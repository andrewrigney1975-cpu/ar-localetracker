# Locale — Implementation Plan

An Android exercise tracker for walking, running, cycling and snow skiing.
Web UI in HTML5 / vanilla JS / CSS3, packaged with Capacitor, with a small
native plugin for background GPS and sensors.

---

## 1. Platform & toolchain

| Item | Choice | Notes |
|---|---|---|
| Min / target SDK | **minSdk 36, targetSdk 36** (Android 16) | `android-36` and `android-37.0` platforms are already in `%LOCALAPPDATA%\Android\Sdk`. minSdk 36 means no compatibility branches for newer location APIs. |
| Android Studio | `F:\Program Files\Android\Android Studio` | Bundled JBR is OpenJDK 25. Point `JAVA_HOME` at `...\Android Studio\jbr` for CLI Gradle builds. Check Gradle/AGP support JDK 25 at scaffold time; fall back to a JDK 21 toolchain via `gradle.properties` if not. |
| Capacitor | Latest stable major (8.x or newer) | Must support targetSdk 36. `@capacitor/android`, `@capacitor/cli`. |
| Node | v24 / npm 11 (installed) | |
| Web build | **Vite**, vanilla ES modules, no UI framework | Vite only bundles npm deps (MapLibre, Three.js) and serves the dev build. App code stays plain JS/CSS. |
| Unit tests | Vitest | Geo math, filtering, stats, exporters. |

### Capacitor plugins
- `@capacitor/filesystem` and `@capacitor/share`: export files and open the share sheet
- `@capacitor/preferences`: settings (units, auto-pause, map style)
- `@capacitor/app`: lifecycle, resume and back handling
- `@capacitor/screen-orientation`: optional
- `@capacitor/keep-awake` or the Wake Lock API: optional "keep screen on during workout"
- **Custom local plugin `LocaleTracker` (Kotlin)**: see §3. This is the only native code.

> Why a custom plugin: Web Geolocation stops when the WebView is backgrounded.
> Community background-geolocation plugins don't expose the barometer, GNSS
> status or MSL altitude, and don't journal points natively. Reliable,
> high-accuracy background tracking needs a native foreground service.

---

## 2. Architecture

```
┌──────────────────────── WebView (vanilla JS) ────────────────────────┐
│  UI views: Home · Live Workout · History · Workout Detail · Settings  │
│  ├─ state/store.js        tiny pub/sub store                          │
│  ├─ tracker/client.js     wraps LocaleTracker plugin + events         │
│  ├─ geo/*                 haversine, ENU projection, Kalman, smoothing│
│  ├─ stats/*               summary, splits, vertical, stationary, runs │
│  ├─ db/*                  IndexedDB (finished workouts)               │
│  ├─ export/*              GPX, TCX, KML, GeoJSON, CSV, (FIT)          │
│  ├─ map/*                 MapLibre map, arrows, markers, scrubber     │
│  ├─ profile/*             canvas elevation profile, linked cursor     │
│  └─ view3d/*              Three.js 3D track, exaggerated Z            │
└───────────────▲──────────────────────────────────────────────────────┘
                │ Capacitor bridge (events + calls)
┌───────────────┴──────────── Native (Kotlin) ─────────────────────────┐
│  LocaleTrackerPlugin  ── start/pause/resume/stop/getStatus/readJournal│
│  TrackingService (FGS, type=location)                                 │
│   ├─ FusedLocationProviderClient (PRIORITY_HIGH_ACCURACY, 1 s)        │
│   ├─ GnssStatus callback (satellites used, CN0)                       │
│   ├─ SensorManager: TYPE_PRESSURE, TYPE_ROTATION_VECTOR               │
│   ├─ Altitude fusion (baro relative + GNSS MSL anchor)                │
│   └─ Append-only journal file (NDJSON per workout, fsync'd batches)   │
└──────────────────────────────────────────────────────────────────────┘
```

**Source of truth during a workout:** the native journal. The JS side shows
live events but can always rebuild state with `readJournal(fromSeq)` after
returning to the foreground or after the WebView is killed. Nothing is lost if
the WebView is suspended.

**Source of truth after a workout:** IndexedDB. On stop, JS reads the full
journal, runs post-processing, and stores `{meta, summary, points, segments}`.
The journal is deleted only after the IndexedDB write succeeds.

---

## 3. Native tracking (`android/app/src/main/java/.../tracker/`)

