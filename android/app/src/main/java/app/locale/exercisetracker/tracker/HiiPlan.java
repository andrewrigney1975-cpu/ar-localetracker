package app.locale.exercisetracker.tracker;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * High-intensity interval plan: randomised bouts of walking, jogging, running and sprinting.
 * Port of planIntervals() / makePlan() / hiiAt() in src/hii/plan.js; HiiPlanTest replays the
 * shared fixture so both make exactly the same plan from the same seed. Pure Java (org.json
 * only), so it is unit-testable on the JVM.
 */
final class HiiPlan {
    static final String[] MODES = { "walk", "jog", "run", "sprint" };
    static final String[] LABELS = { "Walk", "Jog", "Run", "Sprint" };
    static final int UNIT_S = 5;
    static final int WARN_S = 10;
    /** Shortest plan worth starting part-way through a workout. */
    static final int MIN_PLAN_S = 120;
    /** Defaults; match HII_DEFAULTS in plan.js. */
    static final int[] DEFAULT_SHARES = { 40, 30, 20, 10 };
    static final int[][] DEFAULT_BOUTS = { { 60, 240 }, { 60, 180 }, { 45, 120 }, { 15, 45 } };
    static final int DEFAULT_DURATION_MIN = 30;

    private static final int WALK = 0;
    private static final int JOG = 1;
    private static final int RUN = 2;
    private static final int SPRINT = 3;

    final int seed;
    /** Active seconds into the workout when the plan began. */
    final long atS;
    final int durationS;
    final int[] shares;
    final int[][] bouts;
    /** {mode index, startS, durationS} relative to atS. */
    final List<int[]> items;
    /** Active seconds at which the user turned intervals off, or -1. */
    long stopS = -1;

    private HiiPlan(int seed, long atS, int durationS, int[] shares, int[][] bouts, List<int[]> items) {
        this.seed = seed;
        this.atS = atS;
        this.durationS = durationS;
        this.shares = shares;
        this.bouts = bouts;
        this.items = items;
    }

    /** makePlan() in plan.js. */
    static HiiPlan make(int durationS, int[] shares, int[][] bouts, int seed, long atS) {
        List<int[]> items = new ArrayList<>();
        int total = plan(durationS, shares, bouts, seed, items);
        return new HiiPlan(seed, atS, total, shares.clone(), bouts, items);
    }

    /** Mulberry32, as mulberry32() in src/tracker/synthetic.js. */
    private static final class Rand {
        private int a;

        Rand(int seed) {
            a = seed;
        }

        double next() {
            a += 0x6d2b79f5;
            int t = a;
            t = (t ^ (t >>> 15)) * (t | 1);
            t ^= t + (t ^ (t >>> 7)) * (t | 61);
            return ((t ^ (t >>> 14)) & 0xffffffffL) / 4294967296.0;
        }

        int pick(int lo, int hi) {
            return lo + (int) Math.floor(next() * (hi - lo + 1));
        }
    }

