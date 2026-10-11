# Plan: share a course, and view a shared one

Status: **implemented** (October 2026), all three phases.

> **Built:** `src/course/courseFile.js` (course GPX writer, file name, parser for GPX
> tracks and routes and GeoJSON), `course/courseStore.js` (Filesystem + Preferences index),
> `views/courses.js` and `views/course.js`; course mode in `map/mapView.js`,
> `view3d/view3d.js`, `view3d/smooth.js` (`distanceAxis`) and `ui/popover.js`; **Your name**
> in Settings → Profile; Share course with Hide start and finish in the workout Share sheet;
> `LocaleStore.readUri` and two `ACTION_VIEW` intent filters for Open with Locale.
>
> **Decided:** initials from a "Your name" profile field; Hide start and finish offered and
> off by default; files named `AR Bondi loop.gpx`; opened courses kept in their own list.
>
> **Verified:** `tests/course.test.js` (writer strips all timing and personal fields, valid
> GPX 1.1, segments kept, ≤ 5,000 points, distance within 0.5% and altitude extremes within
> 2 m after thinning, hiding the ends, file names, parsing other GPX and GeoJSON, course-mode
> popovers and distance smoothing). The City2Surf sample shares as 428 points in 30 kB
> (14.33 km against 14.37 km recorded). On the Pixel, a `.gpx` in Downloads opened through
> `ACTION_VIEW` both while Locale was running and from a cold start, typed as
> `application/gpx+xml` and as `application/octet-stream`.

A user shares a workout's **course**, meaning where it went and how high, with someone
else by SMS, email or file transfer. The recipient opens it in a new **View** tool and
explores it on the Map and in 3D. A course carries **no timing or performance data**:
distance and altitude only.

## 1. Format: GPX 1.1, with the time stripped

**Recommendation: a standard GPX 1.1 track (`<trk>`) with `<ele>` and no `<time>`,**
plus a small namespaced `<extensions>` block for Locale's own metadata. The file is named
`.gpx`.

| Option | Verdict |
|---|---|
| **GPX 1.1 track, no time** | **Use it.** It is the most widely understood route format. Garmin Connect, Strava (routes), Komoot, OsmAnd, Google Earth and QGIS all read it, so a recipient without Locale can still use it. It is text, so it compresses well and previews in mail. Time is optional in GPX, so a course without it is valid. Locale already writes GPX (`export/gpx.js`). |
| GPX route (`<rte>`) | Meant for a few turn points, not a recorded line. Some apps rebuild it by routing. Read it in View, but don't write it. |
| KML / GeoJSON | Fine for maps, but neither has a sports convention for altitude profiles, and fitness apps rarely import them. View can still read GeoJSON LineStrings (§4). |
| FIT Course | Garmin's binary course file. Good on Garmin devices, but opaque in email and SMS and harder to inspect. Possible later as "Send to Garmin". |
| Custom `.locale` JSON | Nothing else could open it. No benefit over GPX plus an extension. |

### What goes in the file

```xml
<gpx version="1.1" creator="Locale Exercise Tracker" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:locale="https://locale.app/xmlschemas/course/v1">
  <metadata>
    <name>Bondi loop</name>
    <author><name>AR</name></author>
    <extensions><locale:course v="1" activity="run" distance="4712.3" gain="64" loss="63"/></extensions>
  </metadata>
  <trk>
    <name>Bondi loop</name>
    <type>run</type>
    <trkseg>
      <trkpt lat="-33.891523" lon="151.276712"><ele>12.4</ele></trkpt>
      …
    </trkseg>
  </trk>
</gpx>
```

**Kept:**
- latitude and longitude, from the smoothed track
- smoothed altitude
- segment breaks, as separate `<trkseg>` elements, so the line doesn't jump across a GPS gap
- the label (workout name)
- the sharer's initials
- the activity type
- distance, climb and descent, for display before parsing the whole file

**Stripped:**
- every timestamp, including the workout's start date and time of day
- speed, pace, moving and stationary flags, and pauses (except as segment breaks)
- heart rate, calories and cardio load
- GPS accuracy, device name and notes
- the goal or prediction, and the routine id

**Size:**
- Points are thinned with Douglas–Peucker (`geo.simplifyIndices`) at 2 m, keeping any
  point where altitude turns by more than 2 m.
- Coordinates are written to 6 decimals (about 0.1 m) and altitude to 0.1 m.
- A 10 km run is about 1,000–1,500 points, roughly 60–90 kB, or about 15 kB zipped.
  There is a hard cap of 5,000 points, which raises the tolerance as needed.
- That keeps files inside MMS limits (often 300 kB–1 MB) and well inside email limits.

