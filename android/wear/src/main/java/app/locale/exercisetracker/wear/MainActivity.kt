package app.locale.exercisetracker.wear

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    companion object {
        /** Set by the tile's "Start" button. */
        const val EXTRA_START_ACTIVITY = "start"
        /** Debug builds: `adb shell am start ... --ez demo true` shows sample workout data. */
        const val EXTRA_DEMO = "demo"
    }

    private var afterPermissions: (() -> Unit)? = null

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        afterPermissions?.invoke()
        afterPermissions = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG && intent?.getBooleanExtra(EXTRA_DEMO, false) == true) PhoneLink.enterDemo()
        setContent {
            LocaleWearApp(
                onStart = ::startWorkout,
                onPause = { send("/locale/pause") },
                onResume = { send("/locale/resume") },
                onStop = { send("/locale/stop") },
                onRetry = { send("/locale/status-request") },
            )
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (PhoneLink.demo) return
        send("/locale/status-request")
        // Foreground is the reliable moment to (re)start heart rate for a phone-started workout.
        HeartRateService.sync(this, PhoneLink.status.value)
    }

    private fun handleIntent(intent: Intent?) {
        val activity = intent?.getStringExtra(EXTRA_START_ACTIVITY) ?: return
        intent.removeExtra(EXTRA_START_ACTIVITY)
        if (!PhoneLink.status.value.active) startWorkout(activity)
    }

    private fun startWorkout(activity: String) {
        val missing = (heartRatePermissions() + Manifest.permission.POST_NOTIFICATIONS)
            .filter { checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            // Heart rate is optional: start either way once the user has answered.
            afterPermissions = { doStart(activity) }
            permissionLauncher.launch(missing.toTypedArray())
        } else {
            doStart(activity)
        }
    }

    private fun doStart(activity: String) {
        PhoneLink.error.value = null
        PhoneLink.markStartRequested()
        lifecycleScope.launch {
            val sent = PhoneLink.send(this@MainActivity, "/locale/start", JSONObject().put("activity", activity))
            if (!sent) {
                PhoneLink.error.value = "Phone not reachable. Check Bluetooth and that Locale is installed on your phone."
                return@launch
            }
            HeartRateService.start(this@MainActivity, activity)
        }
    }

    private fun send(path: String) {
        if (PhoneLink.demo) return
        lifecycleScope.launch { PhoneLink.send(this@MainActivity, path) }
    }
}
