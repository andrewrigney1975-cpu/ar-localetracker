package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The native announcer must say exactly what the JS one does (tests/voice.test.js writes the fixture). */
public class VoiceCoachTest {
    private static JSONArray fixture() throws Exception {
        try (InputStream in = VoiceCoachTest.class.getResourceAsStream("/fixtures/voice.json")) {
            assertNotNull("missing fixture voice.json", in);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            in.transferTo(out);
            return new JSONArray(out.toString(StandardCharsets.UTF_8));
        }
    }

    @Test
    public void replaysSharedScenarios() throws Exception {
        JSONArray scenarios = fixture();
        assertEquals(9, scenarios.length());
        for (int s = 0; s < scenarios.length(); s++) {
            JSONObject sc = scenarios.getJSONObject(s);
            JSONObject c = sc.getJSONObject("cfg");
            VoiceCoach.Config cfg = new VoiceCoach.Config();
            cfg.splits = c.getBoolean("splits");
            cfg.time = c.getBoolean("time");
            cfg.goal = c.getBoolean("goal");
            cfg.intervalMin = c.getInt("intervalMin");
            cfg.goalM = c.getDouble("goalM");
            cfg.pace = c.getBoolean("pace");
            cfg.imperial = c.getBoolean("imperial");
            cfg.countdown = c.optBoolean("countdown", false);
            cfg.routine = c.optBoolean("routine", false);
            VoiceCoach coach = new VoiceCoach(cfg);
            JSONArray sync = sc.optJSONArray("sync");
            if (sync != null) coach.syncTo(sync.getDouble(0), sync.getLong(1));
            JSONArray plan = sc.optJSONArray("plan");
            if (plan != null) coach.setPlan(HiiPlan.fromJson(plan.getJSONObject(0)), plan.getLong(1));
            long stopS = sc.has("stopS") ? sc.getLong("stopS") : -1;

            List<String> said = new ArrayList<>();
            JSONArray samples = sc.getJSONArray("samples");
            for (int i = 0; i < samples.length(); i++) {
                JSONArray p = samples.getJSONArray(i);
                if (stopS >= 0 && p.getLong(1) >= stopS * 1000 && coach.plan.stopS < 0) coach.stopPlan(stopS);
                String text = coach.onProgress(p.getDouble(0), p.getLong(1));
                if (text != null) said.add(i + ": " + text);
            }
            List<String> expected = new ArrayList<>();
            JSONArray exp = sc.getJSONArray("expected");
            for (int i = 0; i < exp.length(); i++) {
                JSONObject e = exp.getJSONObject(i);
                expected.add(e.getInt("i") + ": " + e.getString("text"));
            }
            assertEquals(sc.getString("name"), expected, said);
        }
    }

    @Test
    public void announcementKindsForTheWatchBuzz() {
        VoiceCoach.Config cfg = new VoiceCoach.Config();
        cfg.splits = true;
        cfg.time = true;
        cfg.intervalMin = 5;
        cfg.goal = true;
        cfg.goalM = 4000;
        VoiceCoach c = new VoiceCoach(cfg);
        c.onProgress(500, 180000);
        assertNull(c.lastKind);
        c.onProgress(1000, 299000);
        assertEquals("goal", c.lastKind);
        c.onProgress(1500, 300000);
        assertEquals("time", c.lastKind);
        c.onProgress(4000, 599000);
        assertEquals("goal-reached", c.lastKind);
        VoiceCoach.Config sc = new VoiceCoach.Config();
        sc.splits = true;
        VoiceCoach s = new VoiceCoach(sc);
        s.onProgress(1000, 300000);
        assertEquals("split", s.lastKind);
    }

    @Test
    public void routineSettingsReplaceTheActivitys() {
        VoiceCoach.Config cfg = new VoiceCoach.Config();
        cfg.splits = true;
        cfg.autoGoal = true;
        VoiceCoach c = new VoiceCoach(cfg);
        c.setGoal(4000, 0, false);
        c.applyRoutine(false, true, false, 5, 420000);
        assertEquals(1, c.intervalsDone);
        assertNull(c.onProgress(1001, 540000));
        assertEquals("10 minutes. Distance 1.1 kilometres. Average pace 9 minutes 5 seconds per kilometre.", c.onProgress(1100, 600000));
    }

    @Test
    public void phrases() {
        assertEquals("1 hour 3 minutes 5 seconds", VoiceCoach.spokenDuration(3785000));
        assertEquals("0 seconds", VoiceCoach.spokenDuration(0));
        assertEquals("1.5 kilometres", VoiceCoach.spokenDistance(1500, false));
        assertEquals("5 miles", VoiceCoach.spokenDistance(5 * 1609.344, true));
        assertEquals("Average speed 24.3 kilometres per hour.", VoiceCoach.spokenAverage(24300, 3600000, false, false));
        assertEquals("1 hour and 3 minutes to go.", VoiceCoach.spokenTimeToGo(3785000));
        assertEquals("31 minutes to go.", VoiceCoach.spokenTimeToGo(31 * 60000 - 20000));
        assertEquals("2 hours to go.", VoiceCoach.spokenTimeToGo(7200000));
        assertEquals("1 minute to go.", VoiceCoach.spokenTimeToGo(5000));
        assertNull(new VoiceCoach(new VoiceCoach.Config()).onProgress(500, 60000));
    }
}
