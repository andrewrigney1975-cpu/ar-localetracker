# Plan: predict goal distances from workout history

Status: **proposed** (October 2026). Builds on voice announcements (backlog item 4).

**Goal:** Locale learns your routines and sets the goal distance itself. A routine is the
same activity from about the same place, at about the same time of week, over about the
same route, for example "Saturday 7 am lake loop, 4.7 km" or "Tuesday evening river run,
8 km". When the app is confident, it sets the goal and announces 25%, 50%, 75% and 100%
of it. When it isn't confident, it stays silent rather than guess.

## 1. What we have to learn from

Every saved workout record (SQLite `record_json`, or IndexedDB in the browser) already
has everything needed. Nothing has to be loaded from the tracks:

| Field | Use |
|---|---|
| `activity` | Routines are learned separately for each activity |
| `startedAt`, `tzOffset` | Local weekday and time of day |
| `preview` (≤120 `[lon, lat]` points, Douglas–Peucker) | Start point, end point, route shape, loop or one-way |
| `summary.distance`, `summary.duration` | The value being predicted, and the usual pace |
| `summary.bbox` | A cheap first check that two routes could match |

Leave out of training:
- the City2Surf sample (`sample-*` ids)
- workouts under 500 m or under 3 minutes (false starts)
- workouts the user marks "Not a routine" (§6)

Today the phone has only a few real workouts, so the feature will stay **dormant** at
first. That is intended: it switches itself on once the thresholds in §3.4 are met. Tests
use generated histories (§7).

## 2. Architecture

```
saved workouts ──► src/insights/routines.js ──► model JSON ──► Preferences "routines.v1"
   (JS: clustering, stats)       (rebuilt after each sync/save and at app start)
                                                     │
TrackingService start / first good fix ──► RoutineMatcher.java (reads the model) ──► VoiceCoach goal
```

- **Learn in JS, match natively.**
  - Clustering is the complex part, so it runs once, in one language, whenever the
    workout list changes. That covers the end of `syncWorkouts()`, a save, a delete and
    app start; for a few hundred workouts it takes milliseconds.
  - The result is a small JSON model of routines and their statistics. It is stored with
    `@capacitor/preferences`, so `PhoneSettings`-style code can read it from
    `CapacitorStorage`.
- **Match in `TrackingService`**, so workouts started from the watch and widgets get a
  predicted goal too. The matcher is small and pure (no Android types). A shared fixture
  keeps it identical to the JS version, the same way `VoiceCoach` and `voice.json` do.
- **Staleness:** a workout saved natively while the app is closed only reaches the model
  the next time the app opens. That's one workout behind, which is acceptable. Phase 3
  can add a native "model is stale" flag if it turns out to matter.

## 3. Learning routines

### 3.1 Features per workout
- **Local start:** weekday (0–6) and minute of day, from `startedAt − tzOffset`.
- **Start point and end point:** first and last preview points. **Loop** if they are
  within 200 m of each other.
- **Route signature:** the preview resampled to 32 points evenly spaced by distance,
  projected to metres around the start point.
- **Distance** and **duration**.

### 3.2 Route similarity
Two workouts follow the same route when all of these hold:
1. Start points are within **300 m**.
2. Distances are within **±12%**.
3. The mean closest-point distance between the two route signatures, taken in both
   directions and averaged, is at most **max(120 m, 4% of the distance)**.

A reversed loop counts as the same route: compare against the reversed signature as
well and take the better result.

### 3.3 Clustering into routines
- **Method:** for each activity, run single-pass agglomerative clustering on the
  similarity above. Process workouts in date order; a workout joins the cluster whose
  medoid it matches best, otherwise it starts a new cluster. Recompute medoids at the end
  and do one reassignment pass. With n up to a few hundred, the O(n²) comparison is fine.
- **Statistics kept per routine:**
  - Count; recency-weighted count (half-life **60 days**); last used.
  - Median distance and coefficient of variation (CV).
  - Median duration.
  - Typical start time: circular mean and spread of minute-of-day.
  - Weekday histogram, with weekdays and weekends pooled when sparse.
  - Medoid start point and route signature (for the deviation check in phase 2).
  - An auto name: "Saturday morning · 4.7 km loop".
- **Time-only fallback:** a separate pattern for each activity × day type (weekday or
  weekend) × time-of-day bucket. It stores a recency-weighted median distance and spread,
  and is used when there is no start location or no route cluster matches.

### 3.4 When there is "enough history"
Initial thresholds, to be tuned with the replay evaluation in §7:
- **Activity:** at least **5** usable workouts in the last 180 days.
- **Routine:** at least **3** workouts, at least **2** in the last 60 days, and distance
  CV of at most **12%**.
- **Time-only fallback:** at least **4** workouts in the bucket and CV of at most **10%**.
  This is stricter because there is no route evidence.

## 4. Predicting at the start of a workout

1. **At start:** load the model and read the activity, the local weekday and minute, and
   the last known location if it is less than 2 minutes old.
2. **Wait for location:** if there is no recent location, decide at the **first fix with
   accuracy ≤ 30 m**, or after **90 s** using the time-only fallback. The 25% milestone is
   far enough away that a late decision costs nothing. If the decision lands after some
   distance is covered, mark the milestones already passed as done (`syncTo`), so nothing
   is announced late.
3. **Score candidates:** a routine is a candidate if its start is within 300 m of the
   location. Its score is:
   - recency-weighted count
   - × time match: Gaussian on minute-of-day difference, σ = 75 min
   - × weekday factor: 1.0 same weekday, 0.6 same day type, 0.3 otherwise
