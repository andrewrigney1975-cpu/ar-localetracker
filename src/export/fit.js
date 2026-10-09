// Garmin FIT activity file encoder (FIT protocol 2.0), no dependencies.
//
// Writes: file_id, event (timer start/stop, including manual pauses), record (1 per fix),
// lap (one per 1 km split), session and activity. Uses only long-standing profile fields,
// so Strava, Garmin Connect, TrainingPeaks etc. read it.

import { caloriesForRange, estimateCalories } from '../stats/physio.js';
import { computeSplits } from '../stats/summary.js';

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
export const FIT_EPOCH_OFFSET = 631065600;
const SEMICIRCLES = 2 ** 31 / 180;

const T = {
  enum: { id: 0x00, size: 1, invalid: 0xff, min: 0, max: 0xfe },
  uint8: { id: 0x02, size: 1, invalid: 0xff, min: 0, max: 0xfe },
  uint16: { id: 0x84, size: 2, invalid: 0xffff, min: 0, max: 0xfffe },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff, min: -0x7fffffff, max: 0x7ffffffe },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff, min: 0, max: 0xfffffffe },
  uint32z: { id: 0x8c, size: 4, invalid: 0, min: 1, max: 0xffffffff },
};

// Global message numbers and enums from the FIT profile.
const MESG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 };
const SPORT = { walk: 11, run: 1, cycle: 2, ski: 13 };
const EVENT = { timer: 0, session: 8, lap: 9, activity: 26 };
const EVENT_TYPE = { start: 0, stop: 1, stopAll: 4 };
const LAP_TRIGGER_DISTANCE = 2;
const LAP_TRIGGER_SESSION_END = 7;

export const fitTime = (ms) => Math.round(ms / 1000) - FIT_EPOCH_OFFSET;
const semicircles = (deg) => (Number.isFinite(deg) ? Math.round(deg * SEMICIRCLES) : null);
const scaled = (v, scale, offset = 0) => (Number.isFinite(v) ? Math.round((v + offset) * scale) : null);

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

