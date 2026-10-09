package app.locale.exercisetracker.store;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SQLite storage for workouts (see docs/plans/sqlite-migration.md).
 *
 * workouts: one row per workout (summary and the rest of the record as JSON, plus
 * denormalised columns for queries); tracks: packed columnar track blob; raw_journals:
 * gzipped NDJSON journal. Every blob carries a CRC-32 that is checked on write.
 */
public final class WorkoutStore extends SQLiteOpenHelper {
    public static final String DB_NAME = "locale.db";
    private static final int VERSION = 1;

    private static volatile WorkoutStore instance;

    public static WorkoutStore get(Context ctx) {
        if (instance == null) {
            synchronized (WorkoutStore.class) {
                if (instance == null) instance = new WorkoutStore(ctx.getApplicationContext(), DB_NAME);
            }
        }
        return instance;
    }

    /** For tests: a separate database file. */
    public static WorkoutStore openForTest(Context ctx, String name) {
        return new WorkoutStore(ctx.getApplicationContext(), name);
    }

    private WorkoutStore(Context ctx, String name) {
        super(ctx, name, null, VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE workouts ("
            + "id TEXT PRIMARY KEY, activity TEXT NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', "
            + "started_at INTEGER NOT NULL, ended_at INTEGER, distance_m REAL, duration_s REAL, "
            + "summary_json TEXT NOT NULL, record_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER)");
        db.execSQL("CREATE INDEX workouts_started ON workouts(started_at DESC)");
        db.execSQL("CREATE INDEX workouts_activity ON workouts(activity, started_at DESC)");
        db.execSQL("CREATE TABLE tracks (workout_id TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE, "
            + "n INTEGER NOT NULL, format INTEGER NOT NULL DEFAULT 1, columns BLOB NOT NULL, crc32 INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE raw_journals (workout_id TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE, "
            + "gzip BLOB NOT NULL, crc32 INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
        db.execSQL("INSERT INTO meta(key, value) VALUES ('schema_version', '1')");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Future schema migrations go here, one step per version.
    }

    // ---- Writes -----------------------------------------------------------------------------

    /** Result of a stored workout, read back after the write for verification. */
    public static final class Stored {
        public final String id;
        public final int n;
        public final long trackCrc;
        public final long rawCrc;

        Stored(String id, int n, long trackCrc, long rawCrc) {
            this.id = id;
            this.n = n;
            this.trackCrc = trackCrc;
            this.rawCrc = rawCrc;
        }
    }

    /**
     * Insert or replace a workout with its track (and raw journal, if given) in one transaction.
     * Blob CRCs are checked against the expected values before anything is written.
     */
    public Stored save(JSONObject workout, byte[] track, long trackCrc, byte[] rawGzip, Long rawCrc) throws JSONException {
        if (TrackCodec.crc32(track) != trackCrc) throw new IllegalArgumentException("Track CRC mismatch for " + workout.optString("id"));
        if (rawGzip != null && rawCrc != null && TrackCodec.crc32(rawGzip) != rawCrc) {
            throw new IllegalArgumentException("Raw journal CRC mismatch for " + workout.optString("id"));
        }
        TrackCodec.Track decoded = TrackCodec.unpack(track); // validates the blob
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            String id = workout.getString("id");
            db.insertWithOnConflict("workouts", null, workoutRow(workout), SQLiteDatabase.CONFLICT_REPLACE);
            ContentValues t = new ContentValues();
            t.put("workout_id", id);
            t.put("n", decoded.n);
            t.put("format", TrackCodec.FORMAT);
            t.put("columns", track);
            t.put("crc32", trackCrc);
            db.insertWithOnConflict("tracks", null, t, SQLiteDatabase.CONFLICT_REPLACE);
            if (rawGzip != null) {
                ContentValues r = new ContentValues();
                r.put("workout_id", id);
                r.put("gzip", rawGzip);
                r.put("crc32", TrackCodec.crc32(rawGzip));
                db.insertWithOnConflict("raw_journals", null, r, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return readBack(workout.getString("id"));
    }

    /** Recompute CRCs from what is actually stored. */
    public Stored readBack(String id) {
        byte[] track = getTrack(id);
        byte[] raw = getRawJournal(id);
        int n = track != null ? TrackCodec.unpack(track).n : -1;
        return new Stored(id, n, track != null ? TrackCodec.crc32(track) : -1, raw != null ? TrackCodec.crc32(raw) : -1);
    }

    /** Merge fields into a stored workout record (e.g. name, notes). */
    public JSONObject update(String id, JSONObject patch) throws JSONException {
        JSONObject w = getWorkout(id);
        if (w == null) throw new IllegalArgumentException("Workout not found: " + id);
        for (Iterator<String> it = patch.keys(); it.hasNext(); ) {
            String k = it.next();
            if (!"id".equals(k)) w.put(k, patch.get(k));
        }
        w.put("updatedAt", System.currentTimeMillis());
        ContentValues row = workoutRow(w);
        getWritableDatabase().update("workouts", row, "id = ?", new String[] { id });
        return w;
    }

    public boolean delete(String id) {
        return getWritableDatabase().delete("workouts", "id = ?", new String[] { id }) > 0;
    }

    private static ContentValues workoutRow(JSONObject w) throws JSONException {
        JSONObject summary = w.optJSONObject("summary");
        JSONObject rest = new JSONObject(w.toString());
        rest.remove("summary");
        ContentValues v = new ContentValues();
        v.put("id", w.getString("id"));
        v.put("activity", w.optString("activity", "run"));
        v.put("name", w.optString("name", ""));
        v.put("notes", w.optString("notes", ""));
        v.put("started_at", w.getLong("startedAt"));
        if (w.has("endedAt") && !w.isNull("endedAt")) v.put("ended_at", w.getLong("endedAt"));
        if (summary != null) {
            v.put("distance_m", summary.optDouble("distance", 0));
            v.put("duration_s", summary.optDouble("duration", 0));
        }
        v.put("summary_json", summary != null ? summary.toString() : "{}");
        v.put("record_json", rest.toString());
        v.put("created_at", w.optLong("createdAt", System.currentTimeMillis()));
        if (w.has("updatedAt")) v.put("updated_at", w.optLong("updatedAt"));
        return v;
    }

    // ---- Reads ------------------------------------------------------------------------------

    public List<JSONObject> list() throws JSONException {
        List<JSONObject> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
            "SELECT record_json, summary_json FROM workouts ORDER BY started_at DESC", null)) {
            while (c.moveToNext()) out.add(record(c.getString(0), c.getString(1)));
        }
        return out;
    }

    public JSONObject getWorkout(String id) throws JSONException {
        try (Cursor c = getReadableDatabase().rawQuery(
            "SELECT record_json, summary_json FROM workouts WHERE id = ?", new String[] { id })) {
            return c.moveToFirst() ? record(c.getString(0), c.getString(1)) : null;
        }
    }

    private static JSONObject record(String recordJson, String summaryJson) throws JSONException {
        JSONObject w = new JSONObject(recordJson);
        w.put("summary", new JSONObject(summaryJson));
        return w;
    }

    public boolean has(String id) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT 1 FROM workouts WHERE id = ?", new String[] { id })) {
            return c.moveToFirst();
        }
    }

    public byte[] getTrack(String id) {
        return blob("SELECT columns FROM tracks WHERE workout_id = ?", id);
    }

    public byte[] getRawJournal(String id) {
        return blob("SELECT gzip FROM raw_journals WHERE workout_id = ?", id);
    }

    private byte[] blob(String sql, String id) {
        try (Cursor c = getReadableDatabase().rawQuery(sql, new String[] { id })) {
            return c.moveToFirst() ? c.getBlob(0) : null;
        }
    }

    public int count(String table) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + table, null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    // ---- Meta -------------------------------------------------------------------------------

    public String getMeta(String key) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT value FROM meta WHERE key = ?", new String[] { key })) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    public void setMeta(String key, String value) {
        ContentValues v = new ContentValues();
        v.put("key", key);
        v.put("value", value);
        getWritableDatabase().insertWithOnConflict("meta", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }
}