**Distance on the recipient's side:**
- It is recalculated from the geometry (haversine between consecutive points within a
  segment), so it matches what the map draws.
- `locale:course@distance` is shown only as the headline figure.
- After thinning, the two agree to within about 0.5%; a test checks this.

### File name

`AR Bondi loop.gpx`: the sharer's initials, a space, then the workout's current label.

- **Initials** come from a new **Settings → Profile → Your name** field (first and last
  name, or just initials). If it's empty when sharing, the share sheet asks once and saves
  the answer.
- **The label** is `workout.name`, which may be a routine name (e.g. "Bondi loop").
- Characters Android or mail clients reject (`/\:*?"<>|` and control characters) become
  spaces, runs of spaces collapse, and the name is cut to 80 characters.
- `<metadata><name>` keeps the label unmodified.

## 2. Sharing (sender)

The workout **Share** sheet (`views/detail.js`) gains a third section, **Share course**:

> **Share course**: route and altitude only, no times, speeds or heart rate.
> `[ Share AR Bondi loop.gpx ]`

- One button writes the file and opens the Android share sheet (`services/share.js →
  shareFile`, mime `application/gpx+xml`). That one sheet covers all three channels the
  user asked for:
  - **SMS**: Google Messages attaches the file and sends it as MMS or RCS.
  - **Email**: Gmail or other mail apps.
  - **File transfer**: Quick Share (Nearby), Drive, Bluetooth, or save to Files.
- A one-line preview under the button shows what's included: "4.71 km · +64 m · 1,214
  points".
- The existing **Export file** list keeps its full-data GPX/TCX/FIT exports. The course
  file is separate on purpose, so a "share" can never leak timing data.

**New code:**
- `src/course/courseFile.js`:
  - `toCourseGPX(workout, track, { initials })`: thins and writes the file.
  - `courseFilename(initials, label)`
  - `parseCourse(text, filename)`: §4.
- `views/detail.js`: the new section.
- `settings.js` and `views/settings.js`: `profile.name` and the derived initials.

## 3. Privacy

A shared course reveals where the sharer starts and finishes, which is often home.
Timing is stripped, but location is the point of sharing.

- **Hide start and finish:** a toggle in the share sheet, on by default once set in
  Settings, that trims the first and last 200 m.
  - **Suggested for v1:** offer it but leave it off by default.
  - **Decision for the user:** should it be on by default?
- The share sheet states plainly what is sent ("route, altitude, name, your initials").

## 4. Viewing (recipient)

### Entry point

A new **View** tile on the Track (home) screen, next to the yellow **Live** tile. Its
subtitle: "Open a course someone shared with you. Nothing is recorded."

The tile opens `#/view`, the **Courses** screen:
- **Open a course file**: a hidden `<input type="file" accept=".gpx,.geojson,.json,application/gpx+xml">`.
  In the Capacitor WebView this opens the Android document picker (Downloads, Drive,
  Messages attachments saved to Files, and so on).
- **A list of courses opened before**, newest first, with:
  - a thumbnail (`ui/thumb.js`)
  - the label and "shared by AR"
  - distance and climb
  - a delete action (swipe or ⋯ menu)

### Storage

Courses are **not workouts**. They must never show up in History, Insights, routines,
goal prediction or sync.

- Each course is saved as its original text with Capacitor Filesystem
  (`Directory.Data`, `courses/<id>.gpx`).
- A small index is kept in Preferences (`courses.v1`: id, label, sharedBy, activity,
  distance, gain, addedAt, preview polyline). No SQLite schema change is needed.
- The browser build stores the same data in IndexedDB.
- Opening the same file twice (same content hash) reuses the existing entry.

### Parsing (`parseCourse`)

- **Accepts:**
  - GPX `<trk>`, with each `<trkseg>` as a segment
  - GPX `<rte>`, as one segment
  - GeoJSON `LineString` / `MultiLineString` with `[lon, lat, alt]`
- **Ignores** any `<time>`, speed or heart-rate data, even in a full-data GPX from
  another app. The viewer is course-only by design.
- **Returns a `CourseTrack`:** `{ n, lat, lon, alt, dist, seg }` with cumulative distance
  and no `t`, `speed`, `active` or `hr`.
- Altitude is lightly smoothed (`geo/process.js → smoothAltitude`, GPS profile) when the
  file came from elsewhere. Locale's own files are already smooth.
- **Rejects** files with fewer than 2 points or over 50,000 points, and coordinates out of
  range, with a clear message.
- XML is read with the browser's `DOMParser`, so no new dependency is needed.

### Course screen: `#/course/:id`

Laid out like workout detail, with only two tabs: **Map** and **3D**.

