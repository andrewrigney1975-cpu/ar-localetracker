# Plan: migrate workout storage from IndexedDB to SQLite

Status: proposal (October 2026). Backlog item 2.

## 1. Questions answered

### Does IndexedDB have a size limit that SQLite would fix?

**Not in practice. Size is not the reason to migrate.**

| | Measured on the Pixel 10a (Android 17, WebView/Chrome 154) |
|---|---|
| IndexedDB quota for Locale | **10.7 GB**, about 10% of the 109 GB data partition. Android WebView gets far less than desktop Chrome's documented 60% of disk per origin. |
| Current use | 1.2 MB for 2 workouts (3.6 h, 13,989 points) |
| Cost per hour of workout | **~380 KB/h**: ~240 KB columnar track + ~140 KB gzipped raw journal |
| Capacity at that rate | about **28,000 hours** of recording |
| `navigator.storage.persisted()` | **false**: the WebView denied Locale's `persist()` request |

SQLite has no quota beyond free disk space, so it does remove the ceiling. But nobody
will reach 10.7 GB. The finding that matters is the last row. The data is stored as
**best-effort**, which the storage spec says the engine may evict under storage pressure.
Chromium's eviction is LRU, least-recently-used origin first (MDN).

Data loss from this is unlikely: Chrome reports eviction is rare, and a WebView's data
lives inside the app's private storage. Still, the platform doesn't promise to keep it.
An SQLite file in the app's `databases/` folder is ordinary app data. Android only
deletes it when the user clears app storage or uninstalls the app.

### What SQLite does fix

1. **Durability:** app-owned data that is never quota-evicted. This is the main safety gain.
2. **Native access:** Java can read and write workouts without the WebView. This is the
   main feature gain.
   - **Finalize workouts natively.** Today a workout stopped from the watch, a widget or the
     notification stays in a journal until the app is next opened and JS imports it. With
     SQLite, `TrackingService` can save it immediately.
   - Widgets can show "last workout" and weekly totals. Voice announcements (backlog 4)
     could compare against personal bests. The watch could show recent history.
3. **Queries:** totals by week or month, personal bests and "longest ride" become SQL,
   instead of loading every record into JS.
4. **Tooling:** a standard `.db` file you can inspect with any SQLite tool (`adb pull` on a
   debug build), and back up or restore as one file.

It does **not** fix backups by itself. Android Auto Backup is capped at **25 MB per app**,
whichever storage is used. A full backup needs its own feature, e.g. "Export all
workouts" to a zip (see §7).

### Is it feasible?

**Yes, at moderate effort.** Storage is already isolated behind one module
(`src/db/workouts.js`: `saveWorkout`, `listWorkouts`, `getWorkout`, `getTrack`,
`getRawJournal`, `updateWorkout`, `deleteWorkout`, `hasWorkout`). The views don't touch
IndexedDB directly, so the change is mostly a new backend behind that interface plus a
one-time migration.

### Can existing data be migrated?

**Yes, without loss.** Everything in IndexedDB is plain data:
- workout records (JSON)
- tracks (typed arrays)
- raw journals (gzip blobs)

All of it can be copied byte for byte, then verified before the old copy is retired.
§5 has the procedure.

## 2. Options

