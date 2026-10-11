package app.locale.exercisetracker.tracker;

import android.content.Context;
import android.content.Intent;

/** 2x2 home-screen widget: distance of this week's workouts, Sunday to Saturday. */
public class WidgetWeekProvider extends LocaleWidgets.Provider {
    @Override
    LocaleWidgets.Size size() {
        return LocaleWidgets.Size.WEEK;
    }

    /** A new week, or the clock or time zone changed: the week's bounds move. */
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (LocaleWidgets.ACTION_NEW_WEEK.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            LocaleWidgets.updateAll(ctx);
        } else {
            super.onReceive(ctx, intent);
        }
    }
}
