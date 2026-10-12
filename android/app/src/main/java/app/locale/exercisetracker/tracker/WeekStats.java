package app.locale.exercisetracker.tracker;

import java.util.Locale;

/**
 * The week widget's average split and speed: the week's total distance over its total
 * moving time, so longer workouts count for more (the same basis Insights uses for pace).
 */
final class WeekStats {
    private static final double M_PER_MI = 1609.344;

    private WeekStats() {}

    /** "Avg split 6:12 /km" (or "/mi"), or null without distance or moving time. */
    static String split(double meters, double movingS, boolean imperial) {
        if (!(meters > 0) || !(movingS > 0)) return null;
        long s = Math.round(movingS / (meters / (imperial ? M_PER_MI : 1000)));
        String time = s >= 3600
            ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
            : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
        return "Avg split " + time + (imperial ? " /mi" : " /km");
    }

    /** "Avg speed 9.7 km/h" (or "mph"), or null without distance or moving time. */
    static String speed(double meters, double movingS, boolean imperial) {
        if (!(meters > 0) || !(movingS > 0)) return null;
        double mps = meters / movingS;
        double value = imperial ? mps * 3600 / M_PER_MI : mps * 3.6;
        return String.format(Locale.US, "Avg speed %.1f %s", value, imperial ? "mph" : "km/h");
    }
}
