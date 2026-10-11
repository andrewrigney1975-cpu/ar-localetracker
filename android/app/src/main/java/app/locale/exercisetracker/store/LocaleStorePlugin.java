package app.locale.exercisetracker.store;

import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import app.locale.exercisetracker.tracker.LocaleWidgets;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS access to {@link WorkoutStore}. Blobs travel as base64. All work runs on one
 * background thread, which also serialises writes.
 */
@CapacitorPlugin(name = "LocaleStore")
public class LocaleStorePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> new Thread(r, "LocaleStore"));

    private interface Job {
        void run(WorkoutStore store, PluginCall call) throws Exception;
    }

    private void run(PluginCall call, Job job) {
        io.execute(() -> {
            try {
                job.run(WorkoutStore.get(getContext()), call);
                if (call.getMethodName().matches("saveWorkout|bulkImport|updateWorkout|deleteWorkout")) {
                    LocaleWidgets.updateAll(getContext()); // the week's distance
                }
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), "store", e);
            }
        });
    }

    private static byte[] b64(String s) {
        return s == null ? null : Base64.decode(s, Base64.NO_WRAP);
    }

    private static String b64(byte[] b) {
        return b == null ? null : Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static JSObject js(JSONObject o) throws Exception {
        return new JSObject(o.toString());
    }

    private static final int MAX_COURSE_BYTES = 20 * 1024 * 1024;

    /**
     * Text of a file another app handed us (a course opened from Messages, Gmail or Files):
     * {uri} → {text, name}. Reads through the ContentResolver, which holds the temporary read
     * grant that came with the VIEW intent.
     */
    @PluginMethod
    public void readUri(PluginCall call) {
        io.execute(() -> {
            try {
                Uri uri = Uri.parse(call.getString("uri"));
                String name = null;
                if ("content".equals(uri.getScheme())) {
                    try (Cursor cur = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                        if (cur != null && cur.moveToFirst()) name = cur.getString(0);
                    } catch (Exception ignored) {
                        // Some providers don't answer queries; the name is only a fallback label.
                    }
                }
                if (name == null) name = uri.getLastPathSegment();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new IllegalStateException("Cannot open " + uri);
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        if (out.size() > MAX_COURSE_BYTES) throw new IllegalStateException("File too large");
                    }
                }
                JSObject o = new JSObject();
                o.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
                o.put("name", name);
                call.resolve(o);
            } catch (Exception e) {
                call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), "uri", e);
            }
        });
    }

    @PluginMethod
    public void listWorkouts(PluginCall call) {
        run(call, (store, c) -> {
            JSArray arr = new JSArray();
            for (JSONObject w : store.list()) arr.put(w);
            JSObject o = new JSObject();
            o.put("workouts", arr);
            c.resolve(o);
        });
    }

    @PluginMethod
    public void getWorkout(PluginCall call) {
        run(call, (store, c) -> {
            JSONObject w = store.getWorkout(c.getString("id"));
            JSObject o = new JSObject();
            o.put("workout", w);
            c.resolve(o);
        });
    }

    @PluginMethod
    public void hasWorkout(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("exists", store.has(c.getString("id")));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void getTrack(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("blob", b64(store.getTrack(c.getString("id"))));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void getRawJournal(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("gzip", b64(store.getRawJournal(c.getString("id"))));
            c.resolve(o);
        });
    }

    /** {workout, track: {blob, crc32}, raw?: {gzip, crc32}} → {id, n, trackCrc, rawCrc} as stored. */
    @PluginMethod
    public void saveWorkout(PluginCall call) {
        run(call, (store, c) -> c.resolve(saveOne(store, c.getData())));
    }

    /** Batch of saveWorkout items for the IndexedDB migration: {items: [...]} → {results: [...]}. */
    @PluginMethod
    public void bulkImport(PluginCall call) {
        run(call, (store, c) -> {
            JSONArray items = c.getData().getJSONArray("items");
            JSArray results = new JSArray();
            for (int i = 0; i < items.length(); i++) results.put(saveOne(store, items.getJSONObject(i)));
            JSObject o = new JSObject();
            o.put("results", results);
            c.resolve(o);
        });
    }

    private static JSObject saveOne(WorkoutStore store, JSONObject item) throws Exception {
        JSONObject workout = item.getJSONObject("workout");
        JSONObject track = item.getJSONObject("track");
        JSONObject raw = item.optJSONObject("raw");
        WorkoutStore.Stored s = store.save(
            workout,
            b64(track.getString("blob")),
            track.getLong("crc32"),
            raw != null ? b64(raw.getString("gzip")) : null,
            raw != null ? raw.getLong("crc32") : null);
        JSObject o = new JSObject();
        o.put("id", s.id);
        o.put("n", s.n);
        o.put("trackCrc", s.trackCrc);
        o.put("rawCrc", s.rawCrc);
        return o;
    }

    @PluginMethod
    public void updateWorkout(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("workout", js(store.update(c.getString("id"), c.getObject("patch"))));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void deleteWorkout(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("deleted", store.delete(c.getString("id")));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void stats(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("workouts", store.count("workouts"));
            o.put("tracks", store.count("tracks"));
            o.put("raw", store.count("raw_journals"));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void getMeta(PluginCall call) {
        run(call, (store, c) -> {
            JSObject o = new JSObject();
            o.put("value", store.getMeta(c.getString("key")));
            c.resolve(o);
        });
    }

    @PluginMethod
    public void setMeta(PluginCall call) {
        run(call, (store, c) -> {
            store.setMeta(c.getString("key"), c.getString("value"));
            c.resolve();
        });
    }
}
