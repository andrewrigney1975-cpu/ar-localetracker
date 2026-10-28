package app.locale.exercisetracker.tracker;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** 4x2 home-screen widget: the week widget's stats, with this week's distance per day beside them. */
public class WidgetWeekChartProvider extends WidgetWeekProvider {
    @Override
    LocaleWidgets.Size size() {
        return LocaleWidgets.Size.WEEK_CHART;
    }

    /** Placed, or the system's update after a reboot or app update: (re)start asking the watch for its battery. */
    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        super.onUpdate(ctx, manager, ids);
        WatchBattery.schedule(ctx);
        WatchBattery.ask(ctx);
    }

    /** Resized: the chart is drawn at the widget's size. */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, LocaleWidgets.build(ctx, size(), options));
    }

    /** The last 4x2 was removed. */
    @Override
    public void onDisabled(Context ctx) {
        WatchBattery.cancel(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (WatchBattery.ACTION_ASK.equals(intent.getAction())) WatchBattery.ask(ctx);
        else super.onReceive(ctx, intent);
    }
}
