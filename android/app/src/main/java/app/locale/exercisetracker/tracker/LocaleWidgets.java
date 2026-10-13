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
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Bundle;
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
 * distance and open the app. The 2×2 week widget shows this week's distance instead, and the
 * 4×2 adds a chart of distance per day.
 */
public final class LocaleWidgets {
    enum Size { SMALL, WIDE, LARGE, WEEK, WEEK_CHART }

    /** The day chart stacks bottom to top in this order, as STACK_ORDER in src/views/insights.js. */
    private static final String[] STACK_ORDER = { "cycle", "run", "walk", "ski" };

    private static final String PREFS = "locale_widgets";
    private static final String KEY_LAST = "lastActivity";
    static final String ACTION_NEW_WEEK = "app.locale.exercisetracker.NEW_WEEK";

    private LocaleWidgets() {}

    // ---- Providers --------------------------------------------------------------------------

    abstract static class Provider extends AppWidgetProvider {
        abstract Size size();

        @Override
        public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
            for (int id : ids) manager.updateAppWidget(id, build(ctx, size(), manager.getAppWidgetOptions(id)));
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
        update(app, manager, WidgetWeekChartProvider.class, Size.WEEK_CHART);
    }

    static Class<? extends Provider> providerFor(String size) {
        switch (size) {
            case "1x1":
                return Widget1x1Provider.class;
            case "2x1":
                return Widget2x1Provider.class;
            case "week":
                return WidgetWeekProvider.class;
            case "week-chart":
                return WidgetWeekChartProvider.class;
            default:
                return Widget2x2Provider.class;
        }
    }

