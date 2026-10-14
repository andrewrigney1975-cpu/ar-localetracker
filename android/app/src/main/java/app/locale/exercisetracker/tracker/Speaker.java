package app.locale.exercisetracker.tracker;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import java.util.Locale;

/**
 * Text-to-speech for announcements. Holds transient audio focus only while speaking, so music
 * ducks (or pauses) for the phrase and then comes back. At most one phrase waits while the
 * engine starts; a newer one replaces it. When loud, the media volume goes to full for the
 * phrase and back afterwards (unless the user changed it meanwhile).
 */
final class Speaker {
    private static final String TAG = "LocaleSpeaker";

    private final AudioManager audio;
    private final AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();
    private final boolean duck;
    private final boolean loud;
    /** Media volume to put back after a loud phrase, or -1. */
    private int restoreVolume = -1;
    private TextToSpeech tts;
    private boolean ready;
    private String pending;
    private AudioFocusRequest focus;
    private int seq;

    Speaker(Context ctx, boolean duck, boolean loud) {
        this.duck = duck;
        this.loud = loud;
        audio = ctx.getSystemService(AudioManager.class);
        tts = new TextToSpeech(ctx.getApplicationContext(), this::onInit);
    }

    private synchronized void onInit(int status) {
        if (tts == null) return;
        if (status != TextToSpeech.SUCCESS) {
            Log.w(TAG, "Text-to-speech unavailable: " + status);
            return;
        }
        // Phrases are English; use the device's English variant, else UK English.
        Locale loc = Locale.getDefault();
        if (!"en".equals(loc.getLanguage()) || tts.isLanguageAvailable(loc) < TextToSpeech.LANG_AVAILABLE) loc = Locale.UK;
        tts.setLanguage(loc);
        tts.setAudioAttributes(attrs);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {}

            @Override
            public void onDone(String id) {
                releaseFocus();
            }

            @Override
            public void onError(String id) {
                releaseFocus();
            }
        });
        ready = true;
        if (pending != null) {
            String text = pending;
            pending = null;
            speak(text);
        }
    }

    synchronized void speak(String text) {
        if (tts == null || text == null) return;
        if (!ready) {
            pending = text;
            return;
        }
        if (focus == null) {
            focus = new AudioFocusRequest.Builder(duck ? AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .build();
            audio.requestAudioFocus(focus);
            raiseVolume();
        }
        Bundle params = new Bundle();
        params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        tts.speak(text, TextToSpeech.QUEUE_ADD, params, "locale-" + (++seq));
    }

    boolean matches(boolean duck, boolean loud) {
        return this.duck == duck && this.loud == loud;
    }

    private void raiseVolume() {
        if (!loud || restoreVolume >= 0 || audio.isVolumeFixed()) return;
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int now = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (now >= max) return;
        try {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0);
            restoreVolume = now;
        } catch (SecurityException e) {
            Log.w(TAG, "Could not raise the volume", e);
        }
    }

    /** Back to the user's volume before music comes back, unless they changed it meanwhile. */
    private void restoreVolume() {
        if (restoreVolume < 0) return;
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        try {
            if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) == max) audio.setStreamVolume(AudioManager.STREAM_MUSIC, restoreVolume, 0);
        } catch (SecurityException e) {
            Log.w(TAG, "Could not restore the volume", e);
        }
        restoreVolume = -1;
    }

    private synchronized void releaseFocus() {
        if (tts != null && tts.isSpeaking()) return; // more queued
        restoreVolume();
        if (focus != null) {
            audio.abandonAudioFocusRequest(focus);
            focus = null;
        }
    }

    synchronized void shutdown() {
        if (tts == null) return;
        tts.stop();
        tts.shutdown();
        tts = null;
        pending = null;
        restoreVolume();
        if (focus != null) {
            audio.abandonAudioFocusRequest(focus);
            focus = null;
        }
    }
}