### 3.1 Manifest & permissions
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` (runtime prompt)
- `HIGH_SAMPLING_RATE_SENSORS` (optional, for barometer rate)
- `WAKE_LOCK`
- `<service android:foregroundServiceType="location" android:exported="false">`
- `ACCESS_BACKGROUND_LOCATION` is **not** needed. The FGS always starts from a
  user action while the app is visible, which Android 14+ requires anyway.
  Leaving it out also avoids extra Play Store review.
- Battery optimisation: detect `PowerManager.isIgnoringBatteryOptimizations`.
  If the app isn't exempt, show an explainer that links to settings. Many OEMs
  (Samsung, Xiaomi, OnePlus) kill FGS apps aggressively. Link to
  dontkillmyapp.com-style guidance per manufacturer.

### 3.2 TrackingService
- Started with `startForegroundService` and promoted with
  `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_LOCATION)`.
- Ongoing notification shows the activity icon, elapsed time and distance,
  with Pause/Resume and Stop actions. Use Android 16 **progress-centric /
  promoted ongoing notification (Live Update)** styling where available.
- Holds a partial `WakeLock` only while recording, not while paused.
- Location request: `PRIORITY_HIGH_ACCURACY`, interval 1000 ms,
  `minUpdateDistance 0`, `waitForAccurateLocation true`,
  `maxUpdateDelayMillis 0` (no batching while recording).
- Per-point record:
  `seq, t (epoch ms), elapsedRealtimeNanos, lat, lon, hAcc, altEllipsoid,
  altMsl (Location.getMslAltitudeMeters), vAcc, speed, speedAcc, bearing,
  bearingAcc, baroPressure, fusedAlt, satsUsed, provider, segment`.
- Sensors:
  - **Barometer** (`TYPE_PRESSURE`, ~5 Hz, low-pass filtered). Convert to
    relative altitude with the hypsometric formula, then anchor to GNSS MSL
    altitude with a slow complementary filter (τ ≈ 60 s, weighted by `vAcc`).
    This gives smooth vertical gain/loss, which matters a lot for skiing and
    hiking.
  - **Rotation vector**: compass heading used when speed < ~1 m/s, because
    GNSS bearing is noise at walking-stop speeds. GNSS bearing is used above
    that threshold.
  - **GnssStatus**: satellites used and mean CN0. Feeds the "GPS quality"
    indicator.
- Pause keeps the service alive, stops writing points, and lowers to
  `PRIORITY_BALANCED_POWER_ACCURACY`, so the GPS fix is warm on resume.
- Auto-pause (optional, per activity): native-side detection so it works in
  the background.
- Journal: `files/journal/<workoutId>.ndjson`. Write batches every 5 s or
  every 10 points, then `fd.sync()`. A crash costs at most a few seconds.
- Process-death recovery: the service is `START_STICKY`. On app launch the
  plugin reports any orphaned journal, and the UI offers "Resume" or "Save"
  for the interrupted workout.

### 3.3 Plugin API (JS ⇄ native)
```js
LocaleTracker.checkPermissions() / requestPermissions()
LocaleTracker.start({ workoutId, activity, autoPause })
LocaleTracker.pause() / resume() / stop()   // stop → { workoutId, pointCount }
LocaleTracker.getStatus()                    // state, elapsed, distance, lastPoint
LocaleTracker.readJournal({ workoutId, fromSeq })
LocaleTracker.discard({ workoutId })
LocaleTracker.listOrphans()
// events
'point'      → latest fused point (throttled to 1 Hz)
'heading'    → compass heading (throttled, ~4 Hz, only while UI visible)
'state'      → recording | paused | autopaused | stopped
'gnss'       → { satsUsed, cn0 }
```
Elapsed time and distance are computed natively, so the notification and the
UI always agree. JS recomputes everything during post-processing.

---

## 4. Signal processing (`src/geo/`)

1. **Gate:** drop fixes with `hAcc > 30 m` (20 m for running), or with
   implied speed above the activity cap (walk 4, run 9, cycle 30, ski 45 m/s).
2. **Smoothing:** 1-D constant-velocity Kalman filter per axis in local ENU
   metres, with measurement noise from `hAcc`.
3. **Speed:** Doppler `speed` from GNSS when `speedAcc` is good, else derived
   from smoothed positions.
4. **Distance:** sum of smoothed segment lengths, ignoring jitter below
   `max(hAcc, 2 m)` while stationary.
5. **Altitude:** fused baro/GNSS series, then a 5-point median filter.
   Vertical gain/loss uses a **hysteresis threshold** (3 m with a barometer,
   8 m GNSS-only) to stop noise from adding up.
6. **Stationary detection:** speed below the activity threshold (walk 0.4,
   run 0.8, cycle 1.0, ski 1.0 m/s) for at least 5 s.
7. **Ski-specific:** label lift vs descent segments from sustained vertical
   rate (ascending more than 0.5 m/s for over 30 s = lift). Count runs and
   report descent vertical and max run speed.

All of this is pure JS, deterministic and unit-tested against fixture GPX
tracks.

---

## 5. Data model (IndexedDB `locale`, v1)

- **`workouts`** store (key `id`, indexes `startedAt` and `activity`):
  `{ id, activity, startedAt, endedAt, tz, deviceInfo, settingsSnapshot,
     summary: { duration, movingTime, stationaryTime, distance, avgSpeed,
       avgMovingSpeed, avgPace, maxSpeed, elevGain, elevLoss, minAlt, maxAlt,
       netVertical, splits:[...], ski:{runs, liftTime, descentVertical}? },
     bbox, polylinePreview /* simplified for list thumbnails */ }`
- **`tracks`** store (key `workoutId`): columnar typed arrays for compactness
  (`Float64Array lat/lon`, `Float32Array alt/speed/…`, `Uint32Array tOffset`,
  `Uint8Array segment`). A 3-hour 1 Hz track is about 10,800 points, a few
  hundred KB.
- Schema versioning through `onupgradeneeded` migrations.
- `navigator.storage.persist()` is requested on first run.
- Optional backup and restore: export or import all workouts as a zip of GPX
  plus JSON.

---

## 6. UI / screens (`src/views/`)

Single-page app with hash routing, one `<section>` per view, CSS grid and
custom properties. Dark and light themes, sized for one-handed use with
gloves (large hit targets; important for skiing).

1. **Home:** four large activity tiles (Walk, Run, Cycle, Ski), a GPS-quality
   indicator, and a recent-workouts strip.
2. **Live Workout:**
   - Big tiles: **Elapsed time · Distance · Current speed** (pace for
     run/walk; tap to toggle) **· Heading** (degrees plus cardinal, with a
     small rotating arrow) **· Latitude/Longitude · Altitude**.
   - Secondary row: vertical gain so far, GPS accuracy (±m), satellite count.
   - Controls: **Start → Pause / Resume → Stop** (long-press to stop, so a
     glove can't end the workout by accident). Lock-screen overlay option.
   - Optional mini-map of the live track (off by default to save battery).
   - Display refresh at 1 Hz. Stops rendering when `document.hidden`.
3. **History:** list grouped by month, filter by activity, simplified route
   thumbnail (inline SVG of `polylinePreview`).
4. **Workout Detail:** tabs **Summary · Map · 3D · Splits**.
   - Summary: avg speed, avg pace, max speed, moving / stationary time,
     vertical gain / loss / net, min / max altitude, ski runs.
   - Splits table: per km or mile, with time, pace, avg speed and elevation
     change. Small bars highlight fastest and slowest.
   - Actions: Export, Rename/Notes, Delete.
5. **Settings:** units (metric/imperial), split distance, auto-pause per
   activity, keep screen on, map style, 3D exaggeration default, battery
   optimisation helper.

---

## 7. Map view + elevation profile (`src/map/`, `src/profile/`)

### 7.1 Map
- **MapLibre GL JS** (bundled, no API key). Uses vector tiles.
- **Free tile sources:**
  - Default: **OpenFreeMap** vector style (free, no key).
  - Topo option: **OpenTopoMap** raster, useful for skiing and hiking. Light
    use only; show attribution.
  - Attribution control is always visible (OSM licence).
- Track layer: line coloured by speed (or plain by activity). Pause gaps are
  drawn dashed.
- **Direction arrows:** a `symbol` layer with `symbol-placement: line`,
  `symbol-spacing ≈ 120 px`, a small chevron SDF icon at low opacity
  (≈0.55), rotated along the line. Subtle and zoom-independent.
- **Distance markers:** every split distance (1 km or 1 mi). Small circular
  HTML markers labelled "1", "2", …, plus Start and Finish pins. Tapping one
  opens a **popover** showing distance, elapsed time, clock time, latitude,
  longitude, altitude, and pace for that split.
- Fit to `bbox` on open. Buttons for recenter and style toggle.

### 7.2 Side (elevation) profile, docked below the map
- A custom `<canvas>` chart. No chart library needed, and that keeps
  dragging smooth.
- X axis distance, Y axis altitude. Filled area with gradient, min/max labels,
  and split ticks aligned with the map's distance markers.
- **Linked scrubbing, both ways:**
  - A draggable **scrub marker** on the map (a MapLibre `Marker` with
    `draggable: true`). On `drag`, snap the pointer to the nearest point on
    the track polyline. Use a projected segment search accelerated with a
    grid index built once per workout. Interpolate distance along the track,
    then move the profile crosshair and show a readout of distance, altitude,
    time, speed and grade.
  - Dragging or touching on the profile moves the map marker along the track
    the same way.
- Profile height about 30% of the viewport. It collapses in landscape.

---

## 8. 3D view (`src/view3d/`)

- **Three.js** with `OrbitControls` (touch rotate, pinch zoom, two-finger pan).
- Coordinates: convert lat/lon to local ENU metres around the track centroid.
  Z = (alt − minAlt) × **exaggeration** (slider 1×–10×, default chosen so the
  vertical range is about 25% of the horizontal extent).
- Geometry:
  - Track as a `TubeGeometry` or a fat line (`Line2`) coloured by speed or
    altitude.
  - A "curtain" (translucent vertical ribbon from the track down to the base
    plane) makes the altitude readable.
  - A ground grid, plus an optional base plane textured with a static map
    image of the bbox, rendered off-screen from MapLibre once with
    `preserveDrawingBuffer`.
- **Direction arrows:** small low-opacity cone meshes (`InstancedMesh`) placed
  every N metres and oriented along the tangent.
- **Distance markers:** sprites at each split. Tapping one uses a Raycaster
  hit test and opens the **same popover component** as the map, positioned
  through `Vector3.project`.
- Render only on change (controls `change` event), not continuously, to save
  battery.

---

## 9. Export (`src/export/`)

| Format | Contents |
|---|---|
| **GPX 1.1** | `trk` / `trkseg` per pause segment. `ele` and `time`, plus a Garmin `TrackPointExtension` for speed and course. |
| **TCX** | `Activity Sport` (Running / Biking / Other), Laps from splits, distance and altitude per Trackpoint. |
| **KML** | `LineString` with `altitudeMode absolute` (opens in Google Earth 3D), plus split placemarks. |
| **GeoJSON** | `LineString` with timestamps / altitude in `properties.coordTimes`. |
| **CSV** | One row per point with every recorded field. |
| **FIT** (phase 2) | Binary encoder for activity/session/lap/record messages. Best compatibility with Strava and Garmin Connect. |

Flow: generate a string or `Uint8Array`, write it with
`Filesystem.writeFile` to the Cache directory, then `Share.share({ files })`.
Also offer "Save to Downloads" through the Storage Access Framework.
Exporters are pure functions with snapshot tests. They are validated against
the GPX/TCX XSDs in tests.

*(Phase 2: GPX import for viewing other tracks.)*

---

## 10. Project structure

```
android-locale/
├─ package.json  vite.config.js  capacitor.config.json
├─ index.html
├─ src/
│  ├─ main.js  router.js  styles/{tokens,base,views}.css
│  ├─ views/{home,live,history,detail,settings}.js
│  ├─ components/{popover,statTile,dialog,toast}.js
│  ├─ tracker/client.js
│  ├─ geo/{haversine,enu,kalman,filters,snap}.js
│  ├─ stats/{summary,splits,vertical,stationary,ski}.js
│  ├─ db/{idb,workouts}.js
│  ├─ export/{gpx,tcx,kml,geojson,csv,fit}.js
│  ├─ map/{mapView,arrows,markers,scrubber}.js
│  ├─ profile/elevationProfile.js
│  └─ view3d/{scene,track,markers}.js
├─ tests/  (vitest + fixtures/*.gpx)
└─ android/  (Capacitor-generated)
   └─ app/src/main/java/app/locale/tracker/
        LocaleTrackerPlugin.kt  TrackingService.kt  AltitudeFusion.kt
        Journal.kt  TrackingNotification.kt
```
App ID: `app.locale.tracker` (placeholder; confirm before first Play upload,
because it can't change later).

---

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Scaffold: Vite + Capacitor, `npx cap add android`, minSdk/targetSdk 36, builds and runs on the emulator from CLI and from Android Studio | "Hello Locale" runs on an API 36 emulator |
| **M1** | Native `LocaleTracker`: FGS, fused location, journal, notification, permissions flow | 30-minute screen-off recording on a real device with no gaps. Survives `adb shell dumpsys deviceidle force-idle`. |
| **M2** | Sensors: barometer fusion, compass heading, GNSS status | Altitude noise below ±1 m when stationary on a baro device. Heading stable when walking slowly. |
| **M3** | Live Workout UI: start/pause/stop per activity, the six live metrics, orphan recovery | All metrics update at 1 Hz. Back-from-background resync is correct. |
| **M4** | Post-processing + storage: filters, stats, splits, stationary, ski runs, IndexedDB | Vitest suite passes against fixture tracks. |
| **M5** | History + Summary/Splits views | |
| **M6** | Map view: tiles, track, arrows, distance markers + popovers | |
| **M7** | Elevation profile + two-way drag scrubbing | Scrubbing stays smooth (60 fps) on a 10k-point track |
| **M8** | 3D view: exaggerated altitude, arrows, clickable markers | |
| **M9** | Export: GPX, TCX, KML, GeoJSON, CSV + share | GPX/TCX import cleanly into Strava, Garmin Connect, Google Earth |
| **M10** | Polish: settings, units, theming, accessibility, battery audit, release signing | Battery use under ~6%/hour with screen off, measured |
| Phase 2 | FIT export, GPX import, Live Update notification polish, offline map tile caching, heart-rate BLE sensors | |

---

## 12. Testing strategy
- **Unit (Vitest):** geo math, Kalman, hysteresis vertical, splits,
  stationary detection, ski run segmentation, exporters (snapshot + XSD).
- **Emulator:** Extended Controls → Location → load a GPX/KML route and play
  it back at 1×–5×. Use a set of fixture routes (walk loop, run with stops,
  cycle hill climb, ski lift/descent laps).
- **Real device (required):** background/screen-off runs, OEM battery killer
  behaviour, barometer, tunnels and urban canyon, glove usability.
- **Lifecycle:** kill the WebView process mid-workout, revoke location
  mid-workout, low battery, airplane mode, reboot during workout (orphan
  recovery).

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OEM battery managers kill the FGS | Battery-optimisation exemption flow, per-OEM guidance, journal-based recovery |
| Not every device has a barometer | GNSS-only fallback with a larger hysteresis threshold. Show "altitude: GPS" vs "barometric" in the UI. |
| Free tile servers have fair-use limits | Sensible caching, attribution, and a configurable tile URL, so switching to self-hosted or paid tiles is a config change |
| Bundled JDK 25 vs Gradle/AGP support | Pin a Gradle toolchain to JDK 21 if needed |
| Play Store background-location policy | No `ACCESS_BACKGROUND_LOCATION`. The FGS is user-initiated with a visible notification. Declare the FGS type in Play Console. |
| WebView memory with large tracks | Columnar typed arrays, Douglas–Peucker simplification for rendering at low zoom, render-on-demand 3D |

---

## 14. Decisions (answered 2026-10-09)
1. App name **Locale Exercise Tracker**. Application ID `app.locale.exercisetracker`
   (change before the first Play upload if a different ID is wanted).
2. Units are metric by default; the user can switch to imperial in Settings.
3. FIT export moves to phase 2.
4. No live map on the workout screen.
5. No BLE heart-rate in v1.

## 15. Implementation status (v1 built 2026-10-09)

M0–M9 are implemented. M10 is partly done (settings, units, theming). Deviations
from the plan above:

| Plan | Built | Why |
|---|---|---|
| Kotlin native plugin | **Java** (`tracker/*.java`) | Matches Capacitor's template and avoids adding a Kotlin toolchain |
| Gradle toolchain pinned to JDK 21 if needed | **Gradle 9.1.0 wrapper** | Runs on Android Studio's bundled JDK 25 with no machine-specific config |
| Grid index for snapping | Brute-force nearest segment | Well under 1 ms for 10k points; simpler |
| 3D base plane with map texture | Ground grid + track shadow | Rendering tiles off-screen adds fragility; phase 2 |
| Exporter XSD validation | Well-formedness + structure tests | No XSD validator dependency |
| "Save to Downloads" (SAF) | Share sheet only | The share sheet already offers Files/Drive; phase 2 |
| Kotlin `TrackingNotification` class | Built into `TrackingService` | Small enough not to need its own class |

Verified so far:
- 33 Vitest tests pass.
- Debug APK builds and lint is clean.
- Every screen was exercised in the browser with the GPS simulator: map,
  profile scrubbing, marker drag snapping, 3D popovers, pause/resume and
  journal recovery.

**Not yet verified on an emulator or device** (no AVD installed). The M1/M2
"done when" criteria still need real-device runs.
