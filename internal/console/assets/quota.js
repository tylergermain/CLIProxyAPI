// Quota engine: fetches live usage windows per credential and normalizes them to
// { plan, windows: [{ id, label, remaining (0-100 | null), resetAt (ms | null) }] }.

import { apiCall, v0, v8 } from './api.js';
import { providerKey } from './providers.js';
import { parseJSON, toMs, store, pool } from './util.js';

const CLAUDE_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_PROFILE = 'https://api.anthropic.com/api/oauth/profile';
const CLAUDE_HEADERS = {
  'User-Agent': 'claude-cli/2.1.280 (external, cli)',
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};
const CLAUDE_WINDOWS = [
  ['iguana_necktie', 'fable', '7-day Fable 5'],
  ['five_hour', '5h', '5-hour limit'],
  ['seven_day', '7d', '7-day limit'],
  ['seven_day_opus', 'opus', '7-day Opus'],
  ['seven_day_sonnet', 'sonnet', '7-day Sonnet'],
  ['seven_day_oauth_apps', 'oauth-apps', '7-day OAuth apps'],
  ['seven_day_cowork', 'cowork', '7-day Cowork'],
];

const CODEX_USAGE = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
};

const KIMI_COM = 'https://api.kimi.com/coding/v1/usages';
const KIMI_AI = 'https://api.kimi.ai/coding/v1/usages';

// Window ids preferred for the provider summary headline, highest priority first.
export const HEADLINE = {
  claude: ['fable', '7d', '5h'],
  codex: ['weekly', 'monthly', '5h'],
};

// Window ids preferred for the summary's secondary line.
export const SECONDARY = {
  claude: ['7d', '5h'],
  codex: ['5h'],
};

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const clamp = (n) => Math.max(0, Math.min(100, n));

function upstreamError(res, what) {
  const body = res.json;
  const msg = body?.error?.message || body?.error_description || body?.detail || body?.message ||
    (typeof body?.error === 'string' ? body.error : '') || String(res.body || '').slice(0, 160);
  if (res.status === 401) return new Error(`${what}: token rejected (401). Re-login may be required.`);
  if (res.status === 403) return new Error(`${what}: access denied (403). ${msg}`.trim());
  if (res.status === 429) return new Error(`${what}: rate limited (429). Try again shortly.`);
  return new Error(`${what}: HTTP ${res.status}${msg ? ` · ${msg}` : ''}`);
}

// ---------- Claude ----------

function claudePlan(profile) {
  if (!profile) return null;
  const org = profile.organization || {};
  const acct = profile.account || {};
  const tier = String(org.rate_limit_tier || '').toLowerCase();
  if (org.organization_type === 'claude_team' && org.subscription_status === 'active') return 'Team';
  if (acct.has_claude_max === true || tier.includes('max')) {
    if (tier.includes('20x')) return 'Max 20x';
    if (tier.includes('5x')) return 'Max 5x';
    return 'Max';
  }
  if (acct.has_claude_pro === true) return 'Pro';
  if (acct.has_claude_max === false && acct.has_claude_pro === false) return 'Free';
  return null;
}

async function fetchClaude(cred) {
  const [usage, profile] = await Promise.allSettled([
    apiCall(cred.auth_index, 'GET', CLAUDE_USAGE, CLAUDE_HEADERS),
    apiCall(cred.auth_index, 'GET', CLAUDE_PROFILE, CLAUDE_HEADERS),
  ]);
  if (usage.status === 'rejected') throw usage.reason;
  const res = usage.value;
  if (res.status < 200 || res.status >= 300) throw upstreamError(res, 'Claude usage');
  const data = res.json;
  if (!data || typeof data !== 'object') throw new Error('Claude usage: empty response');

  // Newer responses expose model-scoped weekly limits; prefer that for Fable.
  const scoped = Array.isArray(data.limits)
    ? data.limits.filter((l) => {
        const kind = String(l?.kind || '').toLowerCase();
        const model = String(l?.scope?.model?.display_name || '').toLowerCase();
        return kind === 'weekly_scoped' && (model === 'fable' || model === 'fable 5') && num(l?.percent) !== null;
      })
    : [];
  const fable = scoped.find((l) => l.is_active === true) || scoped[0] || null;

  const windows = [];
  for (const [key, id, label] of CLAUDE_WINDOWS) {
    if (id === 'fable' && fable) {
      windows.push({ id, label, remaining: clamp(100 - num(fable.percent)), resetAt: toMs(fable.resets_at) });
      continue;
    }
    const w = data[key];
    if (!w || typeof w !== 'object' || !('utilization' in w)) continue;
    const used = num(w.utilization);
    windows.push({ id, label, remaining: used === null ? null : clamp(100 - used), resetAt: toMs(w.resets_at) });
  }
  if (!windows.length) throw new Error('Claude usage: no quota windows returned');

  let plan = null;
  if (profile.status === 'fulfilled' && profile.value.status >= 200 && profile.value.status < 300) {
    plan = claudePlan(profile.value.json);
  }
  if (!plan && cred.account_type) plan = cred.account_type;
  return { plan, windows };
}

// ---------- Codex ----------

