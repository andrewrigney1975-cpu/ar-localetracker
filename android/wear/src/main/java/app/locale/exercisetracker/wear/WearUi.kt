package app.locale.exercisetracker.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledIconButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay

private val ACCENT = mapOf(
    "walk" to Color(0xFF13A594),
    "run" to Color(0xFFF2672E),
    "cycle" to Color(0xFF2F7DF6),
    "ski" to Color(0xFF8A63F0),
)
private val STOP_RED = Color(0xFFD93B3B)
private val HEART = Color(0xFFFF5A6E)

@Composable
fun LocaleWearApp(
    onStart: (String) -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    onRetry: () -> Unit,
) {
    val status by PhoneLink.status.collectAsStateWithLifecycle()
    val error by PhoneLink.error.collectAsStateWithLifecycle()
    val hr by PhoneLink.heartRate.collectAsStateWithLifecycle()
    val reachable by PhoneLink.phoneReachable.collectAsStateWithLifecycle()
    MaterialTheme {
        AppScaffold {
            if (status.active) {
                ActiveScreen(status, hr, error, onPause, onResume, onStop)
            } else {
                IdleScreen(error, reachable, onStart, onRetry)
            }
        }
    }
}

@Composable
private fun IdleScreen(error: String?, reachable: Boolean?, onStart: (String) -> Unit, onRetry: () -> Unit) {
    val listState = rememberScalingLazyListState()
    ScreenScaffold(scrollState = listState) { padding ->
        ScalingLazyColumn(state = listState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
            item { ListHeader { Text("Locale") } }
            if (error != null) {
                item { Message(error, MaterialTheme.colorScheme.error) }
            } else if (reachable == false) {
                item { Message("Phone not reachable", MaterialTheme.colorScheme.error) }
                item {
                    Button(onClick = onRetry, modifier = Modifier.fillMaxWidth(), label = { Text("Retry") })
                }
            }
            for ((id, label) in listOf("run" to "Run", "walk" to "Walk", "cycle" to "Cycle", "ski" to "Ski")) {
                item {
                    Button(
                        onClick = { onStart(id) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = ACCENT.getValue(id), contentColor = Color.White, iconColor = Color.White),
                        icon = { Icon(painterResource(R.drawable.ic_action_play), contentDescription = null) },
                        label = { Text("Start $label") },
                    )
                }
            }
            item {
                Text(
                    "GPS is recorded by your phone. Your watch adds heart rate.",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp, start = 8.dp, end = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Message(text: String, color: Color) {
    Text(
        text,
        color = color,
        style = MaterialTheme.typography.bodySmall,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
private fun ActiveScreen(
    status: PhoneStatus,
    hr: Int?,
    error: String?,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
) {
    val accent = ACCENT[status.activity] ?: ACCENT.getValue("run")
    var now by remember { mutableLongStateOf(status.elapsedNow()) }
    LaunchedEffect(status) {
        while (true) {
            now = status.elapsedNow()
            delay(250)
        }
    }
    // Stop needs a second tap within 3 s, so a brush against the screen can't end the workout.
    var confirmStop by remember { mutableStateOf(false) }
    LaunchedEffect(confirmStop) {
        if (confirmStop) {
            delay(3000)
            confirmStop = false
        }
    }
    val paused = status.state != "recording"
    val goal = status.goalM?.takeIf { it > 0 }
    val progress = if (goal != null) (status.distance / goal).toFloat().coerceIn(0f, 1f) else null
    ScreenScaffold {
        // Goal progress around the edge of the round screen.
        if (progress != null) {
            Canvas(Modifier.fillMaxSize().padding(3.dp)) {
                val stroke = 5.dp.toPx()
                val inset = stroke / 2
                val arcSize = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke)
                val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
                drawArc(Color(0x33FFFFFF), -90f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
                drawArc(accent, -90f, 360f * progress, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
        }
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                if (!paused && goal != null) "${activityLabel(status.activity)} · ${(progress!! * 100).toInt()}% of ${formatGoal(goal, status.units)}"
                else "${activityLabel(status.activity)} · ${stateLabel(status.state)}",
                color = if (paused) Color(0xFFD08A10) else accent,
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                formatDuration(now),
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Metric(formatDistance(status.distance, status.units))
                Metric(formatSpeed(status.speed, status.activity, status.units))
            }
            Spacer(Modifier.height(2.dp))
            Text(
                if (hr != null) "♥ $hr bpm" else "♥ --",
                color = HEART,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
            )
            if (error != null) Message(error, MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledIconButton(
                    onClick = if (paused) onResume else onPause,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = accent, contentColor = Color.White),
                    modifier = Modifier.size(52.dp),
                ) {
                    Icon(
                        painterResource(if (paused) R.drawable.ic_action_play else R.drawable.ic_action_pause),
                        contentDescription = if (paused) "Resume" else "Pause",
                    )
                }
                FilledIconButton(
                    onClick = {
                        if (confirmStop) {
                            confirmStop = false
                            onStop()
                        } else {
                            confirmStop = true
                        }
                    },
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = STOP_RED, contentColor = Color.White),
                    modifier = Modifier.size(52.dp),
                ) {
                    Icon(painterResource(R.drawable.ic_action_stop), contentDescription = "Stop")
                }
            }
            Box(Modifier.height(18.dp), contentAlignment = Alignment.Center) {
                if (confirmStop) Text("Tap stop again to finish", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Metric(text: String) {
    Text(text, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Color(0xFFD7DEE4))
}

private fun stateLabel(state: String) = when (state) {
    "paused" -> "Paused"
    "autopaused" -> "Auto-paused"
    else -> "Recording"
}

fun formatDuration(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/** "4.7 km", "10 km", "3.1 mi" */
fun formatGoal(m: Double, units: String): String {
    val v = Math.round(m / (if (units == "imperial") 1609.344 else 1000.0) * 10) / 10.0
    val text = if (v == Math.floor(v)) v.toLong().toString() else v.toString()
    return "$text ${if (units == "imperial") "mi" else "km"}"
}

fun formatDistance(m: Double, units: String): String =
    if (units == "imperial") "%.2f mi".format(m / 1609.344) else "%.2f km".format(m / 1000)

fun formatSpeed(mps: Double?, activity: String, units: String): String {
    if (mps == null || mps < 0.3) return if (activity == "walk" || activity == "run") "--:--" else "0.0"
    val split = if (units == "imperial") 1609.344 else 1000.0
    return if (activity == "walk" || activity == "run") {
        val secs = (split / mps).toInt()
        "%d:%02d /%s".format(secs / 60, secs % 60, if (units == "imperial") "mi" else "km")
    } else {
        val v = if (units == "imperial") mps * 2.236936 else mps * 3.6
        "%.1f %s".format(v, if (units == "imperial") "mph" else "km/h")
    }
}
