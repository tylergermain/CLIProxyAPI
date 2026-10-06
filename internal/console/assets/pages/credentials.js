// Credential pages: Auth Files management and OAuth provider login.

import { v8 } from '../api.js';
import { esc, icon, fmtAgo, fmtNum, maskName, store, toast } from '../util.js';
import { OAUTH, providerKey, providerMeta, glyph } from '../providers.js';

function statusPill(c) {
  if (c.disabled) return '<span class="pill off">Disabled</span>';
  if (c.unavailable) return `<span class="pill warn" title="${esc(c.status_message || '')}">Cooling down</span>`;
  const s = String(c.status || '').toLowerCase();
  if (!s || s === 'active' || s === 'ok') return '<span class="pill ok">Active</span>';
  return `<span class="pill bad" title="${esc(c.status_message || '')}">${esc(c.status)}</span>`;
}

export function authFiles(el, ctx) {
  let showEmails = store.get('quota.emails', false);
  let filter = '';
  let busy = new Set();

  function render() {
    const q = filter.toLowerCase();
    const list = ctx.creds
      .filter((c) => !q || `${c.name} ${c.email || ''} ${c.provider}`.toLowerCase().includes(q))
      .sort((a, b) => providerKey(a).localeCompare(providerKey(b)) || a.name.localeCompare(b.name));
    const active = ctx.creds.filter((c) => !c.disabled).length;

    el.innerHTML = `
      <header class="page-head">
        <div><h1 class="page-title">Auth Files</h1>
          <div class="page-sub">${ctx.creds.length} credentials <span class="dot">·</span> <span class="ok">${active} active</span></div></div>
        <div class="head-actions">
          <button class="btn" data-action="emails">${icon(showEmails ? 'eyeOff' : 'eye')}${showEmails ? 'Hide emails' : 'Show emails'}</button>
          <label class="btn">${icon('upload')}Upload JSON<input type="file" accept=".json,application/json" multiple hidden data-action="upload"></label>
          <a class="btn primary" href="#/oauth">${icon('user')}Add via OAuth</a>
        </div>
      </header>
      <div class="logs-toolbar"><input class="input" placeholder="Filter by name, email or provider" value="${esc(filter)}" data-action="filter"></div>
      ${list.length ? `<div class="card" style="padding:6px 24px"><div class="table-wrap"><table class="table">
        <thead><tr><th>Credential</th><th>Provider</th><th>Status</th><th style="text-align:right">Requests</th><th>Refreshed</th><th>Enabled</th><th></th></tr></thead>
        <tbody>${list.map((c) => {
          const k = providerKey(c);
          const name = showEmails ? c.name : maskName(c.name);
          const isBusy = busy.has(c.name);
          return `<tr>
            <td><div class="mono" style="font-weight:600;font-size:13.5px">${esc(name)}</div>
              <div class="muted" style="font-size:12.5px">${esc(c.account_type || '')}${c.priority != null ? ` · priority ${esc(c.priority)}` : ''}${c.runtime_only ? ' · runtime only' : ''}</div></td>
            <td><span style="display:inline-flex;align-items:center;gap:8px">${glyph(k)}${esc(providerMeta(k).name)}</span></td>
            <td>${statusPill(c)}</td>
            <td class="num" style="text-align:right"><span style="color:var(--green)">${fmtNum(c.success)}</span> / <span style="color:${c.failed ? 'var(--red)' : 'var(--faint)'}">${fmtNum(c.failed)}</span></td>
            <td class="muted">${esc(fmtAgo(c.last_refresh || c.updated_at))}</td>
            <td><label class="switch"><input type="checkbox" data-action="toggle" data-name="${esc(c.name)}" ${c.disabled ? '' : 'checked'} ${isBusy ? 'disabled' : ''}><span></span></label></td>
            <td><div class="actions">
              ${c.runtime_only ? '' : `<button class="icon-btn" data-action="download" data-name="${esc(c.name)}" title="Download">${icon('download')}</button>`}
              <button class="icon-btn danger" data-action="delete" data-name="${esc(c.name)}" title="Delete" ${isBusy ? 'disabled' : ''}>${icon('trash')}</button>
            </div></td></tr>`;
        }).join('')}</tbody></table></div></div>`
        : `<div class="empty"><h3>${filter ? 'No matches' : 'No credentials yet'}</h3><p>Log in through OAuth or upload an existing auth JSON file.</p>
            <a class="btn primary" href="#/oauth">${icon('user')}OAuth Login</a></div>`}`;
    if (filter) {
      const input = el.querySelector('[data-action="filter"]');
      input.focus();
      input.setSelectionRange(filter.length, filter.length);
    }
  }

  async function reload() {
    try { await ctx.loadCreds(true); } catch (err) { ctx.handleError(err); }
    render();
  }

  el.addEventListener('input', (e) => {
    if (e.target.dataset.action === 'filter') { filter = e.target.value; render(); }
  });

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.action === 'toggle') {
      const name = t.dataset.name;
      busy.add(name);
      try {
        await v8('/credentials/status', { method: 'PATCH', body: { name, disabled: !t.checked } });
        toast(`${t.checked ? 'Enabled' : 'Disabled'} ${name}`, 'ok');
      } catch (err) {
        ctx.handleError(err);
      }
      busy.delete(name);
      reload();
    } else if (t.dataset.action === 'upload') {
      for (const file of t.files) {
        try {
          const text = await file.text();
          JSON.parse(text);
          await v8('/credentials', { method: 'POST', query: { name: file.name }, body: text });
          toast(`Uploaded ${file.name}`, 'ok');
        } catch (err) {
          if (!ctx.handleError(err)) { /* toast shown */ }
        }
      }
      reload();
    }
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.tagName === 'INPUT') return;
    const name = t.dataset.name;
    if (t.dataset.action === 'emails') {
      showEmails = !showEmails;
      store.set('quota.emails', showEmails);
      render();
    } else if (t.dataset.action === 'download') {
      try {
        const text = await v8('/credentials/download', { query: { name }, text: true });
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) { ctx.handleError(err); }
    } else if (t.dataset.action === 'delete') {
      if (!confirm(`Delete ${name}? The auth file is removed from disk and this account stops serving requests.`)) return;
      busy.add(name);
      render();
      try {
        await v8('/credentials', { method: 'DELETE', query: { name } });
        toast(`Deleted ${name}`, 'ok');
      } catch (err) { ctx.handleError(err); }
      busy.delete(name);
      reload();
    }
  });

  render();
  reload();
}

