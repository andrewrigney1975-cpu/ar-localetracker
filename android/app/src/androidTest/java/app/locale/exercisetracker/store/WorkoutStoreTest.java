package app.locale.exercisetracker.store;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * On-device tests for {@link WorkoutStore}. Each test uses its own throwaway database file,
 * never the app's real locale.db.
 */
@RunWith(AndroidJUnit4.class)
public class WorkoutStoreTest {
    private Context ctx;
    private String dbName;
    private WorkoutStore store;

    @Before
    public void open() {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        dbName = "test-" + UUID.randomUUID() + ".db";
        store = WorkoutStore.openForTest(ctx, dbName);
    }

    @After
    public void close() {
        store.close();
        ctx.deleteDatabase(dbName);
    }

    private static String fixture(String name) throws Exception {
        try (InputStream in = WorkoutStoreTest.class.getResourceAsStream("/fixtures/" + name)) {
            assertNotNull(name, in);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return out.toString(StandardCharsets.UTF_8);
        }
    }

    private WorkoutStore.Stored saveFixture(String name, String id) throws Exception {
        String text = fixture(name + ".ndjson");
        WorkoutBuilder.Built b = WorkoutBuilder.build(text, id);
        byte[] blob = TrackCodec.pack(b.track.toCodec());
        byte[] raw = text.getBytes(StandardCharsets.UTF_8);
        return store.save(b.workout, blob, TrackCodec.crc32(blob), raw, TrackCodec.crc32(raw));
    }

    @Test
    public void schemaIsVersionOne() {
        assertEquals("1", store.getMeta("schema_version"));
        assertEquals(1, store.getReadableDatabase().getVersion());
        assertTrue(store.getReadableDatabase().isWriteAheadLoggingEnabled());
    }

    @Test
    public void savesAndReadsBackAWorkoutWithTrackAndJournal() throws Exception {
        WorkoutStore.Stored s = saveFixture("run-hr-pause", "w1");
        WorkoutBuilder.Built expected = WorkoutBuilder.build(fixture("run-hr-pause.ndjson"), "w1");
        assertEquals(expected.track.n, s.n);
        JSONObject w = store.getWorkout("w1");
        assertEquals("run", w.getString("activity"));
        assertEquals(expected.workout.getJSONObject("summary").getDouble("distance"),
            w.getJSONObject("summary").getDouble("distance"), 0);
        TrackCodec.Track t = TrackCodec.unpack(store.getTrack("w1"));
        assertEquals(expected.track.n, t.n);
        assertNotNull("heart rate column kept", t.columns.get("hr"));
        assertEquals(fixture("run-hr-pause.ndjson"), new String(store.getRawJournal("w1"), StandardCharsets.UTF_8));
        assertTrue(store.has("w1"));
    }

    @Test
    public void listsNewestFirst() throws Exception {
        saveFixture("cycle", "older");
        WorkoutStore.Stored s = saveFixture("ski", "newer");
        JSONObject newer = store.getWorkout("newer");
        newer.put("startedAt", store.getWorkout("older").getLong("startedAt") + 1000);
        store.update("newer", new JSONObject().put("startedAt", newer.getLong("startedAt")));
        assertEquals("newer", store.list().get(0).getString("id"));
        assertEquals(2, store.list().size());
        assertTrue(s.n > 0);
    }

    @Test
    public void updatesNameAndNotesWithoutTouchingTheTrack() throws Exception {
        WorkoutStore.Stored s = saveFixture("walk-nobaro", "w2");
        JSONObject updated = store.update("w2", new JSONObject().put("name", "Lake loop").put("notes", "Windy"));
        assertEquals("Lake loop", updated.getString("name"));
        assertEquals("Windy", store.getWorkout("w2").getString("notes"));
        assertEquals(s.trackCrc, store.readBack("w2").trackCrc);
    }

    @Test
    public void deleteCascadesToTrackAndJournal() throws Exception {
        saveFixture("cycle", "w3");
        assertTrue(store.delete("w3"));
        assertFalse(store.has("w3"));
        assertNull(store.getTrack("w3"));
        assertNull(store.getRawJournal("w3"));
        assertEquals(0, store.count("tracks"));
        assertEquals(0, store.count("raw_journals"));
    }

    @Test
    public void upsertReplacesInsteadOfDuplicating() throws Exception {
        saveFixture("cycle", "w4");
        saveFixture("cycle", "w4");
        assertEquals(1, store.count("workouts"));
        assertEquals(1, store.count("tracks"));
    }

    @Test
    public void rejectsCorruptBlobs() throws Exception {
        WorkoutBuilder.Built b = WorkoutBuilder.build(fixture("cycle.ndjson"), "bad");
        byte[] blob = TrackCodec.pack(b.track.toCodec());
        try {
            store.save(b.workout, blob, TrackCodec.crc32(blob) ^ 1, null, null);
            fail("CRC mismatch accepted");
        } catch (IllegalArgumentException expected) {
            assertFalse(store.has("bad"));
        }
    }

    @Test
    public void storesALongTrack() throws Exception {
        // ~14 hours at 1 Hz.
        WorkoutBuilder.Built b = WorkoutBuilder.build(fixture("city2surf.ndjson"), "big");
        TrackCodec.Track big = new TrackCodec.Track(50_000);
        double[] t = new double[50_000];
        for (int i = 0; i < t.length; i++) t[i] = i * 1000.0;
        big.columns.put("t", t);
        big.columns.put("dist", new double[50_000]);
        big.columns.put("alt", new float[50_000]);
        byte[] blob = TrackCodec.pack(big);
        WorkoutStore.Stored s = store.save(b.workout, blob, TrackCodec.crc32(blob), null, null);
        assertEquals(50_000, s.n);
        assertEquals(TrackCodec.crc32(blob), s.trackCrc);
    }

    @Test
    public void metaRoundTrips() {
        assertNull(store.getMeta("migrated_from_idb"));
        store.setMeta("migrated_from_idb", "123");
        assertEquals("123", store.getMeta("migrated_from_idb"));
    }

    @Test
    public void foreignKeysAreEnforced() {
        SQLiteDatabase db = store.getWritableDatabase();
        try {
            db.execSQL("INSERT INTO tracks(workout_id, n, columns, crc32) VALUES ('nope', 1, x'00', 0)");
            fail("orphan track accepted");
        } catch (android.database.SQLException expected) {
            // FOREIGN KEY constraint failed
        }
    }
}