4. **Confidence:** normalise the scores. Accept the top routine only if it has at least
   **0.6** of the total and leads the second by at least **0.2**. Otherwise use the
   time-only fallback if it qualifies. Otherwise set **no goal**.
5. **Goal value:** the routine's median distance, rounded to 0.1 km (or 0.1 mi). It is not
   rounded to whole kilometres, because percentages of a 4.7 km loop should land where
   the user actually is.
6. **Confirmation, spoken once** after the decision. Example: *"Goal 4.7 kilometres, your
   usual Saturday morning loop."* It also shows as the live-screen caption, and in the
   notification as "Goal 4.7 km".

**Precedence:**
- A goal set by hand on the start screen always wins.
- An auto goal applies only when the activity's goal mode is **Auto** (§6).

## 5. During the workout (phase 2)

- **Leaving the route:** compare live fixes with the routine's medoid signature. If the
  user is more than **250 m** from it for more than **2 minutes**, stop goal milestones
  and say once: *"Off your usual route. Goal announcements paused."* Splits and time
  announcements carry on.
- **Going past the goal:** after 100%, say nothing more about the goal. A finished
  workout that ran well past the goal still feeds the model, which will drift if the user
  keeps going further.
- **Record the prediction** with the workout:
  `record.prediction = { goalM, routineId, confidence, source: 'route'|'time'|'manual' }`.
  This supports the accuracy display and any later tuning.

## 6. Settings and UI

- **Settings → Voice announcements:** the per-activity **Goal** chip becomes three-way:
  **Off · Set · Auto**. The default is **Auto** for walk, run and cycle once the feature
  ships, and Off for ski, where distance goals mean little.
- **Start screen:**
  - With Auto and a confident match, the goal picker shows
    *"Auto · 4.7 km · usual Saturday loop"*. Tapping − or + switches to a manual goal for
    this workout.
  - Without a confident match it shows *"Auto · learning (3 of 5 workouts)"*.
  - The start screen predicts from the warm-up GPS fix, so this works before Start.
- **Settings → Learned routines** (new list):
  - name, count, usual time, median distance and hit rate
  - **Rename**
  - **Forget**, which excludes those workouts from learning
- **Workout detail:** a small "Goal 4.7 km (auto) · finished 4.72 km ✓" line.
- **Watch:** no changes in v1. Phase 3 could show the goal and a progress ring on the
  watch.

## 7. Testing and evaluation

- **History generator** (`tests/helpers/history.js`): builds synthetic workout records
  with known routines, for example:
  - Saturday 7:00 lake loop 4.7 km ± 2%
  - Tuesday and Thursday 18:15 river run 8 km ± 4%
  - Sunday ride 40 km
  - random one-off workouts and noise
  - time-zone changes, and reversed loops
- **Unit tests:**
  - route similarity: same, reversed, partial overlap, different routes
  - clustering finds the planted routines
  - thresholds: no prediction with 2 workouts, a prediction with 3+
  - confidence margins: two routines from the same start at similar times leads to no goal
  - manual goal precedence
  - `syncTo` when the decision is late
- **Replay evaluation** (`scripts/evaluate-goals.mjs`):
  - Method: walk through the history in date order. Predict each workout from earlier
    workouts only, then compare with the actual distance.
  - Report:
    - **coverage** (how often a goal is set)
    - **precision** (actual within ±10% of the goal)
    - **false-goal rate**
  - **Shipping bar:** at least 85% precision on the generated histories, and no goal
    on noise-only histories. Run it on the real phone history as data builds up.
- **JS ↔ Java fixture** (`fixtures/routines.json`): a model plus start situations and
  the expected goal for each. `RoutineMatcherTest` replays it, like `VoiceCoachTest`.
- **On device:** seed a history of generated workouts into a debug build, start
  workouts from the phone, the watch and a widget, and confirm the spoken confirmation
  and the milestones.

## 8. Phases

| Phase | Scope |
|---|---|
| **1. Learn and predict** | `insights/routines.js` (features, similarity, clustering, model); model rebuild hooks; `RoutineMatcher.java` and fixture; goal decision in `TrackingService` (start or first fix, with fallback); spoken confirmation; Goal chip Off·Set·Auto; start-screen auto label; history generator, unit tests and replay script |
| **2. During the workout** | Route-deviation pause; `record.prediction` and the detail-screen line; Settings → Learned routines (rename, forget) |
| **3. Polish** | Hit-rate feedback that tunes thresholds per user; native stale-model flag; watch goal display |

**Rough size:**
- phase 1: about 900 lines JS and 300 lines Java, plus tests
- phase 2: about 400 lines

## 9. Risks

- **Wrong goals annoy people:** the conservative thresholds and the margin rule favour
  silence over wrong guesses. Each prediction is spoken once and can be changed on the
  start screen.
- **Sparse or changing habits:** the 60-day recency weighting lets new routines take
  over. Old routines fade, but **Forget** is there too.
- **Shared start points:** for example several routes from home. Time of day and weekday
  separate them. If they still can't be told apart, the margin rule sets no goal and
  waits for the route-deviation data in phase 2.
- **Privacy:** everything stays on the device. The model holds only start points and
  coarse route shapes that are already in the workout records.

## 10. Decisions

1. **Spoken confirmation at the start:** on by default; a setting can turn it off.
2. **Auto is the default goal mode** for walk, run and cycle (ski: Off). The user can
   switch it off or to a manual goal per activity.
3. **Round-number goals win** when the history clusters around one, e.g. 4.9–5.1 km is
   announced as "5 kilometres".
