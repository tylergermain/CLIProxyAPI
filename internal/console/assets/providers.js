// Provider registry: display names, glyphs, and OAuth login descriptors.

const glyphs = {
  claude: `<svg viewBox="0 0 24 24" class="pg"><g stroke="#d97757" stroke-width="2.6" stroke-linecap="round">
    <path d="M12 3v6.2"/><path d="M12 14.8V21"/><path d="M3 12h6.2"/><path d="M14.8 12H21"/>
    <path d="m5.6 5.6 4.4 4.4"/><path d="m14 14 4.4 4.4"/><path d="m18.4 5.6-4.4 4.4"/><path d="m10 14-4.4 4.4"/></g></svg>`,
  codex: `<svg viewBox="0 0 24 24" class="pg"><defs><linearGradient id="cxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8aa2ff"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="url(#cxg)"/><path d="m7.5 9 3 3-3 3M12.5 15.5h4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  antigravity: `<svg viewBox="0 0 24 24" class="pg"><defs><linearGradient id="agg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#4285f4"/><stop offset=".6" stop-color="#7c6cf2"/><stop offset="1" stop-color="#ea4335"/></linearGradient></defs>
    <path d="M3.5 20.5 12 3.5l8.5 17" fill="none" stroke="url(#agg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  xai: `<svg viewBox="0 0 24 24" class="pg"><g fill="none" stroke="#e8e8ea" stroke-width="2" stroke-linecap="round"><path d="M17.5 8.2A7 7 0 1 1 15.8 6"/><path d="M4 20 20 4"/></g></svg>`,
  kimi: `<svg viewBox="0 0 24 24" class="pg"><rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#f4f4f5"/><path d="M8.5 6.5v11M15.5 6.5 9.5 12l6 5.5" fill="none" stroke="#0b0b0c" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="7" r="1.4" fill="#2f6bff"/></svg>`,
  gemini: `<svg viewBox="0 0 24 24" class="pg"><defs><linearGradient id="gmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#b072ff"/></linearGradient></defs>
    <path d="M12 2.5c.6 5.2 4.3 8.9 9.5 9.5-5.2.6-8.9 4.3-9.5 9.5-.6-5.2-4.3-8.9-9.5-9.5 5.2-.6 8.9-4.3 9.5-9.5z" fill="url(#gmg)"/></svg>`,
};

function letterGlyph(letter, color) {
  return `<svg viewBox="0 0 24 24" class="pg"><circle cx="12" cy="12" r="9.5" fill="${color}"/><text x="12" y="16.2" text-anchor="middle" font-size="11.5" font-weight="700" font-family="-apple-system,system-ui,sans-serif" fill="#0b0b0c">${letter}</text></svg>`;
}

export const PROVIDERS = {
  claude: { name: 'Claude', glyph: glyphs.claude },
  codex: { name: 'Codex', glyph: glyphs.codex },
  antigravity: { name: 'Antigravity', glyph: glyphs.antigravity },
  xai: { name: 'xAI', glyph: glyphs.xai },
  kimi: { name: 'Kimi', glyph: glyphs.kimi },
  gemini: { name: 'Gemini', glyph: glyphs.gemini },
  vertex: { name: 'Vertex', glyph: glyphs.gemini },
  devin: { name: 'Devin', glyph: letterGlyph('D', '#8dc9f5') },
  meta: { name: 'Meta', glyph: letterGlyph('M', '#64b5f6') },
};

// Tabs that always appear on the quota page, in display order.
export const PINNED = ['claude', 'antigravity', 'codex', 'xai', 'kimi'];

export function providerKey(cred) {
  const raw = String(cred?.provider || cred?.type || '').toLowerCase().trim();
  if (raw === 'anthropic') return 'claude';
  if (raw.startsWith('kimi')) return 'kimi';
  if (raw.startsWith('gemini')) return 'gemini';
  if (raw === 'grok') return 'xai';
  return raw || 'unknown';
}

export function providerMeta(key) {
  if (PROVIDERS[key]) return PROVIDERS[key];
  const name = key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown';
  return { name, glyph: letterGlyph(name.charAt(0), '#a1a1aa') };
}

export const glyph = (key, cls = '') => providerMeta(key).glyph.replace('class="pg"', `class="pg ${cls}"`);

export const OAUTH = [
  { id: 'claude', provider: 'claude', name: 'Claude', desc: 'Claude Pro / Max / Team subscription via Anthropic OAuth.' },
  { id: 'codex', provider: 'codex', name: 'Codex', desc: 'ChatGPT Plus / Pro / Team subscription via OpenAI OAuth.' },
  { id: 'antigravity', provider: 'antigravity', name: 'Antigravity', desc: 'Google Antigravity account via Google OAuth.' },
  { id: 'xai', provider: 'xai', name: 'xAI', desc: 'Grok subscription via xAI OAuth.' },
  { id: 'kimi', provider: 'kimi', name: 'Kimi (kimi.com)', desc: 'Kimi coding plan on kimi.com.' },
  { id: 'kimi-ai', provider: 'kimi', name: 'Kimi (kimi.ai)', desc: 'Kimi coding plan on the international kimi.ai domain.' },
  { id: 'devin', provider: 'devin', name: 'Devin', desc: 'Devin account via Cognition OAuth.' },
  { id: 'meta', provider: 'meta', name: 'Meta', desc: 'Meta AI (Muse) account via Meta OAuth.' },
];
