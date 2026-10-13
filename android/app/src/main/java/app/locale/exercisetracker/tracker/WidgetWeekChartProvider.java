package app.locale.exercisetracker.tracker;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Bundle;

/** 4x2 home-screen widget: the week widget's stats, with this week's distance per day beside them. */
public class WidgetWeekChartProvider extends WidgetWeekProvider {
    @Override
    LocaleWidgets.Size size() {
        return LocaleWidgets.Size.WEEK_CHART;
    }

    /** Resized: the chart is drawn at the widget's size. */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, LocaleWidgets.build(ctx, size(), options));
    }
}
