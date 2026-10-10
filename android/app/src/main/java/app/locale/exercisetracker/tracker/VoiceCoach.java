package app.locale.exercisetracker.tracker;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Voice announcements (splits, time-based, goal-based): when to speak and what to say.
 * Port of src/voice/coach.js; VoiceCoachTest replays the shared fixture so both say exactly
 * the same thing. Pure Java, no Android types, so it is unit-testable on the JVM.
 */
final class VoiceCoach {
    private static final double KM = 1000;
    private static final double MILE = 1609.344;
    private static final double MIN_AVG_DISTANCE_M = 50;

    static final class Config {
        boolean splits;
        boolean time;
        boolean goal;
        int intervalMin = 10;
        double goalM;
        boolean pace = true;
        boolean imperial;
        /** Lower other audio while speaking (true) or pause it (false). Not used for phrasing. */
        boolean duck = true;
        /** Goal mode Auto: the goal comes from RoutineMatcher once it decides. */
        boolean autoGoal;
        /** Say the goal when it is chosen. */
        boolean confirmGoal = true;
        /** Vibrate a paired watch with each announcement. */
        boolean watchBuzz = true;
    }

    static final String OFF_ROUTE_PHRASE = "Off your usual route. Goal announcements paused.";

    final Config cfg;
    private final double unit;
    int splitsDone;
    long lastSplitMs;
    long intervalsDone;
    int goalMask;
    boolean goalPaused;
    /** Kind of the last announcement (for the watch buzz): goal-reached | goal | split | time. */
    String lastKind;

    VoiceCoach(Config cfg) {
        this.cfg = cfg;
        this.unit = cfg.imperial ? MILE : KM;
    }

    boolean enabled() {
        return cfg.splits || cfg.time || (cfg.goal && cfg.goalM > 0) || cfg.autoGoal;
    }

    /** Set (or replace) the goal mid-workout; milestones already passed are not announced. */
    void setGoal(double goalM, double distanceM) {
        cfg.goal = true;
        cfg.goalM = goalM;
        goalMask = 0;
        for (int q = 1; q <= 4; q++) if (distanceM >= (goalM * q) / 4) goalMask |= 1 << q;
    }

    /** Stop goal milestones (e.g. the user left their usual route); other kinds carry on. */
    void pauseGoal() {
        goalPaused = true;
    }

    /** "Goal 4.7 kilometres, your usual Saturday morning loop." (goalConfirmation in coach.js) */
    static String goalConfirmation(double goalM, boolean imperial, String source, String name) {
        String v = spokenNumber(goalM / (imperial ? MILE : KM));
        boolean one = "1".equals(v);
        String words = v + " " + (imperial ? (one ? "mile" : "miles") : (one ? "kilometre" : "kilometres"));
        boolean named = name != null && !name.isEmpty();
        if ("route".equals(source) && named) return "Goal " + words + ", your usual " + name + ".";
        if ("time".equals(source) && named) return "Goal " + words + ", based on your " + name + ".";
        return "Goal " + words + ".";
    }

    /** Mark everything already passed as announced (e.g. resuming without saved state). */
    void syncTo(double distanceM, long elapsedMs) {
        splitsDone = (int) Math.floor(distanceM / unit);
        // Estimate when the last split was passed from the average pace so far.
        lastSplitMs = distanceM > 0 ? Math.round(elapsedMs * ((splitsDone * unit) / distanceM)) : 0;
        intervalsDone = cfg.intervalMin > 0 ? (long) Math.floor(elapsedMs / (cfg.intervalMin * 60000.0)) : 0;
        goalMask = 0;
        if (cfg.goalM > 0) {
            for (int q = 1; q <= 4; q++) if (distanceM >= (cfg.goalM * q) / 4) goalMask |= 1 << q;
        }
    }

