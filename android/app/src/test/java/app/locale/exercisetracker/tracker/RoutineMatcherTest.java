package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The native matcher must decide exactly as predictGoal() in JS (tests/routines.test.js writes the fixture). */
public class RoutineMatcherTest {
    private static JSONObject fixture() throws Exception {
        try (InputStream in = RoutineMatcherTest.class.getResourceAsStream("/fixtures/routines.json")) {
            assertNotNull("missing fixture routines.json", in);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return new JSONObject(out.toString(StandardCharsets.UTF_8));
        }
    }

    @Test
    public void replaysSharedCases() throws Exception {
        JSONObject f = fixture();
        RoutineMatcher m = new RoutineMatcher(f.getJSONObject("model"));
        JSONArray cases = f.getJSONArray("cases");
        assertTrue(cases.length() >= 10);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i).getJSONObject("ctx");
            JSONObject exp = cases.getJSONObject(i).getJSONObject("expected");
            double lat = c.isNull("lat") ? Double.NaN : c.getDouble("lat");
            double lon = c.isNull("lon") ? Double.NaN : c.getDouble("lon");
            RoutineMatcher.Prediction p = m.predict(c.getString("activity"), c.getLong("now"), c.getInt("tzOffset"), lat, lon, c.getBoolean("imperial"));
            String what = "case " + i + " " + c;
            if (exp.isNull("goalM")) {
                assertFalse(what, p.hasGoal());
                assertEquals(what, exp.getString("reason"), p.reason);
                if (exp.has("have")) {
                    assertEquals(what, exp.getInt("have"), p.have);
                    assertEquals(what, exp.getInt("need"), p.need);
                }
            } else {
                assertEquals(what, exp.getDouble("goalM"), p.goalM, 0);
                assertEquals(what, exp.getString("source"), p.source);
                assertEquals(what, exp.isNull("routineId") ? null : exp.getString("routineId"), p.routineId);
                assertEquals(what, exp.getString("name"), p.name);
                assertEquals(what, exp.getDouble("confidence"), p.confidence, 0);
                if (exp.has("signature")) assertEquals(what, exp.getJSONArray("signature").toString(), p.signature.toString());
            }
        }
    }

    @Test
    public void localTimeMatchesJs() {
        // Saturday 10 Oct 2026 07:05 in Sydney (UTC+10) = 21:05 UTC on Friday 9 Oct.
        long t = java.time.Instant.parse("2026-10-09T21:05:00Z").toEpochMilli();
        int[] lt = RoutineMatcher.localTime(t, -600);
        assertEquals(6, lt[0]);
        assertEquals(425, lt[1]);
    }

    @Test
    public void missingModelMeansLearning() {
        RoutineMatcher.Prediction p = new RoutineMatcher(null).predict("run", 0, 0, Double.NaN, Double.NaN, false);
        assertFalse(p.hasGoal());
        assertEquals("learning", p.reason);
        assertNull(p.source);
    }

    @Test
    public void routeGuardFiresOnceAfterTwoMinutesOff() throws Exception {
        // A straight 2 km route east from (0, 0).
        JSONArray sig = new JSONArray();
        for (int i = 0; i <= 10; i++) sig.put(new JSONArray().put(0.0).put(i * 0.0018));
        RouteGuard g = new RouteGuard(sig);
        double off = 400 / 111195.0; // 400 m north
        assertFalse(g.onFix(0, 0.009, 0));
        assertFalse(g.onFix(off, 0.009, 10_000));
        assertFalse(g.onFix(0, 0.009, 60_000));
        assertFalse(g.onFix(off, 0.009, 70_000));
        assertFalse(g.onFix(off, 0.009, 189_000));
        assertTrue(g.onFix(off, 0.009, 190_000));
        assertFalse(g.onFix(off, 0.009, 400_000));
        assertEquals(400, g.distanceTo(off, 0.009), 1);
    }

    @Test
    public void coachGoalSetLatePausedAndConfirmed() {
        VoiceCoach.Config cfg = new VoiceCoach.Config();
        cfg.autoGoal = true;
        VoiceCoach c = new VoiceCoach(cfg);
        assertTrue(c.enabled());
        c.setGoal(4000, 1200);
        assertNull(c.onProgress(1500, 540_000));
        assertTrue(c.onProgress(2000, 720_000).startsWith("Halfway to your 4 kilometre goal"));
        c.pauseGoal();
        assertNull(c.onProgress(3000, 1_080_000));
        assertEquals("Goal 4.7 kilometres, your usual Saturday morning loop.", VoiceCoach.goalConfirmation(4700, false, "route", "Saturday morning loop"));
        assertEquals("Goal 5 kilometres, based on your weekend morning walks.", VoiceCoach.goalConfirmation(5000, false, "time", "weekend morning walks"));
        assertEquals("Goal 1 mile.", VoiceCoach.goalConfirmation(1609.344, true, "manual", null));
    }
}
