# Backlog

Requested features, not yet scheduled. Each entry has the requested behaviour, followed by
implementation notes for whoever picks it up.

---

## 1. Share workout details as text (SMS)

**Request:** share a workout's details as plain text, for example by SMS.

- Add a "Share as text" action on the workout screen, next to Export.
- Message, in the user's units:
  ```
  City2Surf 2026 — Run, Sun 9 Aug 2026
  14.37 km in 1:30:29 · 6:18 /km avg
  Climb +242 m · Avg HR 149 bpm · 1,373 kcal
  Recorded with Locale
  ```
- Only include lines that have data: heart rate and calories appear only when available.

*Notes:*
- `Share.share({ text })` opens the Android share sheet, where Messages is one of the
  targets. That's enough for "via SMS" and also covers WhatsApp, Signal and others.
- For a direct SMS button, use an `sms:?body=…` intent.
- Keep the text builder a pure function in `src/export/` with unit tests.

---

## 2. Migrate IndexedDB to SQLite

**Request:** move workout storage from IndexedDB to SQLite.

- One-time migration on upgrade:
  - Copy every workout, track and raw journal.
  - Verify counts and checksums.
  - Only then mark IndexedDB as migrated.
  - Keep the IndexedDB data for one release as a rollback.
- No user-visible change apart from a brief "Updating your workouts…" on first launch.

*Notes:*
- Plugin: `@capacitor-community/sqlite`, the maintained Capacitor SQLite plugin.
  Check that it supports Capacitor 8 before starting.
- Schema sketch:
  - `workouts(id PK, activity, name, notes, started_at, ended_at, summary_json, preview_json, …)`
  - `tracks(workout_id PK, columns BLOB)`: keep the columnar typed arrays as blobs, not
    one row per point, so a 10k-point track is a single row.
  - `raw_journals(workout_id PK, gzip BLOB)`
  - `schema_version`
- Benefits:
  - Native code (widgets, announcements, the watch) can read workouts directly.
  - It's easier to include in Android Auto Backup.
  - It enables real queries (totals by month, personal bests).
- `db/workouts.js` is the only module that touches storage, so put SQLite behind the same
  API and keep the views unchanged.
- Tests: run the migration against a fixture IndexedDB database in a browser test.

---

## 3. Home-screen widgets to start a workout

**Request:** home-screen widgets in three sizes:

| Size | Content |
|---|---|
| **1×1** | One button for the **last-used** activity type |
| **2×1** | **Run** and **Walk** |
| **2×2** | All four: **Walk, Run, Cycle, Ski** |

- Tapping an activity starts recording immediately. The live screen opens if the app is
  in the foreground.
- While a workout is running, widgets show its state (elapsed time and distance) and
  tapping opens the live screen.

*Notes:*
- Native Android App Widgets: `AppWidgetProvider` with `RemoteViews`. Use Jetpack Glance
  instead if we adopt Kotlin in `:app` (the `:wear` module already uses Kotlin).
- Use one provider per size, or one provider with responsive layouts (Android 12+
  `RemoteViews` size mapping).
- The tap uses `PendingIntent.getForegroundService(TrackingService ACTION_START)`. A
  widget tap counts as user interaction, so starting location tracking from the
  background is allowed.
  - If location permission is missing, open the app instead.
  - Reuse `WearListenerService.startIntent()` for the workout ID and settings.
- Last-used activity: store it natively in `TrackingService` on start. It's already known
  there, so the widget doesn't depend on the web layer.
- Update widgets on state changes from `TrackingService` (`AppWidgetManager.updateAppWidget`),
  throttled. Use a chronometer `RemoteViews` for elapsed time, so no per-second updates.
- Widget previews: `previewLayout` (Android 12+) plus a static image.

---

## 4. Voice announcements

**Request:** spoken updates during a workout, in three independently configurable kinds.

1. **Split announcements:** at every split (km or mile, following units), announce:
   - distance
   - split time
   - average speed so far, or pace for walk/run
2. **Time-based:** every *X* minutes (user-set, e.g. 5/10/15), announce:
   - total distance covered
   - average speed so far, or pace
3. **Goal-based:** the user sets a goal distance for the workout. At **25%, 50% and 75%**
   of the goal, announce:
   - distance covered
   - average speed so far, or pace

   Possibly also "goal reached" at 100%; to be confirmed.

- Example: *"5 kilometres. Split time 6 minutes 12 seconds. Average pace 6 minutes 18
  per kilometre."*
- Settings: turn each kind on or off per activity, set the interval, and set the goal
  distance on the start screen. A volume or "duck music" option too.

*Notes:*
- Announcements must run **natively in `TrackingService`**. The WebView is suspended with
  the screen off, so the JS side can't do it.
  - Use Android `TextToSpeech` with the device locale.
  - Request `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` around each utterance so music ducks
    rather than stops. Use `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` audio attributes.
- Triggers:
  - **Splits:** fire when the native `distanceM` crosses each split boundary. Split time
    is native elapsed time minus elapsed time at the previous boundary.
  - **Time:** fire on elapsed (active) time, so pauses don't count.
  - **Goal:** fire at distance thresholds, each once per workout. Store which have fired
    in the snapshot prefs so they survive a service restart.
- Don't announce while paused or auto-paused; queue at most one pending announcement.
- Pass the settings (units, enabled kinds, interval, goal) in the start intent, or read
  them via `PhoneSettings`, so watch- and widget-started workouts announce too.
- Phrase-building is a pure function, so it can be unit-tested. Mirror it in JS if the
  browser simulator should speak (Web Speech API) for testing.
- Optional: mirror announcements to the watch as a short vibration.
