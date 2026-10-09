package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import app.locale.exercisetracker.store.TrackCodec;
import app.locale.exercisetracker.store.WorkoutStore;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** On-device: a finished journal becomes a stored workout without the WebView. */
@RunWith(AndroidJUnit4.class)
public class NativeFinalizerTest {
    private Context ctx;
    private String dbName;
    private WorkoutStore store;
    private String id;

    @Before
    public void open() {
        ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        dbName = "test-" + UUID.randomUUID() + ".db";
        store = WorkoutStore.openForTest(ctx, dbName);
        id = "test-" + UUID.randomUUID();
    }

    @After
    public void close() {
        store.close();
        ctx.deleteDatabase(dbName);
        Journal.delete(ctx, id);
    }

    private static String fixture(String name) throws Exception {
        try (InputStream in = NativeFinalizerTest.class.getResourceAsStream("/fixtures/" + name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return out.toString(StandardCharsets.UTF_8);
        }
    }

    @Test
    public void savesTheWorkoutAndRemovesTheJournal() throws Exception {
        String text = fixture("run-hr-pause.ndjson");
        JSONObject expected = new JSONObject(fixture("run-hr-pause.expected.json"));
        NativeFinalizer.writeJournalForTest(ctx, id, text);

        assertTrue(NativeFinalizer.finalizeJournal(ctx, store, id));

        assertFalse("journal deleted", NativeFinalizer.journalExistsForTest(ctx, id));
        JSONObject w = store.getWorkout(id);
        assertNotNull(w);
        assertEquals(expected.getJSONObject("summary").getDouble("distance"), w.getJSONObject("summary").getDouble("distance"), 0.01);
        assertEquals(expected.getInt("n"), TrackCodec.unpack(store.getTrack(id)).n);
        // Raw journal kept, gzipped, for reprocessing later.
        try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(store.getRawJournal(id)))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            gz.transferTo(out);
            assertEquals(text, out.toString(StandardCharsets.UTF_8));
        }
    }

    @Test
    public void keepsTheJournalWhenThereIsNothingToSave() throws Exception {
        NativeFinalizer.writeJournalForTest(ctx, id, "{\"type\":\"meta\",\"workoutId\":\"x\",\"activity\":\"run\",\"startedAt\":1}\n");
        assertFalse(NativeFinalizer.finalizeJournal(ctx, store, id));
        assertTrue("journal kept for the app to handle", NativeFinalizer.journalExistsForTest(ctx, id));
        assertFalse(store.has(id));
    }
}
