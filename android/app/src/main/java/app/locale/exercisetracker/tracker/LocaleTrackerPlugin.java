package app.locale.exercisetracker.tracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Surface;
import android.view.WindowManager;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.IOException;
import java.util.List;
import org.json.JSONException;

@CapacitorPlugin(
    name = "LocaleTracker",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
)
public class LocaleTrackerPlugin extends Plugin {
    private static final long HEADING_EMIT_MS = 200;

    private volatile boolean inForeground = true;
    private static volatile boolean appVisible = false;
    private FusedLocationProviderClient fused;
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private final Handler main = new Handler(Looper.getMainLooper());

    private boolean warmupActive;
    private boolean headingRequested;
    private boolean headingRegistered;
    private Location warmupLocation;
    private long lastHeadingEmit;
    private float lastHeading = -999f;
    private final float[] rotation = new float[9];
    private final float[] remapped = new float[9];
    private final float[] orientation = new float[3];

    @Override
    public void load() {
        Context ctx = getContext();
        fused = LocationServices.getFusedLocationProviderClient(ctx);
        locationManager = ctx.getSystemService(LocationManager.class);
        sensorManager = ctx.getSystemService(SensorManager.class);
        TrackerHub.setListener((name, data) -> {
            if (inForeground) notifyListeners(name, data);
        });
    }

    @Override
    protected void handleOnPause() {
        inForeground = false;
        appVisible = false;
        unregisterHeading();
    }

    @Override
    protected void handleOnResume() {
        inForeground = true;
        appVisible = true;
        // Permissions may have changed in Settings; widgets choose start vs. open-app on that.
        LocaleWidgets.updateAll(getContext());
        if (headingRequested) registerHeading();
    }

    @Override
    protected void handleOnDestroy() {
        TrackerHub.setListener(null);
        stopWarmupInternal();
        unregisterHeading();
    }

    /** True while the app's activity is resumed (used to decide if a watch start can run directly). */
    static boolean isAppVisible() {
        return appVisible;
    }

    // ---- Watch ------------------------------------------------------------------------------

    @PluginMethod
    public void getWatchStatus(PluginCall call) {
        com.google.android.gms.wearable.Wearable.getCapabilityClient(getContext())
            .getCapability(WearSync.CAPABILITY_WEAR, com.google.android.gms.wearable.CapabilityClient.FILTER_ALL)
            .addOnCompleteListener(task -> {
                JSObject o = new JSObject();
                JSArray watches = new JSArray();
                boolean reachable = false;
                if (task.isSuccessful()) {
                    for (com.google.android.gms.wearable.Node n : task.getResult().getNodes()) {
                        JSObject w = new JSObject();
                        w.put("name", n.getDisplayName());
                        w.put("nearby", n.isNearby());
                        watches.put(w);
                        reachable |= n.isNearby();
                    }
                }
                o.put("supported", task.isSuccessful());
                o.put("watches", watches);
                o.put("connected", reachable);
                o.put("backgroundLocation", getPermissionState("backgroundLocation") == PermissionState.GRANTED);
                call.resolve(o);
            });
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Grant location access first", "permission");
            return;
        }
        requestPermissionForAlias("backgroundLocation", call, "backgroundLocationResult");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void backgroundLocationResult(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", getPermissionState("backgroundLocation") == PermissionState.GRANTED);
        call.resolve(o);
    }

    // ---- Widgets ----------------------------------------------------------------------------

