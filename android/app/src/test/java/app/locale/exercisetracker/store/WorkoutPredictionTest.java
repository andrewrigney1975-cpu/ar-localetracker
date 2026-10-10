package app.locale.exercisetracker.store;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The goal used for a workout is kept on its record, as predictionRecord() does in JS. */
public class WorkoutPredictionTest {
    private static String journal(String goalLines) {
        StringBuilder sb = new StringBuilder();
        long t0 = 1_791_000_000_000L;
        sb.append("{\"type\":\"meta\",\"v\":1,\"workoutId\":\"w1\",\"activity\":\"walk\",\"startedAt\":").append(t0).append("}\n");
        sb.append("{\"type\":\"state\",\"t\":").append(t0).append(",\"state\":\"recording\",\"seg\":0}\n");
        sb.append(goalLines);
        for (int i = 0; i < 60; i++) {
            sb.append("{\"type\":\"pt\",\"s\":").append(i + 1).append(",\"t\":").append(t0 + i * 1000L)
                .append(",\"lat\":").append(-33.87 + i * 0.00001).append(",\"lon\":151.21,\"ha\":4,\"sp\":1.3,\"seg\":0}\n");
        }
        sb.append("{\"type\":\"end\",\"t\":").append(t0 + 60_000).append("}\n");
        return sb.toString();
    }

    @Test
    public void lastGoalLineBecomesThePrediction() throws Exception {
        String goals = "{\"type\":\"goal\",\"t\":1,\"goalM\":4700,\"source\":\"route\",\"routineId\":\"w0001\",\"name\":\"Saturday morning loop\",\"confidence\":0.91}\n"
            + "{\"type\":\"goal\",\"t\":2,\"goalM\":4700,\"source\":\"route\",\"routineId\":\"w0001\",\"name\":\"Saturday morning loop\",\"confidence\":0.91,\"offRoute\":true}\n";
        JSONObject w = WorkoutBuilder.build(journal(goals), null).workout;
        JSONObject p = w.getJSONObject("prediction");
        assertEquals(4700, p.getDouble("goalM"), 0);
        assertEquals("route", p.getString("source"));
        assertEquals("w0001", p.getString("routineId"));
        assertEquals("Saturday morning loop", p.getString("name"));
        assertEquals(0.91, p.getDouble("confidence"), 0);
        assertTrue(p.getBoolean("offRoute"));
    }

    @Test
    public void noGoalNoPrediction() throws Exception {
        assertFalse(WorkoutBuilder.build(journal(""), null).workout.has("prediction"));
        String manual = "{\"type\":\"goal\",\"t\":1,\"goalM\":5000,\"source\":\"manual\",\"confidence\":1}\n";
        JSONObject p = WorkoutBuilder.build(journal(manual), null).workout.getJSONObject("prediction");
        assertEquals("manual", p.getString("source"));
        assertTrue(p.isNull("routineId"));
    }
}
