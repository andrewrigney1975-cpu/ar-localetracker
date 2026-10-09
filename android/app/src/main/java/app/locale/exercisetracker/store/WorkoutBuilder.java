package app.locale.exercisetracker.store;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Journal → workout record + columnar track, in Java, so TrackingService can save a workout
 * the moment it stops without the WebView.
 *
 * This is a line-for-line port of src/tracker/journal.js, src/geo/{geo,kalman,process}.js,
 * src/stats/summary.js (+ heartRateStats from physio.js) and src/services/buildWorkout.js.
 * Values the JS stores in Float32Array are stored as float here so rounding matches.
 * Shared fixtures (src/test/resources/fixtures) check both implementations agree.
 */
public final class WorkoutBuilder {
    private WorkoutBuilder() {}

    // ---- Activity profiles (src/activities.js) ------------------------------------------------

    static final class Profile {
        final String id;
        final String label;
        final double accuracyGate;
        final double maxSpeed;
        final double stationarySpeed;
        final double processNoise;

        Profile(String id, String label, double gate, double max, double still, double q) {
            this.id = id;
            this.label = label;
            this.accuracyGate = gate;
            this.maxSpeed = max;
            this.stationarySpeed = still;
            this.processNoise = q;
        }

        static Profile of(String id) {
            if (id == null) id = "run";
            switch (id) {
                case "walk":
                    return new Profile("walk", "Walk", 30, 4, 0.4, 0.5);
                case "cycle":
                    return new Profile("cycle", "Cycle", 30, 30, 1.0, 2);
                case "ski":
                    return new Profile("ski", "Ski", 30, 45, 1.0, 4);
                default:
                    return new Profile("run", "Run", 25, 9, 0.8, 1.5);
            }
        }
    }

    // ---- Journal (src/tracker/journal.js) -----------------------------------------------------

    static final class Point {
        double t;
        double lat;
        double lon;
        Double ha;
        Double ae;
        Double am;
        Double af;
        Double sp;
        Double sa;
        Double br;
        Double pr;
        int seg;
        boolean paused;
    }

    static final class Journal {
        JSONObject meta;
        final List<Point> points = new ArrayList<>();
        final List<double[]> states = new ArrayList<>(); // [t, active(1/0)]
        final List<double[]> hr = new ArrayList<>(); // [t, bpm]
        JSONObject end;
    }

    private static Double num(JSONObject o, String k) {
        if (!o.has(k) || o.isNull(k)) return null;
        double v = o.optDouble(k, Double.NaN);
        return Double.isNaN(v) ? null : v;
    }

    static Journal parse(String text) {
        Journal j = new Journal();
        for (String line : text.split("\n")) {
            if (line.isEmpty()) continue;
            JSONObject o;
            try {
                o = new JSONObject(line);
            } catch (JSONException e) {
                continue; // a torn final line after a crash
            }
            switch (o.optString("type")) {
                case "meta":
                    if (j.meta == null) j.meta = o;
                    break;
                case "pt": {
                    Double t = num(o, "t");
                    Double lat = num(o, "lat");
                    Double lon = num(o, "lon");
                    if (t == null || lat == null || lon == null) break;
                    Point p = new Point();
                    p.t = t;
                    p.lat = lat;
                    p.lon = lon;
                    p.ha = num(o, "ha");
                    p.ae = num(o, "ae");
                    p.am = num(o, "am");
                    p.af = num(o, "af");
                    p.sp = num(o, "sp");
                    p.sa = num(o, "sa");
                    p.br = num(o, "br");
                    p.pr = num(o, "pr");
                    p.seg = o.optInt("seg", 0);
                    p.paused = o.optInt("p", 0) != 0;
                    j.points.add(p);
                    break;
                }
                case "state": {
                    String s = o.optString("state");
                    boolean active = "recording".equals(s) || "autopaused".equals(s);
                    j.states.add(new double[] { o.optDouble("t"), active ? 1 : 0 });
                    break;
                }
                case "hr": {
                    Double t = num(o, "t");
                    Double bpm = num(o, "bpm");
                    if (t != null && bpm != null && bpm >= 25 && bpm <= 240) j.hr.add(new double[] { t, bpm });
                    break;
                }
                case "end":
                    j.end = o;
                    break;
                default:
                    break;
            }
        }
        // JS Array.prototype.sort is stable, as is List.sort.
        j.points.sort((a, b) -> Double.compare(a.t, b.t));
        j.states.sort((a, b) -> Double.compare(a[0], b[0]));
        j.hr.sort((a, b) -> Double.compare(a[0], b[0]));
        return j;
    }

