package app.locale.exercisetracker.tracker;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Predicts the goal distance for a new workout from the learned routine model. Port of
 * predictGoal() in src/insights/routines.js; RoutineMatcherTest replays the shared fixture.
 * The model itself is built in JS and stored as "routines.v1" in CapacitorStorage.
 */
final class RoutineMatcher {
    static final double EARTH_RADIUS = 6371008.8;
    private static final double RAD = Math.PI / 180;
    // Same tunables as T in routines.js.
    private static final double SAME_START_M = 300;
    private static final double TIME_SIGMA_MIN = 75;
    private static final double MIN_TIME_MATCH = 0.25;
    private static final double MIN_SHARE = 0.7;
    private static final double MIN_MARGIN = 0.3;
    private static final int DEFAULT_NEED = 5;

    /** A decision: goal set ({@code goalM > 0}) or not, with the reason. */
    static final class Prediction {
        double goalM;
        String source; // route | time
        String routineId;
        String name;
        double confidence;
        JSONArray signature; // [[lat, lon], ...] for route predictions
        String reason; // learning | unsure, when no goal
        int have;
        int need;

        boolean hasGoal() {
            return goalM > 0;
        }
    }

    private final JSONObject model;

    RoutineMatcher(JSONObject model) {
        this.model = model;
    }

    /** Local weekday (0 = Sunday) and minute of day; tzOffset as JS getTimezoneOffset(). */
    static int[] localTime(long ms, int tzOffset) {
        long local = ms - tzOffset * 60000L;
        long days = Math.floorDiv(local, 86400000L);
        int minute = (int) (Math.floorMod(local, 86400000L) / 60000L);
        int weekday = (int) Math.floorMod(days + 4, 7L); // 1970-01-01 was a Thursday
        return new int[] { weekday, minute };
    }

    static int dayPart(int minute) {
        if (minute < 300 || minute >= 1260) return 0;
        if (minute < 660) return 1;
        if (minute < 900) return 2;
        if (minute < 1080) return 3;
        return 4;
    }

    private static boolean weekend(int wd) {
        return wd == 0 || wd == 6;
    }

    private static double circDiff(double a, double b) {
        double d = Math.abs(a - b) % 1440;
        return d > 720 ? 1440 - d : d;
    }

    /** Equirectangular distance, as makeProjection() in geo.js. */
    static double metres(double lat1, double lon1, double lat2, double lon2) {
        double kx = Math.cos(lat1 * RAD) * EARTH_RADIUS * RAD;
        double ky = EARTH_RADIUS * RAD;
        return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * ky);
    }

    private static double round4(double v) {
        return Math.round(v * 1e4) / 1e4;
    }

    /** @param lat NaN when there is no good fix yet (time-only fallback). */
    Prediction predict(String activity, long now, int tzOffset, double lat, double lon, boolean imperial) {
        Prediction p = new Prediction();
        JSONObject acts = model != null ? model.optJSONObject("activities") : null;
        JSONObject a = acts != null ? acts.optJSONObject(activity) : null;
        p.need = model != null ? model.optInt("need", DEFAULT_NEED) : DEFAULT_NEED;
        if (a == null || !a.optBoolean("ready")) {
            p.reason = "learning";
            p.have = a != null ? a.optInt("usable") : 0;
            return p;
        }
        int[] lt = localTime(now, tzOffset);
        int weekday = lt[0];
        int minute = lt[1];
        String units = imperial ? "imperial" : "metric";
        boolean hasFix = !Double.isNaN(lat) && !Double.isNaN(lon);

        if (hasFix) {
            double total = 0;
            JSONObject best = null;
            double bestTm = 0;
            double bestScore = 0;
            double secondScore = 0;
            double othersScore = 0;
            JSONArray routines = a.optJSONArray("routines");
            for (int i = 0; routines != null && i < routines.length(); i++) {
                JSONObject r = routines.optJSONObject(i);
                if (!r.optBoolean("eligible")) continue;
                JSONArray start = r.optJSONArray("start");
                if (metres(lat, lon, start.optDouble(0), start.optDouble(1)) > SAME_START_M) continue;
                double tm = timeMatch(minute, r.optDouble("startMin"));
                JSONArray days = r.optJSONArray("weekdays");
                boolean sameType = false;
                for (int d = 0; d < 7; d++) if (days.optInt(d) > 0 && weekend(d) == weekend(weekday)) sameType = true;
                double s = r.optDouble("weight") * tm * dayFactor(days.optInt(weekday) > 0, sameType);
                total += s;
                if (s > bestScore) {
                    secondScore = bestScore;
                    bestScore = s;
                    best = r;
                    bestTm = tm;
                } else if (s > secondScore) {
                    secondScore = s;
                }
            }
            if (best != null) {
                JSONArray others = a.optJSONArray("others");
                for (int i = 0; others != null && i < others.length(); i++) {
                    JSONArray o = others.optJSONArray(i);
                    if (metres(lat, lon, o.optDouble(0), o.optDouble(1)) > SAME_START_M) continue;
                    int wd = o.optInt(4);
                    double s = o.optDouble(2) * timeMatch(minute, o.optDouble(3)) * dayFactor(wd == weekday, weekend(wd) == weekend(weekday));
                    total += s;
                    othersScore += s;
                }
                double share = bestScore / total;
                double margin = (bestScore - Math.max(secondScore, othersScore)) / total;
                if (bestTm >= MIN_TIME_MATCH && share >= MIN_SHARE && margin >= MIN_MARGIN) {
                    p.goalM = best.optJSONObject("goal").optDouble(units);
                    p.source = "route";
                    p.routineId = best.optString("id");
                    p.name = best.optString("name");
                    p.confidence = round4(share);
                    p.signature = best.optJSONArray("signature");
                    return p;
                }
            }
            p.reason = "unsure";
            return p;
        }

        JSONArray buckets = a.optJSONArray("buckets");
        int dayType = weekend(weekday) ? 1 : 0;
        int part = dayPart(minute);
        for (int i = 0; buckets != null && i < buckets.length(); i++) {
            JSONObject b = buckets.optJSONObject(i);
            if (b.optBoolean("eligible") && b.optInt("dayType") == dayType && b.optInt("part") == part) {
                p.goalM = b.optJSONObject("goal").optDouble(units);
                p.source = "time";
                p.name = b.optString("name");
                p.confidence = round4(1 - b.optDouble("cv"));
                return p;
            }
        }
        p.reason = "unsure";
        return p;
    }

    /** The stored route of one routine, for RouteGuard after a service restart. */
    static JSONArray signatureOf(JSONObject model, String activity, String routineId) {
        JSONObject acts = model != null ? model.optJSONObject("activities") : null;
        JSONObject a = acts != null ? acts.optJSONObject(activity) : null;
        JSONArray routines = a != null ? a.optJSONArray("routines") : null;
        for (int i = 0; routines != null && i < routines.length(); i++) {
            JSONObject r = routines.optJSONObject(i);
            if (routineId.equals(r.optString("id"))) return r.optJSONArray("signature");
        }
        return null;
    }

    private static double timeMatch(int minute, double m) {
        double z = circDiff(minute, m) / TIME_SIGMA_MIN;
        return Math.exp(-0.5 * z * z);
    }

    private static double dayFactor(boolean sameDay, boolean sameType) {
        return sameDay ? 1 : sameType ? 0.6 : 0.3;
    }
}
