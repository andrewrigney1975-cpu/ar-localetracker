package app.locale.exercisetracker.wear

import android.os.BatteryManager
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
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
            "/locale/battery-request" -> replyBattery(event.sourceNodeId)
        }
    }

    /** The phone's 4x2 widget shows this watch's battery (WatchBattery.java asks every 10 minutes). */
    private fun replyBattery(nodeId: String) {
        val bm = getSystemService(BatteryManager::class.java) ?: return
        val reply = JSONObject()
            .put("pct", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("charging", bm.isCharging)
        Wearable.getMessageClient(this)
            .sendMessage(nodeId, "/locale/battery", reply.toString().toByteArray(Charsets.UTF_8))
            .addOnFailureListener { Log.w("LocaleWear", "Battery reply to node $nodeId failed", it) }
    }
}
