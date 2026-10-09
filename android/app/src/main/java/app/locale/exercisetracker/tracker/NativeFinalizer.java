package app.locale.exercisetracker.tracker;

import android.content.Context;
import android.util.Log;
import app.locale.exercisetracker.store.TrackCodec;
import app.locale.exercisetracker.store.WorkoutBuilder;
import app.locale.exercisetracker.store.WorkoutStore;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPOutputStream;

/** Turns a finished journal into a stored workout without the WebView. */
public final class NativeFinalizer {
    private static final String TAG = "LocaleTracker";

    private NativeFinalizer() {}

    /**
     * Build the workout from journal {@code id}, save it (track + gzipped journal, CRC-checked)
     * and delete the journal. Returns false, keeping the journal, if anything fails or the
     * workout is too short to keep.
     */
    public static boolean finalizeJournal(Context ctx, WorkoutStore store, String id) {
        try {
            String text = Journal.read(ctx, id);
            if (text == null) return false;
            WorkoutBuilder.Built built = WorkoutBuilder.build(text, id);
            if (built.track.n < 2) return false; // too short: the app offers to discard it
            byte[] blob = TrackCodec.pack(built.track.toCodec());
            long crc = TrackCodec.crc32(blob);
            byte[] gz = gzip(text);
            WorkoutStore.Stored stored = store.save(built.workout, blob, crc, gz, TrackCodec.crc32(gz));
            if (stored.n != built.track.n || stored.trackCrc != crc) return false;
            Journal.delete(ctx, id);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Native save failed; the app will import the journal", e);
            return false;
        }
    }

    static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(Math.max(64, text.length() / 4));
        try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
            gz.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return bytes.toByteArray();
    }

    /** Test hook: write a journal file the way TrackingService would. */
    public static void writeJournalForTest(Context ctx, String id, String text) throws IOException {
        java.io.File f = Journal.fileFor(ctx, id);
        f.getParentFile().mkdirs();
        java.nio.file.Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    public static boolean journalExistsForTest(Context ctx, String id) {
        return Journal.fileFor(ctx, id).exists();
    }
}
