package app.locale.exercisetracker.tracker;

import org.json.JSONArray;

/**
 * Notices when the user leaves the routine's usual route: more than 250 m away from it for
 * more than 2 minutes of active time. Fires once. Mirrors RouteGuard in src/insights/routeGuard.js.
 */
final class RouteGuard {
    static final double OFF_ROUTE_M = 250;
    static final long OFF_ROUTE_MS = 120_000;

    private final double lat0;
    private final double lon0;
    private final double kx;
    private final double ky;
    private final double[] xs;
    private final double[] ys;
    private long offSinceMs = -1;
    private boolean fired;

    /** @param signature [[lat, lon], ...] */
    RouteGuard(JSONArray signature) {
        int n = signature.length();
        lat0 = signature.optJSONArray(0).optDouble(0);
        lon0 = signature.optJSONArray(0).optDouble(1);
        kx = Math.cos(Math.toRadians(lat0)) * RoutineMatcher.EARTH_RADIUS * Math.PI / 180;
        ky = RoutineMatcher.EARTH_RADIUS * Math.PI / 180;
        xs = new double[n];
        ys = new double[n];
        for (int i = 0; i < n; i++) {
            JSONArray p = signature.optJSONArray(i);
            xs[i] = (p.optDouble(1) - lon0) * kx;
            ys[i] = (p.optDouble(0) - lat0) * ky;
        }
    }

    double distanceTo(double lat, double lon) {
        double px = (lon - lon0) * kx;
        double py = (lat - lat0) * ky;
        if (xs.length == 1) return Math.hypot(px - xs[0], py - ys[0]);
        double best = Double.POSITIVE_INFINITY;
        for (int i = 1; i < xs.length; i++) {
            double dx = xs[i] - xs[i - 1];
            double dy = ys[i] - ys[i - 1];
            double len2 = dx * dx + dy * dy;
            double t = len2 > 0 ? Math.max(0, Math.min(1, ((px - xs[i - 1]) * dx + (py - ys[i - 1]) * dy) / len2)) : 0;
            best = Math.min(best, Math.hypot(px - (xs[i - 1] + t * dx), py - (ys[i - 1] + t * dy)));
        }
        return best;
    }

    /** @return true exactly once, when the user has been off the route long enough. */
    boolean onFix(double lat, double lon, long activeElapsedMs) {
        if (fired) return false;
        if (distanceTo(lat, lon) <= OFF_ROUTE_M) {
            offSinceMs = -1;
            return false;
        }
        if (offSinceMs < 0) offSinceMs = activeElapsedMs;
        if (activeElapsedMs - offSinceMs >= OFF_ROUTE_MS) {
            fired = true;
            return true;
        }
        return false;
    }
}
