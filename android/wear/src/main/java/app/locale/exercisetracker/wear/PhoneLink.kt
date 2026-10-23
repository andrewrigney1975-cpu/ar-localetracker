package app.locale.exercisetracker.wear

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/** Workout status as last reported by the phone. */
data class PhoneStatus(
    /** unknown | idle | recording | paused | autopaused */
    val state: String = "unknown",
    val workoutId: String? = null,
    val activity: String = "run",
    val elapsedMs: Long = 0,
    /** SystemClock.elapsedRealtime() when this status arrived, for local ticking. */
    val receivedAt: Long = 0,
    val distance: Double = 0.0,
    val speed: Double? = null,
    val units: String = "metric",
    /** Goal distance for this workout (manual or predicted), when set; null otherwise. */
    val goalM: Double? = null,
    /** Max and resting heart rate from the phone's profile, for zone colours; null without one. */
    val hrMax: Int? = null,
    val hrRest: Int = 60,
    /** High-intensity intervals: the current mode, seconds left in it then, and the next mode. */
    val hiiMode: String? = null,
    val hiiLeftS: Int = 0,
    val hiiNext: String? = null,
) {
    val active: Boolean get() = state == "recording" || state == "paused" || state == "autopaused"

    fun elapsedNow(): Long =
        elapsedMs + if (state == "recording") SystemClock.elapsedRealtime() - receivedAt else 0

    /** Seconds left in the current interval, ticking down locally between updates. */
    fun hiiLeftNow(): Int =
        (hiiLeftS - if (state == "recording") ((SystemClock.elapsedRealtime() - receivedAt) / 1000).toInt() else 0).coerceAtLeast(0)
}

/** Messaging with the Locale phone app over the Wearable Data Layer, plus shared UI state. */
object PhoneLink {
    private const val TAG = "LocaleWear"
    private const val CAPABILITY_PHONE = "locale_phone"
    /** Keep heart rate running this long after a watch start while the phone catches up. */
    private const val START_GRACE_MS = 30_000L
    private const val PREFS = "locale_wear"
    private const val KEY_LAST_ACTIVITY = "lastActivity"
    private val ACTIVITY_IDS = setOf("walk", "run", "hii", "cycle", "ski")

    val status = MutableStateFlow(PhoneStatus())
    val error = MutableStateFlow<String?>(null)
    val heartRate = MutableStateFlow<Int?>(null)
    val phoneReachable = MutableStateFlow<Boolean?>(null)
    /** Last spoken announcement from the phone, with SystemClock.elapsedRealtime() it arrived. */
    val announcement = MutableStateFlow<Pair<String, Long>?>(null)

    fun onAnnouncement(text: String) {
        if (text.isNotEmpty()) announcement.value = text to SystemClock.elapsedRealtime()
    }

    @Volatile private var pendingStartAt = 0L

    /** Debug builds only: show sample data for screenshots; ignores the phone and sensors. */
    @Volatile var demo = false
        private set

    fun enterDemo() {
        demo = true
        status.value = PhoneStatus(
            state = "recording",
            workoutId = "demo",
            activity = "run",
            elapsedMs = 47 * 60_000L + 15_000L,
            receivedAt = SystemClock.elapsedRealtime(),
            distance = 7470.0,
            speed = 2.56,
            goalM = 10000.0,
            hrMax = 185,
            hrRest = 55,
        )
        heartRate.value = 158
        phoneReachable.value = true
    }

    /** The activity of the last workout, started from the watch, phone or a widget; the tile offers it. */
    fun lastActivity(ctx: Context): String =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LAST_ACTIVITY, null)
            ?.takeIf { it in ACTIVITY_IDS } ?: "run"

    fun rememberActivity(ctx: Context, activity: String) {
        if (activity !in ACTIVITY_IDS || activity == lastActivity(ctx)) return
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LAST_ACTIVITY, activity).apply()
        TileService.getUpdater(ctx).requestUpdate(LocaleTileService::class.java)
    }

    fun markStartRequested() {
        pendingStartAt = SystemClock.elapsedRealtime()
    }

    fun startPending(): Boolean = SystemClock.elapsedRealtime() - pendingStartAt < START_GRACE_MS

    /** Send a message to the phone; returns false if no phone running Locale is reachable. */
    suspend fun send(ctx: Context, path: String, body: JSONObject = JSONObject()): Boolean {
        val app = ctx.applicationContext
        val nodes = try {
            Wearable.getCapabilityClient(app)
                .getCapability(CAPABILITY_PHONE, CapabilityClient.FILTER_REACHABLE)
                .await()
                .nodes
        } catch (e: Exception) {
            Log.w(TAG, "Capability lookup failed", e)
            emptySet()
        }
        phoneReachable.value = nodes.isNotEmpty()
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        var sent = false
        for (node in nodes) {
            try {
                Wearable.getMessageClient(app).sendMessage(node.id, path, bytes).await()
                sent = true
            } catch (e: Exception) {
                Log.w(TAG, "Send $path to ${node.displayName} failed", e)
            }
        }
        return sent
    }

    fun onStatus(ctx: Context, json: JSONObject) {
        if (demo) return
        val next = PhoneStatus(
            state = json.optString("state", "idle"),
            workoutId = json.optString("workoutId").ifEmpty { null },
            activity = json.optString("activity", "run"),
            elapsedMs = json.optLong("elapsedMs"),
            receivedAt = SystemClock.elapsedRealtime(),
            distance = json.optDouble("distance", 0.0),
            speed = if (json.has("speed")) json.optDouble("speed") else null,
            units = json.optString("units", "metric"),
            goalM = if (json.has("goalM")) json.optDouble("goalM") else null,
            hrMax = if (json.has("hrMax")) json.optInt("hrMax") else null,
            hrRest = json.optInt("hrRest", 60),
            hiiMode = json.optString("hiiMode").ifEmpty { null },
            hiiLeftS = json.optInt("hiiLeftS"),
            hiiNext = json.optString("hiiNext").ifEmpty { null },
        )
        val prev = status.value
        status.value = next
        phoneReachable.value = true
        if (next.active) {
            error.value = null
            pendingStartAt = 0
            rememberActivity(ctx, next.activity)
        }
        HeartRateService.sync(ctx, next)
        if (prev.state != next.state || prev.workoutId != next.workoutId) {
            TileService.getUpdater(ctx).requestUpdate(LocaleTileService::class.java)
        }
    }
}
