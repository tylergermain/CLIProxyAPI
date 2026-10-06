// System pages: live logs, config editor and plugins.

import { v8 } from '../api.js';
import { esc, icon, toast } from '../util.js';

function header(title, sub, actions = '') {
  return `<header class="page-head"><div><h1 class="page-title">${esc(title)}</h1><div class="page-sub">${sub}</div></div>
    <div class="head-actions">${actions}</div></header>`;
}

function colorize(line) {
  // The server pads columns with runs of spaces; collapse them so lines wrap cleanly.
  let s = esc(String(line).replace(/ {2,}/g, ' '));
  s = s.replace(/^\[([^\]]+)\]/, '<span class="ts">[$1]</span>');
  s = s.replace(/\[(debug|info|warn|warning|error|fatal)\s*\]/i, (m, lv) => `<span class="lv-${lv.toLowerCase().replace('warning', 'warn')}">${m}</span>`);
  s = s.replace(/\s([2-5])(\d\d) \|/, (m, a, b) => ` <span class="s${a}">${a}${b}</span> |`);
  return s;
}

export function logs(el, ctx) {
  const MAX = 2000;
  let lines = [];
  let latest = 0;
  let paused = false;
  let filter = '';
  let error = '';

  el.innerHTML = `
    ${header('Logs Viewer', '<span id="log-count">0 lines</span> <span class="dot">·</span> <span class="ok" id="log-state">live</span>',
      `<button class="btn" data-action="pause">${icon('pause')}Pause</button><button class="btn danger" data-action="clear">${icon('trash')}Clear logs</button>`)}
    <div class="logs-toolbar"><input class="input" placeholder="Filter lines (e.g. error, /v1/chat, 429)" data-action="filter"></div>
    <div class="log-view" id="log-view"></div>`;
  const view = el.querySelector('#log-view');

  function paint() {
    const q = filter.toLowerCase();
    const shown = q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
    const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
    view.innerHTML = error
      ? `<div class="log-line lv-error">${esc(error)}</div>`
      : shown.length ? shown.map((l) => `<div class="log-line">${colorize(l)}</div>`).join('') : '<div class="log-line ts">No log lines yet.</div>';
    if (atBottom || !view.dataset.init) { view.scrollTop = view.scrollHeight; view.dataset.init = '1'; }
    el.querySelector('#log-count').textContent = `${lines.length} line${lines.length === 1 ? '' : 's'}`;
    const st = el.querySelector('#log-state');
    st.textContent = paused ? 'paused' : 'live';
    st.className = paused ? 'warn' : 'ok';
  }

  async function fetchLogs() {
    if (paused) return;
    try {
      const r = await v8('/observability/logs', { query: latest ? { after: latest } : { limit: 500 } });
      const fresh = r?.lines || [];
      if (r?.['latest-timestamp']) latest = r['latest-timestamp'];
      error = '';
      if (fresh.length) {
        lines = lines.concat(fresh).slice(-MAX);
        paint();
      } else if (!view.dataset.init) {
        paint();
      }
    } catch (err) {
      if (ctx.handleError(err)) return;
      error = /disabled/i.test(err.message)
        ? 'File logging is disabled. Set observability.logs.logging-to-file: true in the Config Panel.'
        : err.message;
      paint();
    }
  }

  el.addEventListener('input', (e) => {
    if (e.target.dataset.action === 'filter') { filter = e.target.value; paint(); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t || t.tagName === 'INPUT') return;
    if (t.dataset.action === 'pause') {
      paused = !paused;
      t.innerHTML = paused ? `${icon('play')}Resume` : `${icon('pause')}Pause`;
      paint();
      if (!paused) fetchLogs();
    } else if (t.dataset.action === 'clear') {
      if (!confirm('Delete all rotated log files and truncate the active log on the server?')) return;
      try {
        await v8('/observability/logs', { method: 'DELETE' });
        lines = [];
        paint();
        toast('Logs cleared', 'ok');
      } catch (err) { ctx.handleError(err); }
    }
  });

  fetchLogs();
  const timer = setInterval(fetchLogs, 2500);
  return () => clearInterval(timer);
}

