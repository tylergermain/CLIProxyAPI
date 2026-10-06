// Quota Management: provider summary cards plus per-credential usage windows.

import { esc, icon, store, fmtRelative, fmtStamp, maskName, meter, toast } from '../util.js';
import { PINNED, providerKey, providerMeta, glyph } from '../providers.js';
import { quotaFor, refreshQuota, refreshMany, onQuota, isLoading, HEADLINE, SECONDARY, effectiveRemaining, useCodexReset } from '../quota.js';

const SORTS = [
  ['ledger', 'Ledger'],
  ['lowest', 'Lowest remaining'],
  ['reset', 'Soonest reset'],
];

function resetLine(w) {
  if (w.resetAt && w.resetAt > Date.now()) {
    return `<b>${esc(fmtRelative(w.resetAt))}</b> · ${esc(fmtStamp(w.resetAt))}`;
  }
  if (w.remaining === 100 || !w.resetAt) return 'No reset pending';
  return `Reset ${esc(fmtStamp(w.resetAt))}`;
}

function windowCell(w) {
  const pct = w.remaining == null ? '--' : `${Math.round(w.remaining)}%`;
  const foot = w.detail
    ? `${esc(w.detail)}${w.resetAt && w.resetAt > Date.now() ? ` · resets ${esc(fmtStamp(w.resetAt))}` : ''}`
    : resetLine(w);
  return `
    <div class="win">
      <div class="win-top"><span class="win-label" title="${esc(w.label)}">${esc(w.label)}</span><span class="win-pct">${pct}</span></div>
      ${meter(w.remaining)}
      <div class="win-reset">${foot}</div>
    </div>`;
}

function skeletonWins() {
  return `<div class="wins">${[0, 1, 2].map(() => `
    <div class="win"><div class="win-top"><div class="skeleton" style="width:55%"></div></div>
    ${meter(null)}<div class="skeleton" style="width:70%;margin-top:12px"></div></div>`).join('')}</div>`;
}

function credRow(c, showEmails) {
  const q = quotaFor(c);
  const loading = isLoading(c);
  const name = showEmails ? c.name : maskName(c.name);
  const plan = q?.plan || c.account_type || '';
  const pills = [];
  if (c.disabled) pills.push('<span class="pill off">Disabled</span>');
  else if (c.unavailable) pills.push(`<span class="pill warn" title="${esc(c.status_message || '')}">Cooling down</span>`);
  else if (c.status && !['active', 'ok', ''].includes(String(c.status).toLowerCase())) {
    pills.push(`<span class="pill bad" title="${esc(c.status_message || '')}">${esc(c.status)}</span>`);
  }

  let body;
  if (c.disabled) {
    body = '<div class="cred-msg">Disabled. Enable it in Auth Files to track quota.</div>';
  } else if (loading && !q?.windows?.length) {
    body = skeletonWins();
  } else if (q?.windows?.length) {
    const err = q.status === 'error' ? `<div class="cred-msg err" style="grid-column:1/-1">${esc(q.error)} · showing last known values</div>` : '';
    body = `<div class="wins">${q.windows.map(windowCell).join('')}${err}</div>`;
  } else if (q?.status === 'error') {
    body = `<div class="cred-msg err">${esc(q.error)}</div>`;
  } else if (q?.status === 'unsupported') {
    body = `<div class="cred-msg">${esc(q.error)}</div>`;
  } else {
    body = '<div class="cred-msg">Not fetched yet.</div>';
  }

  for (const f of q?.flags || []) {
    pills.push(`<span class="pill ${f.tone || 'plain'}">${esc(f.text)}</span>`);
  }
  const canReset = !c.disabled && (q?.resets?.applicable ?? 0) > 0;
  const updated = q?.fetchedAt ? `<span class="faint" title="Last fetched ${esc(fmtStamp(q.fetchedAt))}">${plan ? '· ' : ''}${esc(fmtRelative(q.fetchedAt))}</span>` : '';
  return `
    <div class="cred" data-index="${esc(c.auth_index)}">
      <div>
        <div class="cred-name" title="${esc(showEmails ? c.name : '')}">${esc(name)}</div>
        <div class="cred-meta">${plan ? `<span>${esc(plan)}</span>` : ''}${pills.join('')}${updated}</div>
      </div>
      ${body}
      <div class="cred-actions">
        ${canReset ? `<button class="btn sm" data-action="use-reset" data-index="${esc(c.auth_index)}" style="margin-bottom:6px">${icon('refresh')}Use reset</button>` : ''}
        <button class="link-btn${loading ? ' spin' : ''}" data-action="refresh-one" data-index="${esc(c.auth_index)}" ${loading || c.disabled ? 'disabled' : ''}>
          ${icon('refresh')}${loading ? 'Refreshing' : 'Refresh quota'}
        </button>
      </div>
    </div>`;
}

