package app.locale.exercisetracker.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.roundToInt

/**
 * Foreground service that runs a Health Services exercise (heart rate only; the phone does
 * GPS) and streams heart-rate samples to the phone every few seconds.
 */
class HeartRateService : LifecycleService() {
    companion object {
        private const val TAG = "LocaleWear"
        private const val CHANNEL_ID = "workout"
        private const val NOTIFICATION_ID = 7
        private const val EXTRA_ACTIVITY = "activity"
        private const val FLUSH_MS = 3_000L

        @Volatile var running = false
            private set

        fun start(ctx: Context, activity: String) {
            if (!hasHeartRatePermission(ctx)) return
            ctx.startForegroundService(Intent(ctx, HeartRateService::class.java).putExtra(EXTRA_ACTIVITY, activity))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, HeartRateService::class.java))
        }

        /** Follow the phone: run while its workout is active, stop when it ends. */
        fun sync(ctx: Context, s: PhoneStatus) {
            if (s.active && !running) {
                try {
                    start(ctx, s.activity)
                } catch (e: Exception) {
                    // Background start can be refused; it starts when the watch app is opened.
                    Log.i(TAG, "Heart rate will start when Locale is opened on the watch", e)
                }
            } else if (s.state == "idle" && running && !PhoneLink.startPending()) {
                stop(ctx)
            }
        }

        fun exerciseType(activity: String): ExerciseType = when (activity) {
            "walk" -> ExerciseType.WALKING
            "cycle" -> ExerciseType.BIKING
            "ski" -> ExerciseType.ALPINE_SKIING
            else -> ExerciseType.RUNNING
        }
    }

    private lateinit var exerciseClient: ExerciseClient
    private val pending = mutableListOf<Pair<Long, Int>>()
    private var started = false

    /** Health Services timestamps are relative to boot. */
    private val bootInstant: Instant
        get() = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val samples = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
            if (samples.isEmpty()) return
            val boot = bootInstant
            synchronized(pending) {
                for (p in samples) {
                    val bpm = p.value.roundToInt()
                    if (bpm in 25..240) pending += p.getTimeInstant(boot).toEpochMilli() to bpm
                }
            }
            PhoneLink.heartRate.value = samples.last().value.roundToInt()
        }

        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {
            Log.w(TAG, "Exercise callback registration failed", throwable)
        }
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    override fun onCreate() {
        super.onCreate()
        running = true
        exerciseClient = HealthServices.getClient(this).exerciseClient
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        val activity = intent?.getStringExtra(EXTRA_ACTIVITY) ?: PhoneLink.status.value.activity
        startForeground(NOTIFICATION_ID, buildNotification(activity), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        if (!started) {
            started = true
            lifecycleScope.launch { startExercise(activity) }
            lifecycleScope.launch { flushLoop() }
        }
        return START_NOT_STICKY
    }

    private suspend fun startExercise(activity: String) {
        try {
            val caps = exerciseClient.getCapabilitiesAsync().await()
            val type = listOf(exerciseType(activity), ExerciseType.RUNNING, ExerciseType.WALKING)
                .firstOrNull { it in caps.supportedExerciseTypes }
            if (type == null) {
                PhoneLink.error.value = "This watch can't measure heart rate during exercise"
                stopSelf()
                return
            }
            val dataTypes = setOf<DataType<*, *>>(DataType.HEART_RATE_BPM)
                .intersect(caps.getExerciseTypeCapabilities(type).supportedDataTypes)
            exerciseClient.setUpdateCallback(callback)
            val config = ExerciseConfig.builder(type)
                .setDataTypes(dataTypes)
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            exerciseClient.startExerciseAsync(config).await()
        } catch (e: Exception) {
            Log.e(TAG, "Could not start heart-rate exercise", e)
            PhoneLink.error.value = "Heart rate unavailable: ${e.message}"
        }
    }

    private suspend fun flushLoop() {
        while (lifecycleScope.isActive) {
            delay(FLUSH_MS)
            flush()
        }
    }

    private suspend fun flush() {
        val batch = synchronized(pending) { pending.toList().also { pending.clear() } }
        if (batch.isEmpty()) return
        val arr = JSONArray()
        for ((t, bpm) in batch) arr.put(JSONArray().put(t).put(bpm))
        if (!PhoneLink.send(this, "/locale/hr", JSONObject().put("s", arr))) {
            // Phone briefly unreachable: keep the most recent samples for the next attempt.
            synchronized(pending) { pending.addAll(0, batch.takeLast(120)) }
        }
    }

    private fun buildNotification(activity: String): android.app.Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Workout", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val label = activityLabel(activity)
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracker)
            .setContentTitle("Locale")
            .setContentText("$label · heart rate")
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setContentIntent(open)
        // Shows the workout on the watch face and in the recents/launcher.
        OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_stat_tracker)
            .setTouchIntent(open)
            .setStatus(Status.Builder().addTemplate("$label · Locale").build())
            .build()
            .apply(applicationContext)
        return builder.build()
    }

    override fun onDestroy() {
        running = false
        PhoneLink.heartRate.value = null
        val client = exerciseClient
        // End the exercise even though our scope is going away.
        kotlinx.coroutines.MainScope().launch {
            try {
                client.clearUpdateCallbackAsync(callback).await()
                client.endExerciseAsync().await()
            } catch (e: Exception) {
                Log.d(TAG, "End exercise: ${e.message}")
            }
        }
        super.onDestroy()
    }
}

fun hasHeartRatePermission(ctx: Context): Boolean =
    heartRatePermissions().all { ctx.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }

fun heartRatePermissions(): List<String> = buildList {
    if (android.os.Build.VERSION.SDK_INT >= 36) add("android.permission.health.READ_HEART_RATE")
    else add(android.Manifest.permission.BODY_SENSORS)
    add(android.Manifest.permission.ACTIVITY_RECOGNITION)
}

fun activityLabel(id: String) = when (id) {
    "walk" -> "Walk"
    "cycle" -> "Cycle"
    "ski" -> "Ski"
    else -> "Run"
}