export function fitCrc(bytes, crc = 0) {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/** Minimal FIT record writer: one local message type per message definition. */
class FitWriter {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
    this.locals = new Map();
  }

  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** @param {Array<[number, keyof T]>} fields */
  define(name, globalNum, fields) {
    const local = this.locals.size;
    if (local > 15) throw new Error('Too many FIT local message types');
    this.locals.set(name, { local, fields: fields.map(([num, type]) => ({ num, type: T[type] })) });
    this.ensure(6 + fields.length * 3);
    const b = this.buf;
    b[this.len++] = 0x40 | local; // definition message header
    b[this.len++] = 0; // reserved
    b[this.len++] = 0; // little-endian
    b[this.len++] = globalNum & 0xff;
    b[this.len++] = (globalNum >> 8) & 0xff;
    b[this.len++] = fields.length;
    for (const [num, type] of fields) {
      b[this.len++] = num;
      b[this.len++] = T[type].size;
      b[this.len++] = T[type].id;
    }
  }

  write(name, values) {
    const def = this.locals.get(name);
    this.ensure(1 + def.fields.reduce((a, f) => a + f.type.size, 0));
    const view = new DataView(this.buf.buffer);
    this.buf[this.len++] = def.local;
    def.fields.forEach((f, i) => {
      let v = values[i];
      if (v == null || !Number.isFinite(v)) v = f.type.invalid;
      else v = Math.min(f.type.max, Math.max(f.type.min, Math.round(v)));
      switch (f.type.size) {
        case 1:
          view.setUint8(this.len, v);
          break;
        case 2:
          view.setUint16(this.len, v, true);
          break;
        default:
          if (f.type === T.sint32) view.setInt32(this.len, v, true);
          else view.setUint32(this.len, v >>> 0, true);
      }
      this.len += f.type.size;
    });
  }

  /** Header + records + file CRC. */
  finish() {
    const data = this.buf.subarray(0, this.len);
    const out = new Uint8Array(14 + data.length + 2);
    const view = new DataView(out.buffer);
    out[0] = 14; // header size
    out[1] = 0x20; // protocol 2.0
    view.setUint16(2, 2140, true); // profile version 21.40
    view.setUint32(4, data.length, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    view.setUint16(12, fitCrc(out.subarray(0, 12)), true);
    out.set(data, 14);
    view.setUint16(14 + data.length, fitCrc(out.subarray(0, 14 + data.length)), true);
    return out;
  }
}

/** Lap index ranges [from, to) matching computeSplits' 1 km boundaries. */
function lapRanges(track, splits) {
  const ranges = [];
  let i = 0;
  splits.forEach((lap, li) => {
    const last = li === splits.length - 1;
    const from = i;
    while (i < track.n && (last || track.dist[i] < lap.endDistance)) i++;
    ranges.push([from, Math.max(from + 1, i)]);
  });
  return ranges;
}

/**
 * @param {object} workout  stored workout record (summary, startedAt, endedAt, activity, tzOffset)
 * @param {object} track    processed track
 * @param {{profile?: object}} [opts]
 * @returns {Uint8Array}
 */
export function toFIT(workout, track, { profile } = {}) {
  const w = new FitWriter();
  const n = track.n;
  const sm = workout.summary ?? {};
  const sport = SPORT[workout.activity] ?? 0;
  const startMs = n ? track.t[0] : workout.startedAt;
  const endMs = n ? track.t[n - 1] : workout.endedAt ?? workout.startedAt;
  const hasHr = Boolean(track.hr);

  w.define('fileId', MESG.fileId, [
    [0, 'enum'], // type
    [1, 'uint16'], // manufacturer
    [2, 'uint16'], // product
    [3, 'uint32z'], // serial_number
    [4, 'uint32'], // time_created
  ]);
  w.write('fileId', [4 /* activity */, 255 /* development */, 1, (fitTime(workout.startedAt) >>> 0) || 1, fitTime(workout.startedAt)]);

  w.define('event', MESG.event, [
    [253, 'uint32'],
    [0, 'enum'],
    [1, 'enum'],
    [4, 'uint8'], // event_group
  ]);
  w.define('record', MESG.record, [
    [253, 'uint32'],
    [0, 'sint32'], // position_lat
    [1, 'sint32'], // position_long
    [2, 'uint16'], // altitude (scale 5, offset 500)
    [3, 'uint8'], // heart_rate
    [5, 'uint32'], // distance (scale 100)
    [6, 'uint16'], // speed (scale 1000)
  ]);

  w.write('event', [fitTime(startMs), EVENT.timer, EVENT_TYPE.start, 0]);
  for (let i = 0; i < n; i++) {
    if (i > 0 && track.seg[i] !== track.seg[i - 1]) {
      // Manual pause: timer stop at the last fix, start at the first fix after resuming.
      w.write('event', [fitTime(track.t[i - 1]), EVENT.timer, EVENT_TYPE.stopAll, 0]);
      w.write('event', [fitTime(track.t[i]), EVENT.timer, EVENT_TYPE.start, 0]);
    }
    w.write('record', [
      fitTime(track.t[i]),
      semicircles(track.lat[i]),
      semicircles(track.lon[i]),
      scaled(track.alt[i], 5, 500),
      hasHr && Number.isFinite(track.hr[i]) ? track.hr[i] : null,
      scaled(track.dist[i], 100),
      scaled(track.speed[i], 1000),
    ]);
  }
  w.write('event', [fitTime(endMs), EVENT.timer, EVENT_TYPE.stopAll, 0]);

  // Laps: one per 1 km split (the last may be partial).
  const splits = computeSplits(track, 1000, sm.hasBarometer);
  const ranges = n ? lapRanges(track, splits) : [];
  w.define('lap', MESG.lap, [
    [254, 'uint16'], // message_index
    [253, 'uint32'],
    [0, 'enum'],
    [1, 'enum'],
    [2, 'uint32'], // start_time
    [3, 'sint32'],
    [4, 'sint32'],
    [5, 'sint32'],
    [6, 'sint32'],
    [7, 'uint32'], // total_elapsed_time (scale 1000)
    [8, 'uint32'], // total_timer_time (scale 1000)
    [9, 'uint32'], // total_distance (scale 100)
    [11, 'uint16'], // total_calories
    [13, 'uint16'], // avg_speed (scale 1000)
    [14, 'uint16'], // max_speed (scale 1000)
    [15, 'uint8'], // avg_heart_rate
    [16, 'uint8'], // max_heart_rate
    [21, 'uint16'], // total_ascent
    [22, 'uint16'], // total_descent
    [24, 'enum'], // lap_trigger
    [25, 'enum'], // sport
  ]);
  splits.forEach((lap, k) => {
    const [from, to] = ranges[k];
    const a = Math.min(from, n - 1);
    const b = Math.min(to - 1, n - 1);
    const kcal = caloriesForRange(track, from, to, workout.activity, profile, workout.startedAt);
    w.write('lap', [
      k,
      fitTime(track.t[b]),
      EVENT.lap,
      EVENT_TYPE.stop,
      fitTime(track.t[a]),
      semicircles(track.lat[a]),
      semicircles(track.lon[a]),
      semicircles(track.lat[b]),
      semicircles(track.lon[b]),
      scaled((track.t[b] - track.t[a]) / 1000, 1000),
      scaled(lap.time, 1000),
      scaled(lap.distance, 100),
      kcal,
      scaled(lap.avgSpeed, 1000),
      scaled(lap.maxSpeed, 1000),
      lap.avgHr,
      lap.maxHr,
      lap.elevGain,
      lap.elevLoss,
      k === splits.length - 1 ? LAP_TRIGGER_SESSION_END : LAP_TRIGGER_DISTANCE,
      sport,
    ]);
  });

  const total = estimateCalories(track, workout.activity, profile, workout.startedAt);
  w.define('session', MESG.session, [
    [254, 'uint16'],
    [253, 'uint32'],
    [0, 'enum'],
    [1, 'enum'],
    [2, 'uint32'], // start_time
    [3, 'sint32'],
    [4, 'sint32'],
    [5, 'enum'], // sport
    [6, 'enum'], // sub_sport
    [7, 'uint32'], // total_elapsed_time
    [8, 'uint32'], // total_timer_time
    [9, 'uint32'], // total_distance
    [11, 'uint16'], // total_calories
    [14, 'uint16'], // avg_speed
    [15, 'uint16'], // max_speed
    [16, 'uint8'], // avg_heart_rate
    [17, 'uint8'], // max_heart_rate
    [22, 'uint16'], // total_ascent
    [23, 'uint16'], // total_descent
    [25, 'uint16'], // first_lap_index
    [26, 'uint16'], // num_laps
    [28, 'enum'], // trigger
  ]);
  w.write('session', [
    0,
    fitTime(endMs),
    EVENT.session,
    EVENT_TYPE.stop,
    fitTime(startMs),
    n ? semicircles(track.lat[0]) : null,
    n ? semicircles(track.lon[0]) : null,
    sport,
    0,
    scaled((endMs - startMs) / 1000, 1000),
    scaled(sm.duration, 1000),
    scaled(sm.distance, 100),
    total ? Math.round(total.kcal) : null,
    scaled(sm.avgSpeed, 1000),
    scaled(sm.maxSpeed, 1000),
    sm.heartRate?.avg,
    sm.heartRate?.max,
    sm.elevGain,
    sm.elevLoss,
    0,
    splits.length,
    0, // activity_end
  ]);

  w.define('activity', MESG.activity, [
    [253, 'uint32'],
    [0, 'uint32'], // total_timer_time
    [1, 'uint16'], // num_sessions
    [2, 'enum'], // type: manual
    [3, 'enum'], // event
    [4, 'enum'], // event_type
    [5, 'uint32'], // local_timestamp
  ]);
  const tzOffsetMin = workout.tzOffset ?? new Date(workout.startedAt).getTimezoneOffset();
  w.write('activity', [
    fitTime(endMs),
    scaled(sm.duration, 1000),
    1,
    0,
    EVENT.activity,
    EVENT_TYPE.stop,
    fitTime(endMs) - tzOffsetMin * 60,
  ]);

  return w.finish();
}
