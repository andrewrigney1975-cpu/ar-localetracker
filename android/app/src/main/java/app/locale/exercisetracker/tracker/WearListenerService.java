package app.locale.exercisetracker.tracker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.NonNull;
import app.locale.exercisetracker.R;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives commands and heart-rate samples from the Locale watch app.
 *
 * Paths (watch → phone): /locale/start {activity}, /locale/pause, /locale/resume,
 * /locale/stop, /locale/hr {s: [[epochMs, bpm], ...]}, /locale/status-request.
 */
public class WearListenerService extends WearableListenerService {
    private static final String TAG = "LocaleWear";
    private static final String CHANNEL_ID = "watch";
    private static final int START_PROMPT_ID = 1002;

    @Override
    public void onMessageReceived(@NonNull MessageEvent event) {
        String path = event.getPath();
        String body = new String(event.getData(), StandardCharsets.UTF_8);
        try {
            switch (path) {
                case "/locale/start":
                    handleStart(new JSONObject(body.isEmpty() ? "{}" : body).optString("activity", "run"));
                    break;
                case "/locale/pause":
                    withService(TrackingService::requestPause);
                    break;
                case "/locale/resume":
                    withService(TrackingService::requestResume);
                    break;
                case "/locale/stop":
                    withService(svc -> svc.requestStop(null));
                    break;
                case "/locale/hr":
                    handleHeartRate(new JSONObject(body));
                    break;
                case "/locale/status-request":
                    sendStatus();
                    break;
                default:
                    Log.d(TAG, "Unknown path " + path);
            }
        } catch (Exception e) {
            Log.w(TAG, "Bad message on " + path, e);
        }
    }

    private interface ServiceAction {
        void run(TrackingService svc);
    }

    private void withService(ServiceAction action) {
        TrackingService svc = TrackingService.get();
        if (svc != null) action.run(svc);
        else sendStatus();
    }

    private void sendStatus() {
        TrackingService svc = TrackingService.get();
        if (svc != null) svc.pushWearStatus(true);
        else {
            JSONObject idle = new JSONObject();
            try {
                idle.put("state", "idle");
                idle.put("units", PhoneSettings.units(this));
                idle.put("t", System.currentTimeMillis());
            } catch (Exception ignored) {
            }
            WearSync.send(this, WearSync.PATH_STATUS, idle);
        }
    }

    private void handleHeartRate(JSONObject body) {
        TrackingService svc = TrackingService.get();
        if (svc == null) return;
        JSONArray samples = body.optJSONArray("s");
        if (samples == null) return;
        for (int i = 0; i < samples.length(); i++) {
            JSONArray s = samples.optJSONArray(i);
            if (s == null || s.length() < 2) continue;
            svc.onHeartRate(s.optLong(0), s.optInt(1));
        }
    }

    private void handleStart(String activity) {
        TrackingService svc = TrackingService.get();
        if (svc != null && !"idle".equals(svc.snapshot().getString("state"))) {
            svc.pushWearStatus(true); // already recording: just resync the watch
            return;
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            WearSync.send(this, WearSync.PATH_ERROR, WearSync.error("permission", "Open Locale on your phone and allow location access"));
            return;
        }
        Intent start = startIntent(this, activity);
        // Background starts need "Allow all the time" location and no battery optimisation;
        // when the app is on screen neither is required.
        boolean background = checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean unrestricted = getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName());
        if (LocaleTrackerPlugin.isAppVisible() || (background && unrestricted)) {
            try {
                startForegroundService(start);
                return;
            } catch (RuntimeException e) {
                Log.w(TAG, "Background start refused", e);
            }
        }
        promptOnPhone(activity, start);
        WearSync.send(this, WearSync.PATH_ERROR, WearSync.error("needs_phone",
            "Tap the Locale notification on your phone to start. To start from the watch alone, allow location \"All the time\" in Locale settings."));
    }

    static Intent startIntent(Context ctx, String activity) {
        return new Intent(ctx, TrackingService.class)
            .setAction(TrackingService.ACTION_START)
            .putExtra(TrackingService.EXTRA_WORKOUT_ID, TrackingService.newWorkoutId())
            .putExtra(TrackingService.EXTRA_ACTIVITY, activity)
            .putExtra(TrackingService.EXTRA_AUTO_PAUSE, PhoneSettings.autoPause(ctx, activity))
            .putExtra(TrackingService.EXTRA_UNITS, PhoneSettings.units(ctx));
    }

    /** A notification whose tap starts tracking (user interaction is allowed to start location services). */
    private void promptOnPhone(String activity, Intent start) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Watch requests", NotificationManager.IMPORTANCE_HIGH));
        PendingIntent pi = PendingIntent.getForegroundService(this, 10, start,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String label = ActivityProfile.forId(activity).label;
        Notification n = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracker)
            .setContentTitle("Start " + label + " from your watch?")
            .setContentText("Tap to start recording on this phone")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_action_play), "Start " + label, pi).build())
            .build();
        nm.notify(START_PROMPT_ID, n);
    }

    static void clearStartPrompt(Context ctx) {
        ctx.getSystemService(NotificationManager.class).cancel(START_PROMPT_ID);
    }
}
