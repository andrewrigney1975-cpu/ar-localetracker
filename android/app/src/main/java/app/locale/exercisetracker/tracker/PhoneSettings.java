package app.locale.exercisetracker.tracker;

import android.content.Context;
import org.json.JSONObject;

/** Reads the web app's settings (stored by @capacitor/preferences) for native-initiated starts. */
final class PhoneSettings {
    private PhoneSettings() {}

    private static JSONObject load(Context ctx) {
        String raw = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("settings.v1", null);
        if (raw == null) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static String units(Context ctx) {
        return "imperial".equals(load(ctx).optString("units")) ? "imperial" : "metric";
    }

    /** Announcement settings for one activity; defaults match src/settings.js. */
    static VoiceCoach.Config voice(Context ctx, String activity) {
        JSONObject s = load(ctx);
        JSONObject v = s.optJSONObject("voice");
        if (v == null) v = new JSONObject();
        VoiceCoach.Config c = new VoiceCoach.Config();
        c.splits = flag(v, "splits", activity, "walk".equals(activity) || "run".equals(activity));
        c.time = flag(v, "time", activity, false);
        c.goal = flag(v, "goal", activity, false);
        c.intervalMin = v.optInt("intervalMin", 10);
        JSONObject goals = v.optJSONObject("goalM");
        double defGoal = "walk".equals(activity) ? 5000 : "cycle".equals(activity) ? 40000 : "ski".equals(activity) ? 20000 : 10000;
        c.goalM = goals != null ? goals.optDouble(activity, defGoal) : defGoal;
        c.duck = v.optBoolean("duck", true);
        JSONObject modes = s.optJSONObject("liveSpeedMode");
        String mode = modes != null ? modes.optString(activity, "") : "";
        if (mode.isEmpty()) mode = "cycle".equals(activity) || "ski".equals(activity) ? "speed" : "pace";
        c.pace = "pace".equals(mode);
        c.imperial = "imperial".equals(s.optString("units"));
        return c;
    }

    private static boolean flag(JSONObject v, String kind, String activity, boolean def) {
        JSONObject o = v.optJSONObject(kind);
        return o != null && o.has(activity) ? o.optBoolean(activity) : def;
    }

    static boolean autoPause(Context ctx, String activity) {
        JSONObject ap = load(ctx).optJSONObject("autoPause");
        if (ap != null && ap.has(activity)) return ap.optBoolean(activity);
        return "cycle".equals(activity);
    }
}