export function oauthLogin(el, ctx) {
  const sessions = {};
  const timers = new Set();

  function card(p) {
    const s = sessions[p.id] || {};
    let status = '';
    if (s.state === 'waiting') status = '<div class="status">Waiting for you to finish signing in…</div>';
    else if (s.state === 'ok') status = `<div class="status ok">${icon('check', 'pg')} Signed in. Credential saved.</div>`;
    else if (s.state === 'error') status = `<div class="status err">${esc(s.error)}</div>`;
    const device = s.userCode ? `<div class="code-box">${esc(s.userCode)}</div>` : '';
    const paste = s.state === 'waiting' && !s.userCode ? `
      <form class="paste" data-id="${p.id}" style="display:flex;gap:8px">
        <input class="input" name="redirect" placeholder="Paste the localhost redirect URL" style="flex:1;height:34px;font-size:13px;min-width:0">
        <button class="btn sm" type="submit">Submit</button>
      </form>` : '';
    return `<div class="card oauth-card">
      <div class="top">${glyph(p.provider, 'lg')}<span class="name">${esc(p.name)}</span>
        <span class="sum-creds" style="margin-left:auto">${ctx.creds.filter((c) => providerKey(c) === p.provider).length} linked</span></div>
      <div class="desc">${esc(p.desc)}</div>
      ${device}${status}${paste}
      <div class="actions">
        <button class="btn sm primary" data-action="start" data-id="${p.id}" ${s.state === 'waiting' ? 'disabled' : ''}>${icon('user')}${s.state === 'waiting' ? 'Waiting…' : 'Sign in'}</button>
        ${s.url ? `<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">${icon('external')}Open link</a>` : ''}
        ${s.state === 'waiting' ? `<button class="btn sm ghost" data-action="cancel" data-id="${p.id}">Cancel</button>` : ''}
      </div></div>`;
  }

  function render() {
    el.innerHTML = `
      <header class="page-head">
        <div><h1 class="page-title">OAuth Login</h1>
          <div class="page-sub">Link subscription accounts <span class="dot">·</span> <span class="ok">${ctx.creds.length} linked</span></div></div>
      </header>
      ${['localhost', '127.0.0.1'].includes(location.hostname) ? '' : `<div class="banner">${icon('warn')}<div>
        You're viewing this console from another machine. After you approve sign-in, the provider redirects to a
        <span class="mono">localhost</span> page that won't load here. Copy that page's full URL from the address bar and paste it into the card to finish.</div></div>`}
      <div class="oauth-grid">${OAUTH.map(card).join('')}</div>`;
  }

  async function poll(id, state) {
    const timer = setInterval(async () => {
      try {
        const r = await v8('/oauth/status', { query: { state } });
        if (r?.status === 'ok') {
          clearInterval(timer); timers.delete(timer);
          sessions[id] = { state: 'ok' };
          await ctx.loadCreds(true).catch(() => {});
          toast('Account linked', 'ok');
          render();
        } else if (r?.status === 'error') {
          clearInterval(timer); timers.delete(timer);
          sessions[id] = { state: 'error', error: r.error || 'Sign-in failed' };
          render();
        }
      } catch (err) {
        clearInterval(timer); timers.delete(timer);
        sessions[id] = { state: 'error', error: err.message };
        render();
      }
    }, 2000);
    timers.add(timer);
  }

  el.addEventListener('submit', async (e) => {
    const form = e.target.closest('form.paste');
    if (!form) return;
    e.preventDefault();
    const url = form.redirect.value.trim();
    if (!url) return;
    try {
      const r = await v8('/oauth/callback', { method: 'POST', body: { redirect_url: url } });
      if (r?.status === 'error') throw new Error(r.error || 'Callback rejected');
      toast('Callback received. Finishing sign-in…', 'ok');
      form.remove();
    } catch (err) {
      ctx.handleError(err);
    }
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const id = t.dataset.id;
    if (t.dataset.action === 'start') {
      // Open the window synchronously so popup blockers allow it.
      const win = window.open('about:blank', '_blank');
      try {
        const r = await v8('/oauth/auth-url', { query: { provider: id, is_webui: 'true' } });
        const url = r?.url || r?.verification_uri_complete || r?.verification_uri;
        sessions[id] = { state: 'waiting', url, stateId: r?.state, userCode: r?.user_code };
        if (win && url) win.location = url; else if (win) win.close();
        render();
        if (r?.state) poll(id, r.state);
      } catch (err) {
        if (win) win.close();
        sessions[id] = { state: 'error', error: err.message };
        ctx.handleError(err);
        render();
      }
    } else if (t.dataset.action === 'cancel') {
      const s = sessions[id];
      if (s?.stateId) v8('/oauth/session', { method: 'DELETE', query: { state: s.stateId } }).catch(() => {});
      sessions[id] = {};
      render();
    }
  });

  render();
  ctx.loadCreds().then(render).catch(ctx.handleError);
  return () => timers.forEach(clearInterval);
}
