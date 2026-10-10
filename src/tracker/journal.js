// Parse the native NDJSON workout journal (see Journal.java).

/**
 * @param {string} text
 * @returns {{meta: object|null, points: object[], states: {t:number,state:string,reason?:string,seg?:number}[], hr: {t:number,bpm:number}[], end: object|null}}
 */
export function parseJournal(text) {
  const out = { meta: null, points: [], states: [], hr: [], end: null, goal: null };
  if (!text) return out;
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a torn final line after a crash
    }
    switch (o.type) {
      case 'meta':
        if (!out.meta) out.meta = o;
        break;
      case 'pt':
        if (Number.isFinite(o.lat) && Number.isFinite(o.lon) && Number.isFinite(o.t)) out.points.push(o);
        break;
      case 'state':
        out.states.push(o);
        break;
      case 'hr':
        // Heart rate from the paired watch (see WearListenerService.java).
        if (Number.isFinite(o.t) && o.bpm >= 25 && o.bpm <= 240) out.hr.push({ t: o.t, bpm: o.bpm });
        break;
      case 'end':
        out.end = o;
        break;
      case 'goal':
        // Goal chosen for this workout (manual or predicted); a later line updates it.
        if (o.goalM > 0) out.goal = o;
        break;
      default:
        break;
    }
  }
  out.points.sort((a, b) => a.t - b.t);
  out.states.sort((a, b) => a.t - b.t);
  out.hr.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Active (non-manually-paused) intervals derived from state transitions.
 * recording and autopaused both count as active; paused/idle do not.
 */
export function activeIntervals(states, fallbackEnd) {
  const intervals = [];
  let openAt = null;
  for (const s of states) {
    const active = s.state === 'recording' || s.state === 'autopaused';
    if (active && openAt == null) openAt = s.t;
    else if (!active && openAt != null) {
      intervals.push([openAt, s.t]);
      openAt = null;
    }
  }
  if (openAt != null && fallbackEnd != null && fallbackEnd > openAt) intervals.push([openAt, fallbackEnd]);
  return intervals;
}
