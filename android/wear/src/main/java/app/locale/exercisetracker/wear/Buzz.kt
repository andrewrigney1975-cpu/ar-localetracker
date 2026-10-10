package app.locale.exercisetracker.wear

import android.content.Context
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibratorManager

/**
 * Wrist vibrations aligned with the phone's spoken announcements, one pattern per kind so
 * the announcement can be told apart without looking:
 * - split: two short taps
 * - time: one medium tap
 * - goal (25/50/75%): three short taps
 * - goal reached: long, short, long
 * - goal set: one short tap
 * - off route: two long taps
 */
object Buzz {
    private const val MAX = 255

    /** Alternating off/on timings in ms, starting with a delay of 0. */
    fun pattern(kind: String): LongArray = when (kind) {
        "split" -> longArrayOf(0, 70, 130, 70)
        "time" -> longArrayOf(0, 200)
        "goal" -> longArrayOf(0, 70, 110, 70, 110, 70)
        "goal-reached" -> longArrayOf(0, 320, 120, 110, 120, 320)
        "goal-set" -> longArrayOf(0, 90)
        "off-route" -> longArrayOf(0, 260, 180, 260)
        else -> longArrayOf(0, 120)
    }

    fun announce(ctx: Context, kind: String) {
        val vibrator = ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator ?: return
        if (!vibrator.hasVibrator()) return
        val timings = pattern(kind)
        val amplitudes = IntArray(timings.size) { i -> if (i % 2 == 1) MAX else 0 }
        val effect = if (vibrator.hasAmplitudeControl()) VibrationEffect.createWaveform(timings, amplitudes, -1)
        else VibrationEffect.createWaveform(timings, -1)
        // Communication usage so it still buzzes during a workout's ongoing activity.
        vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_COMMUNICATION_REQUEST))
    }
}
