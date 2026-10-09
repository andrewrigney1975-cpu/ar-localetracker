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

    static boolean autoPause(Context ctx, String activity) {
        JSONObject ap = load(ctx).optJSONObject("autoPause");
        if (ap != null && ap.has(activity)) return ap.optBoolean(activity);
        return "cycle".equals(activity);
    }
}
