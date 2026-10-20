# Locale Exercise Tracker

Locale is a GPS workout tracker for Android 16+ covering **walking, running, cycling and
snow skiing**. It records reliably in the background with the screen off. A **Wear OS
companion** lets you start and stop workouts from your watch and adds live heart rate.
Home-screen widgets start a workout in one tap, and **voice announcements** call out
your splits, time and goal progress as you go. Locale **learns your routines**, and
sets the goal distance for a workout on its own once it knows them. A **Live** mode shows your position,
altitude, speed and heading without recording anything.
Afterwards you can review each workout as stats, heart-rate effort (calories, cardio load,
zones), splits, an interactive map with an elevation side view, or a 3D plot over
satellite imagery. Then you can export it as **FIT** (for Strava and Garmin Connect),
GPX, TCX, KML, GeoJSON or CSV. **Insights** reports your totals and averages by day, week,
month, quarter or year, per activity or routine, shows your **personal bests**, and
exports the report as CSV or JSON. Set **goals** for distance, time, cardio load or
calories per day, week or month: Insights charts draw them, and the 4×2 widget tells you
whether you're ahead or behind for the week. You can **share a
course** (the route and its altitude, with no times or speeds) by SMS, email or Quick
Share, and the recipient explores it on the map and in 3D with Locale's **View** tool.

