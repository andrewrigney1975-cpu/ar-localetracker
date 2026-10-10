package app.locale.exercisetracker.tracker;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationManager;
import android.location.altitude.AltitudeConverter;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.NonNull;
import app.locale.exercisetracker.MainActivity;
import app.locale.exercisetracker.R;
import app.locale.exercisetracker.store.WorkoutStore;
import com.getcapacitor.JSObject;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.IOException;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Foreground service (type=location) that records a workout. All tracking state is
 * owned by a dedicated HandlerThread; location, sensor and command callbacks all run there.
 */
public class TrackingService extends Service {
    private static final String TAG = "LocaleTracker";

    static final String ACTION_START = "app.locale.tracker.START";
    static final String ACTION_PAUSE = "app.locale.tracker.PAUSE";
    static final String ACTION_RESUME = "app.locale.tracker.RESUME";
    static final String ACTION_STOP = "app.locale.tracker.STOP";

    static final String EXTRA_WORKOUT_ID = "workoutId";
    static final String EXTRA_ACTIVITY = "activity";
    static final String EXTRA_AUTO_PAUSE = "autoPause";
    static final String EXTRA_UNITS = "units";
    static final String EXTRA_RESUME = "resume";
    static final String EXTRA_GOAL_M = "goalM";
    static final String EXTRA_FIX_LAT = "fixLat";
    static final String EXTRA_FIX_LON = "fixLon";
    static final String EXTRA_FIX_T = "fixT";
    static final String EXTRA_FIX_ACC = "fixAcc";

    /** Auto goal: decide at the first fix this accurate, or without location after the timeout. */
    private static final double GOAL_FIX_ACCURACY_M = 30;
    private static final long GOAL_TIMEOUT_MS = 90_000;
    private static final long GOAL_FIX_MAX_AGE_MS = 120_000;

    private static final String CHANNEL_ID = "tracking";
    private static final int NOTIFICATION_ID = 1001;
    private static final String PREFS = "locale_tracker";

    private static final long AUTO_PAUSE_AFTER_MS = 5000;
    private static final long NOTIFICATION_INTERVAL_MS = 5000;
    private static final long SNAPSHOT_INTERVAL_MS = 10000;
    private static final long GNSS_EMIT_INTERVAL_MS = 2000;
    private static final long WEAR_PUSH_INTERVAL_MS = 2000;
    private static final long WIDGET_INTERVAL_MS = 30_000;
    private static final long HR_FRESH_MS = 15000;
    /** Wake lock is held in short leases, renewed on every fix, so it can never leak. */
    private static final long WAKE_LEASE_MS = 10 * 60 * 1000;

    enum State { IDLE, RECORDING, PAUSED, AUTOPAUSED }

    interface StopCallback {
        /** @param saved true when the workout was processed and stored natively (SQLite). */
        void onStopped(String workoutId, long pointCount, boolean saved);
    }

    private static volatile TrackingService instance;

    static TrackingService get() {
        return instance;
    }

    // Threading
    private HandlerThread thread;
    private Handler handler;

    // Platform services
    private FusedLocationProviderClient fused;
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private Sensor pressureSensor;
    private PowerManager.WakeLock wakeLock;
    private NotificationManager notificationManager;
    private AltitudeConverter altitudeConverter;
    private SharedPreferences prefs;

    // Workout state (guarded by `this` for cross-thread reads in snapshot()).
    private State state = State.IDLE;
    private String workoutId;
    private ActivityProfile profile = ActivityProfile.forId("run");
    private boolean autoPause;
    private String units = "metric";
    private long startedAt;
    private long elapsedBaseMs;
    private long runningSinceRealtime;
    private double distanceM;
    private int segment;
    private long seq;
    private Journal journal;
    private Location anchor;
    private int anchorSegment = -1;
    private Location lastLocation;
    private double lastFusedAlt = Double.NaN;
    private long slowSinceRealtime;
    private int fastFixes;
    private int satsUsed;
    private int lastHr;
    private long lastHrAt;
    private long lastWearPushMs;
    private long lastWidgetUpdateMs;
    private int satsVisible;
    private double meanCn0;
    private long lastNotificationMs;
    private long lastSnapshotMs;
    private long lastGnssEmitMs;
    private boolean locationActive;
    private int locationPriority = -1;

    private final AltitudeFusion altitude = new AltitudeFusion();

    // Voice announcements (tracker thread; the coach's counters are read under `this`).
    private VoiceCoach coach;
    private Speaker speaker;

    // Goal for this workout (manual, or predicted from learned routines).
    private boolean goalPending;
    private double goalM;
    private String goalSource;
    private String goalRoutineId;
    private String goalName;
    private double goalConfidence;
    private boolean goalOffRoute;
    private RouteGuard routeGuard;
    private final Runnable goalTimeout = () -> decideGoal(Double.NaN, Double.NaN);