    static List<double[]> activeIntervals(List<double[]> states, Double fallbackEnd) {
        List<double[]> out = new ArrayList<>();
        Double openAt = null;
        for (double[] s : states) {
            boolean active = s[1] == 1;
            if (active && openAt == null) openAt = s[0];
            else if (!active && openAt != null) {
                out.add(new double[] { openAt, s[0] });
                openAt = null;
            }
        }
        if (openAt != null && fallbackEnd != null && fallbackEnd > openAt) out.add(new double[] { openAt, fallbackEnd });
        return out;
    }

    // ---- Geo (src/geo/geo.js) -----------------------------------------------------------------

    static final double EARTH_RADIUS = 6371008.8;
    static final double RAD = Math.PI / 180;

    static double haversine(double lat1, double lon1, double lat2, double lon2) {
        double dLat = (lat2 - lat1) * RAD;
        double dLon = (lon2 - lon1) * RAD;
        double s1 = Math.sin(dLat / 2);
        double s2 = Math.sin(dLon / 2);
        double a = s1 * s1 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * s2 * s2;
        return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    static double bearing(double lat1, double lon1, double lat2, double lon2) {
        double y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
        double x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD)
            - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
        return jsMod(Math.atan2(y, x) / RAD + 360, 360);
    }

    /** JS `%` (truncated remainder), same as Java's for doubles. */
    private static double jsMod(double a, double b) {
        return a % b;
    }

    static final class Projection {
        final double lat0;
        final double lon0;
        final double kx;
        final double ky;

        Projection(double lat0, double lon0) {
            this.lat0 = lat0;
            this.lon0 = lon0;
            this.kx = Math.cos(lat0 * RAD) * EARTH_RADIUS * RAD;
            this.ky = EARTH_RADIUS * RAD;
        }

        double x(double lon) {
            return (lon - lon0) * kx;
        }

        double y(double lat) {
            return (lat - lat0) * ky;
        }

        double lat(double y) {
            return lat0 + y / ky;
        }

        double lon(double x) {
            return lon0 + x / kx;
        }
    }

    static int[] simplifyIndices(double[] xs, double[] ys, double tolerance) {
        int n = xs.length;
        if (n <= 2) {
            int[] all = new int[n];
            for (int i = 0; i < n; i++) all[i] = i;
            return all;
        }
        boolean[] keep = new boolean[n];
        keep[0] = keep[n - 1] = true;
        ArrayDeque<int[]> stack = new ArrayDeque<>();
        stack.push(new int[] { 0, n - 1 });
        double tol2 = tolerance * tolerance;
        while (!stack.isEmpty()) {
            int[] r = stack.pop();
            int a = r[0];
            int b = r[1];
            double maxD = 0;
            int idx = -1;
            double dx = xs[b] - xs[a];
            double dy = ys[b] - ys[a];
            double len2 = dx * dx + dy * dy;
            for (int i = a + 1; i < b; i++) {
                double t = len2 > 0 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2 : 0;
                t = Math.max(0, Math.min(1, t));
                double px = xs[a] + t * dx - xs[i];
                double py = ys[a] + t * dy - ys[i];
                double d = px * px + py * py;
                if (d > maxD) {
                    maxD = d;
                    idx = i;
                }
            }
            if (maxD > tol2 && idx > 0) {
                keep[idx] = true;
                stack.push(new int[] { a, idx });
                stack.push(new int[] { idx, b });
            }
        }
        int c = 0;
        for (boolean k : keep) if (k) c++;
        int[] out = new int[c];
        c = 0;
        for (int i = 0; i < n; i++) if (keep[i]) out[c++] = i;
        return out;
    }

    // ---- Kalman + RTS (src/geo/kalman.js) -----------------------------------------------------