    /** planIntervals() in plan.js: fills `out` with the bouts and returns the plan's length. */
    static int plan(int durationS, int[] shares, int[][] bouts, int seed, List<int[]> out) {
        Rand rand = new Rand(seed);
        int n = Math.max(0, durationS / UNIT_S);

        int[] share = new int[4];
        int sum = 0;
        for (int m = 0; m < 4; m++) {
            share[m] = Math.max(0, shares[m]);
            sum += share[m];
        }
        if (sum == 0) sum = 1;
        int[] total = new int[4];
        int left = n;
        for (int m = 0; m < 4; m++) {
            total[m] = (int) ((long) n * share[m] / sum);
            left -= total[m];
        }
        final int fSum = sum;
        Integer[] byFraction = { 0, 1, 2, 3 };
        Arrays.sort(byFraction, (a, b) -> {
            long d = ((long) n * share[b]) % fSum - ((long) n * share[a]) % fSum;
            return d != 0 ? Long.signum(d) : a - b;
        });
        for (int i = 0; left > 0; i = (i + 1) % 4, left--) total[byFraction[i]]++;

        int[][] lim = new int[4][];
        for (int m = 0; m < 4; m++) {
            int lo = Math.max(1, (int) Math.ceil(bouts[m][0] / (double) UNIT_S));
            lim[m] = new int[] { lo, Math.max(lo, bouts[m][1] / UNIT_S) };
        }
        int[] count = new int[4];
        for (int m : new int[] { RUN, SPRINT, JOG }) {
            int[] r = typical(total, lim, m);
            count[m] = rand.pick(r[0], r[1]);
        }
        int wMax = range(total, lim, WALK)[1];
        while (count[RUN] + count[SPRINT] > wMax
            && (count[RUN] > range(total, lim, RUN)[0] || count[SPRINT] > range(total, lim, SPRINT)[0])) {
            if (count[RUN] > range(total, lim, RUN)[0]) count[RUN]--;
            else count[SPRINT]--;
        }
        int hard = count[RUN] + count[SPRINT];
        if (total[WALK] > 0) {
            int[] r = typical(total, lim, WALK);
            count[WALK] = Math.min(total[WALK], Math.max(hard, rand.pick(r[0], r[1])));
        }

        int[][] parts = new int[4][];
        for (int m = 0; m < 4; m++) parts[m] = split(total[m], count[m], lim[m], rand);

        // Blocks of {mode, units} pairs: each hard bout with the walk after it, then free walks and jogs.
        List<int[][]> blocks = new ArrayList<>();
        int w = 0;
        for (int m : new int[] { RUN, SPRINT }) {
            for (int p : parts[m]) {
                if (w < parts[WALK].length) blocks.add(new int[][] { { m, p }, { WALK, parts[WALK][w++] } });
                else blocks.add(new int[][] { { m, p } });
            }
        }
        for (; w < parts[WALK].length; w++) blocks.add(new int[][] { { WALK, parts[WALK][w] } });
        for (int p : parts[JOG]) blocks.add(new int[][] { { JOG, p } });

        List<int[][]> best = null;
        int bestScore = Integer.MAX_VALUE;
        for (int attempt = 0; attempt < 40 && bestScore > 0; attempt++) {
            List<int[][]> order = new ArrayList<>(blocks);
            for (int i = order.size() - 1; i > 0; i--) {
                int j = (int) Math.floor(rand.next() * (i + 1));
                int[][] tmp = order.get(i);
                order.set(i, order.get(j));
                order.set(j, tmp);
            }
            int s = score(order);
            if (s < bestScore) {
                bestScore = s;
                best = order;
            }
        }

        int at = 0;
        if (best != null) {
            for (int[][] block : best) {
                for (int[] bout : block) {
                    int[] last = out.isEmpty() ? null : out.get(out.size() - 1);
                    if (last != null && last[0] == bout[0]) last[2] += bout[1] * UNIT_S;
                    else out.add(new int[] { bout[0], at, bout[1] * UNIT_S });
                    at += bout[1] * UNIT_S;
                }
            }
        }
        return n * UNIT_S;
    }

    private static int[] range(int[] total, int[][] lim, int m) {
        int t = total[m];
        if (t == 0) return new int[] { 0, 0 };
        int fewest = (t + lim[m][1] - 1) / lim[m][1];
        return new int[] { fewest, Math.max(fewest, t / lim[m][0]) };
    }

    private static int[] typical(int[] total, int[][] lim, int m) {
        int[] r = range(total, lim, m);
        int mid = (int) Math.round((2.0 * total[m]) / (lim[m][0] + lim[m][1]));
        return new int[] { r[0], Math.min(r[1], Math.max(r[0], mid)) };
    }

    private static int[] split(int t, int k, int[] lim, Rand rand) {
        if (k == 0) return new int[0];
        int lo = lim[0];
        int hi = lim[1];
        int[] out = new int[k];
        if (k * lo >= t) {
            int base = t / k;
            for (int i = 0; i < k; i++) out[i] = base + (i < t - base * k ? 1 : 0);
            return out;
        }
        Arrays.fill(out, lo);
        int rest = t - k * lo;
        while (rest > 0) {
            int i = (int) Math.floor(rand.next() * k);
            int free = hi - out[i];
            if (free <= 0) continue;
            int add = 1 + (int) Math.floor(rand.next() * Math.min(free, rest));
            out[i] += add;
            rest -= add;
        }
        return out;
    }

