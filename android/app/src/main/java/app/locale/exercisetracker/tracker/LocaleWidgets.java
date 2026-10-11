package app.locale.exercisetracker.tracker;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import app.locale.exercisetracker.MainActivity;
import app.locale.exercisetracker.R;
import app.locale.exercisetracker.store.WorkoutStore;
import com.getcapacitor.JSObject;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * Home-screen widgets: 1×1 (last-used activity), 2×1 (run, walk) and 2×2 (all four).
 * Idle widgets start a workout with one tap; while recording they show elapsed time and
 * distance and open the app. The 2×2 week widget shows this week's distance instead.
 */
public final class LocaleWidgets {
    enum Size { SMALL, WIDE, LARGE, WEEK }

    private static final String PREFS = "locale_widgets";
    private static final String KEY_LAST = "lastActivity";
    static final String ACTION_NEW_WEEK = "app.locale.exercisetracker.NEW_WEEK";

    private LocaleWidgets() {}

    // ---- Providers --------------------------------------------------------------------------

    abstract static class Provider extends AppWidgetProvider {
        abstract Size size();

        @Override
        public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
            RemoteViews views = build(ctx, size());
            for (int id : ids) manager.updateAppWidget(id, views);
        }
    }

    // ---- Public API -------------------------------------------------------------------------

    static void rememberActivity(Context ctx, String activity) {
        prefs(ctx).edit().putString(KEY_LAST, activity).apply();
    }

    static String lastActivity(Context ctx) {
        return prefs(ctx).getString(KEY_LAST, "run");
    }

    /** Refresh every placed Locale widget. Safe to call from any thread. */
    public static void updateAll(Context ctx) {
        Context app = ctx.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        if (manager == null) return;
        update(app, manager, Widget1x1Provider.class, Size.SMALL);
        update(app, manager, Widget2x1Provider.class, Size.WIDE);
        update(app, manager, Widget2x2Provider.class, Size.LARGE);
        update(app, manager, WidgetWeekProvider.class, Size.WEEK);
    }

    static Class<? extends Provider> providerFor(String size) {
        switch (size) {
            case "1x1":
                return Widget1x1Provider.class;
            case "2x1":
                return Widget2x1Provider.class;
            case "week":
                return WidgetWeekProvider.class;
            default:
                return Widget2x2Provider.class;
        }
    }

    private static void update(Context ctx, AppWidgetManager manager, Class<?> provider, Size size) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, provider));
        if (ids.length == 0) return;
        RemoteViews views = build(ctx, size);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- Rendering --------------------------------------------------------------------------

    static RemoteViews build(Context ctx, Size size) {
        TrackingService svc = TrackingService.get();
        JSObject s = svc != null ? svc.snapshot() : null;
        String state = s != null ? s.getString("state", "idle") : "idle";
        if (size == Size.WEEK) return week(ctx, "idle".equals(state) ? null : s);
        if (!"idle".equals(state)) return active(ctx, size, s, state);
        switch (size) {
            case SMALL: {
                RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_1x1);
                String act = lastActivity(ctx);
                v.setInt(R.id.tile_last, "setBackgroundResource", tileBackground(act));
                v.setImageViewResource(R.id.icon_last, icon(act));
                v.setTextViewText(R.id.label_last, ActivityProfile.forId(act).label);
                v.setContentDescription(R.id.tile_last, "Start " + ActivityProfile.forId(act).label.toLowerCase(Locale.ROOT));
                v.setOnClickPendingIntent(R.id.tile_last, startAction(ctx, act));
                return v;
            }
            case WIDE: {
                RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_2x1);
                v.setOnClickPendingIntent(R.id.tile_run, startAction(ctx, "run"));
                v.setOnClickPendingIntent(R.id.tile_walk, startAction(ctx, "walk"));
                return v;
            }
            default: {
                RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_2x2);
                v.setOnClickPendingIntent(R.id.tile_walk, startAction(ctx, "walk"));
                v.setOnClickPendingIntent(R.id.tile_run, startAction(ctx, "run"));
                v.setOnClickPendingIntent(R.id.tile_cycle, startAction(ctx, "cycle"));
                v.setOnClickPendingIntent(R.id.tile_ski, startAction(ctx, "ski"));
                return v;
            }
        }
    }

    private static RemoteViews active(Context ctx, Size size, JSObject s, String state) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_active);
        ActivityProfile act = ActivityProfile.forId(s.getString("activity", "run"));
        boolean recording = "recording".equals(state);
        String status = recording ? "Recording" : "autopaused".equals(state) ? "Auto-paused" : "Paused";
        v.setImageViewResource(R.id.active_icon, icon(act.id));
        v.setInt(R.id.active_icon, "setColorFilter", accent(act.id)); // the icons are white; this reads in both themes
        v.setTextViewText(R.id.active_title, size == Size.SMALL ? status : act.label + " · " + status);
        v.setTextColor(R.id.active_title, recording ? accent(act.id) : 0xFFD08A10);
        long elapsed = s.optLong("elapsedMs", 0L);
        v.setChronometer(R.id.active_time, SystemClock.elapsedRealtime() - elapsed, null, recording);
        v.setTextViewTextSize(R.id.active_time, TypedValue.COMPLEX_UNIT_SP, size == Size.SMALL ? 17 : 30);
        double meters = s.optDouble("distance", 0);
        boolean imperial = "imperial".equals(PhoneSettings.units(ctx));
        v.setTextViewText(R.id.active_distance, imperial
            ? String.format(Locale.US, "%.2f mi", meters / 1609.344)
            : String.format(Locale.US, "%.2f km", meters / 1000));
        v.setTextViewTextSize(R.id.active_distance, TypedValue.COMPLEX_UNIT_SP, size == Size.SMALL ? 12 : 15);
        v.setViewVisibility(R.id.active_icon, size == Size.SMALL ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx));
        return v;
    }

    /** Midnight at the start of this week's Sunday, local time. */
    static long weekStart(long nowMs) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(nowMs);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_YEAR, Calendar.SUNDAY - c.get(Calendar.DAY_OF_WEEK));
        return c.getTimeInMillis();
    }

    private static long addDays(long ms, int days) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.add(Calendar.DAY_OF_YEAR, days);
        return c.getTimeInMillis();
    }

    /** This week's distance, Sunday to Saturday, including a workout being recorded now. */
    private static RemoteViews week(Context ctx, JSObject live) {
        long from = weekStart(System.currentTimeMillis());
        long to = addDays(from, 7);
        double meters = 0;
        int count = 0;
        try {
            double[] r = WorkoutStore.get(ctx).distanceBetween(from, to);
            meters = r[0];
            count = (int) r[1];
        } catch (Exception e) {
            // Store unavailable: show zero rather than fail the widget.
        }
        if (live != null && live.optLong("startedAt", 0) >= from) {
            meters += live.optDouble("distance", 0);
            count++;
        }
        boolean imperial = "imperial".equals(PhoneSettings.units(ctx));
        double value = imperial ? meters / 1609.344 : meters / 1000;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_week);
        v.setTextViewText(R.id.week_distance, String.format(Locale.US, value < 100 ? "%.1f" : "%.0f", value));
        v.setTextViewText(R.id.week_unit, imperial ? "mi" : "km");
        SimpleDateFormat day = new SimpleDateFormat("d MMM", Locale.getDefault());
        v.setTextViewText(R.id.week_range, day.format(from) + " – " + day.format(addDays(from, 6)));
        v.setTextViewText(R.id.week_count, count == 0 ? "No workouts yet" : count == 1 ? "1 workout" : count + " workouts");
        v.setContentDescription(R.id.widget_root, String.format(Locale.US, "This week %.1f %s, %d workouts",
            value, imperial ? "miles" : "kilometres", count));
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx));
        scheduleNewWeek(ctx, to);
        return v;
    }

    /** Refresh the week widget when the next week starts (inexact: may land a little late). */
    private static void scheduleNewWeek(Context ctx, long atMs) {
        AlarmManager alarms = ctx.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        Intent intent = new Intent(ctx, WidgetWeekProvider.class).setAction(ACTION_NEW_WEEK);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 105, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        alarms.set(AlarmManager.RTC, atMs + 1000, pi);
    }

    /** Start tracking directly (a widget tap counts as user interaction), or open the app if location isn't allowed yet. */
    private static PendingIntent startAction(Context ctx, String activity) {
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return openApp(ctx);
        }
        Intent start = new Intent(ctx, TrackingService.class)
            .setAction(TrackingService.ACTION_START)
            .putExtra(TrackingService.EXTRA_ACTIVITY, activity);
        return PendingIntent.getForegroundService(ctx, requestCode(activity), start,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent openApp(Context ctx) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 99, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Stable, distinct PendingIntent request codes per activity. */
    private static int requestCode(String activity) {
        switch (activity) {
            case "walk":
                return 101;
            case "cycle":
                return 103;
            case "ski":
                return 104;
            default:
                return 102;
        }
    }

    static int icon(String activity) {
        switch (activity) {
            case "walk":
                return R.drawable.ic_activity_walk;
            case "cycle":
                return R.drawable.ic_activity_cycle;
            case "ski":
                return R.drawable.ic_activity_ski;
            default:
                return R.drawable.ic_activity_run;
        }
    }

    private static int tileBackground(String activity) {
        switch (activity) {
            case "walk":
                return R.drawable.widget_tile_walk;
            case "cycle":
                return R.drawable.widget_tile_cycle;
            case "ski":
                return R.drawable.widget_tile_ski;
            default:
                return R.drawable.widget_tile_run;
        }
    }

    private static int accent(String activity) {
        switch (activity) {
            case "walk":
                return 0xFF13A594;
            case "cycle":
                return 0xFF2F7DF6;
            case "ski":
                return 0xFF8A63F0;
            default:
                return 0xFFF2672E;
        }
    }
}
