package app.locale.exercisetracker.tracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import org.json.JSONObject;

/**
 * The watch's battery level for the 4×2 widget. The phone asks (/locale/battery-request) when
 * the widget is placed or updated and then every 10 minutes while one is on the home screen; the
 * watch app replies with /locale/battery {pct, charging}. Asking from the phone needs no
 * scheduler on the watch, whose listener service wakes for the message.
 */
final class WatchBattery {
    static final String PATH_REQUEST = "/locale/battery-request";
    static final String PATH = "/locale/battery";
    static final String ACTION_ASK = "app.locale.exercisetracker.WATCH_BATTERY";

    private static final String PREFS = "locale_watch_battery";
    /** The user's choice (2026-10-29). */
    static final long INTERVAL_MS = 10 * 60 * 1000L;
    /** An older report is hidden (three missed refreshes): the watch is off, out of range or not running Locale. */
    static final long STALE_MS = 3 * INTERVAL_MS;

    private WatchBattery() {}

    /** Ask the watch for its battery level (no reply when it isn't reachable). */
    static void ask(Context ctx) {
        WearSync.send(ctx, PATH_REQUEST, new JSONObject());
    }

    /** The watch's reply: remember it and redraw the widgets (which doesn't ask again). */
    static void onReport(Context ctx, JSONObject body) {
        int pct = body.optInt("pct", -1);
        if (pct < 0 || pct > 100) return;
        prefs(ctx).edit()
            .putInt("pct", pct)
            .putBoolean("charging", body.optBoolean("charging", false))
            .putLong("at", System.currentTimeMillis())
            .apply();
        LocaleWidgets.updateAll(ctx);
    }

    /** "76%" from a recent report, or null. */
    static String label(Context ctx) {
        SharedPreferences p = prefs(ctx);
        long at = p.getLong("at", 0);
        if (at == 0 || System.currentTimeMillis() - at > STALE_MS) return null;
        return p.getInt("pct", 0) + "%";
    }

    /** Ask every 10 minutes while the phone is awake (inexact, so it rides along with other wake-ups). */
    static void schedule(Context ctx) {
        AlarmManager alarms = ctx.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + INTERVAL_MS, INTERVAL_MS, alarm(ctx));
    }

    static void cancel(Context ctx) {
        AlarmManager alarms = ctx.getSystemService(AlarmManager.class);
        if (alarms != null) alarms.cancel(alarm(ctx));
    }

    private static PendingIntent alarm(Context ctx) {
        Intent intent = new Intent(ctx, WidgetWeekChartProvider.class).setAction(ACTION_ASK);
        return PendingIntent.getBroadcast(ctx, 106, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