export function config(el, ctx) {
  let original = '';

  el.innerHTML = `
    ${header('Config Panel', '<span>config.yaml</span> <span class="dot">·</span> <span class="ok" id="cfg-state">loading</span>',
      `<button class="btn" data-action="reload">${icon('refresh')}Reload</button><button class="btn primary" data-action="save" disabled>${icon('save')}Save</button>`)}
    <div class="banner">${icon('warn')}<div>Changes are written to config.yaml and hot-reloaded. Plaintext secrets (like the management key) are hashed when saved.</div></div>
    <textarea class="editor" spellcheck="false" id="cfg"></textarea>`;
  const ta = el.querySelector('#cfg');
  const save = el.querySelector('[data-action="save"]');
  const state = el.querySelector('#cfg-state');

  const setState = (text, cls = 'ok') => { state.textContent = text; state.className = cls; };

  async function load() {
    try {
      original = await v8('/config.yaml', { text: true });
      ta.value = original;
      save.disabled = true;
      setState('saved');
    } catch (err) {
      ctx.handleError(err);
      setState('failed to load', 'bad');
    }
  }

  ta.addEventListener('input', () => {
    const dirty = ta.value !== original;
    save.disabled = !dirty;
    setState(dirty ? 'unsaved changes' : 'saved', dirty ? 'warn' : 'ok');
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!save.disabled) save.click(); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    if (t.dataset.action === 'reload') {
      if (ta.value !== original && !confirm('Discard unsaved changes?')) return;
      load();
    } else if (t.dataset.action === 'save') {
      save.disabled = true;
      setState('saving…', 'warn');
      try {
        await v8('/config.yaml', { method: 'PUT', body: ta.value });
        toast('Config saved', 'ok');
        ctx.config = null;
        await load();
      } catch (err) {
        ctx.handleError(err);
        save.disabled = false;
        setState('save failed', 'bad');
      }
    }
  });

  load();
}

function pluginLogo(p) {
  const logo = p.logo || p.metadata?.logo;
  if (logo && /^(https?:|data:image\/)/.test(logo)) return `<img src="${esc(logo)}" alt="" width="36" height="36" style="border-radius:9px;flex:none">`;
  const name = p.metadata?.name || p.name || p.id || '?';
  return `<div style="width:36px;height:36px;border-radius:9px;background:var(--hover);display:grid;place-items:center;font-weight:700;flex:none">${esc(name.charAt(0).toUpperCase())}</div>`;
}

export function plugins(el, ctx) {
  async function load() {
    el.innerHTML = `${header('Plugins', 'loading…')}<div class="card"><div class="skeleton" style="width:50%"></div></div>`;
    try {
      const r = await v8('/plugins');
      const list = r?.plugins || [];
      el.innerHTML = `
        ${header('Plugins', `${list.length} installed <span class="dot">·</span> <span class="${r?.plugins_enabled ? 'ok' : 'warn'}">${r?.plugins_enabled ? 'plugins enabled' : 'plugins disabled'}</span>`)}
        ${r?.plugins_dir ? `<div class="banner info">${icon('info')}<div>Plugin directory: <span class="mono">${esc(r.plugins_dir)}</span></div></div>` : ''}
        ${list.length ? `<div class="card" style="padding:6px 24px"><div class="row-list">${list.map((p) => `
          <div class="row-item">${pluginLogo(p)}
            <div class="grow"><div style="font-weight:600">${esc(p.metadata?.name || p.id)} <span class="muted" style="font-weight:400">${esc(p.metadata?.version || '')}</span></div>
              <div class="sub">${esc(p.id)}${p.metadata?.author ? ` · ${esc(p.metadata.author)}` : ''}${p.supports_quota ? ' · quota' : ''}${p.supports_oauth ? ' · OAuth' : ''}</div></div>
            ${p.effective_enabled ? '<span class="pill ok">Enabled</span>' : '<span class="pill off">Inactive</span>'}
            <button class="icon-btn danger" data-action="delete" data-id="${esc(p.id)}" title="Uninstall">${icon('trash')}</button>
          </div>`).join('')}</div></div>`
          : `<div class="empty"><h3>No plugins installed</h3><p>Plugins add OAuth providers, quota sources and request hooks.</p></div>`}`;
    } catch (err) {
      ctx.handleError(err);
      el.innerHTML = `${header('Plugins', '<span class="bad">failed to load</span>')}<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action="delete"]');
    if (!t) return;
    if (!confirm(`Uninstall plugin ${t.dataset.id}?`)) return;
    try {
      await v8(`/plugins/${encodeURIComponent(t.dataset.id)}`, { method: 'DELETE' });
      toast('Plugin removed', 'ok');
      load();
    } catch (err) { ctx.handleError(err); }
  });
  load();
}
