package app.locale.exercisetracker.tracker;

import java.util.Locale;
import org.json.JSONObject;

/**
 * The 4×2 widget's weekly distance goal and how this week is going against it. Goals come from
 * settings.goals (src/insights/goals.js): {"run.week": {"distance": 20000}, …} in metres. The
 * widget counts every activity's distance, so the goal is the All-activities one, else the
 * activities' goals added up. A day or month goal counts as its share of a week.
 */
final class WeekGoal {
    private static final String[] ACTIVITIES = { "walk", "run", "hii", "cycle", "ski" };
    private static final double M_PER_MI = 1609.344;

    private WeekGoal() {}

    /** This week's distance goal in metres, or 0 if none is set. */
    static double weeklyMeters(JSONObject goals, int daysInMonth) {
        if (goals == null) return 0;
        double all = forActivity(goals, "all", daysInMonth);
        if (all > 0) return all;
        double sum = 0;
        for (String a : ACTIVITIES) sum += forActivity(goals, a, daysInMonth);
        return sum;
    }

    /** One activity's weekly goal: its week goal, else 7 days of its day goal, else its month goal's share. */
    private static double forActivity(JSONObject goals, String activity, int daysInMonth) {
        double week = distance(goals, activity + ".week");
        if (week > 0) return week;
        double day = distance(goals, activity + ".day");
        if (day > 0) return day * 7;
        double month = distance(goals, activity + ".month");
        return month > 0 ? month * 7 / daysInMonth : 0;
    }

    private static double distance(JSONObject goals, String key) {
        JSONObject g = goals.optJSONObject(key);
        double v = g != null ? g.optDouble("distance", 0) : 0;
        return v > 0 ? v : 0;
    }

    /**
     * How the week is going: ahead of or behind an even share of the goal per day.
     * @param day 0 for Sunday … 6 for Saturday (the week runs Sunday to Saturday)
     */
    static String message(double goalM, double doneM, int day, boolean imperial) {
        double unit = imperial ? M_PER_MI : 1000;
        String u = imperial ? "mi" : "km";
        if (doneM >= goalM) return "Weekly goal reached! Well done!!";
        double byToday = goalM * (day + 1) / 7;
        double byYesterday = goalM * day / 7;
        if (doneM >= byToday) {
            double ahead = (doneM - byToday) / unit;
            return ahead < 0.05 ? "Right on track for your goal. Nice!" : "You're " + amount(ahead) + " " + u + " ahead of your goal! Well done!!";
        }
        String today = amount((byToday - doneM) / unit) + " " + u;
        if (doneM >= byYesterday) return "On track – " + today + " today keeps you on your goal";
        return day == 6
            ? "You're a bit behind your goal – " + today + " today gets you there"
            : "You're a bit behind your goal – you need to go " + today + " today to catch up";
    }

    /** "2", "2.5", "12": tenths, without a trailing ".0". */
    static String amount(double v) {
        double r = Math.max(0.1, Math.round(v * 10) / 10.0);
        return r == Math.floor(r) ? String.format(Locale.US, "%.0f", r) : String.format(Locale.US, "%.1f", r);
    }
}