- **Header:**
  - the label
  - "Shared by AR" and the activity icon
  - distance, climb, descent, and min/max altitude
- **Map:** `mountMapView(panel, { course: true, … })`
  - **Line:** one colour, the activity's colour or the accent if there's no activity, at
    the same width. No speed ramp and no legend.
  - **Readout** (one line, as now): distance · **Alt** · **Grade** · **Climb so far**
    (cumulative gain to the cursor). No time, pace, speed or ♥.
  - **Distance-marker popovers:** distance, altitude, and latitude/longitude. No split
    time, clock time or pace.
  - **Elevation profile:** altitude against distance. The heart-rate line and the
    speed-tinted fill are off.
- **3D:** `mountView3D(panel, { course: true, … })`
  - The line is one colour. Today it uses `rampRGB` on speed.
  - Exaggeration, satellite imagery and distance markers work as now. Marker labels show
    distance and altitude.
  - **Smooth** must work without time. `view3d/smooth.js` uses a 10-second
    time-weighted window, so courses get the equivalent window over distance instead
    (about 25 m) via `smoothForDisplay(track, cols, { by: 'distance' })`.

### Changes needed in the shared views

| Module | Today | Course mode |
|---|---|---|
| `map/mapView.js` | `speedRange`, `rampCSS` and a speed-coloured line; the legend; a readout with time and pace; split times in popovers (`m.active`) | One colour, no legend, readout of distance / alt / grade / climb, popovers without times |
| `ui/popover.js → markerInfoHTML` | Shows time and clock time | An option to leave them out |
| `profile/elevationProfile.js` | Heart-rate overlay and HR in the cursor label | Off when there's no `hr` (already the case), and no time in the label |
| `view3d/view3d.js` | `speedRange` / `rampRGB` per point | One colour |
| `view3d/smooth.js` | Time window | A distance window when there's no `t` |

These become small `course` branches inside the existing views, not copies of them. A
test passes a `CourseTrack` (no `t`, `speed`, `active` or `hr`) through the map readout,
popover and 3D builders and checks no `NaN` or time strings appear.

## 5. Opening straight from Messages, Gmail or Files (phase 2)

Tapping the `.gpx` attachment should offer **Open with Locale**:
- **Manifest:** an `ACTION_VIEW` intent filter for `application/gpx+xml`, and
  `application/octet-stream` / `*/*` with `pathPattern=".*\\.gpx"`, because mail clients
  often send GPX as octet-stream.
- **Native:** a small `LocaleCourses` plugin method `readIncoming()` returns the content
  URI's text, read through `ContentResolver`, and `MainActivity` passes new intents to JS.
- **JS:** an `appUrlOpen`-style listener in `main.js` saves the course and navigates to
  `#/course/:id`.

This is phase 2 because phase 1 already works through Files plus the View tile.

## 6. Phases

1. **Format and share:**
   - `courseFile.js` (write, filename, parse) with tests
   - the profile name and initials
   - Share course in the detail Share sheet
   - tests round-trip a synthetic workout and assert no `<time>`, speed, heart rate,
     notes or device in the output
2. **View:**
   - the home tile
   - the Courses screen and storage
   - the course screen with Map and 3D in course mode
   - the distance-based smoothing
   - README section and screenshots
3. **Open with Locale:** the intent filter, the native read, and routing.

## 7. Tests

- **Writer:**
  - no timing, performance or personal fields
  - valid GPX 1.1 (parsed back by `fast-xml-parser` in tests)
  - segments preserved
  - the point cap respected
  - distance after thinning within 0.5%
  - altitude extremes within 2 m
- **Filename:** initials from different name forms, illegal characters, length cap.
- **Parser:**
  - Locale's own files
  - a full-data GPX (timing ignored)
  - `<rte>` files and GeoJSON
  - malformed and empty files
  - mixed segments
- **Course mode:** the readout, popovers and 3D colours with a `CourseTrack` (no time
  strings, no `NaN`); smoothing by distance.
- **On device:**
  - share by Messages to the second phone and open via Files → View
  - Gmail attachment and Quick Share
  - check the map and 3D on the Pixel

## 8. Decisions for the user

1. **Initials:** from a new "Your name" profile field (proposed), or typed when sharing?
2. **Start and finish trimming** (§3): offer it off by default (proposed), on by default,
   or leave it out?
3. **Filename separator:** `AR Bondi loop.gpx` (proposed) or `AR - Bondi loop.gpx`?
4. **Keep opened courses** in a list (proposed), or view them once without saving?
5. **Later:** follow a course live (a "course" goal with off-route alerts, reusing
   `RouteGuard`)? It is out of scope here, but the format keeps it possible.
