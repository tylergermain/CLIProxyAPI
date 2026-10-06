// Gateway pages: Quick Start connection snippets and configured API-key providers.

import { esc, icon, maskSecret, copyText } from '../util.js';
import { glyph } from '../providers.js';

function header(title, sub, actions = '') {
  return `<header class="page-head"><div><h1 class="page-title">${esc(title)}</h1><div class="page-sub">${sub}</div></div>
    <div class="head-actions">${actions}</div></header>`;
}

function snippet(title, code) {
  return `<div class="card">
    <div class="card-title">${esc(title)}<button class="icon-btn right" data-copy="${esc(code)}" title="Copy">${icon('copy')}</button></div>
    <div class="code">${esc(code)}</div></div>`;
}

export function quickStart(el, ctx) {
  let revealed = false;
  let models = null;

  function render() {
    const key = ctx.clientKeys()[0] || '<your-api-key>';
    const shown = revealed ? key : maskSecret(key);
    const origin = location.origin;
    const k = revealed ? key : '$CLIPROXY_API_KEY';
    const exportLine = `export CLIPROXY_API_KEY="${revealed ? key : maskSecret(key)}"`;

    el.innerHTML = `
      ${header('Quick Start', `${esc(origin)} <span class="dot">·</span> <span class="ok">OpenAI · Anthropic · Gemini compatible</span>`,
        `<button class="btn" data-action="reveal">${icon(revealed ? 'eyeOff' : 'eye')}${revealed ? 'Hide key' : 'Reveal key'}</button>`)}
      <div class="grid two">
        <div class="card">
          <div class="card-title">Connection</div>
          <div class="kv">
            <span class="k">OpenAI base</span><span class="v">${esc(origin)}/v1</span><button class="icon-btn" data-copy="${esc(origin)}/v1">${icon('copy')}</button>
            <span class="k">Anthropic base</span><span class="v">${esc(origin)}</span><button class="icon-btn" data-copy="${esc(origin)}">${icon('copy')}</button>
            <span class="k">Gemini base</span><span class="v">${esc(origin)}/v1beta</span><button class="icon-btn" data-copy="${esc(origin)}/v1beta">${icon('copy')}</button>
            <span class="k">API key</span><span class="v">${esc(shown)}</span><button class="icon-btn" data-copy="${esc(key)}">${icon('copy')}</button>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Available models ${models ? `<span class="muted" style="font-weight:500">${models.length}</span>` : ''}</div>
          ${models == null ? '<div class="skeleton" style="width:60%"></div>' : models.length
            ? `<div style="display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow:auto">${models.map((m) => `<span class="pill plain mono" style="cursor:pointer" data-copy="${esc(m)}" title="Copy">${esc(m)}</span>`).join('')}</div>`
            : '<div class="cred-msg">No models yet. Models appear once a provider credential is logged in.</div>'}
        </div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(420px,1fr))">
        ${snippet('Shell', `${exportLine}`)}
        ${snippet('curl · chat completions', `curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${k}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${models?.[0] || 'gpt-5'}", "messages": [{"role": "user", "content": "Hello"}]}'`)}
        ${snippet('Claude Code', `export ANTHROPIC_BASE_URL="${origin}"
export ANTHROPIC_AUTH_TOKEN="${k}"
claude`)}
        ${snippet('Codex CLI · ~/.codex/config.toml', `model_provider = "cliproxy"

[model_providers.cliproxy]
name = "CLIProxyAPI"
base_url = "${origin}/v1"
env_key = "CLIPROXY_API_KEY"
wire_api = "responses"`)}
        ${snippet('Python · OpenAI SDK', `from openai import OpenAI

client = OpenAI(base_url="${origin}/v1", api_key="${k}")
resp = client.chat.completions.create(
    model="${models?.[0] || 'gpt-5'}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`)}
        ${snippet('TypeScript · OpenAI SDK', `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${origin}/v1", apiKey: "${k}" });
const resp = await client.chat.completions.create({
  model: "${models?.[0] || 'gpt-5'}",
  messages: [{ role: "user", content: "Hello" }],
});`)}
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy); return; }
    if (e.target.closest('[data-action="reveal"]')) { revealed = !revealed; render(); }
  });

  render();
  ctx.loadConfig().then(async () => {
    render();
    const key = ctx.clientKeys()[0];
    try {
      const res = await fetch('/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      const data = await res.json();
      models = (data?.data || []).map((m) => m.id).filter(Boolean).sort();
    } catch {
      models = [];
    }
    render();
  }).catch(ctx.handleError);
}

