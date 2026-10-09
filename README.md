# Locale Exercise Tracker

GPS workout tracker for **walking, running, cycling and snow skiing** on Android 16+.
The UI is HTML5, vanilla JS and CSS3, packaged with Capacitor 8. A small Java plugin
records in the background through a foreground service.

## Features

- **Start / pause / resume / stop per activity.** Stop is hold-to-confirm, so a gloved
  hand can't end a workout by accident. Auto-pause can be set per activity.
- **Background tracking with high accuracy.** A location foreground service uses the
  fused provider (high accuracy, 1 Hz). It also reads the barometer, GNSS status
  (satellites, signal), MSL altitude via `AltitudeConverter`, and the compass.
  - Notification controls appear as an Android 16 Live Update.
  - Points are written to a crash-safe journal on disk.
  - Workouts survive process death.
- **Live screen** shows elapsed time, distance, speed or pace (tap to toggle),
  heading (GPS course when moving, compass when slow), latitude/longitude, altitude,
  climb so far, and GPS quality.
- **Review:**
  - Distance, time, moving and stationary time, average speed and pace, max speed.
  - Climb, descent, net vertical, min/max altitude.
  - Splits per km or mile.
  - For skiing: runs, lifts, ski vertical and lift time.
- **Map:** MapLibre with free OpenFreeMap or OpenTopoMap tiles.
  - The track is coloured by speed, with subtle direction chevrons.
  - Tapping a distance marker opens a popover with distance, time, clock time,
    latitude, longitude and altitude.
  - An **elevation side view** sits below the map. Dragging the marker on the map, or
    scrubbing the profile, moves the other.
- **3D:** Three.js route plot with a vertical exaggeration slider (1–10×), plus
  direction arrows and the same clickable distance markers.
- **Export:** GPX 1.1, TCX, KML (3D), GeoJSON and CSV, sent through the Android
  share sheet.
- Metric by default, with imperial in Settings. Light, dark and auto themes.

## Project layout

```
src/
  main.js, router.js, settings.js, units.js, activities.js
  tracker/   client.js (native plugin + browser simulator), journal.js, synthetic.js
  geo/       geo.js, kalman.js (RTS smoother), process.js (journal → track), snap.js
  stats/     summary.js (stats, splits, vertical hysteresis, ski runs)
  db/        IndexedDB: workouts, columnar tracks, gzipped raw journals
  export/    gpx, tcx, kml, geojson, csv
  map/       mapView.js     profile/ elevationProfile.js     view3d/ view3d.js
  views/     home, live, history, detail, settings
android/app/src/main/java/app/locale/exercisetracker/tracker/
  LocaleTrackerPlugin.java  TrackingService.java  Journal.java  AltitudeFusion.java
tests/       Vitest unit tests (geo, processing, stats, exporters)
```

## Develop

```sh
npm install
npm test                  # unit tests
npm run dev               # browser dev server with a simulated GPS route
                          # (append ?sim=10 to run the simulator 10× faster)
```

## Build for Android

Requires Android Studio (its bundled JBR works as the JDK) and SDK platform 36.

```sh
npm run build && npx cap sync android
cd android
# Use Android Studio's bundled JDK:
#   set JAVA_HOME=F:\Program Files\Android\Android Studio\jbr
gradlew.bat assembleDebug
```

You can also open the `android/` folder in Android Studio and run it.

Toolchain notes:
- The Gradle wrapper is pinned to **9.1.0**, because Android Studio's bundled JDK 25
  is too new for the Gradle 8.14 that Capacitor generates.
- `android/local.properties` (gitignored) must point `sdk.dir` at your Android SDK.

### Testing GPS on the emulator

Extended controls → Location → load a GPX/KML route and press play. To check
background survival, turn the screen off, then run
`adb shell dumpsys deviceidle force-idle`.

## Data and privacy

Workouts stay on the device (IndexedDB inside the app). Nothing is uploaded. The
network is used only to fetch map tiles.