const CODEX_PLANS = {
  pro: 'Pro', prolite: 'Pro Lite', plus: 'Plus', team: 'Team', free: 'Free',
  business: 'Business', enterprise: 'Enterprise', edu: 'Edu',
  self_serve_business_prolite: 'Business Premium',
};

function codexAccountId(cred) {
  const sources = [cred, cred.metadata, cred.attributes, cred.id_token];
  for (const s of sources) {
    const v = s && (s.chatgpt_account_id || s.chatgptAccountId);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function codexWindows(rate, prefix, labels, windows) {
  if (!rate || typeof rate !== 'object') return;
  const primary = rate.primary_window ?? rate.primaryWindow ?? null;
  const secondary = rate.secondary_window ?? rate.secondaryWindow ?? null;
  const reached = rate.limit_reached ?? rate.limitReached;
  const allowed = rate.allowed;
  const secs = (w) => num(w?.limit_window_seconds ?? w?.limitWindowSeconds);
  const isMonthly = (w) => { const s = secs(w); return s !== null && s >= 2419200 && s <= 2678400; };

  let five = null;
  let week = null;
  for (const w of [primary, secondary]) {
    if (!w) continue;
    const s = secs(w);
    if (s === 18000 && !five) five = w;
    else if ((s === 604800 || isMonthly(w)) && !week) week = w;
  }
  if (!five && primary && primary !== week) five = primary;
  if (!week && secondary && secondary !== five) week = secondary;

  const push = (w, id, label) => {
    if (!w) return;
    let used = num(w.used_percent ?? w.usedPercent);
    if (used === null && (reached || allowed === false)) used = 100;
    const resetAt = toMs(w.reset_at ?? w.resetAt) ??
      (num(w.reset_after_seconds ?? w.resetAfterSeconds) !== null
        ? Date.now() + num(w.reset_after_seconds ?? w.resetAfterSeconds) * 1000
        : null);
    windows.push({ id, label, remaining: used === null ? null : clamp(100 - used), resetAt });
  };
  push(five, `${prefix}5h`, labels.five);
  const monthly = isMonthly(week);
  push(week, `${prefix}${monthly ? 'monthly' : 'weekly'}`, monthly ? labels.month : labels.week);
}

async function fetchCodex(cred) {
  const header = { ...CODEX_HEADERS };
  const account = codexAccountId(cred);
  if (account) header['Chatgpt-Account-Id'] = account;
  const res = await apiCall(cred.auth_index, 'GET', CODEX_USAGE, header);
  if (res.status < 200 || res.status >= 300) throw upstreamError(res, 'Codex usage');
  const data = res.json;
  if (!data || typeof data !== 'object') throw new Error('Codex usage: empty response');

  const windows = [];
  codexWindows(data.rate_limit ?? data.rateLimit, '', { five: '5-hour limit', week: 'Weekly limit', month: 'Monthly limit' }, windows);
  codexWindows(data.code_review_rate_limit ?? data.codeReviewRateLimit, 'review-', {
    five: 'Code review 5-hour', week: 'Code review weekly', month: 'Code review monthly',
  }, windows);
  const extra = data.additional_rate_limits ?? data.additionalRateLimits;
  if (Array.isArray(extra)) {
    extra.forEach((item, i) => {
      const name = item?.limit_name || item?.limitName || item?.metered_feature || item?.meteredFeature || `Limit ${i + 1}`;
      const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      codexWindows(item?.rate_limit ?? item?.rateLimit, `${slug}-`, {
        five: `${name} 5-hour`, week: `${name} weekly`, month: `${name} monthly`,
      }, windows);
    });
  }
  if (!windows.length) throw new Error('Codex usage: no quota windows returned');

  const rawPlan = String(data.plan_type || data.planType || cred.id_token?.plan_type || '').toLowerCase();
  const plan = CODEX_PLANS[rawPlan] || (rawPlan ? rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1) : null);
  return { plan, windows };
}

// ---------- Kimi ----------

async function kimiURL(cred) {
  const hint = `${cred.provider || ''} ${cred.type || ''} ${cred.name || ''}`.toLowerCase();
  try {
    const text = await v8('/credentials/download', { query: { name: cred.name }, text: true });
    const file = parseJSON(text) || {};
    const domain = String(file.domain || file.base_url || file['base-url'] || '').toLowerCase();
    if (domain.includes('kimi.ai') || domain === 'ai') return KIMI_AI;
    if (domain) return KIMI_COM;
  } catch { /* fall back to name heuristics */ }
  return /kimi-ai|kimi\.ai/.test(hint) ? KIMI_AI : KIMI_COM;
}

function kimiWindowLabel(duration, unit) {
  const d = num(duration);
  const u = String(unit || '').toUpperCase();
  if (d === null) return null;
  let minutes = d;
  if (u.includes('HOUR')) minutes = d * 60;
  else if (u.includes('DAY')) minutes = d * 1440;
  else if (u.includes('SECOND')) minutes = d / 60;
  if (minutes >= 1440 * 7 && minutes % (1440 * 7) === 0) return `${minutes / (1440 * 7)}-week limit`.replace('1-week', 'Weekly');
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function kimiRow(detail, id, label) {
  const limit = num(detail?.limit);
  const used = num(detail?.used);
  const left = num(detail?.remaining);
  let remaining = null;
  if (limit !== null && limit > 0) {
    if (left !== null) remaining = clamp((left / limit) * 100);
    else if (used !== null) remaining = clamp(((limit - used) / limit) * 100);
  }
  const resetAt = toMs(detail?.reset_time ?? detail?.resetTime ?? detail?.reset_at ?? detail?.resetAt);
  return { id, label, remaining, resetAt };
}

async function fetchKimi(cred) {
  const url = await kimiURL(cred);
  const res = await apiCall(cred.auth_index, 'GET', url, { Authorization: 'Bearer $TOKEN$' });
  if (res.status < 200 || res.status >= 300) throw upstreamError(res, 'Kimi usage');
  const data = res.json;
  if (!data || typeof data !== 'object') throw new Error('Kimi usage: empty response');
  const windows = [];
  if (data.usage && typeof data.usage === 'object') windows.push(kimiRow(data.usage, 'weekly', 'Weekly limit'));
  if (Array.isArray(data.limits)) {
    data.limits.forEach((l, i) => {
      const detail = l?.detail && typeof l.detail === 'object' ? l.detail : l;
      const win = l?.window && typeof l.window === 'object' ? l.window : {};
      const label = kimiWindowLabel(win.duration ?? l.duration, win.timeUnit ?? l.timeUnit) || `Limit ${i + 1}`;
      windows.push(kimiRow(detail, `limit-${i}`, label));
    });
  }
  const month = data.usages?.limit_month_total;
  if (month && num(month.used_ratio) !== null) {
    windows.push({ id: 'monthly', label: 'Monthly limit', remaining: clamp(100 - num(month.used_ratio) * 100), resetAt: toMs(month.reset_time) });
  }
  if (!windows.length) throw new Error('Kimi usage: no quota data returned');
  return { plan: cred.account_type || null, windows };
}

// ---------- Plugin quota providers (generic) ----------

async function fetchPluginQuota(cred) {
  let data;
  try {
    data = await v0('/quota/fetch', { method: 'POST', body: { auth_index: cred.auth_index } });
  } catch (err) {
    if (err.status === 501 || err.status === 404) {
      const e = new Error('No live quota source for this provider yet.');
      e.unsupported = true;
      throw e;
    }
    throw err;
  }
  const windows = [];
  (data?.groups || []).forEach((g, gi) => {
    (g.buckets || []).forEach((b, bi) => {
      const frac = num(b.remainingFraction ?? b.remaining_fraction);
      const name = [g.displayName || g.display_name, b.window || b.description].filter(Boolean).join(' · ');
      windows.push({
        id: `g${gi}-${b.window || bi}`,
        label: name || `Bucket ${bi + 1}`,
        remaining: frac === null ? null : clamp(frac * 100),
        resetAt: toMs(b.resetTime ?? b.reset_time),
      });
    });
  });
  const plan = data?.subscription?.tierName || data?.subscription?.plan || null;
  if (!windows.length) throw new Error('Quota provider returned no buckets');
  return { plan, windows };
}

const FETCHERS = { claude: fetchClaude, codex: fetchCodex, kimi: fetchKimi };

// ---------- Cache ----------

const cache = store.get('quota', {});
const listeners = new Set();
const inflight = new Map();

export const STALE_MS = 10 * 60 * 1000;
const cacheKey = (cred) => `${cred.auth_index}:${cred.name}`;

export function quotaFor(cred) {
  return cache[cacheKey(cred)] || null;
}

export function onQuota(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(cred) {
  for (const fn of listeners) fn(cred);
}

function persist() {
  const slim = {};
  for (const [k, v] of Object.entries(cache)) if (v.status === 'ok') slim[k] = v;
  store.set('quota', slim);
}

export function isLoading(cred) {
  return inflight.has(cacheKey(cred));
}

export async function refreshQuota(cred) {
  const key = cacheKey(cred);
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    const prev = cache[key];
    emit(cred);
    try {
      const fetcher = FETCHERS[providerKey(cred)] || fetchPluginQuota;
      const result = await fetcher(cred);
      cache[key] = { status: 'ok', ...result, fetchedAt: Date.now() };
    } catch (err) {
      cache[key] = {
        status: err?.unsupported ? 'unsupported' : 'error',
        error: err?.message || String(err),
        fetchedAt: Date.now(),
        // Keep the last good numbers visible beneath the error.
        windows: prev?.windows || [],
        plan: prev?.plan || null,
      };
    } finally {
      inflight.delete(key);
      persist();
      emit(cred);
    }
  })();
  inflight.set(key, run);
  return run;
}

export function refreshMany(creds, { staleOnly = false } = {}) {
  const now = Date.now();
  const targets = creds.filter((c) => {
    if (c.disabled) return false;
    if (!staleOnly) return true;
    const q = quotaFor(c);
    if (q?.status === 'unsupported') return false;
    return !q || now - (q.fetchedAt || 0) > STALE_MS;
  });
  return pool(targets, 4, refreshQuota);
}