    private static int score(List<int[][]> blocks) {
        int s = !blocks.isEmpty() && (blocks.get(0)[0][0] == RUN || blocks.get(0)[0][0] == SPRINT) ? 1 : 0;
        for (int i = 1; i < blocks.size(); i++) {
            int[][] prev = blocks.get(i - 1);
            if (prev[prev.length - 1][0] == blocks.get(i)[0][0]) s += 2;
        }
        return s;
    }

    // ---- Where the plan is (hiiAt in plan.js) ----------------------------------------------

    private long endS() {
        return stopS >= 0 ? Math.min(durationS, stopS - atS) : durationS;
    }

    /** Index of the bout at `elapsedS` active seconds: -1 before the plan, items.size() once done. */
    int indexAt(double elapsedS) {
        double rel = elapsedS - atS;
        if (rel < 0) return -1;
        if (rel >= endS() || items.isEmpty()) return items.size();
        int i = 0;
        while (i + 1 < items.size() && items.get(i + 1)[1] <= rel) i++;
        return i;
    }

    /** Seconds left in the bout at `elapsedS`. */
    int leftAt(double elapsedS, int index) {
        if (index < 0 || index >= items.size()) return 0;
        int[] it = items.get(index);
        return (int) Math.max(0, Math.round(atS + it[1] + it[2] - elapsedS));
    }

    // ---- JSON (the journal's `hii` line and the workout's `hii` field) -----------------------

    JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("seed", seed);
            o.put("atS", atS);
            o.put("durationS", durationS);
            JSONObject sh = new JSONObject();
            JSONObject bo = new JSONObject();
            for (int m = 0; m < 4; m++) {
                sh.put(MODES[m], shares[m]);
                bo.put(MODES[m], new JSONArray().put(bouts[m][0]).put(bouts[m][1]));
            }
            o.put("shares", sh);
            o.put("bouts", bo);
            JSONArray arr = new JSONArray();
            for (int[] it : items) arr.put(new JSONArray().put(MODES[it[0]]).put(it[1]).put(it[2]));
            o.put("items", arr);
            if (stopS >= 0) o.put("stopS", stopS);
        } catch (JSONException ignored) {
        }
        return o;
    }

    static HiiPlan fromJson(JSONObject o) {
        if (o == null) return null;
        JSONArray arr = o.optJSONArray("items");
        if (arr == null) return null;
        List<int[]> items = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONArray it = arr.optJSONArray(i);
            if (it == null) continue;
            items.add(new int[] { modeIndex(it.optString(0)), it.optInt(1), it.optInt(2) });
        }
        HiiPlan p = new HiiPlan(o.optInt("seed"), o.optLong("atS"), o.optInt("durationS"),
            sharesOf(o.optJSONObject("shares")), boutsOf(o.optJSONObject("bouts")), items);
        if (o.has("stopS")) p.stopS = o.optLong("stopS");
        return p;
    }

    static int modeIndex(String mode) {
        for (int m = 0; m < 4; m++) if (MODES[m].equals(mode)) return m;
        return WALK;
    }

    /** Shares by mode from settings JSON (settings().hii.shares), defaults where missing. */
    static int[] sharesOf(JSONObject o) {
        int[] out = DEFAULT_SHARES.clone();
        if (o != null) for (int m = 0; m < 4; m++) if (o.has(MODES[m])) out[m] = (int) Math.round(o.optDouble(MODES[m], out[m]));
        return out;
    }

    /** Bout limits by mode from settings JSON (settings().hii.bouts), defaults where missing. */
    static int[][] boutsOf(JSONObject o) {
        int[][] out = new int[4][];
        for (int m = 0; m < 4; m++) {
            out[m] = DEFAULT_BOUTS[m].clone();
            JSONArray a = o != null ? o.optJSONArray(MODES[m]) : null;
            if (a != null && a.length() == 2) out[m] = new int[] { a.optInt(0, out[m][0]), a.optInt(1, out[m][1]) };
        }
        return out;
    }
}
