// Dashboard: in plain language, which accounts can take work now, when each limit refills over the
// next week, how much of every limit each account has used, then traffic and the endpoint.

import { esc, icon, fmtNum, fmtStamp, fmtWhen, fmtIn, maskSecret, maskName, copyText, store, meter, toast } from '../util.js';

const RANGES = [[24, 'Next 24 hours'], [168, 'Next 7 days']];
import { providerKey, providerMeta, glyph } from '../providers.js';
import { quotaFor, onQuota, refreshMany, isLoading } from '../quota.js';
import { accountStatus, resetEvents, timeline, kindOf, shortLabel } from './insights.js';

function activity(creds) {
  const buckets = [];
  for (const c of creds) {
    (c.recent_requests || []).forEach((b, i) => {
      if (!buckets[i]) buckets[i] = { time: b.time, success: 0, failed: 0 };
      buckets[i].success += Number(b.success) || 0;
      buckets[i].failed += Number(b.failed) || 0;
    });
  }
  return buckets;
}

function chart(buckets) {
  if (!buckets.length) return '<div class="cred-msg">No request activity recorded yet.</div>';
  const max = Math.max(1, ...buckets.map((b) => b.success + b.failed));
  const cols = buckets.map((b) => {
    const total = b.success + b.failed;
    if (!total) return `<div class="bar-col"><div class="b-none"></div><div class="tip">${esc(b.time)} · no requests</div></div>`;
    const h = (total / max) * 100;
    const failH = (b.failed / total) * 100;
    return `<div class="bar-col"><div style="height:${h}%;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden">
      ${b.failed ? `<div class="b-bad" style="height:${failH}%"></div>` : ''}<div class="b-ok" style="flex:1"></div></div>
      <div class="tip">${esc(b.time)} · <span style="color:var(--green)">${b.success} ok</span>${b.failed ? ` · <span style="color:var(--red)">${b.failed} failed</span>` : ''}</div></div>`;
  }).join('');
  const first = buckets[0]?.time?.split('-')[0] || '';
  const last = buckets[buckets.length - 1]?.time?.split('-')[1] || '';
  return `<div class="bars">${cols}</div><div class="bars-axis"><span>${esc(first)}</span><span>now · ${esc(last)}</span></div>`;
}

const ORDER = ['claude', 'codex', 'antigravity', 'kimi', 'xai'];
const COLS = ['5h', '7d', 'fable', 'weekly', 'monthly', 'credits', 'fable-credit'];

function nowCard(pkey, rows, now) {
  const usable = rows.filter((r) => ['ok', 'low'].includes(r.status.level)).length;
  const known = rows.filter((r) => ['ok', 'low', 'maxed'].includes(r.status.level)).length;
  const next = resetEvents(rows, now)[0];
  const lines = rows.map((r) => `
    <div class="pc-line"><span class="sdot lv-${r.status.level}"></span>
      <div><div class="pc-name mono">${esc(r.name)}</div><div class="pc-text">${esc(r.status.text)}</div></div></div>`).join('');
  return `
    <div class="card pcard">
      <div class="card-title">${glyph(pkey, 'lg')}${esc(providerMeta(pkey).name)}<span class="muted right" style="font-weight:500">${rows.length} account${rows.length === 1 ? '' : 's'}</span></div>
      <div class="pc-big">${known ? `<b>${usable}</b> of ${rows.length} usable now` : '<b>—</b> usage isn’t tracked here'}</div>
      <div class="pc-lines">${lines}</div>
      <div class="pc-next">${!known && !next ? 'The proxy can route to it, but can’t read its limits yet.' : next ? `Next refill: <b>${esc(next.window.label)}</b> on <span class="mono">${esc(next.row.name)}</span>, <b>in ${esc(fmtIn(next.at, now))}</b> (${esc(fmtWhen(next.at))})` : 'Nothing used, so nothing waiting to refill.'}</div>
    </div>`;
}

