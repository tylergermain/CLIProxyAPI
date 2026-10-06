// Plain-language reading of quota: whether each account can be used now, what refills when,
// and how the next week of resets lays out. Pure functions over quota windows.

import { fmtWhen } from '../util.js';

// Windows measured in dollars, not rate limits: spending them never blocks an account.
const ALLOWANCES = new Set(['credits', 'fable-credit']);
const isRate = (w) => !ALLOWANCES.has(w.id);

const SHORT = { '5h': '5h', '7d': '7-day', fable: 'Fable', weekly: 'Week', monthly: 'Month', 'fable-credit': 'Fable $', credits: 'Credits' };
export const shortLabel = (w) => SHORT[w.id] || w.label.replace(/ limit$/i, '');

/** Which family a window belongs to, for its colour on the timeline. */
export function kindOf(id) {
  if (/5h$/.test(id)) return 'k-5h';
  if (id === 'fable' || id === 'fable-credit') return 'k-fable';
  if (id === '7d' || /weekly$/.test(id)) return 'k-week';
  return 'k-month';
}

const used = (w) => (w.remaining == null ? null : 100 - w.remaining);

/**
 * Whether an account can take work right now, in a few words:
 * level is ok | low | maxed | off | err | unknown; `until` is when a maxed one is back.
 */
export function accountStatus(c, q) {
  if (c.disabled) return { level: 'off', text: 'Turned off' };
  if (!q) return { level: 'unknown', text: 'Not checked yet' };
  if (q.status === 'unsupported') return { level: 'unknown', text: 'Usage not available for this provider' };
  const rate = (q.windows || []).filter((w) => isRate(w) && w.remaining != null);
  if (q.status === 'error' && !rate.length) return { level: 'err', text: 'Couldn’t read its usage' };
  const onCredits = (q.flags || []).some((f) => /usage credits/i.test(f.text) && f.tone === 'ok');
  const spent = rate.filter((w) => w.remaining <= 0);
  if (spent.length) {
    const until = Math.max(...spent.map((w) => w.resetAt || 0)) || null;
    const which = spent.map((w) => w.label.replace(/ limit$/i, '')).join(' + ');
    const back = until ? ` until ${fmtWhen(until)}` : '';
    return onCredits
      ? { level: 'low', text: `${which} maxed${back}; running on usage credits`, until }
      : { level: 'maxed', text: `${which} maxed${back}`, until };
  }
  if (!rate.length) return { level: 'unknown', text: 'No limits reported' };
  const tight = rate.reduce((a, b) => (b.remaining < a.remaining ? b : a));
  const left = Math.round(tight.remaining);
  if (left < 25) return { level: 'low', text: `Running low: ${left}% of ${tight.label.replace(/ limit$/i, '')} left` };
  return { level: 'ok', text: `Good to go: ${left}% left on its tightest limit` };
}

/** Every reset ahead that matters (something's been used), soonest first. */
export function resetEvents(rows, now = Date.now()) {
  const out = [];
  for (const r of rows) {
    for (const w of r.q?.windows || []) {
      const u = used(w);
      if (!w.resetAt || w.resetAt <= now || u == null || u < 1) continue;
      out.push({ at: w.resetAt, row: r, window: w, used: u });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The next `days` laid out on a line: day ticks, and per account its reset markers (resets close
 * together merged) and the span it's maxed out for. Positions are percents of the line.
 */
export function timeline(rows, now = Date.now(), hours = 168) {
  const end = now + hours * 3600000;
  const pos = (t) => ((Math.min(Math.max(t, now), end) - now) / (end - now)) * 100;
  const ticks = [];
  if (hours <= 48) {
    // Every 3 hours, on the hour: "3 PM", and the day's name at midnight.
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    d.setHours(Math.ceil((d.getHours() + 1) / 3) * 3);
    for (; d.getTime() < end; d.setHours(d.getHours() + 3)) {
      const midnight = d.getHours() === 0;
      ticks.push({ at: pos(d.getTime()), label: midnight ? d.toLocaleDateString('en-US', { weekday: 'short' }) : d.toLocaleTimeString('en-US', { hour: 'numeric' }), major: midnight });
    }
  } else {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    for (; d.getTime() < end; d.setDate(d.getDate() + 1)) ticks.push({ at: pos(d.getTime()), label: d.toLocaleDateString('en-US', { weekday: 'short' }), major: true });
  }
  // Markers closer than this on the line would sit on each other: they're shown as one.
  const close = (end - now) * 0.08;
  const lanes = rows.map((r) => {
    const marks = [];
    for (const e of resetEvents([r], now)) {
      if (e.at > end) continue;
      const near = marks.find((m) => Math.abs(m.time - e.at) < close);
      if (near) near.items.push(e);
      else marks.push({ time: e.at, at: pos(e.at), items: [e] });
    }
    const st = accountStatus(r.c, r.q);
    const band = st.until && (st.level === 'maxed' || st.level === 'low') && st.until > now ? { to: pos(st.until), until: st.until, credits: st.level === 'low', overflow: st.until > end } : null;
    const later = resetEvents([r], now).filter((e) => e.at > end);
    return { row: r, status: st, marks, band, later };
  });
  return { ticks, lanes, end };
}
