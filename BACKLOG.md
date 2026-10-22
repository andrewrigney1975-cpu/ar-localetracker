# Backlog

Requested features, not yet scheduled. Each entry has the requested behaviour, followed by
implementation notes for whoever picks it up.

---

## 1. Share workout details as text (SMS): ✅ done (October 2026)

> Implemented in `src/export/text.js`. Share sheet → **Text message** opens the default SMS app with the summary pre-filled (`sms:?body=`). **Other apps** opens the Android share sheet.

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

## 2. Migrate IndexedDB to SQLite: ✅ done (October 2026)

> Detailed plan, with storage measurements: [docs/plans/sqlite-migration.md](docs/plans/sqlite-migration.md).

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

## 3. Home-screen widgets to start a workout: ✅ done (October 2026)

> Implemented in `LocaleWidgets.java` and `Widget1x1Provider`, `Widget2x1Provider`, `Widget2x2Provider`. Add one from Settings → Home-screen widgets or the launcher's widget picker.

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

## 4. Voice announcements: ✅ done (October 2026)

> Implemented natively in `VoiceCoach.java` (triggers and phrases) and `Speaker.java` (TextToSpeech, transient audio focus that ducks or pauses), called from `TrackingService` on each fix while recording. Coach state is saved in the snapshot prefs, so a restarted service doesn't repeat itself. `src/voice/coach.js` mirrors it for the browser simulator (Web Speech) and writes a shared fixture that `VoiceCoachTest` replays. Settings → Voice announcements: Splits / Time / Goal per activity, interval, Lower or Pause other audio, Test. The goal distance is picked on the start screen; "goal reached" at 100% is included. Watch vibration was added later: one pattern per kind (`Buzz.kt`), plus the text on the watch for a few seconds.

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

---

## 5. Smooth data points in the 3D view: ✅ done (October 2026)