    private static void update(Context ctx, AppWidgetManager manager, Class<?> provider, Size size) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(ctx, provider));
        if (ids.length == 0) return;
        for (int id : ids) manager.updateAppWidget(id, build(ctx, size, manager.getAppWidgetOptions(id)));
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- Rendering --------------------------------------------------------------------------

    /** @param options the widget's AppWidgetManager options: its size, for the 4×2's chart. */
    static RemoteViews build(Context ctx, Size size, Bundle options) {
        TrackingService svc = TrackingService.get();
        JSObject s = svc != null ? svc.snapshot() : null;
        String state = s != null ? s.getString("state", "idle") : "idle";
        if (size == Size.WEEK || size == Size.WEEK_CHART) return week(ctx, "idle".equals(state) ? null : s, size, options);
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

    /**
     * This week's distance, Sunday to Saturday, with its average split and speed, including
     * a workout being recorded now (counted by its elapsed time).
     */
    private static RemoteViews week(Context ctx, JSObject live, Size size, Bundle options) {
        long from = weekStart(System.currentTimeMillis());
        long to = addDays(from, 7);
        double meters = 0;
        double movingS = 0;
        int count = 0;
        try {
            double[] r = WorkoutStore.get(ctx).distanceBetween(from, to);
            meters = r[0];
            count = (int) r[1];
            movingS = r[2];
        } catch (Exception e) {
            // Store unavailable: show zero rather than fail the widget.
        }
        if (live != null && live.optLong("startedAt", 0) >= from) {
            meters += live.optDouble("distance", 0);
            movingS += live.optLong("elapsedMs", 0) / 1000.0;
            count++;
        }
        boolean imperial = "imperial".equals(PhoneSettings.units(ctx));
        double value = imperial ? meters / 1609.344 : meters / 1000;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), size == Size.WEEK_CHART ? R.layout.widget_week_chart : R.layout.widget_week);
        if (size == Size.WEEK_CHART) {
            v.setTextViewText(R.id.chart_title, imperial ? "mi per day" : "km per day");
            v.setImageViewBitmap(R.id.chart, dayChart(ctx, from, live, imperial, options));
        }
        v.setTextViewText(R.id.week_distance, String.format(Locale.US, value < 100 ? "%.1f" : "%.0f", value));
        v.setTextViewText(R.id.week_unit, imperial ? "mi" : "km");
        SimpleDateFormat day = new SimpleDateFormat("d MMM", Locale.getDefault());
        v.setTextViewText(R.id.week_range, day.format(from) + " – " + day.format(addDays(from, 6)));
        v.setTextViewText(R.id.week_count, count == 0 ? "No workouts yet" : count == 1 ? "1 workout" : count + " workouts");
        String split = WeekStats.split(meters, movingS, imperial);
        String speed = WeekStats.speed(meters, movingS, imperial);
        v.setTextViewText(R.id.week_split, split != null ? split : "");
        v.setTextViewText(R.id.week_speed, speed != null ? speed : "");
        v.setViewVisibility(R.id.week_split, split != null ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.week_speed, speed != null ? View.VISIBLE : View.GONE);
        v.setContentDescription(R.id.widget_root, String.format(Locale.US, "This week %.1f %s, %d workouts",
            value, imperial ? "miles" : "kilometres", count) + (split != null ? ", " + split + ", " + speed : ""));
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx));
        scheduleNewWeek(ctx, to);
        return v;
    }

    /**
     * This week's distance per day, Sunday to Saturday, stacked by activity in the activity
     * colours as in Insights' distance chart, with each day's initial under its bar (today's bold).
     * Drawn at the space the 4×2 layout leaves it, so it isn't stretched.
     */
    private static Bitmap dayChart(Context ctx, long from, JSObject live, boolean imperial, Bundle options) {
        long[] dayStarts = new long[8];
        for (int i = 0; i <= 7; i++) dayStarts[i] = addDays(from, i);
        double[][] byDay = new double[7][STACK_ORDER.length];
        try {
            byDay = WorkoutStore.get(ctx).distanceByDay(dayStarts, STACK_ORDER);
        } catch (Exception e) {
            // Store unavailable: an empty chart rather than a failed widget.
        }
        if (live != null) {
            int d = WorkoutStore.dayOf(dayStarts, live.optLong("startedAt", 0));
            int a = java.util.Arrays.asList(STACK_ORDER).indexOf(live.getString("activity", ""));
            if (d >= 0 && a >= 0) byDay[d][a] += live.optDouble("distance", 0);
        }
        double unit = imperial ? 1609.344 : 1000;
        double max = 0;
        for (double[] day : byDay) {
            double sum = 0;
            for (double m : day) sum += m / unit;
            max = Math.max(max, sum);
        }

        // The right half of the widget, less the 16dp padding, the 12dp gap and the title.
        float dp = ctx.getResources().getDisplayMetrics().density;
        int wDp = options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) : 0;
        int hDp = options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
        if (wDp <= 0) wDp = 300;
        if (hDp <= 0) hDp = 170;
        int w = Math.round(Math.max(80, (wDp - 32 - 12) / 2f) * dp);
        int h = Math.round(Math.max(50, hDp - 32 - 22) * dp);
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        int muted = ctx.getColor(R.color.widget_text_muted);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTextSize(11 * dp);
        text.setColor(muted);
        Paint grid = new Paint(Paint.ANTI_ALIAS_FLAG);
        grid.setColor(muted);
        grid.setAlpha(70);
        grid.setStrokeWidth(Math.max(1, dp));
        Paint bar = new Paint(Paint.ANTI_ALIAS_FLAG);

        double top = niceTop(max);
        String topLabel = top == Math.floor(top) ? String.format(Locale.US, "%.0f", top) : String.format(Locale.US, "%.1f", top);
        float plotTop = 6 * dp;
        float plotBottom = h - 16 * dp; // day initials below
        float plotRight = w - text.measureText(topLabel) - 4 * dp; // scale label on the right
        c.drawLine(0, plotTop, plotRight, plotTop, grid);
        c.drawLine(0, (plotTop + plotBottom) / 2, plotRight, (plotTop + plotBottom) / 2, grid);
        c.drawLine(0, plotBottom, plotRight, plotBottom, grid);
        c.drawText(topLabel, plotRight + 4 * dp, plotTop + 4 * dp, text);

        float slot = plotRight / 7;
        float barW = Math.min(16 * dp, slot * 0.6f);
        float radius = 3 * dp;
        int today = WorkoutStore.dayOf(dayStarts, System.currentTimeMillis());
        // The first letter of the short name: "EEEEE" gives "Su." or "M." in some locales.
        SimpleDateFormat dayName = new SimpleDateFormat("EEE", Locale.getDefault());
        text.setTextAlign(Paint.Align.CENTER);
        for (int d = 0; d < 7; d++) {
            float cx = slot * (d + 0.5f);
            int last = -1;
            for (int a = 0; a < STACK_ORDER.length; a++) if (byDay[d][a] > 0) last = a;
            double acc = 0;
            for (int a = 0; a < STACK_ORDER.length; a++) {
                double v = byDay[d][a] / unit;
                if (v <= 0) continue;
                float yBase = (float) (plotBottom - (plotBottom - plotTop) * acc / top);
                float yTop = (float) (plotBottom - (plotBottom - plotTop) * (acc + v) / top);
                if (acc > 0) yBase -= 2 * dp; // a 2dp gap between stacked segments
                acc += v;
                if (yBase - yTop < 0.5f) continue;
                bar.setColor(accent(STACK_ORDER[a]));
                c.drawPath(roundTop(cx - barW / 2, yTop, barW, yBase - yTop, a == last ? radius : 0), bar);
            }
            text.setTypeface(d == today ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            text.setColor(d == today ? ctx.getColor(R.color.widget_text) : muted);
            c.drawText(dayName.format(dayStarts[d]).substring(0, 1).toUpperCase(Locale.getDefault()), cx, h - 3 * dp, text);
        }
        return bmp;
    }

    /** A bar with rounded top corners (the data end) and a square base. */
    private static Path roundTop(float x, float y, float w, float h, float r) {
        r = Math.min(r, Math.min(w / 2, h));
        Path p = new Path();
        p.addRoundRect(new RectF(x, y, x + w, y + h), new float[] { r, r, r, r, 0, 0, 0, 0 }, Path.Direction.CW);
        return p;
    }

    /** The smallest 1, 2 or 5 × 10^n at or above {@code max}, for a tidy scale (1 when empty). */
    static double niceTop(double max) {
        if (!(max > 0)) return 1;
        double p = Math.pow(10, Math.floor(Math.log10(max)));
        for (double m : new double[] { 1, 2, 5 }) if (m * p >= max - 1e-9) return m * p;
        return 10 * p;
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
