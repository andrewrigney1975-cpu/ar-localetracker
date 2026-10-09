// Verify an on-device IndexedDB → SQLite migration byte for byte.
//
//   node scripts/verify-migration.mjs <baseline-idb.json> <locale.db>
//
// baseline-idb.json is a dump of the app's IndexedDB taken before upgrading (every workout,
// every typed-array column and every raw journal, base64). locale.db is pulled from the
// device afterwards (with its -wal/-shm files alongside).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { renderExport } from '../src/export/index.js';
import { crc32, unpackTrack } from '../src/db/trackCodec.js';

const [, , baselinePath, dbPath] = process.argv;
const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const db = new DatabaseSync(dbPath, { readOnly: true });

const TYPES = { Float64Array, Float32Array, Uint16Array, Uint8Array };
const bytes = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) failures++;
};

const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
console.log(`SQLite: ${count('workouts')} workouts, ${count('tracks')} tracks, ${count('raw_journals')} raw journals`);
console.log(`migrated_from_idb = ${db.prepare("SELECT value FROM meta WHERE key='migrated_from_idb'").get()?.value}`);
check(count('workouts') === base.workouts.length, `workout count ${count('workouts')} = ${base.workouts.length}`);

for (const w of base.workouts) {
  console.log(`\n${w.id} (${w.name})`);
  const row = db.prepare('SELECT * FROM workouts WHERE id = ?').get(w.id);
  check(Boolean(row), 'row exists');
  if (!row) continue;
  const stored = { ...JSON.parse(row.record_json), summary: JSON.parse(row.summary_json) };
  check(JSON.stringify(sortKeys(stored)) === JSON.stringify(sortKeys(w)), 'workout record identical (all fields, incl. summary)');
  check(row.name === w.name && row.started_at === w.startedAt, 'denormalised columns match');

  const tr = db.prepare('SELECT * FROM tracks WHERE workout_id = ?').get(w.id);
  const blob = new Uint8Array(tr.columns);
  check(crc32(blob) === tr.crc32, `track CRC-32 ${tr.crc32.toString(16)} verifies`);
  const track = unpackTrack(blob);
  const bt = base.tracks[w.id];
  check(track.n === bt.n, `n = ${track.n}`);
  const names = Object.keys(bt.cols).sort();
  check(eq(Object.keys(track).filter((k) => k !== 'n').sort(), names), `columns: ${names.join(', ')}`);
  let allCols = true;
  for (const k of names) {
    const want = bytes(bt.cols[k].b64);
    const got = track[k];
    const gotBytes = new Uint8Array(got.buffer, got.byteOffset, got.byteLength);
    if (got.constructor.name !== bt.cols[k].type || !eq(gotBytes, want)) {
      allCols = false;
      console.log(`    column ${k} differs`);
    }
  }
  check(allCols, 'every column byte-identical');

  const raw = db.prepare('SELECT * FROM raw_journals WHERE workout_id = ?').get(w.id);
  check(Boolean(raw) && eq(new Uint8Array(raw.gzip), bytes(base.raw[w.id].b64)), `raw journal identical (${raw ? raw.gzip.length : 0} bytes gzip)`);

  // FIT export from each copy must be byte-identical.
  const baseTrack = { n: bt.n };
  for (const k of names) baseTrack[k] = new TYPES[bt.cols[k].type](bytes(bt.cols[k].b64).buffer);
  const profile = { birthYear: 1980, sex: 'male', weightKg: 78 };
  const fitA = renderExport('fit', w, baseTrack, { profile }).content;
  const fitB = renderExport('fit', stored, track, { profile }).content;
  check(eq(fitA, fitB), `FIT export identical (${fitA.length} bytes, CRC-32 ${crc32(fitA).toString(16)})`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