The app is written in HTML5, vanilla JavaScript and CSS3, and packaged with
[Capacitor](https://capacitorjs.com/). A small Java plugin handles background GPS and
sensors.

<p align="center">
  <img src="docs/screenshots/home.png" width="250" alt="Home screen with activity tiles, the Live and View tiles, and the City2Surf sample workout">
  &nbsp;
  <img src="docs/screenshots/live.png" width="250" alt="Live workout screen with elapsed time, heart rate, distance, pace, heading, altitude and location">
  &nbsp;
  <img src="docs/screenshots/summary.png" width="250" alt="Workout summary with distance and the average GPS error, times, speed, pace, climb and altitude">
</p>
<p align="center">
  <img src="docs/screenshots/effort.png" width="250" alt="Effort: average and max heart rate, calories, cardio load and time in heart-rate zones">
  &nbsp;
  <img src="docs/screenshots/map.jpeg" width="250" alt="Map view with speed-coloured route, distance marker popover, and elevation profile with heart-rate line">
  &nbsp;
  <img src="docs/screenshots/3d.jpeg" width="250" alt="3D route over satellite imagery with exaggerated altitude">
</p>
<p align="center">
  <img src="docs/screenshots/splits.png" width="250" alt="Per-kilometre splits with pace, elevation change, heart rate and time">
  &nbsp;
  <img src="docs/screenshots/share.png" width="250" alt="Share sheet: text summary with Text message and Other apps buttons, and file export formats">
  &nbsp;
  <img src="docs/screenshots/live-position.png" width="250" alt="Live position screen: coordinates, barometric altitude, speed, compass heading and a map, with nothing recorded">
</p>
<p align="center">
  <img src="docs/screenshots/voice-settings.png" width="250" alt="Voice announcement settings: Splits, Time and Goal per activity, time interval, lower or pause other audio, always loud, and watch vibration">
  &nbsp;
  <img src="docs/screenshots/voice-live.png" width="250" alt="Live workout screen showing the last spoken announcement as a caption under the controls">
</p>
<p align="center">
  <img src="docs/screenshots/insights.png" width="250" alt="Insights: date range, grouping, activity and routine filters, with totals for workouts, distance against its goal, activity time, speed and pace with their ± variation, heart rate, cardio load and calories">
  &nbsp;
  <img src="docs/screenshots/insights-split.png" width="250" alt="Insights: monthly distance stacked by activity, with a tooltip for July and a table broken down by activity">
  &nbsp;
  <img src="docs/screenshots/insights-weekly.png" width="250" alt="Insights: weekly cardio load for the last 3 months stacked by activity, with a tooltip for one week">
</p>
<p align="center">
  <img src="docs/screenshots/insights-bests.png" width="250" alt="Insights: personal bests per activity, with best average pace, best kilometre split, fastest speed and longest workout, each with its date">
</p>
<p align="center">
  <img src="docs/screenshots/settings.png" width="250" alt="Settings: Units and display, then Goals listing all activities per week, walk per day, run per week and cycle per month, with an Add button">
  &nbsp;
  <img src="docs/screenshots/goals.png" width="250" alt="Goal editor: activity chips, Per day, Per week or Per month, and distance, activity time, cardio load and calorie targets">
  &nbsp;
  <img src="docs/screenshots/insights-goals.png" width="250" alt="Insights: weekly running distance with a dashed 25 km goal line, and a tooltip for a week 7.4 km short of the goal">
</p>
<p align="center">
  <img src="docs/screenshots/widget-week-chart.png" width="490" alt="4×2 widget: this week's distance, average split and speed, a chart of distance per day with a dashed daily goal line, and You're 3 km ahead of your goal! Well done!!">
</p>
<p align="center">
  <img src="docs/screenshots/view-share.png" width="250" alt="Share sheet: Share course section with a Hide start and finish switch, a Share AR City2Surf 2026.gpx button and Share a link to view in a browser">
  &nbsp;
  <img src="docs/screenshots/view-list.png" width="250" alt="View: Open a course file, and the courses opened before with who shared them, distance and climb">
</p>
<p align="center">
  <img src="docs/screenshots/view-map.png" width="250" alt="A shared course on the map in one colour, with a readout of distance, altitude, grade and climb so far, and the elevation profile">
  &nbsp;
  <img src="docs/screenshots/view-3d.png" width="250" alt="A shared course in 3D over satellite imagery, drawn in one colour">
</p>
<p align="center">
  <img src="docs/screenshots/viewer.jpeg" width="760" alt="Locale Viewer in a desktop browser: the City2Surf course from a link, full width on the map with its elevation profile">
</p>
<p align="center">
  <img src="docs/screenshots/watch-home.png" width="200" alt="Pixel Watch: Locale start screen with Start Run and Start Walk">
  &nbsp;
  <img src="docs/screenshots/watch-workout.png" width="200" alt="Pixel Watch: workout in progress with goal ring, elapsed time, distance, pace, zone-coloured heart rate, pause and stop">
</p>

<sub>The phone screenshots show the built-in sample workout, a simulated run of the Sydney
City2Surf (Hyde Park to Bondi via Heartbreak Hill at 6:18/km, with simulated heart rate).
It is generated from the course map and is not a real recording. The voice screenshots
come from the browser simulator. The Insights screenshots use a year of generated
workouts in the browser build, and the Goals screenshots 16 weeks of them. The 4×2
widget is on a Pixel 10a. The View screenshots show the sample shared as a course,
and a generated walk shared with its start and finish hidden; the Locale Viewer screenshot
is the same course opened from a link in desktop Chrome. The watch screenshots
are from a Pixel Watch 3; the workout screen uses the debug build's demo mode.</sub>

## Features

### Record
- **Four activities:** walk, run, cycle and ski, each with tuned accuracy filters and
  stationary thresholds.
- **Controls:** start, pause, resume and **hold-to-stop**, so a gloved hand can't end a
  workout by accident.
- **Auto-pause:** optional, set separately for each activity.
- **Live position mode:** the yellow **Live** tile shows where you are without recording
  anything:
  - coordinates, as decimal or degrees-minutes-seconds
  - GPS accuracy and satellites
  - barometric altitude with vertical accuracy and air pressure
  - speed, and heading from the compass or GPS
  - a live map with an accuracy circle
  - **Copy**, **Share** and **Hold**

  Sensors stop as soon as you leave the screen.
- **Home-screen widgets:**
  - **1×1:** your last-used activity
  - **2×1:** run and walk
  - **2×2:** all four activities

  One tap starts recording, even with the app closed. While recording, the widget shows
  the activity, a running timer and distance. Add one from Settings → Home-screen widgets.

  Two more show this week (Sunday to Saturday) and open the app when tapped:
  - **2×2 this week:** distance, workout count, average split and speed
  - **4×2 this week:** the same, with a chart of distance per day stacked by activity,
    as in Insights. With a distance [goal](#goals) it draws the goal's share per day as a
    dashed line and says how the week is going: *"You're 3 km ahead of your goal! Well
    done!!"* or *"You're a bit behind your goal – you need to go 4.5 km today to catch up"*.
- **Live screen:**
  - elapsed time
  - distance
  - speed or pace (tap to switch)
  - heading: GPS course while moving, compass when slow
  - latitude/longitude
  - altitude and climb so far
  - GPS accuracy and satellite count
- **Background tracking** runs through a location foreground service:
  - fused GPS at 1 Hz, high accuracy
  - barometer fused with GNSS altitude, for smooth climb figures
  - mean-sea-level altitude
  - GNSS satellite status
- **Voice announcements**, spoken by the phone even with the screen off:
  - **Splits:** every km or mile, with the split time and average pace or speed.
  - **Time:** every 5, 10, 15 or 30 minutes of active time, with the workout's distance so
    far and average.
  - **Goal:** at 25%, 50%, 75% and 100% of a goal distance set on the start screen. For a
    recognised routine each milestone says the time left at your average pace instead of
    the average, *"31 minutes to go"*, and routines of 10 km or more add 33% and 66%.
  - **Countdown** (opt in, routines only): over the last kilometre to a recognised
    routine's goal, *"1000 metres to go"*, then 500, 200 and 100, each short with no
    average. It follows the routine's goal announcements, so it stops when you go off route.

  Each kind is on or off per activity (Settings → Voice announcements). Music is lowered
  or paused while Locale speaks, and nothing is said while paused. **Always loud** turns
  the media volume up to full while Locale speaks, then back to where it was.
  The distance spoken (and shown live) only counts movement of 10 m or more, so GPS
  jitter while you walk doesn't run it ahead of the saved workout's distance. A routine can have its
  own (Settings → Learned routines → **Customise**): splits, time, goal and the time
  interval, used instead of the activity's once Locale recognises the routine at the start.
- **Watch vibration** with each announcement, so you can feel it without listening:
  - split: two taps
  - time: one longer tap
  - goal milestone: three taps
  - goal reached: long, short, long
  - countdown: one quick tap
  - goal set: one short tap
  - off route: two long taps

  The watch also shows the announcement's text for a few seconds. Settings → Voice
  announcements → Vibrate the watch turns it off, and **Test** buzzes the watch too.
- **Auto goals:** the goal distance is predicted from your routines; see
  [Auto goals](#auto-goals-how-locale-learns-your-routines).
- **Lock-screen notification** with pause, resume and stop. It shows as an Android 16
  Live Update.
- **Crash-safe recording:** every fix goes to an on-disk journal. A workout survives the
  app being killed, and interrupted workouts can be saved or continued.

### Wear OS watch (Pixel Watch and other Wear OS 5+ watches)
- **Start, pause, resume and stop** phone workouts from the watch app or its tile. Stop
  needs a second tap. The tile starts the activity you used last.
- **Live heart rate** from the watch, read through Wear OS Health Services and streamed to
  the phone about every 3 s. It's saved into the workout recording, so every GPS point
  has a heart rate.
- **Step cadence** (steps per minute) for walks and runs, from the watch with the heart
  rate, or from the phone's own step counter when the watch has none (needs the "Physical
  activity" permission, asked once). The workout shows the average cadence and where it
  came from, and the VO2max estimate uses it to spot heart rate locked onto the step rate.
- **Watch screen:** elapsed time, distance, pace or speed, and heart rate. The details are
  white on black, whatever the watch's theme; only the heart rate is coloured, by
  zone, matching the phone's zone colours (from your profile's max and resting heart rate).
  The goal ring and buttons keep the activity's colour. The workout also shows on the watch face as an ongoing activity.
  When the watch screen times out it goes black (effectively off, even with always-on
  display); raise or turn your wrist, or tap, to bring the workout back.
- **Starting with the phone in your pocket** needs location set to "Allow all the time"
  (Settings → Watch). Without it, the watch asks you to tap a notification on the phone.
- **Pull to refresh** on the Track and History screens picks up workouts recorded from the watch, a
  widget or the notification while the app wasn't open, and shows one still in progress.
  The list also refreshes by itself whenever you come back to the app.

### Review
- **Stats:**
  - distance, with the average GPS error the phone reported for the workout's fixes
    ("GPS ±4 m avg")
  - time, moving time and stationary time
  - average speed and average pace
  - max speed
  - climb, descent and net vertical
  - min and max altitude
- **Ski extras:** runs, lifts, ski vertical, lift time and max run speed.
- **Effort**, when you've filled in the profile (sex, birth year, weight):
  - average and max heart rate
  - **calories**: Keytel 2005 heart-rate equation, or ACSM/MET from speed and slope
    without heart rate
  - **cardio load** (Banister TRIMP)
  - time in heart-rate zones
  - **VO2max estimate** for walks and runs with watch heart rate: the HUNT 3 walking model
    (Loe et al. 2016) on steady 5-minute stretches after a 10-minute warm-up, from speed,
    slope, weight, age and heart rate. Stretches with an uneven pace, a steep slope or
    unreliable heart rate (gaps, sudden jumps, unsteady, or too high to be steady walking)
    are left out, and the page says why. Settings → Profile shows your current estimate:
    the median of the last 4 weeks.
- **Heart-rate line** on the elevation profile, with heart rate per split and in the
  marker popovers. GPX, TCX and CSV exports include heart rate.
- **Splits** per km or mile, with pace, elevation change and fastest/slowest bars.
- **Map:**
  - MapLibre with free OpenFreeMap streets, light or dark styles, or OpenTopoMap topo.
  - The route is coloured by speed, with subtle direction chevrons.
  - **Distance markers** open a popover showing distance, time, clock time, latitude,
    longitude and altitude.
- **Elevation side view** below the map. Drag the marker along the route, or scrub the
  profile, and the two follow each other.
- **3D view:**
  - Three.js plot with an altitude exaggeration slider from 1× to 10×.
  - **Satellite imagery** on the ground.
  - Direction arrows, and the same clickable distance markers as the map.
  - **Smooth** route: a 10-second time-weighted average removes GPS noise and altitude
    bounce from the drawn line (display only; stats and exports use the raw track).
    Toggle it on the 3D view or in Settings.
- **Edit** a workout's name, notes and **activity type**. Recorded the wrong one? Changing
  it re-processes the original GPS recording with the new activity's filters, and an
  automatic name like "Morning Run" follows.
- **Share as text:** a short summary (distance, time, pace or speed, climb, heart rate,
  calories) by **SMS** with one tap, or to any app through the Android share sheet.
- **Export** through the Android share sheet as:
  - **FIT**: Garmin's binary activity format, the best fit for Strava and Garmin Connect.
    Includes per-km laps, heart rate, climb and calories. The encoder is written from the
    FIT protocol spec and checked in tests with Garmin's official FIT SDK.
  - GPX, TCX, KML (3D in Google Earth), GeoJSON or CSV.

### Share and view courses
- **Share course**, in a workout's Share sheet, sends the route and its altitude only. It
  leaves out every time and date, speed, pace, pause, heart rate, calorie, note and
  device detail, so a share can never give away how fast you went or when.
  - The file is named with your initials and the workout's label, like
    `AR Bondi loop.gpx`. Your name is in **Settings → Profile**, and only the initials
    are sent.
  - **Hide start and finish** (off by default) leaves out the first and last 200 m, so a
    course that starts at home doesn't show where you live.
  - It goes through the Android share sheet: Messages (SMS/MMS or RCS), Gmail, Quick
    Share, Drive or Files. A 10 km course is about 30–60 kB.
  - The format is standard **GPX 1.1** with no timestamps, so Garmin Connect, Strava
    routes, Komoot or Google Earth can open it too. Locale's extra details (the activity,
    distance and climb) ride in a small `locale:course` extension that other apps ignore.
  - **Share a link to view in a browser** sends the same course as a
    [Locale Viewer](https://andrewrigney1975-cpu.github.io/ar-localetracker/) link, which
    anyone can open in a browser without installing anything (see below).
- **View**, the tile under Live on the Track screen, opens a course file someone shared
  with you. Tap a `.gpx` attachment in Messages, Gmail or Files and choose **Open with
  Locale**, or use **Open a course file** in View.
  - **Map**: the course in one colour (there's no speed to colour it by), distance
    markers, start and finish, and the elevation profile. The readout shows distance,
    altitude, grade and the climb so far, and nothing about time or performance.
  - **3D**: the same course in one colour over satellite imagery, with the vertical
    exaggeration and Smooth (averaged over 25 m, as there are no times).
  - Opened courses are kept in their own list in View, apart from your workouts, so they
    never show up in History, Insights or your routines. View also opens other GPX
    tracks and routes, and GeoJSON lines, ignoring any timing in them.
- **Locale Viewer** is a standalone web page with the same Map and 3D views, for people
  who don't have the app. It works in any browser, phone or desktop, at any window width.
  - Open a `.gpx` or GeoJSON file with **Open a course file**, or drop it on the page.
  - The address then becomes a **course link** (`…/#c=…`) that holds the whole course,
    deflated and base64url-encoded. City2Surf is about 2,100 characters. Send the link
    and it opens straight in the browser. **Share link** copies it, or opens the share
    sheet on a phone, and **Download .gpx** saves the course as a file.
  - Nothing is uploaded. Files are read in the browser, and the course in a link sits
    after the `#`, which browsers never send to a server, so the page can be hosted on
    any static host.

### Goals
- **Set in Settings → Goals:** pick all activities or one, and per day, week or month, then
  set any of distance, activity time, cardio load and calories. Leave a box empty for no
  target.
- **Insights** draws the goal as a dashed line on the chart for the same activity and
  metric. A goal set for another period is scaled to the chart's grouping: a weekly goal
  is a seventh of it per day, and a monthly one is spread over the month's days. With all
  activities in one bar, the line is the All-activities goal, else the activities' goals
  added up. Tap a bar to see the goal and how much was left, or that it was reached. The
  Distance tile shows the window's total against its goal.
- **The 4×2 widget** counts every activity's distance against the All-activities distance
  goal, else the activities' distance goals added up (a day or month goal counts as its
  share of a week). It compares the week so far with an even share per day, Sunday to
  Saturday, and tells you how far ahead you are, or how far to go today.

### Insights
- **Date range:** today, this week (Sunday to Saturday), this month, the last 3 or 12
  months, this year, all time, or custom dates. The ‹ and › arrows step back and forward
  a window at a time: yesterday, last week, August, the 3 months before, last year.
- **Grouping:** daily, weekly (Sunday to Saturday), monthly, every 3 months (calendar quarters)
  or yearly.
- **Activity:** all together, one activity, or all with each activity shown separately.
- **Routine:** narrow the report to one of your routines (learned, or marked by you).
- **Metrics:** distance, average speed and pace (over moving time), activity time,
  average heart rate (max too in exports), cardio load and calories. Totals sit at the top; the chart
  shows the metric you pick (tap a bar for its values), and a table lists every period.
- **Totals tiles:**
  - **Distance**, to one decimal. With a distance [goal](#goals), the right of the tile
    shows how far above or below it you are (*"−20.4 of 25.0 goal"*, green once reached).
    A day, week or month window uses that period's goal, scaled from another when it isn't
    set. Longer windows add up each day's goal. With all activities and no All-activities
    goal, the activities' goals are added up and compared with those activities' distance
    only (*"of 45.0 walk + run"*). Not shown for a single routine.
  - **Avg speed** and **Avg pace** show **±%** on the right: how much the workouts' speeds
    vary about the average (one standard deviation, weighted by moving time as the average
    is). Shown from two workouts.
- **Goal line:** the chart shows your [goal](#goals) for its activity and metric as a
  dashed line, with how much each period had left to go.
- **Export** the report as **CSV** (one row per period, or per period and activity) or
  **JSON** (with totals) through the Android share sheet. Values are SI units.
- **Personal bests**, per activity over all time (following the activity and routine
  filters): best average pace or speed, best km or mile split, fastest speed (held for
  at least 5 seconds, so a GPS glitch doesn't count) and longest workout. Tap one to open
  the workout. Ski days show only fastest speed and longest workout.
- Calories and cardio load need the profile in Settings. They are worked out from each
  workout's full recording and cached on the device until the workout or profile changes.

### General
- **Units:** metric by default, imperial in Settings.
- **Theme:** light, dark and auto.
- **Font:** Google Sans, bundled for offline use.
- **Privacy:** workouts are stored only on the device. The network is used for map tiles
  and nothing else.
- **Storage:** on Android, workouts live in an app-private **SQLite** database. Existing
  IndexedDB data migrates automatically on first launch, verified per track by CRC-32.
  A workout stopped from the watch, a widget or the notification is processed and saved
  natively right away. The browser build keeps IndexedDB.

## Auto goals: how Locale learns your routines

Most people repeat a few workouts, such as a Saturday morning loop of the lake or a
run along the river after work on Tuesdays and Thursdays. Locale notices these
**routines** and uses them to set the goal distance for you, so you hear "25 percent of
your goal" without setting anything up.

### What it does
- **When you start a workout**, from the phone, the watch or a widget, Locale picks the
  routine you are probably doing straight away, whatever the goal mode. Its goal, the
  watch's goal ring and the routine's own announcements apply from the first metre, and
  Locale tells you: *"Goal 4.7 kilometres, your usual Saturday morning loop."* Without a
  GPS fix yet it goes by the weekday and time, then checks the start place at the first
  good fix (within 3 minutes) and switches routine if that says another.
- **During the workout** it announces 25%, 50%, 75% (plus 33% and 66% for routines of
  10 km or more) and "Goal reached" at 100%, along with your distance and the time to go
  at your average pace so far: *"Halfway to your 12 kilometre goal. 6 kilometres. 37
  minutes to go."*
- **If you leave the usual route**, meaning more than 250 m from it for over 2 minutes,
  it says *"Off your usual route. Goal announcements paused."* Splits and time
  announcements carry on.
- **It always picks one** when the activity has routines, even at an unusual time or
  place. If it picked wrong, the off-route check above stops the goal announcements, and
  you can take the workout out of the routine afterwards (the routine picker on the
  workout's Distance tile).
- **Afterwards**, the route's shape decides which routine the workout belongs to; when
  it fits more than one, the routine picked at the start wins. The workout summary shows
  the goal and whether you finished within 10% of it. The watch shows goal progress as a
  ring round the screen.

### How it learns
1. **It looks at your saved workouts**, on the phone only, nothing is sent anywhere.
   For each workout it reads the activity, the local weekday and start time, where it
   started and finished, the shape of the route, and the distance and time taken. The
   built-in sample and very short workouts (under 500 m or 3 minutes) are left out.
2. **It groups workouts that are the same routine.** That means the same activity, a
   start within 300 m, distances within 12%, and routes that overlap. Two routes overlap
   when they stay, on average, within 120 m or 4% of the distance of each other. A loop
   run the other way round counts as the same route.
3. **It describes each routine:**
   - how often you do it, with recent workouts counting more (each 60 days halves the
     weight)
   - the usual weekday and start time
   - the usual distance and how much it varies
   - a name such as "Saturday morning loop" or "weekday evening route"
4. **It works out the goal:** the usual (median) distance, to two decimals (0.01 km or mi).
   Recent workouts count most (one from 3 weeks ago counts half), so the goal follows a
   routine you have lengthened or shortened. If your distances cluster around a round
   number, such as 4.9–5.1 km, the goal is that number: "5 kilometres".
5. **It checks it has enough history first.** Auto goals start once an activity has 5
   workouts in the last 6 months. A routine counts once it has 3 workouts, 2 of them in
   the last 60 days, with distances that vary by no more than about 12%.
6. **It picks one routine when you start.** Each routine of the activity is scored on
   how often you do it, how close you are to its usual start time, whether today is its
   usual day and, with a GPS fix, how close you are to its start. Being at a routine's
   start counts for more than the time, and the highest score wins. An activity with no
   routines falls back to your usual distance for that time of week, such as "weekend
   morning walks" (Auto goal mode only).
7. **It learns from its mistakes.** Each workout keeps the goal it was given. If a
   routine's recent auto goals mostly missed (fewer than half of the last 5 within 10%),
   that learned routine is paused, so a new habit can take over quickly. Routines you
   marked are never paused.

The model is rebuilt whenever your workout list changes, including when you come back
to the app after recording from the watch. The phone's tracking service reads it, so
workouts started from the watch or a widget get their routine too.

### Your controls
- **Settings → Voice announcements:** each activity's goal chip cycles between
  **Auto goal** (the default; ski is Off), **Set goal** (a distance you choose on the
  start screen) and **Off**. You can also turn off "Say the goal at the start". The
  routine is picked in every mode: Set goal keeps your distance, and Off still shows
  the routine's goal on the ring and the summary but only announces it if the routine's
  own announcements (Customise) include the goal.
- **Start screen:** shows the auto goal and the routine it came from, or "learning · 3
  of 5 runs". Use − or + to set a different goal for this workout only.
- **Settings → Learned routines:** each routine's distance, how often you do it, the
  usual day and time, and how often its goal was hit. You can **Rename** it (Locale then
  says "your usual lake loop") or **Forget** it, which leaves its workouts out of
  learning. **Restore** undoes forgetting.
- **History → Select:** pick two or more workouts of one activity and **Mark as
  routine** with a name. A routine you mark counts from those two workouts, with no
  need for 5 workouts of history, 3 repeats or a recent one. Later workouts on the same
  route join it. In Settings it shows as "Marked by you", where **Remove** turns it
  back into ordinary learning.
- **Workout names:** a workout that belongs to a routine is named after it ("Lake loop"
  instead of "Morning Run"), and follows the routine if you rename it. Only automatic
  names change; a name you typed is kept.

The thresholds were tuned with `scripts/evaluate-goals.mjs`. It replays generated
histories in date order and predicts each workout from the earlier ones only. On
typical routines, 100% of auto goals landed within 10% of the actual distance, and
histories of random one-off workouts got no goals at all. The design and numbers are in
[docs/plans/goal-prediction.md](docs/plans/goal-prediction.md).

## Getting started

Requirements:
- Node 20+
- Android Studio, whose bundled JDK works
- Android SDK platform 36
- A device or emulator running Android 16 or later

```sh
npm install
npm test         # unit tests (Vitest)
npm run dev      # run in a browser with a simulated GPS route
```

The browser build uses a GPS simulator that starts at Hyde Park, Sydney. Add `?sim=10` to
the URL to run it 10× faster.

### Locale Viewer (web)

```sh
npm run viewer         # serve viewer/ with hot reload
npm run viewer:build   # static site in dist-viewer/
```

`.github/workflows/viewer-pages.yml` publishes it to GitHub Pages on every push to `main`
that touches it (repository Settings → Pages → Source: **GitHub Actions**). Course links
from the app point there (`VIEWER_URL` in `src/course/courseLink.js`). `dist-viewer/` also
works on any other static host, or from a subfolder, since it uses relative paths.

### Build and install on a device

```sh
npm run build
npx cap sync android
cd android
# Point JAVA_HOME at Android Studio's bundled JDK, e.g.
#   set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
gradlew.bat assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

You can also open `android/` in Android Studio and press **Run**.

### Install on a Wear OS watch

```sh
gradlew.bat :wear:assembleDebug
adb -s <watch-serial> install -r wear/build/outputs/apk/debug/wear-debug.apk
```

The watch app uses the phone app's application ID and must be signed with the same key.
Debug builds from one machine already are. To enable debugging on the watch:
1. Settings → System → About → Versions: tap **Build number** 7 times.
2. Settings → Developer options: enable **ADB debugging** and **Wireless debugging**.
3. Run `adb pair <ip:port>` with the code shown, then `adb connect <ip:port>`.

> The Gradle wrapper is pinned to 9.1, because Android Studio's bundled JDK 25 is too new
> for the Gradle 8.x that Capacitor generates. `android/local.properties` (gitignored)
> must point `sdk.dir` at your Android SDK.

### Testing GPS

- **Emulator:** Extended controls → Location → load a GPX/KML route and press play.
- **Background survival:** start a workout, turn the screen off, then run
  `adb shell dumpsys deviceidle force-idle`.

## Project layout

```
src/
  main.js, router.js, settings.js, units.js, activities.js
  tracker/   native plugin client + browser simulator, journal parser
  geo/       geodesy, Kalman/RTS smoothing, journal → track processing, snapping
  stats/     summary, splits, hysteresis climb, stationary time, ski runs
  db/        storage facade: SQLite on Android (nativeStore), IndexedDB in the browser
             (idbStore), track codec, one-time migration
  export/    FIT, GPX, TCX, KML, GeoJSON, CSV
  map/       MapLibre workout map, Live position map    profile/  elevation side view
  view3d/    Three.js 3D view, satellite imagery, display smoothing
  seed/      City2Surf sample workout (course data + generator)
  stats/physio.js  heart-rate zones, TRIMP, calories
  views/     home, live (workout), position (Live mode), history, detail, insights,
             settings, courses + course (View)
  course/    shared course files (write, name, parse), course links, and the View
             course store
  viewer/    Locale Viewer, the standalone web page (entry: viewer/index.html)
  voice/     announcement triggers and phrases (mirrored natively in VoiceCoach)
  insights/  learned routines and goal prediction (matcher mirrored in RoutineMatcher);
             date-based reports with CSV/JSON export, calorie and load cache
android/app/src/main/java/app/locale/exercisetracker/tracker/
  LocaleTrackerPlugin  TrackingService  Journal  AltitudeFusion
  WearListenerService  WearSync          (watch link)
  LocaleWidgets  Widget1x1/2x1/2x2/Week/WeekChartProvider  (home-screen widgets)
  VoiceCoach  Speaker                        (voice announcements, text-to-speech)
  RoutineMatcher  RouteGuard                 (auto goals from learned routines)
android/app/src/main/java/app/locale/exercisetracker/store/
  WorkoutStore (SQLite)  LocaleStorePlugin  TrackCodec  WorkoutBuilder (JS processing port)
android/wear/            Wear OS companion app (Kotlin, Compose for Wear OS)
  MainActivity  HeartRateService  PhoneLink  PhoneListenerService  LocaleTileService
tests/       Vitest suites
docs/        screenshots
```

See [PLAN.md](PLAN.md) for the design and decisions, and [BACKLOG.md](BACKLOG.md) for
the feature requests.

## Credits

- **Map data:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- **Map tiles:** [OpenFreeMap](https://openfreemap.org) and
  [OpenTopoMap](https://opentopomap.org) (CC-BY-SA).
- **Satellite imagery:** © Esri, Maxar, Earthstar Geographics.
- **Sample course elevation:** Copernicus GLO-90 DEM via [Open-Meteo](https://open-meteo.com).
- **FIT protocol:** files are validated in tests with Garmin's
  [FIT SDK](https://developer.garmin.com/fit/) (a dev dependency only; it isn't shipped
  in the app).
- **Font:** [Google Sans](https://fonts.google.com/specimen/Google+Sans) (SIL Open Font
  License).

## License

[MIT](LICENSE) © 2026 Andrew Rigney
