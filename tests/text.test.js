import { describe, expect, it } from 'vitest';
import { smsUri, workoutShareText } from '../src/export/text.js';

const day = () => 'Sun, 9 Aug 2026';
const run = {
  name: 'City2Surf 2026',
  activity: 'run',
  startedAt: Date.UTC(2026, 7, 8, 22, 52),
  summary: {
    distance: 14370,
    duration: 5429,
    avgSpeed: 14370 / 5429,
    avgMovingSpeed: 14370 / 5429,
    elevGain: 242,
    heartRate: { avg: 149.4, max: 168 },
  },
};

describe('workout share text', () => {
  it('matches the backlog example for a run with heart rate and calories', () => {
    expect(workoutShareText(run, { calories: 1373.2, formatDay: day })).toBe(
      ['City2Surf 2026 — Run, Sun, 9 Aug 2026', '14.37 km in 1:30:29 · 6:18 /km avg', 'Climb +242 m · Avg HR 149 bpm · 1,373 kcal', 'Recorded with Locale'].join('\n')
    );
  });

  it('omits heart rate and calories when missing, and uses imperial units', () => {
    const text = workoutShareText({ ...run, summary: { ...run.summary, heartRate: undefined } }, { units: 'imperial', formatDay: day });
    expect(text).toContain('8.93 mi in 1:30:29');
    expect(text).toContain('/mi avg');
    expect(text).toContain('Climb +794 ft');
    expect(text).not.toMatch(/HR|kcal/);
  });

  it('uses speed for cycling and does not repeat the activity in the title', () => {
    const ride = { name: 'Evening Cycle', activity: 'cycle', startedAt: 0, summary: { distance: 30000, duration: 3600, avgMovingSpeed: 30000 / 3600, elevGain: 0 } };
    const text = workoutShareText(ride, { formatDay: day });
    expect(text.split('\n')[0]).toBe('Evening Cycle — Sun, 9 Aug 2026');
    expect(text).toContain('30.00 km in 1:00:00 · 30.0 km/h avg');
    expect(text).not.toContain('Climb');
  });

  it('reports runs and vertical for skiing', () => {
    const ski = {
      name: 'Whistler',
      activity: 'ski',
      startedAt: 0,
      summary: { distance: 21650, duration: 3600, avgMovingSpeed: 6, maxSpeed: 14.25, elevGain: 2609, ski: { runs: 6, descentVertical: 2183 } },
    };
    expect(workoutShareText(ski, { formatDay: day }).split('\n')[2]).toBe('6 runs · 2,183 m vertical · max 51.3 km/h');
  });

  it('builds an sms: URI with an encoded body', () => {
    expect(smsUri('a b·c\nd')).toBe('sms:?body=a%20b%C2%B7c%0Ad');
  });
});

describe('location sharing and coordinate formats', () => {
  it('builds a location message with a map link', async () => {
    const { locationShareText } = await import('../src/export/text.js');
    expect(locationShareText({ lat: -33.87312, lon: 151.21113, accuracy: 4.6, altitude: 31.6 })).toBe(
      ['My location: -33.873120, 151.211130', '±5 m · altitude 32 m', 'https://maps.google.com/?q=-33.873120,151.211130'].join('\n')
    );
    expect(locationShareText({ lat: 1, lon: 2 }).split('\n')).toHaveLength(2);
  });

  it('formats degrees, minutes and seconds with carries', async () => {
    const { formatDMS } = await import('../src/units.js');
    expect(formatDMS(-33.87312, 'lat')).toBe(`33°52'23.2" S`);
    expect(formatDMS(151.21113, 'lon')).toBe(`151°12'40.1" E`);
    expect(formatDMS(10.999999, 'lat')).toBe(`11°00'00.0" N`); // 59.99..." carries
    expect(formatDMS(NaN, 'lat')).toBe('–');
  });
});