    static double[] smoothAxis(double[] t, double[] z, double[] r, double q) {
        int n = z.length;
        double[] out = new double[n];
        if (n == 0) return out;
        if (n == 1) {
            out[0] = z[0];
            return out;
        }
        double[] xf = new double[n * 2];
        double[] pf = new double[n * 4];
        double[] xp = new double[n * 2];
        double[] pp = new double[n * 4];
        double x0 = z[0];
        double v0 = 0;
        double p00 = r[0] * r[0];
        double p01 = 0;
        double p10 = 0;
        double p11 = 25;
        for (int k = 0; k < n; k++) {
            if (k > 0) {
                double dt = Math.max(1e-3, t[k] - t[k - 1]);
                double nx = x0 + v0 * dt;
                double nv = v0;
                double a00 = p00 + dt * (p10 + p01) + dt * dt * p11;
                double a01 = p01 + dt * p11;
                double a10 = p10 + dt * p11;
                double a11 = p11;
                double dt2 = dt * dt;
                x0 = nx;
                v0 = nv;
                p00 = a00 + q * dt2 * dt / 3;
                p01 = a01 + q * dt2 / 2;
                p10 = a10 + q * dt2 / 2;
                p11 = a11 + q * dt;
            }
            xp[2 * k] = x0;
            xp[2 * k + 1] = v0;
            pp[4 * k] = p00;
            pp[4 * k + 1] = p01;
            pp[4 * k + 2] = p10;
            pp[4 * k + 3] = p11;
            double R = r[k] * r[k];
            double s = p00 + R;
            double k0 = p00 / s;
            double k1 = p10 / s;
            double y = z[k] - x0;
            x0 += k0 * y;
            v0 += k1 * y;
            double n00 = (1 - k0) * p00;
            double n01 = (1 - k0) * p01;
            double n10 = p10 - k1 * p00;
            double n11 = p11 - k1 * p01;
            p00 = n00;
            p01 = n01;
            p10 = n10;
            p11 = n11;
            xf[2 * k] = x0;
            xf[2 * k + 1] = v0;
            pf[4 * k] = p00;
            pf[4 * k + 1] = p01;
            pf[4 * k + 2] = p10;
            pf[4 * k + 3] = p11;
        }
        double sx = xf[2 * (n - 1)];
        double sv = xf[2 * (n - 1) + 1];
        out[n - 1] = sx;
        for (int k = n - 2; k >= 0; k--) {
            double dt = Math.max(1e-3, t[k + 1] - t[k]);
            double f00 = pf[4 * k], f01 = pf[4 * k + 1], f10 = pf[4 * k + 2], f11 = pf[4 * k + 3];
            double m00 = f00 + f01 * dt;
            double m01 = f01;
            double m10 = f10 + f11 * dt;
            double m11 = f11;
            double q00 = pp[4 * (k + 1)], q01 = pp[4 * (k + 1) + 1], q10 = pp[4 * (k + 1) + 2], q11 = pp[4 * (k + 1) + 3];
            double det = q00 * q11 - q01 * q10;
            if (Math.abs(det) < 1e-12) {
                sx = xf[2 * k];
                sv = xf[2 * k + 1];
                out[k] = sx;
                continue;
            }
            double i00 = q11 / det, i01 = -q01 / det, i10 = -q10 / det, i11 = q00 / det;
            double c00 = m00 * i00 + m01 * i10;
            double c01 = m00 * i01 + m01 * i11;
            double c10 = m10 * i00 + m11 * i10;
            double c11 = m10 * i01 + m11 * i11;
            double dx = sx - xp[2 * (k + 1)];
            double dv = sv - xp[2 * (k + 1) + 1];
            sx = xf[2 * k] + c00 * dx + c01 * dv;
            sv = xf[2 * k + 1] + c10 * dx + c11 * dv;
            out[k] = sx;
        }
        return out;
    }

    // ---- Track (src/geo/process.js) -----------------------------------------------------------

    public static final class Track {
        public final int n;
        public final double[] t;
        public final double[] lat;
        public final double[] lon;
        public final float[] alt;
        public final float[] speed;
        public final double[] dist;
        public final double[] active;
        public final char[] seg;
        public final float[] acc;
        public final float[] course;
        public final byte[] moving;
        public float[] hr;

        Track(int n) {
            this.n = n;
            t = new double[n];
            lat = new double[n];
            lon = new double[n];
            alt = new float[n];
            speed = new float[n];
            dist = new double[n];
            active = new double[n];
            seg = new char[n];
            acc = new float[n];
            course = new float[n];
            moving = new byte[n];
        }

        /** Same column names and order as the JS track, for TrackCodec. */
        public TrackCodec.Track toCodec() {
            TrackCodec.Track c = new TrackCodec.Track(n);
            c.columns.put("t", t);
            c.columns.put("lat", lat);
            c.columns.put("lon", lon);
            c.columns.put("alt", alt);
            c.columns.put("speed", speed);
            c.columns.put("dist", dist);
            c.columns.put("active", active);
            c.columns.put("seg", seg);
            c.columns.put("acc", acc);
            c.columns.put("course", course);
            c.columns.put("moving", moving);
            if (hr != null) c.columns.put("hr", hr);
            return c;
        }
    }