function minRemaining(c) {
  const ws = quotaFor(c)?.windows || [];
  const vals = ws.map((w) => w.remaining).filter((v) => v != null);
  return vals.length ? Math.min(...vals) : Infinity;
}
function soonestReset(c) {
  const now = Date.now();
  const ws = (quotaFor(c)?.windows || []).filter((w) => w.resetAt && w.resetAt > now);
  return ws.length ? Math.min(...ws.map((w) => w.resetAt)) : Infinity;
}

function sortCreds(list, sort) {
  const out = [...list];
  if (sort === 'lowest') out.sort((a, b) => minRemaining(a) - minRemaining(b) || a.name.localeCompare(b.name));
  else if (sort === 'reset') out.sort((a, b) => soonestReset(a) - soonestReset(b) || a.name.localeCompare(b.name));
  else out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Aggregates one provider's credentials into a headline window and secondary totals.
function summarize(pkey, creds) {
  const active = creds.filter((c) => !c.disabled);
  const order = [];
  const labels = {};
  for (const c of active) {
    for (const w of quotaFor(c)?.windows || []) {
      if (!labels[w.id]) { labels[w.id] = w.label; order.push(w.id); }
    }
  }
  const pick = (HEADLINE[pkey] || []).find((id) => labels[id]) || order[0] || null;
  const totals = (id) => {
    let sum = 0;
    let seen = 0;
    let soonest = null;
    const segs = active.map((c) => {
      const ws = quotaFor(c)?.windows || [];
      const w = ws.find((x) => x.id === id);
      const v = effectiveRemaining(pkey, ws, id);
      if (!w || v == null) return null;
      sum += v;
      seen += 1;
      if (w.resetAt && w.resetAt > Date.now() && (soonest == null || w.resetAt < soonest)) soonest = w.resetAt;
      return v;
    });
    return { sum, seen, soonest, segs };
  };
  const pref = SECONDARY[pkey] || [];
  const rank = (id) => (pref.indexOf(id) === -1 ? pref.length : pref.indexOf(id));
  const rest = order.filter((id) => id !== pick).sort((a, b) => rank(a) - rank(b));
  return {
    headline: pick ? { id: pick, label: labels[pick], ...totals(pick) } : null,
    others: rest.map((id) => ({ id, label: labels[id], ...totals(id) })),
    count: creds.length,
    denom: Math.max(active.length, 1) * 100,
    activeCount: active.length,
  };
}

function summaryCard(pkey, creds, expanded) {
  const meta = providerMeta(pkey);
  const s = summarize(pkey, creds);
  const h = s.headline;
  const big = h && h.seen ? `${Math.round(h.sum)}%` : '--';
  const segs = (h ? h.segs : creds.filter((c) => !c.disabled).map(() => null))
    .map((v) => meter(v, 'seg')).join('');
  const reset = h?.soonest ? `<b>${esc(fmtRelative(h.soonest))}</b> · ${esc(fmtStamp(h.soonest))}` : (h?.seen ? 'No reset pending' : 'No data yet');
  const others = s.others.filter((o) => o.seen);
  const first = others[0];
  const more = first ? `
    <div class="sum-more">
      <div class="sum-more-row"><span>${esc(first.label)}</span><b>${Math.round(first.sum)}%</b>
        ${others.length > 1 ? `<button class="link-btn" data-action="toggle-more" data-provider="${esc(pkey)}">${expanded ? 'Hide' : 'Show'}</button>` : ''}</div>
      ${expanded ? others.slice(1).map((o) => `<div class="sum-more-row"><span>${esc(o.label)}</span><b>${Math.round(o.sum)}%</b></div>`).join('') : ''}
    </div>` : '';
  return `
    <div class="sum-card">
      <div class="sum-head">${glyph(pkey, 'lg')}<span class="sum-name">${esc(meta.name)}</span>
        <span class="sum-creds">${s.count} credential${s.count === 1 ? '' : 's'}</span></div>
      <div class="sum-label">${esc(h?.label || 'Quota')}</div>
      <div class="sum-value"><span class="big">${big}</span><span class="of">of ${s.denom}%</span></div>
      <div class="segs">${segs || meter(null, 'seg')}</div>
      <div class="sum-reset">${reset}</div>
      ${more}
    </div>`;
}

export function quota(el, ctx) {
  let tab = store.get('quota.tab', 'all');
  let sort = store.get('quota.sort', 'ledger');
  let showEmails = store.get('quota.emails', false);
  const expanded = new Set();
  let loaded = false;
  let raf = 0;

  function render() {
    raf = 0;
    const creds = ctx.creds;
    const byProvider = new Map();
    for (const c of creds) {
      const k = providerKey(c);
      if (!byProvider.has(k)) byProvider.set(k, []);
      byProvider.get(k).push(c);
    }
    const tabKeys = [...PINNED, ...[...byProvider.keys()].filter((k) => !PINNED.includes(k)).sort()];
    if (tab !== 'all' && !tabKeys.includes(tab)) tab = 'all';
    const shown = tab === 'all' ? [...byProvider.keys()].sort((a, b) => tabKeys.indexOf(a) - tabKeys.indexOf(b)) : [tab];
    const withCreds = shown.filter((k) => byProvider.get(k)?.length);
    const okCount = creds.filter((c) => quotaFor(c)?.status === 'ok').length;
    const errCount = creds.filter((c) => quotaFor(c)?.status === 'error').length;
    const busy = creds.some(isLoading);

    const tabsHTML = [
      `<button class="tab${tab === 'all' ? ' active' : ''}" data-tab="all">${icon('dashboard', 'pg')}All <span class="count">${creds.length}</span></button>`,
      ...tabKeys.map((k) => `<button class="tab${tab === k ? ' active' : ''}" data-tab="${esc(k)}">${glyph(k)}${esc(providerMeta(k).name)} <span class="count">${byProvider.get(k)?.length || 0}</span></button>`),
    ].join('');

    let content;
    if (!loaded) {
      content = '<div class="card"><div class="skeleton" style="width:40%;margin-bottom:14px"></div><div class="skeleton" style="width:70%"></div></div>';
    } else if (!withCreds.length) {
      content = `
        <div class="empty">
          <h3>${tab === 'all' ? 'No credentials yet' : `No ${esc(providerMeta(tab).name)} credentials`}</h3>
          <p>Sign in with a provider account and its quota windows will show up here.</p>
          <a class="btn primary" href="#/oauth">${icon('user')}Go to OAuth Login</a>
        </div>`;
    } else {
      const cards = withCreds.map((k) => summaryCard(k, byProvider.get(k), expanded.has(k))).join('');
      const groups = withCreds.map((k) => {
        const list = sortCreds(byProvider.get(k), sort);
        return `
          <section class="group">
            <h2 class="group-title">${esc(providerMeta(k).name)} <span class="n">${list.length}</span></h2>
            ${list.map((c) => credRow(c, showEmails)).join('')}
          </section>`;
      }).join('');
      content = `<section class="summary">${cards}</section>${groups}`;
    }

    el.innerHTML = `
      <header class="page-head">
        <div>
          <h1 class="page-title">Quota Management</h1>
          <div class="page-sub">${creds.length} credential${creds.length === 1 ? '' : 's'} <span class="dot">·</span>
            <span class="ok">${okCount} loaded</span>${errCount ? ` <span class="dot">·</span> <span class="bad">${errCount} failed</span>` : ''}</div>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="toggle-emails">${icon(showEmails ? 'eyeOff' : 'eye')}${showEmails ? 'Hide emails' : 'Show emails'}</button>
          <button class="btn primary${busy ? ' spin' : ''}" data-action="refresh-all" ${busy || !creds.length ? 'disabled' : ''}>${icon('refresh')}${busy ? 'Refreshing…' : 'Refresh all'}</button>
        </div>
      </header>
      <div class="tabs-row">
        <nav class="tabs">${tabsHTML}</nav>
        <select class="select" data-action="sort" aria-label="Sort credentials">
          ${SORTS.map(([v, l]) => `<option value="${v}"${v === sort ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${content}`;
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-action]');
    if (!t) return;
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      store.set('quota.tab', tab);
      render();
      return;
    }
    const action = t.dataset.action;
    if (action === 'toggle-emails') {
      showEmails = !showEmails;
      store.set('quota.emails', showEmails);
      render();
    } else if (action === 'refresh-all') {
      const targets = tab === 'all' ? ctx.creds : ctx.creds.filter((c) => providerKey(c) === tab);
      ctx.loadCreds(true).catch(ctx.handleError).finally(() => refreshMany(targets));
    } else if (action === 'refresh-one') {
      const c = ctx.creds.find((x) => String(x.auth_index) === t.dataset.index);
      if (c) refreshQuota(c);
    } else if (action === 'use-reset') {
      const c = ctx.creds.find((x) => String(x.auth_index) === t.dataset.index);
      if (!c) return;
      if (!confirm(`Redeem one Codex rate-limit reset for ${c.name}? This uses up the reset credit.`)) return;
      t.disabled = true;
      useCodexReset(c).then(() => toast('Codex limits reset', 'ok')).catch((err) => ctx.handleError(err));
    } else if (action === 'toggle-more') {
      const p = t.dataset.provider;
      if (expanded.has(p)) expanded.delete(p); else expanded.add(p);
      render();
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'sort') {
      sort = e.target.value;
      store.set('quota.sort', sort);
      render();
    }
  });

  const off = onQuota(schedule);
  render();
  ctx.loadCreds(true)
    .then(() => {
      loaded = true;
      render();
      refreshMany(ctx.creds, { staleOnly: true });
    })
    .catch((err) => { loaded = true; render(); ctx.handleError(err); });

  // Keep relative reset times current, and refetch live quota every 5 minutes.
  const tick = setInterval(schedule, 60000);
  const poll = setInterval(() => refreshMany(ctx.creds, { staleOnly: true }), 5 * 60000);
  return () => {
    off();
    clearInterval(tick);
    clearInterval(poll);
    if (raf) cancelAnimationFrame(raf);
  };
}
