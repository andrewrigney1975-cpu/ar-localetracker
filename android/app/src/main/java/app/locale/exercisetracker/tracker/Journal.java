package app.locale.exercisetracker.tracker;

import android.content.Context;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Append-only NDJSON journal for one workout. Lines are buffered and fsync'd in
 * small batches so a crash or process kill loses at most a few seconds of data.
 *
 * Line types: meta (first line), pt (GNSS fix), state (recording/paused/...), end.
 */
final class Journal {
    private static final int FLUSH_LINES = 10;
    private static final long FLUSH_INTERVAL_MS = 5000;

    private final File file;
    private FileOutputStream out;
    private final StringBuilder buffer = new StringBuilder(8192);
    private int bufferedLines = 0;
    private long lastFlushMs = 0;

    Journal(File file) throws IOException {
        this.file = file;
        File dir = file.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create journal directory " + dir);
        }
        this.out = new FileOutputStream(file, true);
        this.lastFlushMs = System.currentTimeMillis();
    }

    static File dir(Context ctx) {
        return new File(ctx.getFilesDir(), "journal");
    }

    static File fileFor(Context ctx, String workoutId) {
        return new File(dir(ctx), sanitize(workoutId) + ".ndjson");
    }

    static String sanitize(String id) {
        return id.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    boolean isEmpty() {
        return file.length() == 0 && buffer.length() == 0;
    }

    void append(JSONObject line, boolean forceFlush) {
        buffer.append(line.toString()).append('\n');
        bufferedLines++;
        long now = System.currentTimeMillis();
        if (forceFlush || bufferedLines >= FLUSH_LINES || now - lastFlushMs >= FLUSH_INTERVAL_MS) {
            flush();
        }
    }

    void flush() {
        if (out == null) return;
        lastFlushMs = System.currentTimeMillis();
        if (buffer.length() == 0) return;
        try {
            out.write(buffer.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
            buffer.setLength(0);
            bufferedLines = 0;
        } catch (IOException e) {
            // Keep the buffer and retry on the next flush.
        }
    }

    void close() {
        flush();
        try {
            if (out != null) out.close();
        } catch (IOException ignored) {
        }
        out = null;
    }

    // ---- Static helpers used by the plugin -------------------------------------------------

    static final class Info {
        String workoutId;
        String metaJson;
        boolean ended;
        long sizeBytes;
        long modifiedAt;
    }

    static List<Info> list(Context ctx) {
        List<Info> result = new ArrayList<>();
        File[] files = dir(ctx).listFiles((d, name) -> name.endsWith(".ndjson"));
        if (files == null) return result;
        for (File f : files) {
            Info info = new Info();
            String name = f.getName();
            info.workoutId = name.substring(0, name.length() - ".ndjson".length());
            info.sizeBytes = f.length();
            info.modifiedAt = f.lastModified();
            info.metaJson = readFirstLine(f);
            info.ended = lastLineContains(f, "\"type\":\"end\"");
            result.add(info);
        }
        return result;
    }

    static String read(Context ctx, String workoutId) throws IOException {
        File f = fileFor(ctx, workoutId);
        if (!f.exists()) return null;
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }

    static boolean delete(Context ctx, String workoutId) {
        File f = fileFor(ctx, workoutId);
        return !f.exists() || f.delete();
    }

    private static String readFirstLine(File f) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            return r.readLine();
        } catch (IOException e) {
            return null;
        }
    }

    private static boolean lastLineContains(File f, String needle) {
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long len = raf.length();
            int n = (int) Math.min(len, 1024);
            if (n == 0) return false;
            byte[] tail = new byte[n];
            raf.seek(len - n);
            raf.readFully(tail);
            String s = new String(tail, StandardCharsets.UTF_8).trim();
            int nl = s.lastIndexOf('\n');
            String last = nl >= 0 ? s.substring(nl + 1) : s;
            return last.contains(needle);
        } catch (IOException e) {
            return false;
        }
    }
}