function timelineCard(rows, now, hours) {
  const t = timeline(rows.filter((r) => r.q?.windows?.length), now, hours);
  const grid = t.ticks.map((k) => `<div class="tl-tick${k.major ? ' major' : ''}" style="left:${k.at}%"></div>`).join('');
  const days = t.ticks.map((k) => `<div class="tl-tick${k.major ? ' major' : ''}" style="left:${k.at}%"><span>${esc(k.label)}</span></div>`).join('');
  const lanes = t.lanes.map((l) => {
    const band = l.band
      ? `<div class="tl-band${l.band.credits ? ' credits' : ''}" style="width:${l.band.to}%" title="${esc(`${l.status.text}`)}">${l.band.to > 14 ? `<span>${l.band.credits ? 'maxed · on credits' : 'maxed out'} until ${esc(fmtWhen(l.band.until))}${l.band.overflow ? ' →' : ''}</span>` : ''}</div>`
      : '';
    const marks = l.marks.map((m) => {
      const label = m.items.map((e) => shortLabel(e.window)).join(' + ');
      const tip = m.items.map((e) => `${e.window.label}: ${Math.round(e.used)}% used, refills ${fmtWhen(e.at)} (in ${fmtIn(e.at, now)})`).join('\n');
      return `<div class="tl-mark ${kindOf(m.items[0].window.id)}" style="left:${m.at}%" title="${esc(tip)}"><i></i><span>${esc(label)}</span></div>`;
    }).join('');
    const later = l.later.length ? `<div class="tl-later" title="${esc(l.later.map((e) => `${e.window.label}: ${fmtStamp(e.at)}`).join('\n'))}">+${l.later.length} later</div>` : '';
    return `
      <div class="tl-lane">
        <div class="tl-label">${glyph(l.row.pkey)}<span class="mono">${esc(l.row.name)}</span><span class="sdot lv-${l.status.level}" title="${esc(l.status.text)}"></span></div>
        <div class="tl-track">${grid}${band}${marks}${later}</div>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-title">Reset timeline
        <span class="seg-mini">${RANGES.map(([h, label]) => `<button class="${h === hours ? 'on' : ''}" data-range="${h}">${label}</button>`).join('')}</span>
        <span class="legend right"><span><i class="k-5h"></i>5-hour</span><span><i class="k-week"></i>7-day / weekly</span><span><i class="k-fable"></i>Fable 5</span><span><i class="k-month"></i>Monthly</span><span><i class="lg-band"></i>Maxed out</span></span></div>
      ${t.lanes.length ? `<div class="timeline">
        <div class="tl-lane tl-axis"><div class="tl-label"></div><div class="tl-track"><div class="tl-now"><span>now</span></div>${days}</div></div>
        ${lanes}
      </div><div class="tl-foot">Each marker is a limit you’ve used refilling to 100%. Hover one for details.</div>`
      : '<div class="cred-msg">No usage read yet. Press Refresh, or open Quota Management.</div>'}
    </div>`;
}

function usageCard(rows, now) {
  const withData = rows.filter((r) => r.q?.windows?.length || r.c.disabled || r.q);
  const present = new Set(withData.flatMap((r) => (r.q?.windows || []).map((w) => w.id)));
  const cols = [...COLS.filter((c) => present.has(c)), ...[...present].filter((c) => !COLS.includes(c))];
  const labels = {};
  for (const r of withData) for (const w of r.q?.windows || []) labels[w.id] ??= w.label;
  const head = cols.map((c) => `<th>${esc(labels[c])}</th>`).join('');
  const body = withData.map((r) => {
    const cells = cols.map((id) => {
      const w = (r.q?.windows || []).find((x) => x.id === id);
      if (!w) return '<td class="u-none">—</td>';
      const u = w.remaining == null ? null : 100 - w.remaining;
      const foot = w.detail ? esc(w.detail) : w.resetAt && w.resetAt > now ? `resets in ${esc(fmtIn(w.resetAt, now))}` : u ? '' : 'nothing used';
      return `<td><div class="u-top"><b>${u == null ? '--' : `${Math.round(u)}%`}</b><span>used</span></div>${meter(w.remaining, 'u-meter', u)}<div class="u-foot">${foot}</div></td>`;
    }).join('');
    const note = !r.q?.windows?.length ? `<td colspan="${Math.max(cols.length, 1)}" class="u-none">${esc(r.status.text)}</td>` : cells;
    const flags = (r.q?.flags || []).map((f) => `<span class="pill ${f.tone || 'plain'}">${esc(f.text)}</span>`).join('');
    return `<tr>
      <td class="u-acct"><div class="u-name">${glyph(r.pkey)}<span class="mono">${esc(r.name)}</span></div>
        <div class="u-meta">${r.q?.plan || r.c.account_type ? `<span>${esc(r.q?.plan || r.c.account_type)}</span>` : ''}${flags}</div></td>${note}</tr>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-title">Usage by account <span class="muted" style="font-weight:500">how much of each limit is used</span></div>
      ${withData.length ? `<div class="table-wrap"><table class="table usage-table"><thead><tr><th>Account</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<div class="cred-msg">No accounts yet.</div>'}
    </div>`;
}

function upcomingCard(rows, now) {
  const events = resetEvents(rows, now).slice(0, 8);
  return `
    <div class="card">
      <div class="card-title">Upcoming resets</div>
      ${events.length ? `<div class="row-list">${events.map((e) => `
        <div class="row-item ev">
          <div class="ev-when"><b>in ${esc(fmtIn(e.at, now))}</b><span>${esc(fmtWhen(e.at))}</span></div>
          <span class="ev-k ${kindOf(e.window.id)}"></span>
          <div class="grow"><div><b>${esc(e.window.label)}</b> <span class="muted">on</span> <span class="mono">${esc(e.row.name)}</span></div>
            <div class="sub">${Math.round(e.used)}% used → back to full</div></div>
          ${glyph(e.row.pkey)}
        </div>`).join('')}</div>` : '<div class="cred-msg">Nothing used, so nothing waiting to refill.</div>'}
    </div>`;
}

export function dashboard(el, ctx) {
  let revealed = false;
  let models = null;
  let showEmails = store.get('quota.emails', false);
  let range = store.get('dash.range', 168);

  function rowsOf(creds) {
    return creds
      .map((c) => {
        const q = quotaFor(c);
        const id = c.email || c.name;
        return { c, q, pkey: providerKey(c), name: showEmails ? id : maskName(id), status: accountStatus(c, q) };
      })
      .sort((a, b) => (ORDER.indexOf(a.pkey) + 1 || 99) - (ORDER.indexOf(b.pkey) + 1 || 99) || a.name.localeCompare(b.name));
  }

  function render() {
    const now = Date.now();
    const creds = ctx.creds;
    const rows = rowsOf(creds);
    const usable = rows.filter((r) => ['ok', 'low'].includes(r.status.level)).length;
    const maxed = rows.filter((r) => r.status.level === 'maxed').length;
    const groups = new Map();
    for (const r of rows) groups.set(r.pkey, [...(groups.get(r.pkey) || []), r]);
    const busy = creds.some(isLoading);

    const buckets = activity(creds);
    const recentOk = buckets.reduce((a, b) => a + b.success, 0);
    const recentBad = buckets.reduce((a, b) => a + b.failed, 0);
    const lifeOk = creds.reduce((a, c) => a + (Number(c.success) || 0), 0);
    const lifeBad = creds.reduce((a, c) => a + (Number(c.failed) || 0), 0);
    const rate = lifeOk + lifeBad ? (lifeOk / (lifeOk + lifeBad)) * 100 : null;
    const key = ctx.clientKeys()[0] || '';
    const base = `${location.origin}/v1`;

    el.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <div class="page-sub">${rows.length} account${rows.length === 1 ? '' : 's'} <span class="dot">·</span>
            <span class="ok">${usable} usable now</span>${maxed ? ` <span class="dot">·</span> <span class="bad">${maxed} maxed out</span>` : ''}</div>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="emails">${icon(showEmails ? 'eyeOff' : 'eye')}${showEmails ? 'Hide emails' : 'Show emails'}</button>
          <button class="btn primary${busy ? ' spin' : ''}" data-action="reload" ${busy ? 'disabled' : ''}>${icon('refresh')}${busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      ${groups.size ? `<div class="now-grid">${[...groups.entries()].map(([k, list]) => nowCard(k, list, now)).join('')}</div>` : `
        <div class="empty" style="margin-bottom:16px"><h3>No accounts yet</h3><p>Log in to a provider to start routing requests.</p><a class="btn primary" href="#/oauth">${icon('user')}OAuth Login</a></div>`}

      <div class="stack">
        ${timelineCard(rows, now, range)}
        ${usageCard(rows, now)}
      </div>

      <div class="grid two">
        ${upcomingCard(rows, now)}
        <div class="card">
          <div class="card-title">Requests through the proxy <span class="legend right"><span><i style="background:var(--green)"></i>Success</span><span><i style="background:var(--red)"></i>Failed</span></span></div>
          <div class="traffic"><span><b>${fmtNum(recentOk + recentBad)}</b> in the last 200 min</span><span><b>${rate == null ? '--' : `${rate.toFixed(rate >= 99.95 ? 0 : 1)}%`}</b> succeeded overall</span>${recentBad ? `<span class="bad"><b>${fmtNum(recentBad)}</b> failed recently</span>` : ''}</div>
          ${chart(buckets)}
          <div class="kv" style="margin-top:18px">
            <span class="k">Base URL</span><span class="v">${esc(base)}</span>
            <button class="icon-btn" data-copy="${esc(base)}" title="Copy">${icon('copy')}</button>
            <span class="k">API key</span><span class="v">${key ? esc(revealed ? key : maskSecret(key)) : '<span class="muted">none configured</span>'}</span>
            <span style="display:flex;gap:6px">${key ? `<button class="icon-btn" data-action="reveal" title="${revealed ? 'Hide' : 'Show'}">${icon(revealed ? 'eyeOff' : 'eye')}</button><button class="icon-btn" data-copy="${esc(key)}" title="Copy">${icon('copy')}</button>` : ''}</span>
            <span class="k">Models</span><span class="v">${models == null ? '<span class="muted">…</span>' : `${models} available`}</span><span></span>
          </div>
        </div>
      </div>
      <div class="faint" style="font-size:12.5px">Updated ${esc(fmtStamp(now))} · usage is re-read every 5 minutes</div>`;
  }

  async function loadModels() {
    const k = ctx.clientKeys()[0];
    if (!k) { models = 0; return; }
    try {
      const res = await fetch('/v1/models', { headers: { Authorization: `Bearer ${k}` } });
      const data = await res.json();
      models = Array.isArray(data?.data) ? data.data.length : 0;
    } catch {
      models = 0;
    }
  }

  async function load(force = false) {
    try {
      await Promise.all([ctx.loadCreds(true), ctx.loadConfig()]);
      render();
      refreshMany(ctx.creds, { staleOnly: !force });
      await loadModels();
    } catch (err) {
      ctx.handleError(err);
    }
    render();
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy); return; }
    const r = e.target.closest('[data-range]');
    if (r) { range = Number(r.dataset.range); store.set('dash.range', range); render(); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'reveal') { revealed = !revealed; render(); }
    if (a.dataset.action === 'emails') { showEmails = !showEmails; store.set('quota.emails', showEmails); render(); }
    if (a.dataset.action === 'reload') { load(true); toast('Re-reading every account’s usage'); }
  });

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  render();
  load();
  const off = onQuota(schedule);
  const tick = setInterval(schedule, 60000);
  const poll = setInterval(() => { ctx.loadCreds(true).then(() => refreshMany(ctx.creds, { staleOnly: true })).catch(() => {}); }, 5 * 60000);
  return () => { off(); clearInterval(tick); clearInterval(poll); if (raf) cancelAnimationFrame(raf); };
}