| | A. Extend `LocaleTrackerPlugin` with a Java `WorkoutStore` (SQLiteOpenHelper) | B. `@capacitor-community/sqlite` 8.1.1 (Capacitor 8 compatible) |
|---|---|---|
| New dependencies | None | Plugin; its web build needs `jeep-sqlite` + `sql.js` WASM |
| Native code (service, widgets, watch) reads/writes | Direct, same schema in one place | Possible (it's a normal SQLite file), but the schema is owned by JS |
| Native finalization of workouts | Natural fit | Would need the schema duplicated in Java |
| Browser dev mode (simulator) | Keep the IndexedDB backend for web | Plugin's WASM web layer, or keep IndexedDB |
| JS API | Small, purpose-built calls (`saveWorkout`, `listWorkouts`, …) | Generic SQL from JS |

**Recommendation: A.** Locale already owns a native plugin and service. Native
finalization is the biggest benefit, and that wants the schema in Java. The JS side keeps
its current API. `db/workouts.js` picks the native store on Android and stays on
IndexedDB in the browser, so the simulator workflow is unchanged.

## 3. Schema (version 1)

```sql
CREATE TABLE workouts (
  id            TEXT PRIMARY KEY,
  activity      TEXT NOT NULL,
  name          TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  started_at    INTEGER NOT NULL,      -- epoch ms
  ended_at      INTEGER,
  distance_m    REAL,                  -- denormalised from summary for queries
  duration_s    REAL,
  summary_json  TEXT NOT NULL,         -- full summary object as today
  record_json   TEXT NOT NULL,         -- remaining fields (preview, device, tzOffset, …)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER
);
CREATE INDEX workouts_started ON workouts(started_at DESC);
CREATE INDEX workouts_activity ON workouts(activity, started_at DESC);

CREATE TABLE tracks (
  workout_id  TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  format      INTEGER NOT NULL DEFAULT 1,  -- columnar layout version
  columns     BLOB NOT NULL,               -- packed typed arrays (see below)
  crc32       INTEGER NOT NULL
);

CREATE TABLE raw_journals (
  workout_id  TEXT PRIMARY KEY REFERENCES workouts(id) ON DELETE CASCADE,
  gzip        BLOB NOT NULL,
  crc32       INTEGER NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- schema_version, migrated_from_idb, …
```

- **Tracks stay columnar,** one row per workout. One row per GPS point would be ~14k rows
  per workout and slower to load. Packing: a small header (field names, typed-array kind,
  length), then each array's bytes, little-endian. Encode/decode lives in JS
  (`db/trackCodec.js`) and, later, Java for native finalization.
- **Bridge transport:** BLOBs cross the Capacitor bridge as base64, about 1.33× size. A
  1-hour track (~240 KB) is ~320 KB of base64, a few tens of milliseconds. History lists
  never load tracks.
- **WAL mode** on, and `foreign_keys` on.

## 4. Implementation steps

1. **`WorkoutStore.java`** (`SQLiteOpenHelper`, schema above, migrations by version).
   Plugin methods that mirror `db/workouts.js`:
   - `saveWorkout`, `listWorkouts`, `getWorkout`, `getTrack`, `getRawJournal`,
     `updateWorkout`, `deleteWorkout`, `hasWorkout`
   - `bulkImport` and `stats` for the migration

   Run DB work on a background executor, never the UI thread.
2. **`db/trackCodec.js`:** pack/unpack the columnar track to/from a single `Uint8Array`,
   plus CRC32. Unit tests must round-trip every field, including optional `hr`.
3. **`db/workouts.js`:** split into `idbStore.js` (today's code) and `nativeStore.js`
   (plugin calls). The exported API stays identical, and views are unchanged.
4. **Migration runner** (`db/migrate.js`), run once at boot before seeding (§5).
5. **Native finalization** (follow-up PR): on stop, `TrackingService` parses its journal,
   builds the summary and track, and writes them to SQLite.
   - Ports the processing from `geo/process.js` and `stats/summary.js` to Java. That's the
     largest piece.
   - Alternative: keep JS processing, but run it in a background WebView or headless JS.
     Not recommended.

   Until this exists, journal import in JS simply writes through `nativeStore.js`.
6. **Remove the IndexedDB data** two releases after the migration ships (§5, step 6).

## 5. Data migration procedure

Runs at app start, before the router renders. It shows "Updating your workouts…" only
if it takes more than ~300 ms.

1. If `meta.migrated_from_idb` is set in SQLite, **skip.**
2. Open IndexedDB `locale` and read workout IDs from the `workouts` store.
3. For each workout, in batches of ~10 per bridge call:
   - read the workout record, track and raw journal
   - pack the track and compute its CRC32
   - call `bulkImport`, which **upserts** by ID inside one SQLite transaction per batch.

   Interrupting and re-running is harmless (idempotent).
4. **Verify:**
   - Counts match per store.
   - For each workout, native returns the stored `n` and CRC32, and they match what JS sent.
   - Spot-check: decode one track back and compare `dist[n-1]` and `t[n-1]`.
5. On success, set `meta.migrated_from_idb = <timestamp>` and an IndexedDB marker. From
   now on reads come from SQLite. **IndexedDB is left untouched.**
6. Two releases later, a cleanup step deletes the IndexedDB database, if
   `migrated_from_idb` is older than 30 days.

**Failure handling:** if any step fails, stay on IndexedDB for this session. Log the
error, and retry next launch. Partial SQLite rows are overwritten by the next upsert.

Seed and sample data: the City2Surf sample migrates like any other workout. The
`seed.*` flags in Capacitor Preferences are unaffected.

## 6. Testing

- **Unit (Vitest):**
  - track codec round-trip
  - CRC32 known vectors
  - migration runner against an in-memory fake native store: verify, idempotency,
    partial failure and resume
- **Instrumented (Android, JUnit):** `WorkoutStore` CRUD, schema upgrade from v1 to v2,
  cascade deletes, a 50k-point track blob.
- **On device:**
  - Install the current release, record 2–3 workouts (including heart rate), upgrade, and
    check that every workout, track, export and 3D view is identical. Compare FIT exports
    before and after byte for byte.
  - Kill the app mid-migration, then relaunch.
  - Low-storage case: fill storage, then migrate (it must not lose IndexedDB data).

## 7. Related follow-ups (not part of this migration)

- **Backup and restore:** "Export all workouts" to a zip (FIT/GPX per workout plus a JSON
  manifest), and import it. This is the real answer for phone changes, because Auto
  Backup's 25 MB cap would only hold ~65 hours.
- **Totals and personal bests** on the History screen, using the new SQL indexes.

## 8. Effort and risk

| Step | Estimate |
|---|---|
| WorkoutStore + plugin methods | 1–1.5 days |
| Track codec + nativeStore + store switch | 0.5–1 day |
| Migration runner + verification + tests | 1 day |
| On-device upgrade testing | 0.5 day |
| **Subtotal (migration)** | **3–4 days** |
| Native finalization (port processing to Java) | +2–3 days, optional follow-up |

**Risks:**
- **Bridge payload size for very long workouts:** a 10-hour ski day is ~3 MB of base64.
  Mitigation: chunked `getTrack` if needed.
- **Two processing implementations once native finalization lands.** Mitigation: shared
  test fixtures (synthetic journals) that both the JS and Java implementations must match
  to the metre.
- **Migration bugs.** Mitigation: IndexedDB is kept read-only for two releases, giving an
  instant rollback path.

## Sources

- MDN, *Storage quotas and eviction criteria*: per-origin 60% of disk in Chromium
  browsers, LRU eviction of best-effort origins, `persist()` exemption.
  https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- web.dev, *Storage for the web*: eviction is rare in practice; `persist()` is granted
  automatically by heuristics. https://web.dev/articles/storage-for-the-web
- Measurements: `navigator.storage.estimate()`/`persisted()` and IndexedDB contents, read
  from the Locale WebView on a Pixel 10a over Chrome DevTools (October 2026).