    // ---- Lifecycle --------------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        thread = new HandlerThread("LocaleTracker");
        thread.start();
        handler = new Handler(thread.getLooper());
        fused = LocationServices.getFusedLocationProviderClient(this);
        locationManager = getSystemService(LocationManager.class);
        sensorManager = getSystemService(SensorManager.class);
        pressureSensor = sensorManager != null ? sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) : null;
        notificationManager = getSystemService(NotificationManager.class);
        altitudeConverter = new AltitudeConverter();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        PowerManager pm = getSystemService(PowerManager.class);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Locale:tracking");
        wakeLock.setReferenceCounted(false);
        createChannel();
    }

    @Override
    public void onDestroy() {
        instance = null;
        LocaleWidgets.updateAll(this); // back to the start buttons
        stopLocationUpdates();
        unregisterSensors();
        if (wakeLock.isHeld()) wakeLock.release();
        if (journal != null) journal.close();
        if (speaker != null) speaker.shutdown();
        thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Sticky restart after process death: try to continue the active workout.
            if (!prefs.getBoolean("active", false) || !promoteToForeground("Resuming workout")) {
                stopSelf();
                return START_NOT_STICKY;
            }
            handler.post(this::restoreAfterRestart);
            return START_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            // Already recording (e.g. a second widget tap): keep the current notification.
            if (!promoteToForeground(state == State.IDLE ? "Starting workout" : null)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            // Widgets send only the activity; fill in a fresh ID and the user's settings here.
            String act = intent.getStringExtra(EXTRA_ACTIVITY);
            String id = intent.hasExtra(EXTRA_WORKOUT_ID) ? intent.getStringExtra(EXTRA_WORKOUT_ID) : newWorkoutId();
            boolean ap = intent.hasExtra(EXTRA_AUTO_PAUSE)
                ? intent.getBooleanExtra(EXTRA_AUTO_PAUSE, false)
                : PhoneSettings.autoPause(this, act == null ? "run" : act);
            String u = intent.hasExtra(EXTRA_UNITS) ? intent.getStringExtra(EXTRA_UNITS) : PhoneSettings.units(this);
            boolean resume = intent.getBooleanExtra(EXTRA_RESUME, false);
            GoalStart gs = new GoalStart();
            gs.goalM = intent.getDoubleExtra(EXTRA_GOAL_M, 0);
            if (intent.hasExtra(EXTRA_FIX_LAT)) {
                gs.fixLat = intent.getDoubleExtra(EXTRA_FIX_LAT, Double.NaN);
                gs.fixLon = intent.getDoubleExtra(EXTRA_FIX_LON, Double.NaN);
                gs.fixT = intent.getLongExtra(EXTRA_FIX_T, 0);
                gs.fixAcc = intent.getDoubleExtra(EXTRA_FIX_ACC, 999);
            }
            handler.post(() -> startWorkout(id, act, ap, u, resume, gs));
        } else if (ACTION_PAUSE.equals(action)) {
            handler.post(this::pauseWorkout);
        } else if (ACTION_RESUME.equals(action)) {
            handler.post(this::resumeWorkout);
        } else if (ACTION_STOP.equals(action)) {
            handler.post(() -> stopWorkout(null));
        }
        return START_STICKY;
    }

    /** Goal inputs from the start screen: a manual goal, and the warm-up fix. */
    static final class GoalStart {
        double goalM;
        double fixLat = Double.NaN;
        double fixLon = Double.NaN;
        long fixT;
        double fixAcc = 999;
    }

    /** Same format as the web app's newWorkoutId(). */
    static String newWorkoutId() {
        return "w" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new java.util.Date())
            + "-" + Integer.toString(new java.util.Random().nextInt(36 * 36 * 36 * 36), 36);
    }

    private boolean promoteToForeground(String text) {
        try {
            startForeground(NOTIFICATION_ID, buildNotification(text), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            return true;
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException or SecurityException (permission revoked).
            Log.e(TAG, "Cannot start foreground service", e);
            return false;
        }
    }

    // ---- Commands (called from the plugin; executed on the tracker thread) -------------------

    void requestPause() {
        handler.post(this::pauseWorkout);
    }

    void requestResume() {
        handler.post(this::resumeWorkout);
    }

    void requestStop(StopCallback cb) {
        handler.post(() -> stopWorkout(cb));
    }

    private void startWorkout(String id, String activityId, boolean ap, String u, boolean resume, GoalStart gs) {
        if (id == null) return;
        synchronized (this) {
            if (state != State.IDLE) {
                if (!id.equals(workoutId)) Log.w(TAG, "Start ignored: workout " + workoutId + " already active");
                return;
            }
            workoutId = id;
            profile = ActivityProfile.forId(activityId);
            autoPause = ap;
            units = "imperial".equals(u) ? "imperial" : "metric";
            coach = new VoiceCoach(PhoneSettings.voice(this, profile.id));
            if (resume && id.equals(prefs.getString("workoutId", null))) {
                startedAt = prefs.getLong("startedAt", System.currentTimeMillis());
                elapsedBaseMs = prefs.getLong("elapsedBaseMs", 0);
                distanceM = Double.longBitsToDouble(prefs.getLong("distanceBits", 0));
                segment = prefs.getInt("segment", 0) + 1;
                seq = prefs.getLong("seq", 0);
                if (prefs.contains("vSplits")) {
                    coach.splitsDone = prefs.getInt("vSplits", 0);
                    coach.lastSplitMs = prefs.getLong("vSplitMs", 0);
                    coach.intervalsDone = prefs.getLong("vIntervals", 0);
                    coach.goalMask = prefs.getInt("vGoal", 0);
                } else {
                    coach.syncTo(distanceM, elapsedBaseMs);
                }
                restoreGoal();
            } else {
                startedAt = System.currentTimeMillis();
                elapsedBaseMs = 0;
                distanceM = 0;
                segment = 0;
                seq = 0;
            }
            anchor = null;
            anchorSegment = -1;
            slowSinceRealtime = 0;
            fastFixes = 0;
        }
        try {
            journal = new Journal(Journal.fileFor(this, id));
        } catch (IOException e) {
            Log.e(TAG, "Cannot open journal", e);
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }
        if (journal.isEmpty()) {
            JSONObject meta = new JSONObject();
            put(meta, "type", "meta");
            put(meta, "v", 1);
            put(meta, "workoutId", id);
            put(meta, "activity", profile.id);
            put(meta, "startedAt", startedAt);
            put(meta, "autoPause", autoPause);
            put(meta, "hasBarometer", pressureSensor != null);
            put(meta, "device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            put(meta, "sdk", android.os.Build.VERSION.SDK_INT);
            journal.append(meta, true);
        }
        WearListenerService.clearStartPrompt(this);
        LocaleWidgets.rememberActivity(this, profile.id);
        synchronized (this) {
            lastHr = 0;
            lastHrAt = 0;
        }
        if (coach.enabled() && speaker == null) speaker = new Speaker(this, coach.cfg.duck);
        wakeLock.acquire(WAKE_LEASE_MS);
        registerSensors();
        setState(State.RECORDING, resume ? "restored" : "start");
        if (!resume) startGoal(gs);
        else if (goalPending) handler.postDelayed(goalTimeout, GOAL_TIMEOUT_MS);
        requestLocationUpdates(Priority.PRIORITY_HIGH_ACCURACY);
    }

    private void restoreAfterRestart() {
        String id = prefs.getString("workoutId", null);
        if (id == null) {
            stopSelf();
            return;
        }
        startWorkout(id, prefs.getString("activity", "run"), prefs.getBoolean("autoPause", false),
            prefs.getString("units", "metric"), true, null);
    }

    private void pauseWorkout() {
        if (state != State.RECORDING && state != State.AUTOPAUSED) return;
        setState(State.PAUSED, "pause");
        if (wakeLock.isHeld()) wakeLock.release();
        // Keep a warm but cheaper fix while paused so resuming is instant.
        requestLocationUpdates(Priority.PRIORITY_BALANCED_POWER_ACCURACY);
    }

    private void resumeWorkout() {
        if (state != State.PAUSED) return;
        synchronized (this) {
            segment++;
            slowSinceRealtime = 0;
            fastFixes = 0;
        }
        wakeLock.acquire(WAKE_LEASE_MS);
        setState(State.RECORDING, "resume");
        requestLocationUpdates(Priority.PRIORITY_HIGH_ACCURACY);
    }

    private void stopWorkout(StopCallback cb) {
        if (state == State.IDLE) {
            if (cb != null) cb.onStopped(workoutId, 0, false);
            stopSelf();
            return;
        }
        setState(State.IDLE, "stop");
        handler.removeCallbacks(goalTimeout);
        goalPending = false;
        routeGuard = null;
        synchronized (this) {
            goalM = 0;
            goalSource = null;
            goalOffRoute = false;
        }
        String id = workoutId;
        long count = seq;
        JSONObject end = new JSONObject();
        put(end, "type", "end");
        put(end, "t", System.currentTimeMillis());
        put(end, "elapsedMs", elapsedBaseMs);
        put(end, "distance", distanceM);
        journal.append(end, true);
        journal.close();
        journal = null;
        prefs.edit().clear().apply();
        stopLocationUpdates();
        unregisterSensors();
        if (wakeLock.isHeld()) wakeLock.release();
        if (speaker != null) {
            speaker.shutdown();
            speaker = null;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        boolean saved = finalizeNatively(id);
        if (cb != null) cb.onStopped(id, count, saved);
        stopSelf();
    }

    /**
     * Process the finished journal and store it in SQLite, then delete the journal. Only once
     * the IndexedDB → SQLite migration has completed (otherwise the app may still be reading
     * IndexedDB). On any failure the journal is kept and the app imports it as before.
     */
    private boolean finalizeNatively(String id) {
        WorkoutStore store = WorkoutStore.get(this);
        if (store.getMeta("migrated_from_idb") == null) return false;
        boolean saved = NativeFinalizer.finalizeJournal(this, store, id);
        if (saved) {
            JSObject ev = new JSObject();
            ev.put("workoutId", id);
            TrackerHub.emit("saved", ev);
        }
        return saved;
    }

    private void setState(State next, String reason) {
        long now = SystemClock.elapsedRealtime();
        synchronized (this) {
            if (state == State.RECORDING && next != State.RECORDING) {
                elapsedBaseMs += Math.max(0, now - runningSinceRealtime);
            }
            if (next == State.RECORDING && state != State.RECORDING) {
                runningSinceRealtime = now;
            }
            state = next;
        }
        if (journal != null) {
            JSONObject line = new JSONObject();
            put(line, "type", "state");
            put(line, "t", System.currentTimeMillis());
            put(line, "state", stateName(next));
            put(line, "reason", reason);
            put(line, "seg", segment);
            journal.append(line, true);
        }
        saveSnapshot();
        updateNotification(true);
        JSObject ev = snapshot();
        ev.put("reason", reason);
        TrackerHub.emit("state", ev);
        pushWearStatus(true);
        LocaleWidgets.updateAll(this);
    }

    // ---- Location ---------------------------------------------------------------------------

    private final LocationCallback locationCallback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            for (Location loc : result.getLocations()) onLocation(loc);
        }
    };

    @SuppressLint("MissingPermission")
    private void requestLocationUpdates(int priority) {
        if (locationActive && locationPriority == priority) return;
        LocationRequest req = new LocationRequest.Builder(priority, 1000)
            .setMinUpdateIntervalMillis(500)
            .setMinUpdateDistanceMeters(0)
            .setMaxUpdateDelayMillis(0)
            .setWaitForAccurateLocation(priority == Priority.PRIORITY_HIGH_ACCURACY)
            .build();
        try {
            fused.requestLocationUpdates(req, locationCallback, handler.getLooper());
            locationActive = true;
            locationPriority = priority;
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission missing", e);
            TrackerHub.emit("error", errorEvent("permission", "Location permission was revoked"));
        }
    }

    private void stopLocationUpdates() {
        if (!locationActive) return;
        fused.removeLocationUpdates(locationCallback);
        locationActive = false;
        locationPriority = -1;
    }

    private void onLocation(Location loc) {
        if (state == State.IDLE) return;
        long nowRt = SystemClock.elapsedRealtime();
        long nowMs = System.currentTimeMillis();

        if (!loc.hasMslAltitude() && loc.hasAltitude()) {
            try {
                altitudeConverter.addMslAltitudeToLocation(this, loc);
            } catch (IOException | RuntimeException ignored) {
                // Geoid model unavailable; fall back to ellipsoidal altitude.
            }
        }
        double gnssAlt = loc.hasMslAltitude() ? loc.getMslAltitudeMeters()
            : (loc.hasAltitude() ? loc.getAltitude() : Double.NaN);
        double vAcc = loc.hasMslAltitude() && loc.hasMslAltitudeAccuracy() ? loc.getMslAltitudeAccuracyMeters()
            : (loc.hasVerticalAccuracy() ? loc.getVerticalAccuracyMeters() : Double.NaN);
        double fusedAlt = altitude.onGnss(gnssAlt, vAcc, nowMs);
        float speed = loc.hasSpeed() ? loc.getSpeed() : derivedSpeed(loc);

        synchronized (this) {
            lastLocation = loc;
            lastFusedAlt = fusedAlt;
        }

        if (state != State.PAUSED) {
            wakeLock.acquire(WAKE_LEASE_MS);
            seq++;
            journal.append(pointJson(loc, gnssAlt, fusedAlt), false);
            if (autoPause) handleAutoPause(speed, nowRt);
            if (goalPending && loc.hasAccuracy() && loc.getAccuracy() <= GOAL_FIX_ACCURACY_M) {
                decideGoal(loc.getLatitude(), loc.getLongitude());
            }
            if (state == State.RECORDING) {
                accumulateDistance(loc, speed);
                checkRoute(loc);
                announce();
            }
        }

        JSObject ev = snapshot();
        TrackerHub.emit("point", ev);

        if (nowMs - lastNotificationMs >= NOTIFICATION_INTERVAL_MS) updateNotification(false);
        if (nowMs - lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) saveSnapshot();
        pushWearStatus(false);
        if (nowMs - lastWidgetUpdateMs >= WIDGET_INTERVAL_MS) {
            lastWidgetUpdateMs = nowMs;
            LocaleWidgets.updateAll(this); // distance; the chronometer ticks on its own
        }
    }

    /** Splits, time and goal announcements; only while actually recording (not paused). */
    private void announce() {
        String text;
        synchronized (this) {
            if (coach == null) return;
            text = coach.onProgress(distanceM, elapsedMs());
        }
        if (text == null) return;
        if (speaker != null) speaker.speak(text);
        JSObject ev = new JSObject();
        ev.put("text", text);
        TrackerHub.emit("announce", ev); // shown as a caption on the live screen
    }

    // ---- Goal (manual, or predicted from learned routines) -----------------------------------

    private void startGoal(GoalStart gs) {
        goalPending = false;
        routeGuard = null;
        if (gs != null && gs.goalM > 0) {
            applyGoal(gs.goalM, "manual", null, null, 1, null);
        } else if (coach.cfg.goal && coach.cfg.goalM > 0) {
            applyGoal(coach.cfg.goalM, "manual", null, null, 1, null);
        } else if (coach.cfg.autoGoal) {
            goalPending = true;
            boolean freshFix = gs != null && !Double.isNaN(gs.fixLat) && gs.fixAcc <= GOAL_FIX_ACCURACY_M
                && System.currentTimeMillis() - gs.fixT <= GOAL_FIX_MAX_AGE_MS;
            if (freshFix) decideGoal(gs.fixLat, gs.fixLon);
            else handler.postDelayed(goalTimeout, GOAL_TIMEOUT_MS);
        }
    }

    /** Auto goal: ask the routine model once, with a good fix or (after the timeout) without one. */
    private void decideGoal(double lat, double lon) {
        if (!goalPending || state == State.IDLE) return;
        goalPending = false;
        handler.removeCallbacks(goalTimeout);
        int tz = -java.util.TimeZone.getDefault().getOffset(startedAt) / 60000;
        RoutineMatcher.Prediction p = new RoutineMatcher(PhoneSettings.routineModel(this))
            .predict(profile.id, startedAt, tz, lat, lon, coach.cfg.imperial);
        if (!p.hasGoal()) {
            Log.i(TAG, "No auto goal: " + p.reason);
            JSObject ev = new JSObject();
            ev.put("reason", p.reason);
            TrackerHub.emit("goal", ev);
            saveSnapshot();
            return;
        }
        applyGoal(p.goalM, p.source, p.routineId, p.name, p.confidence, p.signature);
    }

    private void applyGoal(double m, String source, String routineId, String name, double confidence, org.json.JSONArray signature) {
        synchronized (this) {
            coach.setGoal(m, distanceM);
            goalM = m;
            goalSource = source;
            goalRoutineId = routineId;
            goalName = name;
            goalConfidence = confidence;
            goalOffRoute = false;
        }
        routeGuard = "route".equals(source) && signature != null && signature.length() > 1 ? new RouteGuard(signature) : null;
        journalGoal();
        if (coach.cfg.confirmGoal) say(VoiceCoach.goalConfirmation(m, coach.cfg.imperial, source, name));
        TrackerHub.emit("goal", goalJs());
        saveSnapshot();
        updateNotification(true);
        pushWearStatus(true);
    }

    /** Left the routine's route: stop goal milestones (splits and time carry on). */
    private void checkRoute(Location loc) {
        if (routeGuard == null || !loc.hasAccuracy() || loc.getAccuracy() > 50) return;
        if (!routeGuard.onFix(loc.getLatitude(), loc.getLongitude(), elapsedMs())) return;
        routeGuard = null;
        synchronized (this) {
            coach.pauseGoal();
            goalOffRoute = true;
        }
        journalGoal();
        say(VoiceCoach.OFF_ROUTE_PHRASE);
        TrackerHub.emit("goal", goalJs());
        saveSnapshot();
        pushWearStatus(true);
    }

    private void journalGoal() {
        if (journal == null) return;
        JSONObject line = new JSONObject();
        put(line, "type", "goal");
        put(line, "t", System.currentTimeMillis());
        put(line, "goalM", goalM);
        put(line, "source", goalSource);
        if (goalRoutineId != null) put(line, "routineId", goalRoutineId);
        if (goalName != null) put(line, "name", goalName);
        put(line, "confidence", goalConfidence);
        if (goalOffRoute) put(line, "offRoute", true);
        journal.append(line, true);
    }

    private synchronized JSObject goalJs() {
        JSObject o = new JSObject();
        o.put("goalM", goalM);
        o.put("source", goalSource);
        if (goalName != null) o.put("name", goalName);
        if (goalOffRoute) o.put("offRoute", true);
        return o;
    }

    /** After a service restart: the goal and its state come back from the snapshot. */
    private void restoreGoal() {
        goalPending = prefs.getBoolean("gPending", false);
        double m = Double.longBitsToDouble(prefs.getLong("gGoalBits", 0));
        if (m <= 0) return;
        goalM = m;
        goalSource = prefs.getString("gSource", "manual");
        goalRoutineId = prefs.getString("gRoutine", null);
        goalName = prefs.getString("gName", null);
        goalConfidence = Double.longBitsToDouble(prefs.getLong("gConfBits", 0));
        goalOffRoute = prefs.getBoolean("gOffRoute", false);
        int mask = coach.goalMask;
        coach.setGoal(m, 0);
        coach.goalMask = mask;
        if (goalOffRoute) coach.pauseGoal();
        else if ("route".equals(goalSource) && goalRoutineId != null) {
            org.json.JSONArray sig = RoutineMatcher.signatureOf(PhoneSettings.routineModel(this), profile.id, goalRoutineId);
            if (sig != null && sig.length() > 1) routeGuard = new RouteGuard(sig);
        }
    }

    private void say(String text) {
        if (speaker != null) speaker.speak(text);
        JSObject ev = new JSObject();
        ev.put("text", text);
        TrackerHub.emit("announce", ev);
    }

    // ---- Watch ------------------------------------------------------------------------------

    /** Heart-rate sample from the watch (any thread). Journaled while recording. */
    void onHeartRate(long t, int bpm) {
        if (bpm < 25 || bpm > 240 || t <= 0) return;
        handler.post(() -> {
            if (state == State.IDLE) return;
            synchronized (this) {
                if (t >= lastHrAt) {
                    lastHr = bpm;
                    lastHrAt = t;
                }
            }
            if (state != State.PAUSED && journal != null) {
                JSONObject line = new JSONObject();
                put(line, "type", "hr");
                put(line, "t", t);
                put(line, "bpm", bpm);
                journal.append(line, false);
            }
            JSObject ev = new JSObject();
            ev.put("bpm", bpm);
            ev.put("t", t);
            TrackerHub.emit("hr", ev);
        });
    }

    /** Send the current status to the watch, throttled unless forced. */
    void pushWearStatus(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastWearPushMs < WEAR_PUSH_INTERVAL_MS) return;
        lastWearPushMs = now;
        JSONObject o = new JSONObject();
        synchronized (this) {
            put(o, "state", stateName(state));
            put(o, "workoutId", workoutId);
            put(o, "activity", profile.id);
            put(o, "startedAt", startedAt);
            put(o, "elapsedMs", elapsedMs());
            put(o, "distance", distanceM);
            put(o, "units", units);
            put(o, "t", now);
            if (lastLocation != null && lastLocation.hasSpeed()) put(o, "speed", (double) lastLocation.getSpeed());
            if (now - lastHrAt < HR_FRESH_MS) put(o, "hr", lastHr);
            if (goalM > 0 && !goalOffRoute) put(o, "goalM", goalM);
        }
        WearSync.send(this, WearSync.PATH_STATUS, o);
    }

    private float derivedSpeed(Location loc) {
        Location prev = lastLocation;
        if (prev == null) return 0f;
        double dt = (loc.getElapsedRealtimeNanos() - prev.getElapsedRealtimeNanos()) / 1e9;
        if (dt <= 0) return 0f;
        return (float) (prev.distanceTo(loc) / dt);
    }

    private void handleAutoPause(float speed, long nowRt) {
        if (state == State.RECORDING) {
            if (speed < profile.stationarySpeed) {
                if (slowSinceRealtime == 0) slowSinceRealtime = nowRt;
                else if (nowRt - slowSinceRealtime >= AUTO_PAUSE_AFTER_MS) {
                    long slowStart = slowSinceRealtime;
                    setState(State.AUTOPAUSED, "auto");
                    // Do not count the stationary window that triggered auto-pause.
                    synchronized (this) {
                        elapsedBaseMs = Math.max(0, elapsedBaseMs - (nowRt - slowStart));
                    }
                    slowSinceRealtime = 0;
                    fastFixes = 0;
                }
            } else {
                slowSinceRealtime = 0;
            }
        } else if (state == State.AUTOPAUSED) {
            if (speed >= profile.stationarySpeed * 2f) {
                if (++fastFixes >= 2) {
                    fastFixes = 0;
                    setState(State.RECORDING, "auto");
                }
            } else {
                fastFixes = 0;
            }
        }
    }

    private void accumulateDistance(Location loc, float speed) {
        if (!loc.hasAccuracy() || loc.getAccuracy() > profile.accuracyGate) return;
        synchronized (this) {
            if (anchor == null || anchorSegment != segment) {
                anchor = loc;
                anchorSegment = segment;
                return;
            }
            double d = anchor.distanceTo(loc);
            double dt = (loc.getElapsedRealtimeNanos() - anchor.getElapsedRealtimeNanos()) / 1e9;
            if (dt <= 0) return;
            if (d / dt > profile.maxSpeed * 1.5) return; // position spike
            double jitter = Math.max(2.0, loc.getAccuracy() * 0.6);
            if (d >= jitter || (speed >= profile.stationarySpeed && d >= 1.0)) {
                distanceM += d;
                anchor = loc;
            }
        }
    }

    private JSONObject pointJson(Location loc, double gnssAlt, double fusedAlt) {
        JSONObject o = new JSONObject();
        put(o, "type", "pt");
        put(o, "s", seq);
        put(o, "t", loc.getTime());
        put(o, "lat", loc.getLatitude());
        put(o, "lon", loc.getLongitude());
        if (loc.hasAccuracy()) put(o, "ha", round(loc.getAccuracy(), 1));
        if (loc.hasAltitude()) put(o, "ae", round(loc.getAltitude(), 2));
        if (loc.hasMslAltitude()) put(o, "am", round(loc.getMslAltitudeMeters(), 2));
        if (loc.hasVerticalAccuracy()) put(o, "va", round(loc.getVerticalAccuracyMeters(), 1));
        if (loc.hasSpeed()) put(o, "sp", round(loc.getSpeed(), 2));
        if (loc.hasSpeedAccuracy()) put(o, "sa", round(loc.getSpeedAccuracyMetersPerSecond(), 2));
        if (loc.hasBearing()) put(o, "br", round(loc.getBearing(), 1));
        if (loc.hasBearingAccuracy()) put(o, "ba", round(loc.getBearingAccuracyDegrees(), 1));
        if (altitude.hasPressure()) put(o, "pr", round(altitude.pressureHpa(), 3));
        if (!Double.isNaN(fusedAlt)) put(o, "af", round(fusedAlt, 2));
        put(o, "sv", satsUsed);
        put(o, "seg", segment);
        if (state == State.AUTOPAUSED) put(o, "p", 1);
        return o;
    }

    // ---- Sensors ----------------------------------------------------------------------------

    private final SensorEventListener pressureListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            altitude.onPressure(event.values[0]);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    private final GnssStatus.Callback gnssCallback = new GnssStatus.Callback() {
        @Override
        public void onSatelliteStatusChanged(@NonNull GnssStatus status) {
            int used = 0;
            double cn0 = 0;
            int n = status.getSatelliteCount();
            for (int i = 0; i < n; i++) {
                if (status.usedInFix(i)) {
                    used++;
                    cn0 += status.getCn0DbHz(i);
                }
            }
            synchronized (TrackingService.this) {
                satsUsed = used;
                satsVisible = n;
                meanCn0 = used > 0 ? cn0 / used : 0;
            }
            long now = System.currentTimeMillis();
            if (now - lastGnssEmitMs >= GNSS_EMIT_INTERVAL_MS) {
                lastGnssEmitMs = now;
                JSObject ev = new JSObject();
                ev.put("satsUsed", used);
                ev.put("satsVisible", n);
                ev.put("cn0", Math.round(meanCn0 * 10) / 10.0);
                TrackerHub.emit("gnss", ev);
            }
        }
    };

    @SuppressLint("MissingPermission")
    private void registerSensors() {
        if (pressureSensor != null) {
            sensorManager.registerListener(pressureListener, pressureSensor, 200_000, handler);
        }
        try {
            locationManager.registerGnssStatusCallback(gnssCallback, handler);
        } catch (SecurityException e) {
            Log.w(TAG, "GNSS status unavailable", e);
        }
    }

    private void unregisterSensors() {
        if (sensorManager != null) sensorManager.unregisterListener(pressureListener);
        if (locationManager != null) locationManager.unregisterGnssStatusCallback(gnssCallback);
    }

    // ---- Status, persistence ----------------------------------------------------------------

    static String stateName(State s) {
        return s.name().toLowerCase(Locale.ROOT);
    }

    synchronized long elapsedMs() {
        long e = elapsedBaseMs;
        if (state == State.RECORDING) e += SystemClock.elapsedRealtime() - runningSinceRealtime;
        return e;
    }

    synchronized Location lastLocation() {
        return lastLocation;
    }

    synchronized JSObject snapshot() {
        JSObject o = new JSObject();
        o.put("state", stateName(state));
        o.put("workoutId", workoutId);
        o.put("activity", profile.id);
        o.put("startedAt", startedAt);
        o.put("elapsedMs", elapsedMs());
        o.put("distance", distanceM);
        o.put("segment", segment);
        o.put("pointCount", seq);
        o.put("hasBarometer", pressureSensor != null);
        o.put("satsUsed", satsUsed);
        o.put("satsVisible", satsVisible);
        if (System.currentTimeMillis() - lastHrAt < HR_FRESH_MS) o.put("hr", lastHr);
        if (lastLocation != null) o.put("last", LocaleTrackerPlugin.locationToJs(lastLocation, lastFusedAlt));
        if (goalM > 0) o.put("goal", goalJs());
        return o;
    }

    private void saveSnapshot() {
        lastSnapshotMs = System.currentTimeMillis();
        if (state == State.IDLE) return;
        synchronized (this) {
            prefs.edit()
                .putBoolean("active", true)
                .putString("workoutId", workoutId)
                .putString("activity", profile.id)
                .putBoolean("autoPause", autoPause)
                .putString("units", units)
                .putLong("startedAt", startedAt)
                .putLong("elapsedBaseMs", elapsedMs())
                .putLong("distanceBits", Double.doubleToLongBits(distanceM))
                .putInt("segment", segment)
                .putLong("seq", seq)
                .putInt("vSplits", coach != null ? coach.splitsDone : 0)
                .putLong("vSplitMs", coach != null ? coach.lastSplitMs : 0)
                .putLong("vIntervals", coach != null ? coach.intervalsDone : 0)
                .putInt("vGoal", coach != null ? coach.goalMask : 0)
                .putBoolean("gPending", goalPending)
                .putLong("gGoalBits", Double.doubleToLongBits(goalM))
                .putString("gSource", goalSource)
                .putString("gRoutine", goalRoutineId)
                .putString("gName", goalName)
                .putLong("gConfBits", Double.doubleToLongBits(goalConfidence))
                .putBoolean("gOffRoute", goalOffRoute)
                .apply();
        }
        if (journal != null) journal.flush();
    }

    // ---- Notification -----------------------------------------------------------------------

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Workout tracking", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows the workout in progress");
        ch.setShowBadge(false);
        notificationManager.createNotificationChannel(ch);
    }

    private void updateNotification(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastNotificationMs < NOTIFICATION_INTERVAL_MS) return;
        lastNotificationMs = now;
        if (state == State.IDLE) return;
        notificationManager.notify(NOTIFICATION_ID, buildNotification(null));
    }

    private Notification buildNotification(String override) {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        State s;
        long elapsed;
        double dist;
        synchronized (this) {
            s = state;
            elapsed = elapsedMs();
            dist = distanceM;
        }
        String distText = formatDistance(dist);
        String title;
        String text;
        if (override != null || s == State.IDLE) {
            title = profile.label;
            text = override != null ? override : "";
        } else if (s == State.PAUSED) {
            title = profile.label + " · Paused";
            text = formatDuration(elapsed) + " · " + distText;
        } else if (s == State.AUTOPAUSED) {
            title = profile.label + " · Auto-paused";
            text = formatDuration(elapsed) + " · " + distText;
        } else {
            title = profile.label + " · Recording";
            text = distText;
        }
        if (s != State.IDLE && override == null && System.currentTimeMillis() - lastHrAt < HR_FRESH_MS) {
            text = text + " · ♥ " + lastHr;
        }
        if (s != State.IDLE && override == null && goalM > 0 && !goalOffRoute) {
            text = text + " · Goal " + VoiceCoach.spokenNumber(goalM / ("imperial".equals(units) ? 1609.344 : 1000))
                + ("imperial".equals(units) ? " mi" : " km");
        }

        Notification.Builder b = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracker)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .setShortCriticalText(distText);

        if (s == State.RECORDING) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - elapsed);
        } else {
            b.setShowWhen(false);
        }

        if (s == State.PAUSED) {
            b.addAction(action(R.drawable.ic_action_play, "Resume", ACTION_RESUME, 1));
        } else if (s != State.IDLE) {
            b.addAction(action(R.drawable.ic_action_pause, "Pause", ACTION_PAUSE, 2));
        }
        if (s != State.IDLE) b.addAction(action(R.drawable.ic_action_stop, "Stop", ACTION_STOP, 3));

        // Android 16 Live Update: ask for a promoted ongoing notification (status-bar chip).
        b.getExtras().putBoolean("android.requestPromotedOngoing", true);
        return b.build();
    }

    private Notification.Action action(int icon, String label, String action, int requestCode) {
        Intent i = new Intent(this, TrackingService.class).setAction(action);
        PendingIntent pi = PendingIntent.getService(this, requestCode, i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, icon), label, pi).build();
    }

    private String formatDistance(double m) {
        if ("imperial".equals(units)) return String.format(Locale.US, "%.2f mi", m / 1609.344);
        return String.format(Locale.US, "%.2f km", m / 1000.0);
    }

    static String formatDuration(long ms) {
        long s = ms / 1000;
        return String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60);
    }

    // ---- Helpers ----------------------------------------------------------------------------

    private static double round(double v, int digits) {
        double f = Math.pow(10, digits);
        return Math.round(v * f) / f;
    }

    private static void put(JSONObject o, String k, Object v) {
        try {
            if (v instanceof Double && (((Double) v).isNaN() || ((Double) v).isInfinite())) return;
            o.put(k, v);
        } catch (JSONException ignored) {
        }
    }

    static JSObject errorEvent(String code, String message) {
        JSObject o = new JSObject();
        o.put("code", code);
        o.put("message", message);
        return o;
    }
}