    /** Called while recording with the running totals. Returns the text to speak, or null. */
    String onProgress(double distanceM, long elapsedMs) {
        List<String> parts = new ArrayList<>();
        boolean saidDistance = false;
        boolean kSplit = false;
        boolean kTime = false;
        boolean kGoal = false;
        boolean kReached = false;

        int k = (int) Math.floor(distanceM / unit);
        if (k > splitsDone) {
            if (cfg.splits) {
                parts.add(spokenDistance(k * unit, cfg.imperial) + ". Split time "
                    + spokenDuration((double) (elapsedMs - lastSplitMs) / (k - splitsDone)) + ".");
                saidDistance = true;
                kSplit = true;
            }
            splitsDone = k;
            lastSplitMs = elapsedMs;
        }

        if (cfg.intervalMin > 0) {
            long intervalMs = cfg.intervalMin * 60000L;
            long j = elapsedMs / intervalMs;
            if (j > intervalsDone) {
                if (cfg.time) {
                    parts.add(capitalise(spokenDuration(j * intervalMs)) + "."
                        + (saidDistance ? "" : " Distance " + spokenDistance(distanceM, cfg.imperial) + "."));
                    saidDistance = true;
                    kTime = true;
                }
                intervalsDone = j;
            }
        }

        if (cfg.goalM > 0) {
            int reached = 0;
            for (int q = 1; q <= 4; q++) {
                int bit = 1 << q;
                if ((goalMask & bit) == 0 && distanceM >= (cfg.goalM * q) / 4) {
                    goalMask |= bit;
                    reached = q;
                }
            }
            if (reached != 0 && cfg.goal && !goalPaused) {
                String goal = spokenNumber(cfg.goalM / unit) + (cfg.imperial ? " mile goal" : " kilometre goal");
                if (reached == 4) kReached = true;
                else kGoal = true;
                if (reached == 4) {
                    parts.add("Goal reached: " + goal + ", in " + spokenDuration(elapsedMs) + ".");
                } else {
                    String head = reached == 2 ? "Halfway to your " + goal + "." : (reached * 25) + " percent of your " + goal + ".";
                    parts.add(saidDistance ? head : head + " " + spokenDistance(distanceM, cfg.imperial) + ".");
                }
            }
        }

        lastKind = kReached ? "goal-reached" : kGoal ? "goal" : kSplit ? "split" : kTime ? "time" : null;
        if (parts.isEmpty()) return null;
        if (distanceM >= MIN_AVG_DISTANCE_M && elapsedMs > 0) parts.add(spokenAverage(distanceM, elapsedMs, cfg.pace, cfg.imperial));
        return String.join(" ", parts);
    }

    static String spokenAverage(double distanceM, double elapsedMs, boolean pace, boolean imperial) {
        double unit = imperial ? MILE : KM;
        if (pace) {
            double perUnitMs = Math.round(elapsedMs / (distanceM / unit) / 1000) * 1000.0;
            return "Average pace " + spokenDuration(perUnitMs) + " per " + (imperial ? "mile" : "kilometre") + ".";
        }
        double perHour = distanceM / unit / (elapsedMs / 3600000);
        double v = Math.round(perHour * 10) / 10.0;
        return "Average speed " + spokenNumber(v) + (imperial ? " miles" : " kilometres") + " per hour.";
    }

    static String spokenDistance(double m, boolean imperial) {
        // Floor, so 0.999 km isn't announced as 1; the epsilon keeps 5 × 1609.344 / 1609.344 at 5.
        double v = Math.floor((m / (imperial ? MILE : KM)) * 100 + 1e-6) / 100;
        String word = imperial ? "mile" : "kilometre";
        return spokenNumber(v) + " " + (v == 1 ? word : word + "s");
    }

    static String spokenDuration(double ms) {
        long total = Math.max(0, Math.round(ms / 1000));
        long h = total / 3600;
        long m = (total % 3600) / 60;
        long s = total % 60;
        List<String> out = new ArrayList<>();
        if (h != 0) out.add(part(h, "hour"));
        if (m != 0) out.add(part(m, "minute"));
        if (s != 0 || out.isEmpty()) out.add(part(s, "second"));
        return String.join(" ", out);
    }

    static String spokenNumber(double v) {
        double r = Math.round(v * 100) / 100.0;
        return BigDecimal.valueOf(r).stripTrailingZeros().toPlainString();
    }

    private static String part(long n, String word) {
        return n + " " + word + (n == 1 ? "" : "s");
    }

    private static String capitalise(String s) {
        return s.substring(0, 1).toUpperCase(Locale.ROOT) + s.substring(1);
    }
}