> Implemented in `src/view3d/smooth.js`: a centred 10 s time-weighted average (integral of the interpolated signal, so uneven fix spacing doesn't add zig-zag) of position, altitude and speed, per segment. Arrows and markers are placed on the smoothed line by distance. **Smooth** chip on the 3D view plus a Settings switch. Distance resampling and Catmull-Rom splines below were not needed.

**Request:** draw a smooth route in the 3D view instead of a jagged one.

- With vertical exaggeration (up to 10×), small altitude noise and 1 Hz GPS wobble show up
  as zig-zags in the route line, the altitude curtain and the arrows.
- The 3D route should look like a clean ribbon that follows the terrain. It must still
  pass through the real distance markers, start and finish.

*Notes:*
- Display-only smoothing in `view3d/view3d.js`. Stats, splits, exports and the stored track
  stay unchanged.
- Resample the track by **distance** (every ~5–10 m, scaled to route length) instead of
  drawing every fix. This also cuts vertex count on long workouts.
- Smooth altitude more strongly for display, e.g. a Gaussian or Savitzky–Golay filter over
  ~50–100 m. Widen the window as exaggeration increases, because the noise is amplified by
  the same factor.
- Draw the line and curtain from a Catmull-Rom spline (`THREE.CatmullRomCurve3`, centripetal)
  through the resampled points, sampled at a fixed number of segments.
- Place direction arrows (tangents) and distance-marker sprites on the smoothed curve, so
  they sit exactly on the line.
- Keep segment breaks (manual pauses) as separate curves, and don't smooth across them.
- Optional: a "Smooth" toggle next to the Satellite button, for anyone who wants to see the
  raw fixes.
- Test: a fixture track with injected altitude noise gives a smoothed curve whose total
  vertical oscillation drops by a set factor, while start, finish and marker positions
  stay within a few metres.

---

## 6. Live position mode (no recording): ✅ done (October 2026)

> Implemented as the yellow **Live** tile on Home → `views/position.js` + `map/positionMap.js`; the native warm-up now carries barometric/MSL altitude and stops in the background.

**Request:** a "Live" mode that uses GPS and the barometer to find and display where you
are, without recording a workout.

- A screen (e.g. a **Locate** tab or a button on Home) that shows, continuously:
  - latitude/longitude (with a coordinate-format option: decimal or degrees-minutes-seconds)
  - GPS accuracy (±m) and satellites in use
  - altitude, with barometric/GPS source and its vertical accuracy
  - speed and heading (GPS course when moving, compass when still)
  - a small map with the current position and accuracy circle
- Nothing is written: no journal, no workout, no notification. It stops when you leave the
  screen or lock the phone.
- Handy extras: copy coordinates, share location as text/`geo:` link, hold a reading
  (freeze display).

*Notes:*
- Reuse the existing **warm-up** path in `LocaleTrackerPlugin` (`startWarmup`): fused
  location at 1 Hz plus GNSS status, foreground only, with no service. Add barometer
  readings (`AltitudeFusion`) and MSL altitude (`AltitudeConverter`) there, so altitude
  matches what a recording would show.
- Compass heading already exists (`startHeading`).
- Stop all sensors in `handleOnPause` so it costs no battery in the background.
- The map can reuse MapLibre (a single marker plus an accuracy circle layer), with no
  track.
- Optional later: a "Mark this spot" button that saves a waypoint, if waypoints are added.

---

## 7. Week widget: average split and speed: ✅ done (October 2026)

> Implemented in `LocaleWidgets.week()` and `widget_week.xml`, with the formatting in `tracker/WeekStats.java` (unit-tested). `WorkoutStore.distanceBetween` now also returns moving time. All activities count together, matching the distance figure; a workout being recorded counts by its elapsed time.

**Request:** on the 2×2 weekly stats home-screen widget, add the week's **average split
time** and **average speed**, as two lines of values below the dates and above the
distance, in the same font as the workout count.

- Line 1: average split for the week, e.g. `Avg split 6:12 /km` (`/mi` in imperial).
- Line 2: average speed for the week, e.g. `Avg speed 9.7 km/h` (`mph` in imperial).
- Same text style as `week_count`: 13sp, regular weight, the same theme colour.
- With no workouts this week, hide both lines (or show `--`), so the widget doesn't claim a
  pace of zero.

*Notes:*
- Layout: `android/app/src/main/res/layout/widget_week.xml`. Add two `TextView`s between
  `week_range` and the distance row, styled like `week_count`. Check that they still fit
  the smallest 2×2 size on the Pixel; the 58sp distance may need to shrink a little.
- Data: `LocaleWidgets.week()` gets distance and count from
  `WorkoutStore.distanceBetween(from, to)`. Extend it, or add a sibling query, to return
  the week's total **moving time** too. Then average speed = distance ÷ moving time, and
  average split = moving time ÷ distance × 1 km (or 1 mi): the distance-weighted average of
  the week's splits, the same basis Insights uses for pace.
- Include a workout being recorded now (as distance already does), using its `elapsedMs`
  or moving time from the live status.
- Decide on mixed activities: the week can mix walks, runs and rides, where one combined
  pace means little. Options: all activities together (simplest, matches the distance
  figure), or the most frequent activity only, labelled (e.g. `Run 5:28 /km`). Ask before
  building.
- Update the widget's content description so TalkBack reads the new values, and add a
  unit test for the averaging, beside the existing widget tests if any.

---

## 8. "You" tab for personal settings and data: ✅ done (October 2026)

> Implemented in `src/views/you.js` (Profile with BMI and VO2max chart, Goals, Learned routines with Rename/Customise/Forget), moved out of `settings.js`; the shared `segmented()` helper is now `src/ui/segmented.js`. Tab order: Track, History, Insights, You, Settings. "Add your profile" links in the workout detail and Insights point at `#/you`. Settings → Voice announcements says where the routines went.

**Request:** move personal settings and data out of Settings into a new **You** tab, with a
person icon.

- Candidates to move: Profile (sex, birth year, height, weight, resting/max HR), the VO2max
  estimate and norms chart, Goals, and Learned routines.
- Settings keeps the app and device options: Units & display, Watch, Home-screen widgets,
  Auto-pause, Voice announcements, Maps, Tracking reliability.

*Notes:*
- Tabs are `TABS` in `src/main.js`; add `{ path: '/you', label: 'You', icon: icons.person }`
  and a person glyph in the icon set, matching the stroke style of the others.
- New view `src/views/you.js` with the usual `mount(root, params, query)` → dispose shape.
  Move the section builders out of `settings.js` (`vo2ChartHTML`, `fillVo2`, goals and
  routines sections) into it rather than duplicating them; both views share
  `settings()`/`updateSettings()`.
- Links into the moved sections (e.g. "Cardio load and calories need your profile", the
  Insights goal captions, the routine picker) must point at `#/you`.
- `.tabbar` is `grid-template-columns: repeat(4, 1fr)`: make it follow the tab count.
- Update the README screenshots that show Settings → Profile.

---

## 9. Tab bar overflow into a ⋮ menu: ✅ done (October 2026)

> Implemented in `main.js` (`fitTabbar`, run on render and from a `ResizeObserver`) with the choice of tabs in the pure `src/ui/tabFit.js` (`fitTabs`, unit-tested). A tab needs 64 px or its label width, whichever is more; labels never wrap. The ⋮ More button opens a bottom sheet (`openDialog`, `.option-list.tab-menu`) and is highlighted when the current page is in it.

**Request:** if the tabs would wrap onto two rows, keep one row and move the tabs that don't
fit into a three-dot (⋮) menu at the right-hand end.

*Notes:*
- At 390 px with 5 tabs (after #8) each tab is about 75 px, so nothing overflows yet; this
  matters for more tabs, larger font scaling (Android font size / display size) or narrow
  widths.
- Measure rather than guess: render all tabs, then with a `ResizeObserver` on `.tabbar`
  move tabs from the right into the menu until the rest fit at a minimum width
  (≈ 64 px, or when a label would wrap). Keep the **current** tab visible, swapping it with
  the last visible one if needed.
- The ⋮ button opens a `ui/dialog.js`-style sheet or a small popover listing the
  overflowing tabs with their icons; highlight it when the current page is one of them.
- Never `alert`/`confirm`. Keep `aria-current` on the right link and give the button
  `aria-haspopup` / `aria-expanded`.

---

## 10. Weather at the start of a workout: ✅ done (October 2026)

> Implemented in JS only, not natively as the notes below suggested: `src/weather/weather.js` (pure: Open-Meteo URLs, hourly parsing with interpolation to the start minute, WMO code → condition, Windy at ≥ 30 km/h wind or ≥ 50 km/h gusts, formatting) and `src/services/weather.js` (lookup and back-fill). One path covers new and old workouts: after a workout is saved (`workouts-changed`), on app start and when the setting is turned on, every workout without `weather` is looked up from the hourly data for its start time and place (forecast API for the last ~80 days, then the historical forecast archive, then ERA5 back to 1940). Workouts stopped from the watch or a widget get it when the app next opens, and offline lookups retry 10 minutes later. Stored on the record as `weather: {tempC, feelsC, windMs, windDeg, gustMs, code, isDay, condition, windy, source, lat, lon, fetchedAt}`, or `{unavailable: true}` when no service has data. Shown on the Summary tab ("Weather at the start") and in the shared text; Settings → Weather turns it off. Not yet in Insights or the exports.


**Request:** record the weather when a workout (routine) starts: temperature, apparent
("feels like") temperature, wind speed and direction, and the prevailing condition (clear,
cloudy, rain, fog, windy, etc.). Show it on the workout and make it usable in Insights.

*Notes:*
- Source: **Open-Meteo** (free, no API key). `current=temperature_2m,apparent_temperature,
  wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day`. Condition from
  the WMO `weather_code` (0 clear, 1–3 cloud, 45/48 fog, 51–67 drizzle/rain, 71–77 snow,
  80–82 showers, 95–99 thunderstorm); "Windy" is not a WMO code, so add it when the
  sustained wind ≥ ~30 km/h or gusts ≥ ~50 km/h (decide thresholds).
- When to fetch: at the first good fix, natively in `TrackingService` (works for watch and
  widget starts), written as a `wx` journal line so it survives with the journal. If
  offline, fill it in later from Open-Meteo's archive/forecast `hourly` data for the start
  time and place (`services/sync.js` or the finaliser), so a dead network never loses it.
- Store on the record as `weather: {tempC, feelsC, windMs, windDeg, gustMs, code,
  condition, source: 'live'|'later', at}` in SI units; convert for display (°F, mph) via
  `units.js`. WorkoutBuilder must carry it through (fixture update).
- Privacy: round the coordinates sent to ~2 decimals (≈ 1 km); nothing else leaves the
  phone. Mention in the README.
- Display: a line on the Summary tab ("14 °C, feels 12 °C · SW 18 km/h · Cloudy") and in
  the shared text; later, weather as an Insights filter/column (e.g. pace vs temperature).
- Not in the exports unless a format has a field for it (TCX/GPX don't; FIT has a
  `weather_conditions` message).

---

## 11. Insights: CSV of raw vs smoothed distance statistics: ✅ done (October 2026)

> Implemented in `src/stats/gpsDistance.js` (pure: `rawDistance` from a journal, `describe`, `groupStats`, `gpsStatsCSV`) and `src/insights/gpsCache.js` (per-workout cache `insights.rawdist.v1`, keyed by id + start time since raw journals don't change). Insights → Export → **GPS distance** covers the workouts in the window and filters. Grouping decision: one group per routine (the selected routine only, when one is chosen; unmatched workouts as "Walk (no routine)" etc.), each with Raw, Raw ≤ ±20 m, Smoothed and **Raw over smoothed %**; with several groups, an "All workouts" row of the % only, since that compares across routes and the distances don't. Per-workout rows also carry the weather at the start. Reproduces the hand analysis of 2026-10-23 exactly (raw 15,008.2 ± 352.6 m, gated 14,905.4 ± 155.0, smoothed 14,672.7 ± 94.2; sample SD).


**Request:** in Insights, an export option that writes a CSV with the **min, max, mean and
standard deviation** of the **raw GPS** and **smoothed** distance, for a single routine
(routine filter) or for all workouts in the chosen period.

Done by hand on 2026-10-23 for Lake Loop 2 Laps (14 walks): raw 15,008 ± 353 m (CV 2.4%),
raw with fixes ≤ ±20 m 14,905 ± 155 m, smoothed 14,673 ± 94 m (CV 0.6%). The raw excess
tracked the average reported accuracy (r = 0.93) and the satellite count (r = −0.79).

- Rows: one per series (Raw, Raw ≤ ±20 m, Smoothed), columns n, min, max, mean, SD, CV%.
- A second block (or a second file) with one row per workout: date, name, raw, raw gated,
  smoothed, raw − smoothed, average reported accuracy (m), average satellites used,
  point count. That made the hand analysis readable.

*Notes:*
- **Raw distance** = sum of haversine distances between consecutive journal `pt` fixes in
  the same segment, unfiltered; **gated** keeps only fixes with `ha ≤ 20`. Smoothed =
  `summary.distance`. Accuracy = mean `ha`, satellites = mean `sv`.
- Raw journals are gzip blobs (SQLite `raw_journals`, IDB in the browser): decompressing
  ~30k lines per workout is slow for a year of data, so compute once per workout in a pure
  `stats/` function and cache it by workout version in localStorage (e.g.
  `insights.rawdist.v1`), like the effort cache. Workouts without a raw journal are
  skipped and counted in a note.
- "All workouts" across different routes and activities gives a meaningless SD of
  distance; for that case also group rows by routine (and activity for unmatched ones), or
  report the per-workout raw ÷ smoothed ratio instead. Decide before building.
- Add to the existing export sheet in `insights.js` (`reportToCSV` lives in
  `insights/report.js`) as a third option, e.g. "GPS distance statistics".

---

## 12. High-intensity interval (HII) workouts

**Request:** a new **High Intensity Interval** workout type, with randomised intervals of
walking, jogging, running and sprinting, and spoken warnings before each change.

- **Workout type:** its own tile on the home screen, and also an option on a routine (a
  routine can be set to run as HII).
- **Starting from the home screen:** the usual routine matching applies (weekday, time,
  then place at the first good fix), so a matched routine still sets the goal and name.
- **HII settings:** the share of the workout spent in each mode: **% walk, % jog, % run,
  % sprint** (adding up to 100).
- **Mode durations:** each mode's total time is its percentage of the workout's duration.
- **Order:** when each mode starts is randomised, with two rules:
  - a sprint never follows a run;
  - a sprint or a run is always followed by a walk.
- **Announcements:** 10 seconds before each change, *"Get ready to X in 10 seconds, for Y
  minutes"*, where X is walk, jog, run or sprint.

*Notes:*
- **Questions to settle before building:**
  - **Total duration:** percentages need a length to apply to. Options: a duration picked
    on the start screen, or a matched routine's usual duration. What if the workout runs
    on past it: keep cycling the plan, or stay in walk?
  - **Interval lengths:** each mode's time is split into several bouts. Choose a minimum
    and maximum bout length (e.g. sprint 20–60 s, run 1–3 min, jog and walk 1–4 min) and
    whether "Y minutes" is spoken as seconds for short bouts ("for 30 seconds").
  - **Routine option:** do the percentages live per routine, with the HII settings as
    the default? Does a routine set to HII make every workout matched to it an HII, even
    one started as a plain walk or run?
  - **Activity:** is HII a fifth activity (its own colour, icon, auto-pause off, speed
    cap like run, its own goals and Insights filter, FIT sport *training* / sub-sport
    *HIIT*), or a mode on top of walk/run? The request reads as its own type.
- **Plan generator:** a pure function `planIntervals({durationS, shares, bout limits,
  seed})` → `[{mode, startS, durationS}]`. Randomise with a seeded generator and store
  the seed in the journal (`meta` or a `plan` line), so a restarted service, the browser
  simulator and the saved workout all see the same plan. Enforce the order rules while
  placing bouts (e.g. build the sequence first, then shuffle only the walk/jog blocks);
  unit-test the rules and that each mode's total matches its share to the second.
- **Announcements must run natively** (`VoiceCoach.java`), since the WebView is suspended
  with the screen off. Mirror the plan generator and the phrases in JS
  (`voice/coach.js`) with a shared fixture, like the existing coach and routine matcher.
  Time the warnings on active time so pauses don't shift them. Merge with other
  announcements that fall in the same few seconds (splits, goal milestones).
- **Watch:** a new buzz kind per change (e.g. a distinct pattern for "sprint"), and show
  the current mode and time left on the workout screen. Unknown kinds fall back to one
  tap on an older watch app.
- **Live screen and summary:** show the current mode and a countdown to the next change;
  after the workout, the plan on the Summary (time in each mode) and mode bands on the
  elevation/speed charts. Speed per mode tells you whether the sprints were sprints.