    /** Ask the launcher to add a widget ("1x1", "2x1" or "2x2"); the user confirms in a system dialog. */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        android.appwidget.AppWidgetManager manager = android.appwidget.AppWidgetManager.getInstance(getContext());
        JSObject o = new JSObject();
        if (manager == null || !manager.isRequestPinAppWidgetSupported()) {
            o.put("supported", false);
            call.resolve(o);
            return;
        }
        Class<?> provider = LocaleWidgets.providerFor(call.getString("size", "2x2"));
        boolean requested = manager.requestPinAppWidget(new android.content.ComponentName(getContext(), provider), null, null);
        o.put("supported", true);
        o.put("requested", requested);
        call.resolve(o);
    }

    // ---- Capabilities & system settings -----------------------------------------------------

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        Context ctx = getContext();
        JSObject o = new JSObject();
        o.put("barometer", sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null);
        o.put("compass", sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null);
        o.put("gpsEnabled", locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER));
        PowerManager pm = ctx.getSystemService(PowerManager.class);
        o.put("ignoringBatteryOptimizations", pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        o.put("manufacturer", android.os.Build.MANUFACTURER);
        o.put("model", android.os.Build.MODEL);
        o.put("sdk", android.os.Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
        } catch (RuntimeException e) {
            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ---- Recording --------------------------------------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission not granted", "permission");
            return;
        }
        String workoutId = call.getString("workoutId");
        if (workoutId == null || workoutId.isEmpty()) {
            call.reject("workoutId is required");
            return;
        }
        TrackingService svc = TrackingService.get();
        if (svc != null) {
            JSObject status = svc.snapshot();
            if (!"idle".equals(status.getString("state"))) {
                call.reject("A workout is already in progress", "busy", null, status);
                return;
            }
        }
        stopWarmupInternal();
        Intent i = new Intent(getContext(), TrackingService.class)
            .setAction(TrackingService.ACTION_START)
            .putExtra(TrackingService.EXTRA_WORKOUT_ID, workoutId)
            .putExtra(TrackingService.EXTRA_ACTIVITY, call.getString("activity", "run"))
            .putExtra(TrackingService.EXTRA_AUTO_PAUSE, Boolean.TRUE.equals(call.getBoolean("autoPause", false)))
            .putExtra(TrackingService.EXTRA_UNITS, call.getString("units", "metric"))
            .putExtra(TrackingService.EXTRA_RESUME, Boolean.TRUE.equals(call.getBoolean("resume", false)));
        try {
            getContext().startForegroundService(i);
        } catch (RuntimeException e) {
            call.reject("Could not start tracking service: " + e.getMessage(), "service");
            return;
        }
        JSObject o = new JSObject();
        o.put("workoutId", workoutId);
        call.resolve(o);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        TrackingService svc = TrackingService.get();
        if (svc != null) svc.requestPause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        TrackingService svc = TrackingService.get();
        if (svc != null) svc.requestResume();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackingService svc = TrackingService.get();
        if (svc == null) {
            JSObject o = new JSObject();
            o.put("workoutId", null);
            o.put("pointCount", 0);
            call.resolve(o);
            return;
        }
        svc.requestStop((workoutId, count, saved) -> {
            JSObject o = new JSObject();
            o.put("workoutId", workoutId);
            o.put("pointCount", count);
            o.put("saved", saved);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        TrackingService svc = TrackingService.get();
        if (svc != null) {
            call.resolve(svc.snapshot());
            return;
        }
        JSObject o = new JSObject();
        o.put("state", "idle");
        call.resolve(o);
    }

    // ---- Journals ---------------------------------------------------------------------------

    @PluginMethod
    public void listJournals(PluginCall call) {
        List<Journal.Info> infos = Journal.list(getContext());
        TrackingService svc = TrackingService.get();
        String activeId = null;
        if (svc != null) {
            JSObject s = svc.snapshot();
            if (!"idle".equals(s.getString("state"))) activeId = s.getString("workoutId");
        }
        JSArray arr = new JSArray();
        for (Journal.Info info : infos) {
            JSObject o = new JSObject();
            o.put("workoutId", info.workoutId);
            o.put("ended", info.ended);
            o.put("active", info.workoutId.equals(activeId != null ? Journal.sanitize(activeId) : null));
            o.put("sizeBytes", info.sizeBytes);
            o.put("modifiedAt", info.modifiedAt);
            if (info.metaJson != null) {
                try {
                    o.put("meta", new JSObject(info.metaJson));
                } catch (JSONException ignored) {
                }
            }
            arr.put(o);
        }
        JSObject result = new JSObject();
        result.put("journals", arr);
        call.resolve(result);
    }

    @PluginMethod
    public void readJournal(PluginCall call) {
        String id = call.getString("workoutId");
        if (id == null) {
            call.reject("workoutId is required");
            return;
        }
        getBridge().execute(() -> {
            try {
                String text = Journal.read(getContext(), id);
                if (text == null) {
                    call.reject("Journal not found", "notfound");
                    return;
                }
                JSObject o = new JSObject();
                o.put("text", text);
                call.resolve(o);
            } catch (IOException e) {
                call.reject("Could not read journal: " + e.getMessage(), "io");
            }
        });
    }

    @PluginMethod
    public void deleteJournal(PluginCall call) {
        String id = call.getString("workoutId");
        if (id == null) {
            call.reject("workoutId is required");
            return;
        }
        TrackingService svc = TrackingService.get();
        if (svc != null && id.equals(svc.snapshot().getString("workoutId")) && !"idle".equals(svc.snapshot().getString("state"))) {
            call.reject("Cannot delete the active workout journal", "busy");
            return;
        }
        JSObject o = new JSObject();
        o.put("deleted", Journal.delete(getContext(), id));
        call.resolve(o);
    }

    // ---- Warm-up (pre-start GPS fix) ---------------------------------------------------------

    private final LocationCallback warmupCallback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            Location loc = result.getLastLocation();
            if (loc == null) return;
            warmupLocation = loc;
            JSObject ev = new JSObject();
            ev.put("state", "idle");
            ev.put("last", locationToJs(loc, Double.NaN));
            if (inForeground) notifyListeners("point", ev);
        }
    };

    private final GnssStatus.Callback warmupGnss = new GnssStatus.Callback() {
        private long lastEmit;

        @Override
        public void onSatelliteStatusChanged(@NonNull GnssStatus status) {
            long now = System.currentTimeMillis();
            if (now - lastEmit < 2000) return;
            lastEmit = now;
            int used = 0;
            double cn0 = 0;
            for (int i = 0; i < status.getSatelliteCount(); i++) {
                if (status.usedInFix(i)) {
                    used++;
                    cn0 += status.getCn0DbHz(i);
                }
            }
            JSObject ev = new JSObject();
            ev.put("satsUsed", used);
            ev.put("satsVisible", status.getSatelliteCount());
            ev.put("cn0", used > 0 ? Math.round(cn0 / used * 10) / 10.0 : 0);
            if (inForeground) notifyListeners("gnss", ev);
        }
    };

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startWarmup(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission not granted", "permission");
            return;
        }
        TrackingService svc = TrackingService.get();
        if (warmupActive || (svc != null && !"idle".equals(svc.snapshot().getString("state")))) {
            call.resolve();
            return;
        }
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000).build();
        fused.requestLocationUpdates(req, warmupCallback, Looper.getMainLooper());
        locationManager.registerGnssStatusCallback(warmupGnss, main);
        warmupActive = true;
        call.resolve();
    }

    @PluginMethod
    public void stopWarmup(PluginCall call) {
        stopWarmupInternal();
        call.resolve();
    }

    private void stopWarmupInternal() {
        if (!warmupActive) return;
        fused.removeLocationUpdates(warmupCallback);
        locationManager.unregisterGnssStatusCallback(warmupGnss);
        warmupActive = false;
    }

    // ---- Compass heading --------------------------------------------------------------------

    private final SensorEventListener headingListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            long now = System.currentTimeMillis();
            if (now - lastHeadingEmit < HEADING_EMIT_MS) return;
            SensorManager.getRotationMatrixFromVector(rotation, event.values);
            int axisX = SensorManager.AXIS_X;
            int axisY = SensorManager.AXIS_Y;
            int rot = getActivity() != null && getActivity().getDisplay() != null ? getActivity().getDisplay().getRotation() : Surface.ROTATION_0;
            switch (rot) {
                case Surface.ROTATION_90:
                    axisX = SensorManager.AXIS_Y;
                    axisY = SensorManager.AXIS_MINUS_X;
                    break;
                case Surface.ROTATION_180:
                    axisX = SensorManager.AXIS_MINUS_X;
                    axisY = SensorManager.AXIS_MINUS_Y;
                    break;
                case Surface.ROTATION_270:
                    axisX = SensorManager.AXIS_MINUS_Y;
                    axisY = SensorManager.AXIS_X;
                    break;
                default:
                    break;
            }
            SensorManager.remapCoordinateSystem(rotation, axisX, axisY, remapped);
            SensorManager.getOrientation(remapped, orientation);
            float azimuth = (float) Math.toDegrees(orientation[0]);
            Location ref = referenceLocation();
            if (ref != null) {
                GeomagneticField field = new GeomagneticField((float) ref.getLatitude(), (float) ref.getLongitude(),
                    (float) ref.getAltitude(), System.currentTimeMillis());
                azimuth += field.getDeclination();
            }
            azimuth = (azimuth + 360f) % 360f;
            float delta = Math.abs(azimuth - lastHeading);
            if (Math.min(delta, 360f - delta) < 1f) return;
            lastHeading = azimuth;
            lastHeadingEmit = now;
            JSObject ev = new JSObject();
            ev.put("heading", Math.round(azimuth * 10) / 10.0);
            ev.put("accuracy", event.accuracy);
            if (inForeground) notifyListeners("heading", ev);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    private Location referenceLocation() {
        TrackingService svc = TrackingService.get();
        Location fromService = svc != null ? svc.lastLocation() : null;
        return fromService != null ? fromService : warmupLocation;
    }

    @PluginMethod
    public void startHeading(PluginCall call) {
        headingRequested = true;
        registerHeading();
        call.resolve();
    }

    @PluginMethod
    public void stopHeading(PluginCall call) {
        headingRequested = false;
        unregisterHeading();
        call.resolve();
    }

    private void registerHeading() {
        if (headingRegistered) return;
        Sensor s = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        if (s == null) return;
        sensorManager.registerListener(headingListener, s, SensorManager.SENSOR_DELAY_UI, main);
        headingRegistered = true;
    }

    private void unregisterHeading() {
        if (!headingRegistered) return;
        sensorManager.unregisterListener(headingListener);
        headingRegistered = false;
    }

    // ---- Shared -----------------------------------------------------------------------------

    static JSObject locationToJs(Location loc, double fusedAlt) {
        JSObject o = new JSObject();
        o.put("t", loc.getTime());
        o.put("lat", loc.getLatitude());
        o.put("lon", loc.getLongitude());
        if (loc.hasAccuracy()) o.put("accuracy", loc.getAccuracy());
        double alt = !Double.isNaN(fusedAlt) ? fusedAlt
            : loc.hasMslAltitude() ? loc.getMslAltitudeMeters()
            : loc.hasAltitude() ? loc.getAltitude() : Double.NaN;
        if (!Double.isNaN(alt)) o.put("altitude", alt);
        if (loc.hasVerticalAccuracy()) o.put("altitudeAccuracy", loc.getVerticalAccuracyMeters());
        if (loc.hasSpeed()) o.put("speed", loc.getSpeed());
        if (loc.hasBearing()) o.put("bearing", loc.getBearing());
        return o;
    }
}
