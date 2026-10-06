// Dashboard: credential health, recent request activity, endpoint and quota at a glance.

import { esc, icon, fmtNum, fmtRelative, fmtStamp, maskSecret, maskName, copyText, tone, store } from '../util.js';
import { providerKey, providerMeta, glyph } from '../providers.js';
import { quotaFor, onQuota, HEADLINE } from '../quota.js';

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

function headlineFor(pkey, creds) {
  const pref = HEADLINE[pkey] || [];
  let best = null;
  for (const c of creds) {
    for (const w of quotaFor(c)?.windows || []) {
      const rank = pref.indexOf(w.id) === -1 ? 99 : pref.indexOf(w.id);
      if (!best || rank < best.rank) best = { rank, id: w.id, label: w.label };
    }
  }
  if (!best) return null;
  let sum = 0;
  let seen = 0;
  for (const c of creds) {
    const w = (quotaFor(c)?.windows || []).find((x) => x.id === best.id);
    if (w?.remaining != null) { sum += w.remaining; seen += 1; }
  }
  return seen ? { label: best.label, avg: sum / seen } : null;
}

export function dashboard(el, ctx) {
  let revealed = false;
  let models = null;

  function render() {
    const creds = ctx.creds;
    const active = creds.filter((c) => !c.disabled);
    const cooling = creds.filter((c) => c.unavailable && !c.disabled);
    const disabled = creds.filter((c) => c.disabled);
    const buckets = activity(creds);
    const recentOk = buckets.reduce((a, b) => a + b.success, 0);
    const recentBad = buckets.reduce((a, b) => a + b.failed, 0);
    const lifeOk = creds.reduce((a, c) => a + (Number(c.success) || 0), 0);
    const lifeBad = creds.reduce((a, c) => a + (Number(c.failed) || 0), 0);
    const rate = lifeOk + lifeBad ? (lifeOk / (lifeOk + lifeBad)) * 100 : null;

    const groups = new Map();
    for (const c of creds) {
      const k = providerKey(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }

    const low = [];
    for (const c of active) {
      for (const w of quotaFor(c)?.windows || []) {
        if (w.remaining != null) low.push({ c, w });
      }
    }
    low.sort((a, b) => a.w.remaining - b.w.remaining);

    const key = ctx.clientKeys()[0] || '';
    const base = `${location.origin}/v1`;

    el.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <div class="page-sub">${location.host} <span class="dot">·</span> <span class="ok">online</span></div>
        </div>
        <div class="head-actions">
          <a class="btn" href="#/quota">${icon('gauge')}Quota</a>
          <button class="btn primary" data-action="reload">${icon('refresh')}Refresh</button>
        </div>
      </header>

      <div class="grid stats">
        <div class="card"><div class="stat-label">${icon('shield', 'pg')}Credentials</div>
          <div class="stat-value">${creds.length}</div>
          <div class="stat-foot">${active.length} active${disabled.length ? ` · ${disabled.length} disabled` : ''}</div></div>
        <div class="card"><div class="stat-label">${icon('activity', 'pg')}Requests · last 200 min</div>
          <div class="stat-value">${fmtNum(recentOk + recentBad)}</div>
          <div class="stat-foot"><span class="ok">${fmtNum(recentOk)} ok</span>${recentBad ? ` · <span class="bad">${fmtNum(recentBad)} failed</span>` : ''}</div></div>
        <div class="card"><div class="stat-label">${icon('check', 'pg')}Success rate · lifetime</div>
          <div class="stat-value">${rate == null ? '--' : `${rate.toFixed(rate >= 99.95 ? 0 : 1)}%`}</div>
          <div class="stat-foot">${fmtNum(lifeOk)} ok · ${fmtNum(lifeBad)} failed</div></div>
        <div class="card"><div class="stat-label">${icon('warn', 'pg')}Cooling down</div>
          <div class="stat-value">${cooling.length}</div>
          <div class="stat-foot">${cooling.length ? cooling.map((c) => esc(providerMeta(providerKey(c)).name)).join(', ') : '<span class="ok">All credentials healthy</span>'}</div></div>
      </div>

      <div class="grid two">
        <div class="card">
          <div class="card-title">Request activity <span class="legend right"><span><i style="background:var(--green)"></i>Success</span><span><i style="background:var(--red)"></i>Failed</span></span></div>
          ${chart(buckets)}
        </div>
        <div class="card">
          <div class="card-title">Endpoint</div>
          <div class="kv">
            <span class="k">Base URL</span><span class="v">${esc(base)}</span>
            <button class="icon-btn" data-copy="${esc(base)}" title="Copy">${icon('copy')}</button>
            <span class="k">API key</span><span class="v">${key ? esc(revealed ? key : maskSecret(key)) : '<span class="muted">none configured</span>'}</span>
            <span style="display:flex;gap:6px">${key ? `<button class="icon-btn" data-action="reveal" title="${revealed ? 'Hide' : 'Show'}">${icon(revealed ? 'eyeOff' : 'eye')}</button><button class="icon-btn" data-copy="${esc(key)}" title="Copy">${icon('copy')}</button>` : ''}</span>
            <span class="k">Models</span><span class="v">${models == null ? '<span class="muted">…</span>' : `${models} available`}</span><span></span>
          </div>
          <div style="margin-top:18px"><a class="link-btn" href="#/quick-start" style="padding:0">${icon('zap')}Connection snippets</a></div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <div class="card-title">Providers</div>
          ${groups.size ? `<div class="row-list">${[...groups.entries()].map(([k, list]) => {
            const ok = list.reduce((a, c) => a + (Number(c.success) || 0), 0);
            const bad = list.reduce((a, c) => a + (Number(c.failed) || 0), 0);
            const hl = headlineFor(k, list.filter((c) => !c.disabled));
            return `<div class="row-item">${glyph(k, 'lg')}
              <div class="grow"><div style="font-weight:600">${esc(providerMeta(k).name)}</div>
                <div class="sub">${list.length} credential${list.length === 1 ? '' : 's'} · ${fmtNum(ok)} ok · ${fmtNum(bad)} failed</div></div>
              ${hl ? `<div style="width:180px"><div class="win-top"><span class="win-label" style="font-size:13px">${esc(hl.label)} · avg</span><span class="win-pct" style="font-size:14px">${Math.round(hl.avg)}%</span></div>
                <div class="meter"><i class="fill-${tone(hl.avg)}" style="width:${hl.avg}%"></i></div></div>` : '<span class="sub">no quota data</span>'}
            </div>`;
          }).join('')}</div>` : `<div class="empty"><h3>No credentials</h3><p>Log in to a provider to start routing requests.</p><a class="btn primary" href="#/oauth">${icon('user')}OAuth Login</a></div>`}
        </div>
        <div class="card">
          <div class="card-title">Lowest quota <a class="link-btn right" href="#/quota" style="padding:0">View all</a></div>
          ${low.length ? `<div class="row-list">${low.slice(0, 6).map(({ c, w }) => `
            <div class="row-item">${glyph(providerKey(c))}
              <div class="grow"><div class="mono" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(store.get('quota.emails', false) ? (c.email || c.name) : maskName(c.email || c.name))}</div>
                <div class="sub">${esc(w.label)}${w.resetAt && w.resetAt > Date.now() ? ` · resets ${esc(fmtRelative(w.resetAt))}` : ''}</div></div>
              <span class="win-pct" style="color:var(--${tone(w.remaining) === 'g' ? 'green' : tone(w.remaining) === 'a' ? 'amber' : 'red'})">${Math.round(w.remaining)}%</span>
            </div>`).join('')}</div>` : '<div class="cred-msg">Open Quota Management to fetch live usage.</div>'}
        </div>
      </div>
      <div class="faint" style="font-size:12.5px">Updated ${esc(fmtStamp(Date.now()))} · auto-refreshes every 30 s</div>`;
  }

  async function loadModels() {
    const key = ctx.clientKeys()[0];
    if (!key) { models = 0; return; }
    try {
      const res = await fetch('/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      const data = await res.json();
      models = Array.isArray(data?.data) ? data.data.length : 0;
    } catch {
      models = 0;
    }
  }

  async function load() {
    try {
      await Promise.all([ctx.loadCreds(true), ctx.loadConfig()]);
      await loadModels();
    } catch (err) {
      ctx.handleError(err);
    }
    render();
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'reveal') { revealed = !revealed; render(); }
    if (a.dataset.action === 'reload') load();
  });

  render();
  load();
  const off = onQuota(() => render());
  const timer = setInterval(() => { ctx.loadCreds(true).then(render).catch(() => {}); }, 30000);
  return () => { off(); clearInterval(timer); };
}
