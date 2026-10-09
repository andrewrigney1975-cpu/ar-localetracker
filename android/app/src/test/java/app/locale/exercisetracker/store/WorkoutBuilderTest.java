package app.locale.exercisetracker.store;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Iterator;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The Java port must reproduce the JS processing (tests/fixtures.test.js writes the
 * fixtures from the JS implementation). Tolerances only absorb last-bit differences in
 * transcendental functions between V8 and the JVM.
 */
public class WorkoutBuilderTest {
    private static final String[] CASES = { "run-hr-pause", "walk-nobaro", "cycle", "ski", "city2surf", "messy-run" };

    private static String read(String name) throws IOException {
        try (InputStream in = WorkoutBuilderTest.class.getResourceAsStream("/fixtures/" + name)) {
            assertNotNull("missing fixture " + name, in);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return out.toString(StandardCharsets.UTF_8);
        }
    }

    private static void close(String what, double expected, double actual, double tol) {
        if (Double.isNaN(expected)) {
            assertTrue(what + " expected NaN, got " + actual, Double.isNaN(actual));
            return;
        }
        assertEquals(what, expected, actual, tol);
    }

    /** Tolerance per summary field (metres, seconds, m/s, bpm). */
    private static double tolerance(String key) {
        switch (key) {
            case "distance":
            case "longestRun":
            case "elevGain":
            case "elevLoss":
            case "descentVertical":
                return 0.01;
            case "maxSpeed":
            case "maxRunSpeed":
            case "avgSpeed":
            case "avgMovingSpeed":
                return 1e-4;
            default:
                return 1e-6;
        }
    }

    private static void assertJsonClose(String path, Object expected, Object actual) throws Exception {
        if (expected instanceof JSONObject) {
            JSONObject e = (JSONObject) expected;
            JSONObject a = (JSONObject) actual;
            for (Iterator<String> it = e.keys(); it.hasNext(); ) {
                String k = it.next();
                assertTrue(path + "." + k + " missing in Java output", a.has(k));
                if (k.equals("bbox")) {
                    assertJsonArrayClose(path + ".bbox", e.getJSONArray(k), a.getJSONArray(k), 1e-9);
                } else {
                    assertJsonClose(path + "." + k, e.get(k), a.get(k));
                }
            }
            assertEquals(path + " keys", e.length(), a.length());
        } else if (expected instanceof Number) {
            String key = path.substring(path.lastIndexOf('.') + 1);
            close(path, ((Number) expected).doubleValue(), ((Number) actual).doubleValue(), tolerance(key));
        } else {
            assertEquals(path, expected, actual);
        }
    }

    private static void assertJsonArrayClose(String path, JSONArray e, JSONArray a, double tol) throws Exception {
        assertEquals(path + " length", e.length(), a.length());
        for (int i = 0; i < e.length(); i++) close(path + "[" + i + "]", e.getDouble(i), a.getDouble(i), tol);
    }

    @Test
    public void summariesMatchJavaScript() throws Exception {
        for (String name : CASES) {
            JSONObject exp = new JSONObject(read(name + ".expected.json"));
            WorkoutBuilder.Built built = WorkoutBuilder.build(read(name + ".ndjson"), "fixture");
            assertEquals(name + " point count", exp.getInt("n"), built.track.n);
            assertJsonClose(name + ".summary", exp.getJSONObject("summary"), built.workout.getJSONObject("summary"));
            assertEquals(name + " preview length", exp.getInt("previewLength"), built.workout.getJSONArray("preview").length());
            assertEquals(name + " intervals", exp.getJSONArray("activeIntervals").toString(),
                built.workout.getJSONArray("activeIntervals").toString());
        }
    }

    @Test
    public void trackSamplesMatchJavaScript() throws Exception {
        for (String name : CASES) {
            JSONObject exp = new JSONObject(read(name + ".expected.json"));
            WorkoutBuilder.Track t = WorkoutBuilder.build(read(name + ".ndjson"), "fixture").track;
            JSONObject s = exp.getJSONObject("samples");
            JSONArray idx = s.getJSONArray("index");
            for (int k = 0; k < idx.length(); k++) {
                int i = idx.getInt(k);
                String at = name + "[" + i + "]";
                close(at + ".t", s.getJSONArray("t").getDouble(k), t.t[i], 0);
                close(at + ".lat", s.getJSONArray("lat").getDouble(k), t.lat[i], 1e-9);
                close(at + ".lon", s.getJSONArray("lon").getDouble(k), t.lon[i], 1e-9);
                close(at + ".alt", s.getJSONArray("alt").getDouble(k), t.alt[i], 1e-3);
                close(at + ".speed", s.getJSONArray("speed").getDouble(k), t.speed[i], 1e-4);
                close(at + ".dist", s.getJSONArray("dist").getDouble(k), t.dist[i], 0.01);
                close(at + ".active", s.getJSONArray("active").getDouble(k), t.active[i], 1e-9);
                close(at + ".moving", s.getJSONArray("moving").getDouble(k), t.moving[i], 0);
                if (!s.isNull("hr")) {
                    Object h = s.getJSONArray("hr").get(k);
                    if (h == JSONObject.NULL) assertTrue(at + ".hr NaN", Float.isNaN(t.hr[i]));
                    else close(at + ".hr", ((Number) h).doubleValue(), t.hr[i], 1e-3);
                } else {
                    assertEquals(at + " no hr", null, t.hr);
                }
            }
        }
    }

    @Test
    public void trackBlobsAreInterchangeable() throws Exception {
        for (String name : CASES) {
            JSONObject exp = new JSONObject(read(name + ".expected.json"));
            byte[] jsBlob = Base64.getDecoder().decode(exp.getString("trackBlob"));
            assertEquals(name + " JS blob CRC", exp.getLong("trackCrc"), TrackCodec.crc32(jsBlob));
            // Java reads the JS blob…
            TrackCodec.Track fromJs = TrackCodec.unpack(jsBlob);
            assertEquals(name + " n", exp.getInt("n"), fromJs.n);
            // …and Java's own blob round-trips and has the same column layout.
            WorkoutBuilder.Track t = WorkoutBuilder.build(read(name + ".ndjson"), "fixture").track;
            byte[] javaBlob = TrackCodec.pack(t.toCodec());
            TrackCodec.Track back = TrackCodec.unpack(javaBlob);
            assertArrayEquals(name + " columns", fromJs.columns.keySet().toArray(), back.columns.keySet().toArray());
            assertArrayEquals(name + " dist", t.dist, (double[]) back.columns.get("dist"), 0);
            assertEquals(name + " blob size", jsBlob.length, javaBlob.length);
        }
    }

    @Test
    public void crc32MatchesStandardCheckValue() {
        assertEquals(0xCBF43926L, TrackCodec.crc32("123456789".getBytes(StandardCharsets.US_ASCII)));
    }
}