    static final class Info {
        String activity;
        double startedAt;
        double endedAt;
        boolean hasBarometer;
        int rawCount;
        List<double[]> activeIntervals;
        double activeSeconds;
        String device;
        boolean hasHeartRate;
    }

    static final class Processed {
        final Track track;
        final Info info;

        Processed(Track track, Info info) {
            this.track = track;
            this.info = info;
        }
    }

    private static boolean isFinite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }

    static Processed process(Journal journal) {
        Profile act = Profile.of(journal.meta != null ? journal.meta.optString("activity", null) : null);
        List<Point> raw = journal.points;

        // 1. Accuracy gate (relax if the gate would discard almost everything).
        double gate = act.accuracyGate;
        List<Point> pts = gateFilter(raw, gate);
        if (pts.size() < Math.min(10, raw.size() * 0.5)) {
            gate = 100;
            pts = gateFilter(raw, gate);
        }

        // 2. Drop duplicates and implausible jumps.
        List<Point> kept = new ArrayList<>();
        for (Point p : pts) {
            Point prev = kept.isEmpty() ? null : kept.get(kept.size() - 1);
            if (prev != null) {
                double dt = (p.t - prev.t) / 1000;
                if (dt <= 0) continue;
                if (p.seg == prev.seg) {
                    double d = haversine(prev.lat, prev.lon, p.lat, p.lon);
                    if (d / dt > act.maxSpeed * 1.5 && d > (p.ha != null ? p.ha : 10) * 2) continue;
                }
            }
            kept.add(p);
        }

        int n = kept.size();
        Track track = new Track(n);
        double lastT;
        if (journal.end != null && journal.end.has("t")) lastT = journal.end.optDouble("t");
        else if (n > 0) lastT = kept.get(n - 1).t;
        else lastT = journal.meta != null && journal.meta.has("startedAt") ? journal.meta.optDouble("startedAt") : 0;
        List<double[]> intervals = activeIntervals(journal.states, lastT);

        Info info = new Info();
        info.activity = act.id;
        info.startedAt = journal.meta != null && journal.meta.has("startedAt") && !journal.meta.isNull("startedAt")
            ? journal.meta.optDouble("startedAt")
            : (n > 0 ? kept.get(0).t : System.currentTimeMillis());
        info.endedAt = lastT;
        boolean anyPressure = false;
        for (Point p : kept) if (p.pr != null) anyPressure = true;
        info.hasBarometer = journal.meta != null && journal.meta.optBoolean("hasBarometer", false) && anyPressure;
        info.rawCount = raw.size();
        info.activeIntervals = intervals;
        double activeSeconds = 0;
        for (double[] iv : intervals) activeSeconds += (iv[1] - iv[0]) / 1000;
        info.activeSeconds = activeSeconds;
        info.device = journal.meta != null && journal.meta.has("device") && !journal.meta.isNull("device")
            ? journal.meta.optString("device")
            : null;
        if (n == 0) return new Processed(track, info);

        // 3. Smooth positions per segment.
        Projection proj = new Projection(kept.get(0).lat, kept.get(0).lon);
        int start = 0;
        for (int i = 1; i <= n; i++) {
            if (i == n || kept.get(i).seg != kept.get(start).seg) {
                smoothSegment(kept, start, i, proj, act.processNoise, track);
                start = i;
            }
        }

        // 4. Scalars; altitude source.
        for (int i = 0; i < n; i++) {
            Point p = kept.get(i);
            track.t[i] = p.t;
            track.seg[i] = (char) p.seg;
            track.acc[i] = p.ha != null ? (float) (double) p.ha : Float.NaN;
            Double a = p.af != null ? p.af : p.am != null ? p.am : p.ae;
            track.alt[i] = a != null ? (float) (double) a : Float.NaN;
        }
        smoothAltitude(track.alt, info.hasBarometer);
        if (!journal.hr.isEmpty()) {
            track.hr = alignHeartRate(track.t, journal.hr, 10000);
            info.hasHeartRate = true;
        }

        // 5. Speed.
        for (int i = 0; i < n; i++) {
            Point p = kept.get(i);
            double v;
            if (p.sp != null && (p.sa == null || p.sa <= 1.5)) v = p.sp;
            else v = derivedSpeed(track, i);
            if (p.paused) v = Math.min(v, act.stationarySpeed * 0.5);
            track.speed[i] = (float) Math.min(Math.max(0, v), act.maxSpeed);
        }
        float[] med = median3(track.speed);
        System.arraycopy(med, 0, track.speed, 0, n);

        // 6. Distance, active time, moving, course.
        for (int i = 0; i < n; i++) {
            track.moving[i] = (byte) (track.speed[i] >= act.stationarySpeed && !kept.get(i).paused ? 1 : 0);
            if (i == 0) continue;
            boolean sameSeg = track.seg[i] == track.seg[i - 1];
            double d = haversine(track.lat[i - 1], track.lon[i - 1], track.lat[i], track.lon[i]);
            double accOr10 = (Float.isNaN(track.acc[i]) || track.acc[i] == 0) ? 10 : track.acc[i];
            boolean counts = sameSeg && (track.speed[i] >= act.stationarySpeed * 0.5 || d > Math.max(3, accOr10 * 0.5));
            track.dist[i] = track.dist[i - 1] + (counts ? d : 0);
            track.active[i] = track.active[i - 1] + (sameSeg ? (track.t[i] - track.t[i - 1]) / 1000 : 0);
        }
        for (int i = 0; i < n; i++) {
            int a = Math.max(0, i - 1);
            int b = Math.min(n - 1, i + 1);
            Point p = kept.get(i);
            if (p.br != null && track.speed[i] > 1.5) track.course[i] = (float) (double) p.br;
            else if (a != b) track.course[i] = (float) bearing(track.lat[a], track.lon[a], track.lat[b], track.lon[b]);
            else track.course[i] = Float.NaN;
        }

        if (intervals.isEmpty()) info.activeSeconds = track.active[n - 1];
        return new Processed(track, info);
    }

    private static List<Point> gateFilter(List<Point> raw, double gate) {
        List<Point> out = new ArrayList<>();
        for (Point p : raw) if (p.ha == null || p.ha <= gate) out.add(p);
        return out;
    }

    static float[] alignHeartRate(double[] times, List<double[]> samples, double maxGapMs) {
        int n = times.length;
        float[] out = new float[n];
        Arrays.fill(out, Float.NaN);
        int j = 0;
        for (int i = 0; i < n; i++) {
            double t = times[i];
            while (j < samples.size() - 1 && samples.get(j + 1)[0] <= t) j++;
            double[] a = samples.get(j);
            double[] b = j + 1 < samples.size() ? samples.get(j + 1) : null;
            if (a[0] <= t && b != null && b[0] - a[0] <= maxGapMs * 2 && t - a[0] <= maxGapMs && b[0] - t <= maxGapMs) {
                double span = b[0] - a[0];
                out[i] = (float) (a[1] + ((b[1] - a[1]) * (t - a[0])) / (span != 0 ? span : 1));
            } else {
                double[] near = null;
                for (double[] s : new double[][] { a, b }) {
                    if (s == null || Math.abs(s[0] - t) > maxGapMs) continue;
                    if (near == null || Math.abs(s[0] - t) < Math.abs(near[0] - t)) near = s;
                }
                if (near != null) out[i] = (float) near[1];
            }
        }
        return out;
    }

    private static void smoothSegment(List<Point> kept, int from, int to, Projection proj, double q, Track track) {
        int m = to - from;
        double[] ts = new double[m];
        double[] xs = new double[m];
        double[] ys = new double[m];
        double[] rs = new double[m];
        for (int i = 0; i < m; i++) {
            Point p = kept.get(from + i);
            ts[i] = p.t / 1000;
            xs[i] = proj.x(p.lon);
            ys[i] = proj.y(p.lat);
            rs[i] = Math.max(1, p.ha != null ? p.ha : 10);
        }
        double[] sx = smoothAxis(ts, xs, rs, q);
        double[] sy = smoothAxis(ts, ys, rs, q);
        for (int i = 0; i < m; i++) {
            track.lat[from + i] = proj.lat(sy[i]);
            track.lon[from + i] = proj.lon(sx[i]);
        }
    }

    private static double derivedSpeed(Track track, int i) {
        int n = track.n;
        int a = i;
        int b = i;
        for (int k = 0; k < 2; k++) {
            if (a > 0 && track.seg[a - 1] == track.seg[i]) a--;
            if (b < n - 1 && track.seg[b + 1] == track.seg[i]) b++;
        }
        if (a == b) return 0;
        double dt = (track.t[b] - track.t[a]) / 1000;
        if (dt <= 0) return 0;
        double d = 0;
        for (int k = a + 1; k <= b; k++) d += haversine(track.lat[k - 1], track.lon[k - 1], track.lat[k], track.lon[k]);
        return d / dt;
    }

    private static float[] median3(float[] arr) {
        int n = arr.length;
        float[] out = new float[n];
        for (int i = 0; i < n; i++) {
            if (i == 0 || i == n - 1) {
                out[i] = arr[i];
                continue;
            }
            double a = arr[i - 1], b = arr[i], c = arr[i + 1];
            out[i] = (float) Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
        }
        return out;
    }

    static void smoothAltitude(float[] alt, boolean hasBarometer) {
        int n = alt.length;
        if (n < 3) return;
        float last = Float.NaN;
        for (int i = 0; i < n; i++) {
            if (!Float.isNaN(alt[i]) && !Float.isInfinite(alt[i])) last = alt[i];
            else if (!Float.isNaN(last)) alt[i] = last;
        }
        float firstFinite = Float.NaN;
        for (int i = 0; i < n; i++) {
            if (!Float.isNaN(alt[i]) && !Float.isInfinite(alt[i])) {
                firstFinite = alt[i];
                break;
            }
        }
        if (Float.isNaN(firstFinite)) return;
        for (int i = 0; i < n && (Float.isNaN(alt[i]) || Float.isInfinite(alt[i])); i++) alt[i] = firstFinite;

        float[] med = new float[n];
        int w = 2;
        double[] buf = new double[2 * w + 1];
        for (int i = 0; i < n; i++) {
            int c = 0;
            for (int k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) buf[c++] = alt[k];
            Arrays.sort(buf, 0, c);
            med[i] = (float) buf[c >> 1];
        }
        int avgW = hasBarometer ? 2 : 4;
        for (int i = 0; i < n; i++) {
            double s = 0;
            int c = 0;
            for (int k = Math.max(0, i - avgW); k <= Math.min(n - 1, i + avgW); k++) {
                s += med[k];
                c++;
            }
            alt[i] = (float) (s / c);
        }
    }

    // ---- Summary (src/stats/summary.js) -------------------------------------------------------

    static double verticalThreshold(boolean hasBarometer) {
        return hasBarometer ? 3 : 8;
    }

    /** @return {gain, loss} */
    static double[] verticalGainLoss(float[] alt, double threshold, int from, int to) {
        double gain = 0;
        double loss = 0;
        int i = from;
        while (i < to && !isFinite(alt[i])) i++;
        if (i >= to) return new double[] { gain, loss };
        double ref = alt[i];
        int dir = 0;
        for (; i < to; i++) {
            double a = alt[i];
            if (!isFinite(a)) continue;
            if (dir == 1) {
                if (a > ref) {
                    gain += a - ref;
                    ref = a;
                } else if (ref - a >= threshold) {
                    loss += ref - a;
                    ref = a;
                    dir = -1;
                }
            } else if (dir == -1) {
                if (a < ref) {
                    loss += ref - a;
                    ref = a;
                } else if (a - ref >= threshold) {
                    gain += a - ref;
                    ref = a;
                    dir = 1;
                }
            } else if (a - ref >= threshold) {
                gain += a - ref;
                ref = a;
                dir = 1;
            } else if (ref - a >= threshold) {
                loss += ref - a;
                ref = a;
                dir = -1;
            }
        }
        return new double[] { gain, loss };
    }

    static double stationarySeconds(Track track) {
        double total = 0;
        double run = 0;
        for (int i = 1; i < track.n; i++) {
            boolean still = track.seg[i] == track.seg[i - 1] && track.moving[i] == 0 && track.moving[i - 1] == 0;
            if (still) run += (track.t[i] - track.t[i - 1]) / 1000;
            if (!still || i == track.n - 1) {
                if (run >= 5) total += run;
                run = 0;
            }
        }
        return total;
    }

    /** @return {avg, max(or NaN)} or null */
    static double[] heartRateStats(Track track) {
        if (track.hr == null) return null;
        double sum = 0;
        double time = 0;
        double max = 0;
        for (int i = 1; i < track.n; i++) {
            if (track.seg[i] != track.seg[i - 1]) continue;
            double dt = (track.t[i] - track.t[i - 1]) / 1000;
            if (!(dt > 0 && dt <= 10)) continue;
            double h = track.hr[i];
            if (!isFinite(h)) continue;
            sum += h * dt;
            time += dt;
        }
        float[] hr = track.hr;
        double[] w = new double[5];
        for (int i = 2; i < track.n - 2; i++) {
            int c = 0;
            for (int k = i - 2; k <= i + 2; k++) if (isFinite(hr[k])) w[c++] = hr[k];
            if (c >= 3) {
                Arrays.sort(w, 0, c);
                max = Math.max(max, w[c >> 1]);
            }
        }
        if (time == 0) return null;
        return new double[] { sum / time, max != 0 ? max : Double.NaN };
    }

    static JSONObject analyzeSki(Track track, boolean hasBarometer) throws JSONException {
        int n = track.n;
        double[] t = track.t;
        float[] alt = track.alt;
        boolean[] climbing = new boolean[n];
        int j = 0;
        for (int i = 0; i < n; i++) {
            while (j < i && t[i] - t[j] > 30000) j++;
            double dt = (t[i] - t[j]) / 1000;
            if (dt >= 10 && ((double) alt[i] - alt[j]) / dt > 0.2) {
                for (int k = j; k <= i; k++) climbing[k] = true;
            }
        }
        List<int[]> lifts = new ArrayList<>();
        int s = -1;
        for (int i = 0; i <= n; i++) {
            if (i < n && climbing[i]) {
                if (s < 0) s = i;
            } else if (s >= 0) {
                int e = i - 1;
                if ((t[e] - t[s]) / 1000 >= 60 && (double) alt[e] - alt[s] >= 30) lifts.add(new int[] { s, e });
                s = -1;
            }
        }
        double th = verticalThreshold(hasBarometer);
        int runs = 0;
        double descent = 0;
        double longest = 0;
        double maxRunSpeed = 0;
        int cursor = 0;
        List<int[]> bounds = new ArrayList<>(lifts);
        bounds.add(new int[] { n, n });
        for (int[] b : bounds) {
            int ls = b[0];
            int le = b[1];
            if (ls - cursor > 1) {
                double loss = verticalGainLoss(alt, th, cursor, ls)[1];
                if (loss >= 30) {
                    double maxSpeed = 0;
                    for (int k = cursor; k < ls; k++) if (track.speed[k] > maxSpeed) maxSpeed = track.speed[k];
                    runs++;
                    descent += loss;
                    longest = Math.max(longest, track.dist[ls - 1] - track.dist[cursor]);
                    maxRunSpeed = Math.max(maxRunSpeed, maxSpeed);
                }
            }
            cursor = le + 1;
        }
        double liftSeconds = 0;
        for (int[] l : lifts) liftSeconds += (t[l[1]] - t[l[0]]) / 1000;
        JSONObject o = new JSONObject();
        o.put("runs", runs);
        o.put("lifts", lifts.size());
        o.put("liftSeconds", liftSeconds);
        o.put("descentVertical", descent);
        o.put("longestRun", longest);
        o.put("maxRunSpeed", maxRunSpeed);
        return o;
    }

    static JSONObject summary(Track track, Info info) throws JSONException {
        int n = track.n;
        double distance = n > 0 ? track.dist[n - 1] : 0;
        double duration = info.activeSeconds != 0 ? info.activeSeconds : (n > 0 ? track.active[n - 1] : 0);
        double stationaryTime = Math.min(duration, stationarySeconds(track));
        double movingTime = Math.max(0, duration - stationaryTime);
        double maxSpeed = 0;
        double minAlt = Double.POSITIVE_INFINITY;
        double maxAlt = Double.NEGATIVE_INFINITY;
        for (int i = 0; i < n; i++) {
            if (track.speed[i] > maxSpeed) maxSpeed = track.speed[i];
            double a = track.alt[i];
            if (isFinite(a)) {
                if (a < minAlt) minAlt = a;
                if (a > maxAlt) maxAlt = a;
            }
        }
        boolean hasAlt = isFinite(minAlt);
        double[] gl = verticalGainLoss(track.alt, verticalThreshold(info.hasBarometer), 0, n);
        JSONObject s = new JSONObject();
        s.put("distance", distance);
        s.put("duration", duration);
        s.put("totalTime", Math.max(0, (info.endedAt - info.startedAt) / 1000));
        s.put("movingTime", movingTime);
        s.put("stationaryTime", stationaryTime);
        s.put("avgSpeed", duration > 0 ? distance / duration : 0);
        s.put("avgMovingSpeed", movingTime > 0 ? distance / movingTime : 0);
        s.put("maxSpeed", maxSpeed);
        s.put("elevGain", gl[0]);
        s.put("elevLoss", gl[1]);
        s.put("netVertical", hasAlt && n > 0 ? (double) track.alt[n - 1] - track.alt[0] : 0);
        s.put("minAlt", hasAlt ? minAlt : JSONObject.NULL);
        s.put("maxAlt", hasAlt ? maxAlt : JSONObject.NULL);
        s.put("pointCount", n);
        s.put("segments", n > 0 ? track.seg[n - 1] - track.seg[0] + 1 : 0);
        s.put("hasBarometer", info.hasBarometer);
        if (n > 0) {
            double w = Double.POSITIVE_INFINITY, so = Double.POSITIVE_INFINITY, e = Double.NEGATIVE_INFINITY, no = Double.NEGATIVE_INFINITY;
            for (int i = 0; i < n; i++) {
                if (track.lon[i] < w) w = track.lon[i];
                if (track.lon[i] > e) e = track.lon[i];
                if (track.lat[i] < so) so = track.lat[i];
                if (track.lat[i] > no) no = track.lat[i];
            }
            s.put("bbox", new JSONArray().put(w).put(so).put(e).put(no));
        } else {
            s.put("bbox", JSONObject.NULL);
        }
        double[] hr = heartRateStats(track);
        if (hr != null) {
            JSONObject h = new JSONObject();
            h.put("avg", hr[0]);
            h.put("max", isFinite(hr[1]) ? hr[1] : JSONObject.NULL);
            s.put("heartRate", h);
        }
        if ("ski".equals(info.activity) && n > 2) s.put("ski", analyzeSki(track, info.hasBarometer));
        return s;
    }

    static JSONArray previewPolyline(Track track, int maxPoints) throws JSONException {
        int n = track.n;
        JSONArray out = new JSONArray();
        if (n == 0) return out;
        Projection proj = new Projection(track.lat[0], track.lon[0]);
        double[] xs = new double[n];
        double[] ys = new double[n];
        for (int i = 0; i < n; i++) {
            xs[i] = proj.x(track.lon[i]);
            ys[i] = proj.y(track.lat[i]);
        }
        double tol = 2;
        int[] idx = simplifyIndices(xs, ys, tol);
        while (idx.length > maxPoints && tol < 5000) {
            tol *= 2;
            idx = simplifyIndices(xs, ys, tol);
        }
        for (int i : idx) out.put(new JSONArray().put(round6(track.lon[i])).put(round6(track.lat[i])));
        return out;
    }

    private static double round6(double v) {
        return Math.round(v * 1e6) / 1e6;
    }

    // ---- Workout record (src/services/buildWorkout.js) ----------------------------------------

    public static final class Built {
        public final JSONObject workout;
        public final Track track;

        Built(JSONObject workout, Track track) {
            this.workout = workout;
            this.track = track;
        }
    }

    static String defaultName(String activity, double startedAt) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis((long) startedAt);
        int h = c.get(Calendar.HOUR_OF_DAY);
        String part = h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night";
        return part + " " + Profile.of(activity).label;
    }

    /** Build the stored workout record and track from journal text. */
    public static Built build(String text, String idOverride) throws JSONException {
        Journal journal = parse(text);
        Processed p = process(journal);
        String id = idOverride != null ? idOverride
            : journal.meta != null && journal.meta.has("workoutId") ? journal.meta.getString("workoutId") : null;
        if (id == null) throw new IllegalArgumentException("Workout has no ID");
        JSONObject w = new JSONObject();
        w.put("id", id);
        w.put("activity", p.info.activity);
        w.put("name", defaultName(p.info.activity, p.info.startedAt));
        w.put("notes", "");
        w.put("startedAt", (long) p.info.startedAt);
        w.put("endedAt", (long) p.info.endedAt);
        w.put("createdAt", System.currentTimeMillis());
        // JS getTimezoneOffset(): minutes, positive west of UTC.
        w.put("tzOffset", -TimeZone.getDefault().getOffset((long) p.info.startedAt) / 60000);
        w.put("device", p.info.device != null ? p.info.device : JSONObject.NULL);
        JSONArray iv = new JSONArray();
        for (double[] a : p.info.activeIntervals) iv.put(new JSONArray().put((long) a[0]).put((long) a[1]));
        w.put("activeIntervals", iv);
        w.put("summary", summary(p.track, p.info));
        w.put("preview", previewPolyline(p.track, 120));
        return new Built(w, p.track);
    }
}
