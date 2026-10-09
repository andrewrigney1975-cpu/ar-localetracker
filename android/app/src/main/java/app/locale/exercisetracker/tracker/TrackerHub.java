package app.locale.exercisetracker.tracker;

import com.getcapacitor.JSObject;

/** In-process event bus between the tracking service and the Capacitor plugin. */
final class TrackerHub {
    interface Listener {
        void onTrackerEvent(String name, JSObject data);
    }

    private static volatile Listener listener;

    private TrackerHub() {}

    static void setListener(Listener l) {
        listener = l;
    }

    static void emit(String name, JSObject data) {
        Listener l = listener;
        if (l != null) l.onTrackerEvent(name, data);
    }
}
