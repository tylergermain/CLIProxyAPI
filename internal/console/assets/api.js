// Management API client. Uses the v8 management contract wherever a route exists.

import { store, parseJSON } from './util.js';

const V8 = '/v8/management';
const V0 = '/v0/management';

export class AuthError extends Error {}

export const getKey = () => store.get('key', '');
export const setKey = (k) => store.set('key', k);
export const clearKey = () => store.del('key');

async function request(base, path, { method = 'GET', body, text = false, query } = {}) {
  const headers = { Authorization: `Bearer ${getKey()}` };
  let payload;
  if (body !== undefined) {
    if (typeof body === 'string') {
      payload = body;
      headers['Content-Type'] = 'text/plain; charset=utf-8';
    } else {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
  }
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')) : '';
  const res = await fetch(base + path + qs, { method, headers, body: payload });
  if (res.status === 401 || (res.status === 403 && base === V8)) {
    const data = parseJSON(await res.text());
    throw new AuthError(data?.error || data?.message || 'Management key rejected');
  }
  const raw = await res.text();
  if (!res.ok) {
    const data = parseJSON(raw);
    const msg = data?.message || data?.error || raw || `HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return text ? raw : parseJSON(raw);
}

export const v8 = (path, opts) => request(V8, path, opts);
export const v0 = (path, opts) => request(V0, path, opts);

export async function verifyKey(key) {
  const res = await fetch(V8 + '/credentials', { headers: { Authorization: `Bearer ${key}` } });
  if (res.ok) return { ok: true };
  const data = parseJSON(await res.text());
  if (res.status === 404) return { ok: false, message: 'Management API is disabled. Set management.secret-key in config.yaml.' };
  return { ok: false, message: data?.error || data?.message || `HTTP ${res.status}` };
}

export const listCredentials = async () => (await v8('/credentials'))?.files ?? [];

// Proxies an upstream HTTP call through the server using a credential's token ($TOKEN$).
export async function apiCall(authIndex, method, url, header, data) {
  const r = await v8('/requests/api-call', {
    method: 'POST',
    body: { auth_index: authIndex, method, url, header, ...(data ? { data } : {}) },
  });
  return { status: r?.status_code ?? 0, body: r?.body ?? '', json: parseJSON(r?.body) };
}
