// Shared helpers: escaping, formatting, storage, icons, toasts.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('cpamc.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('cpamc.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  del(key) {
    try { localStorage.removeItem('cpamc.' + key); } catch { /* storage unavailable */ }
  },
};

export function parseJSON(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
}

// Accepts ISO strings, epoch seconds or epoch milliseconds.
export function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }
  const t = new Date(String(v).replace(/(\.\d{3})\d+/, '$1')).getTime();
  return Number.isFinite(t) ? t : null;
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtStamp(ms) {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtRelative(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  if (min < 1) return 'just now';
  let s;
  if (min < 60) s = `${min} min`;
  else if (abs < 24 * 3600000) {
    const h = Math.round(abs / 3600000);
    s = `${h} hour${h === 1 ? '' : 's'}`;
  } else {
    const d = Math.floor(abs / 86400000);
    s = `${d} day${d === 1 ? '' : 's'}`;
  }
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function fmtAgo(v) {
  const ms = toMs(v);
  return ms ? fmtRelative(ms) : '—';
}

export const fmtNum = (n) => (Number(n) || 0).toLocaleString('en-US');

/** "Tue 6:00 PM" */
export function fmtWhen(ms) {
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** How long until `ms`, compactly: "45m", "3h 16m", "1d 17h". */
export function fmtIn(ms, now = Date.now()) {
  const mins = Math.max(0, Math.round((ms - now) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function maskSecret(s) {
  const v = String(s || '');
  if (v.length <= 10) return '•'.repeat(v.length);
  return v.slice(0, 7) + '•'.repeat(6) + v.slice(-4);
}

// claude-tyler@example.dev.json -> claude-t•••@e•••.dev.json
export function maskName(name) {
  const m = String(name).match(/^(.*?-)?([^@\s]+)@([^.@\s]+)(\..+)?$/);
  if (!m) return name;
  const [, prefix = '', local, domain, rest = ''] = m;
  return `${prefix}${local[0]}•••@${domain[0]}•••${rest}`;
}

export function maskEmail(email) {
  return email ? maskName(email) : '';
}

// Slanted tick meter, echoing the skewed bars of the Friday Labs mark. Coloured by what's left;
// `fill` draws a different amount (a "used" bar fills by what's used).
export function meter(remaining, cls = '', fill = remaining) {
  const v = fill == null ? 0 : Math.max(0, Math.min(100, fill));
  const t = tone(remaining) || 'none';
  const label = remaining == null ? '' : ` role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}"`;
  return `<div class="meter tone-${t}${cls ? ` ${cls}` : ''}" style="--v:${v}"${label}><i></i></div>`;
}

export function tone(remaining) {
  if (remaining == null) return '';
  if (remaining >= 65) return 'g';
  if (remaining >= 25) return 'a';
  return 'r';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'ok');
  } catch {
    toast('Copy failed', 'err');
  }
}

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}

export async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try { await fn(item); } catch { /* handled by fn */ }
    }
  });
  await Promise.all(workers);
}

const paths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  providers: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5 6.5 17M12 11.5l5.5 5.5"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6L12 3z"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  gauge: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13 4-4"/>',
  logs: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.3C3.5 8.1 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  save: '<path d="M5 3h11l4 4v14H4V3z"/><path d="M8 3v6h8M8 21v-7h8v7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
