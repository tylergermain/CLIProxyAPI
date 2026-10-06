// App shell: sign-in, sidebar navigation, hash router and shared context.

import { AuthError, getKey, setKey, clearKey, verifyKey, listCredentials, v8 } from './api.js';
import { esc, icon, store, toast } from './util.js';
import * as quotaPage from './pages/quota.js';
import * as dashboardPage from './pages/dashboard.js';
import * as gatewayPages from './pages/gateway.js';
import * as credentialPages from './pages/credentials.js';
import * as systemPages from './pages/system.js';

const NAV = [
  { section: 'Operate' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', page: dashboardPage.dashboard },
  { id: 'quick-start', label: 'Quick Start', icon: 'zap', page: gatewayPages.quickStart },
  { section: 'Gateway' },
  // Hidden from the sidebar (rarely used); still at #/providers.
  { id: 'providers', label: 'API Providers', icon: 'providers', page: gatewayPages.providers, hidden: true },
  { id: 'auth-files', label: 'Auth Files', icon: 'shield', page: credentialPages.authFiles, badge: 'creds' },
  { id: 'oauth', label: 'OAuth Login', icon: 'user', page: credentialPages.oauthLogin },
  { section: 'Observe' },
  { id: 'quota', label: 'Quota Management', icon: 'gauge', page: quotaPage.quota },
  { id: 'logs', label: 'Logs Viewer', icon: 'logs', page: systemPages.logs },
  { section: 'Control' },
  { id: 'config', label: 'Config Panel', icon: 'sliders', page: systemPages.config },
  { id: 'plugins', label: 'Plugins', icon: 'plug', page: systemPages.plugins },
  { id: 'management-center', label: 'Management Center', icon: 'server', href: '/management.html' },
  { id: 'sign-out', label: 'Sign out', icon: 'logout', action: 'sign-out' },
];

const app = document.getElementById('app');
const main = document.getElementById('main');
const nav = document.getElementById('nav');
let cleanup = null;

// ---------- Shared context ----------

const ctx = {
  creds: [],
  credsAt: 0,
  config: null,
  async loadCreds(force = false) {
    if (!force && Date.now() - this.credsAt < 4000) return this.creds;
    this.creds = await listCredentials();
    this.credsAt = Date.now();
    renderNav();
    return this.creds;
  },
  async loadConfig(force = false) {
    if (!force && this.config) return this.config;
    this.config = await v8('/config');
    return this.config;
  },
  clientKeys() {
    const keys = this.config?.access?.['api-keys'];
    return Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
  },
  handleError(err) {
    if (err instanceof AuthError) {
      clearKey();
      showLogin(err.message);
      return true;
    }
    toast(err?.message || String(err), 'err');
    return false;
  },
};

// ---------- Navigation ----------

function currentRoute() {
  const id = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  return NAV.find((n) => n.id === id && n.page) || NAV.find((n) => n.id === 'dashboard');
}

function renderNav() {
  const active = currentRoute()?.id;
  nav.innerHTML = NAV.filter((n) => !n.hidden).map((n) => {
    if (n.section) return `<div class="nav-section">${esc(n.section)}</div>`;
    const badge = n.badge === 'creds' && ctx.creds.length ? `<span class="count">${ctx.creds.length}</span>` : '';
    const inner = `${icon(n.icon)}<span class="nav-label">${esc(n.label)}</span>${badge}`;
    if (n.href) {
      return `<a class="nav-item" href="${n.href}" target="_blank" rel="noopener" title="${esc(n.label)}">${inner}${icon('external', 'ext')}</a>`;
    }
    if (n.action) {
      return `<a class="nav-item" href="#" data-action="${n.action}" title="${esc(n.label)}">${inner}</a>`;
    }
    return `<a class="nav-item${n.id === active ? ' active' : ''}" href="#/${n.id}" title="${esc(n.label)}">${inner}</a>`;
  }).join('');
}

nav.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action="sign-out"]');
  if (!a) return;
  e.preventDefault();
  clearKey();
  showLogin();
});

document.getElementById('collapse').addEventListener('click', () => {
  app.classList.toggle('collapsed');
  store.set('collapsed', app.classList.contains('collapsed'));
});
if (store.get('collapsed', false)) app.classList.add('collapsed');

function route() {
  if (!getKey()) {
    showLogin();
    return;
  }
  const r = currentRoute();
  renderNav();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  main.innerHTML = '';
  main.scrollTop = 0;
  document.getElementById('sidebar').classList.remove('hidden');
  document.title = `${r.label} · Friday Proxy`;
  const el = document.createElement('div');
  el.className = 'page';
  main.appendChild(el);
  try {
    cleanup = r.page(el, ctx) || null;
  } catch (err) {
    ctx.handleError(err);
  }
}

window.addEventListener('hashchange', route);

// ---------- Sign-in ----------

function showLogin(message = '') {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  document.getElementById('sidebar').classList.add('hidden');
  document.title = 'Sign in · Friday Proxy';
  main.innerHTML = `
    <div class="login-wrap">
      <div class="login card">
        <img src="logo.png" width="48" height="48" alt="Friday Labs" style="border-radius:12px">
        <h1>Friday Proxy</h1>
        <p>Enter the management key (<span class="mono">management.secret-key</span> in config.yaml) for this Friday Proxy server.</p>
        <form id="login-form">
          <input class="input" id="login-key" type="password" placeholder="Management key" autocomplete="current-password" autofocus>
          <div class="err" id="login-err">${esc(message)}</div>
          <button class="btn primary" type="submit">${icon('key')}Sign in</button>
        </form>
      </div>
    </div>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('login-key').value.trim();
    const errEl = document.getElementById('login-err');
    if (!key) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    errEl.textContent = '';
    try {
      const res = await verifyKey(key);
      if (!res.ok) {
        errEl.textContent = res.message;
        return;
      }
      setKey(key);
      ctx.credsAt = 0;
      ctx.config = null;
      route();
    } catch (err) {
      errEl.textContent = err?.message || 'Could not reach the server';
    } finally {
      btn.disabled = false;
    }
  });
}

route();
