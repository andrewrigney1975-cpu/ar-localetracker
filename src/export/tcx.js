import { activity } from '../activities.js';
import { estimateCalories } from '../stats/physio.js';
import { computeSplits } from '../stats/summary.js';
import { esc, fixed, iso } from './xml.js';

/** Garmin Training Center XML v2. One lap per 1 km split; heart rate and calories when available. */
export function toTCX(workout, track, { profile } = {}) {
  const sport = activity(workout.activity).tcxSport;
  const total = track.n ? track.dist[track.n - 1] : 0;
  let splits = computeSplits(track, 1000, workout.summary?.hasBarometer);
  if (!splits.length) splits = [{ startDistance: 0, endDistance: total, time: 0, maxSpeed: 0 }];

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" ' +
      'xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">'
  );
  lines.push('  <Activities>');
  lines.push(`    <Activity Sport="${sport}">`);
  lines.push(`      <Id>${iso(workout.startedAt)}</Id>`);

  let i = 0;
  splits.forEach((lap, li) => {
    const last = li === splits.length - 1;
    const from = i;
    while (i < track.n && (last || track.dist[i] < lap.endDistance)) i++;
    const startTime = from < track.n ? track.t[from] : workout.startedAt;
    lines.push(`      <Lap StartTime="${iso(startTime)}">`);
    lines.push(`        <TotalTimeSeconds>${fixed(lap.time, 1)}</TotalTimeSeconds>`);
    lines.push(`        <DistanceMeters>${fixed(lap.endDistance - lap.startDistance, 1)}</DistanceMeters>`);
    lines.push(`        <MaximumSpeed>${fixed(lap.maxSpeed, 2)}</MaximumSpeed>`);
    lines.push(`        <Calories>${lapCalories(track, from, i, workout, profile)}</Calories>`);
    if (lap.avgHr != null) lines.push(`        <AverageHeartRateBpm><Value>${Math.round(lap.avgHr)}</Value></AverageHeartRateBpm>`);
    if (lap.maxHr != null) lines.push(`        <MaximumHeartRateBpm><Value>${Math.round(lap.maxHr)}</Value></MaximumHeartRateBpm>`);
    lines.push('        <Intensity>Active</Intensity>');
    lines.push('        <TriggerMethod>Distance</TriggerMethod>');
    if (i > from) {
      lines.push('        <Track>');
      for (let k = from; k < i; k++) {
        lines.push('          <Trackpoint>');
        lines.push(`            <Time>${iso(track.t[k])}</Time>`);
        lines.push('            <Position>');
        lines.push(`              <LatitudeDegrees>${track.lat[k].toFixed(7)}</LatitudeDegrees>`);
        lines.push(`              <LongitudeDegrees>${track.lon[k].toFixed(7)}</LongitudeDegrees>`);
        lines.push('            </Position>');
        const ele = fixed(track.alt[k], 1);
        if (ele != null) lines.push(`            <AltitudeMeters>${ele}</AltitudeMeters>`);
        lines.push(`            <DistanceMeters>${fixed(track.dist[k], 1)}</DistanceMeters>`);
        if (track.hr && Number.isFinite(track.hr[k])) {
          lines.push(`            <HeartRateBpm><Value>${Math.round(track.hr[k])}</Value></HeartRateBpm>`);
        }
        const speed = fixed(track.speed[k], 2);
        if (speed != null) lines.push(`            <Extensions><ns3:TPX><ns3:Speed>${speed}</ns3:Speed></ns3:TPX></Extensions>`);
        lines.push('          </Trackpoint>');
      }
      lines.push('        </Track>');
    }
    lines.push('      </Lap>');
  });
  if (workout.notes) lines.push(`      <Notes>${esc(workout.notes)}</Notes>`);
  lines.push(
    '      <Creator xsi:type="Device_t"><Name>Locale Exercise Tracker</Name><UnitId>0</UnitId><ProductID>0</ProductID>' +
      '<Version><VersionMajor>1</VersionMajor><VersionMinor>0</VersionMinor><BuildMajor>0</BuildMajor><BuildMinor>0</BuildMinor></Version></Creator>'
  );
  lines.push('    </Activity>');
  lines.push('  </Activities>');
  lines.push('</TrainingCenterDatabase>');
  return lines.join('\n') + '\n';
}

/** Calories for track indices [from, to); 0 without a complete profile. */
function lapCalories(track, from, to, workout, profile) {
  if (!profile || to - from < 2) return 0;
  const slice = {};
  for (const [k, v] of Object.entries(track)) slice[k] = ArrayBuffer.isView(v) ? v.subarray(from, to) : v;
  slice.n = to - from;
  const est = estimateCalories(slice, workout.activity, profile, workout.startedAt);
  return est ? Math.round(est.kcal) : 0;
}
