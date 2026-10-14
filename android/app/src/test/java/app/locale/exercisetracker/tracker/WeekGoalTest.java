package app.locale.exercisetracker.tracker;

import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

public class WeekGoalTest {
    private static JSONObject goals(String json) throws Exception {
        return new JSONObject(json);
    }

    @Test
    public void allActivitiesGoalWins() throws Exception {
        JSONObject g = goals("{\"all.week\":{\"distance\":30000},\"run.week\":{\"distance\":20000}}");
        assertEquals(30000, WeekGoal.weeklyMeters(g, 31), 1e-6);
    }

    @Test
    public void addsUpActivityGoalsAndConvertsDayAndMonthGoals() throws Exception {
        // Run 20 km a week, walk 2 km a day (14 km a week), cycle 310 km a month (70 km a week in a 31-day month).
        JSONObject g = goals("{\"run.week\":{\"distance\":20000},\"walk.day\":{\"distance\":2000},\"cycle.month\":{\"distance\":310000}}");
        assertEquals(20000 + 14000 + 70000, WeekGoal.weeklyMeters(g, 31), 1e-6);
    }

    @Test
    public void noDistanceGoal() throws Exception {
        assertEquals(0, WeekGoal.weeklyMeters(goals("{\"run.week\":{\"time\":7200}}"), 30), 0);
        assertEquals(0, WeekGoal.weeklyMeters(null, 30), 0);
    }

    @Test
    public void aheadBehindAndDone() {
        double goal = 21000; // 3 km a day
        // Tuesday (day 2): 9 km due by tonight.
        assertEquals("You're 2 km ahead of your goal! Well done!!", WeekGoal.message(goal, 11000, 2, false));
        assertEquals("Right on track for your goal. Nice!", WeekGoal.message(goal, 9000, 2, false));
        // 6 km done by Monday night, none yet today.
        assertEquals("On track – 3 km today keeps you on your goal", WeekGoal.message(goal, 6000, 2, false));
        assertEquals("You're a bit behind your goal – you need to go 4.5 km today to catch up", WeekGoal.message(goal, 4500, 2, false));
        assertEquals("You're a bit behind your goal – 5 km today gets you there", WeekGoal.message(goal, 16000, 6, false));
        assertEquals("Weekly goal reached! Well done!!", WeekGoal.message(goal, 21000, 4, false));
    }

    @Test
    public void imperialMessages() {
        assertEquals("You're 1 mi ahead of your goal! Well done!!", WeekGoal.message(7 * 1609.344, 2 * 1609.344, 0, true));
    }
}
