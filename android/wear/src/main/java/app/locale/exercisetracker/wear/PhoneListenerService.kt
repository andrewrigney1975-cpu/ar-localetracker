package app.locale.exercisetracker.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/** Receives workout status and errors from the Locale phone app. */
class PhoneListenerService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        val body = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: JSONObject()
        when (event.path) {
            "/locale/status" -> PhoneLink.onStatus(this, body)
            "/locale/error" -> PhoneLink.error.value = body.optString("message", "Something went wrong on the phone")
            "/locale/announce" -> {
                Buzz.announce(this, body.optString("kind"))
                PhoneLink.onAnnouncement(body.optString("text"))
            }
        }
    }
}