const UPSTREAMS = [
  ['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini'], ['interactions', 'Gemini Interactions'],
  ['vertex', 'Vertex'], ['xai', 'xAI'], ['meta', 'Meta'], ['openai-compatibility', 'OpenAI-compatible'],
];

export function providers(el, ctx) {
  function render(cfg) {
    const root = cfg?.['api-keys'] && typeof cfg['api-keys'] === 'object' && !Array.isArray(cfg['api-keys']) ? cfg['api-keys'] : {};
    const sections = UPSTREAMS.map(([id, name]) => [id, name, Array.isArray(root[id]) ? root[id] : []]).filter(([, , g]) => g.length);
    const totalKeys = sections.reduce((a, [, , groups]) => a + groups.reduce((b, g) => b + (Array.isArray(g.keys) ? g.keys.length : 0), 0), 0);

    el.innerHTML = `
      ${header('API Providers', `${sections.length} provider${sections.length === 1 ? '' : 's'} <span class="dot">·</span> ${totalKeys} API key${totalKeys === 1 ? '' : 's'}`,
        `<a class="btn" href="#/config">${icon('sliders')}Edit in Config Panel</a><a class="btn primary" href="#/oauth">${icon('user')}OAuth Login</a>`)}
      <div class="banner info">${icon('info')}<div>API-key upstreams come from the <span class="mono">api-keys</span> section of config.yaml. OAuth subscriptions (Claude, Codex, Antigravity…) are managed under Auth Files and OAuth Login.</div></div>
      ${sections.length ? sections.map(([id, name, groups]) => `
        <section class="group">
          <h2 class="group-title" style="gap:10px">${glyph(id === 'openai-compatibility' ? 'openai' : id)}${esc(name)} <span class="n">${groups.length} group${groups.length === 1 ? '' : 's'}</span></h2>
          <div class="card" style="padding:6px 24px"><div class="table-wrap"><table class="table">
            <thead><tr><th>Name</th><th>Base URL</th><th>Keys</th><th>Models</th><th>Prefix</th><th>Status</th></tr></thead>
            <tbody>${groups.map((g) => {
              const keys = Array.isArray(g.keys) ? g.keys : [];
              return `<tr>
                <td><b>${esc(g.name || '—')}</b></td>
                <td class="mono" style="font-size:13px">${esc(g['base-url'] || 'default')}</td>
                <td class="mono" style="font-size:13px">${keys.map((k) => esc(maskSecret(k['api-key'] || ''))).join('<br>') || '—'}</td>
                <td class="num">${Array.isArray(g.models) ? g.models.length : 'all'}</td>
                <td class="mono">${esc(g.prefix || '—')}</td>
                <td>${g.disabled ? '<span class="pill off">Disabled</span>' : '<span class="pill ok">Enabled</span>'}</td></tr>`;
            }).join('')}</tbody></table></div></div>
        </section>`).join('') : `
        <div class="empty"><h3>No API-key providers configured</h3>
          <p>Add Gemini, Claude, Codex, xAI or any OpenAI-compatible endpoint under <span class="mono">api-keys</span> in the Config Panel.</p>
          <a class="btn primary" href="#/config">${icon('sliders')}Open Config Panel</a></div>`}`;
  }

  render(ctx.config);
  ctx.loadConfig(true).then(render).catch(ctx.handleError);
}
