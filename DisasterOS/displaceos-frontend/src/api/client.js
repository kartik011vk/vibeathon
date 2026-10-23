// Central API client. Matches the backend envelope:
//   success → { success: true, data, meta }   error → { success: false, error: { code, message, details }, requestId }
// The access token lives in memory only. The refresh token is an httpOnly cookie the browser sends to /api/v1/auth.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  accessToken = token;
  listeners.forEach((fn) => fn(token));
}
export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor({ status, code, message, details = [], requestId }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  fieldErrors() {
    const out = {};
    for (const d of this.details ?? []) if (d?.path && d.message) out[d.path] = d.message;
    return out;
  }
}

function buildUrl(path, query) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON (e.g. a proxy error page)
  }
  if (res.ok && body?.success !== false) return { data: body?.data, meta: body?.meta ?? {} };
  throw new ApiError({
    status: res.status,
    code: body?.error?.code ?? (res.status === 502 || res.status === 504 ? 'SERVER_UNREACHABLE' : 'HTTP_ERROR'),
    message: body?.error?.message ?? (res.status >= 500 ? 'The server could not complete this request.' : `Request failed (${res.status})`),
    details: body?.error?.details ?? [],
    requestId: body?.requestId,
  });
}

async function raw(method, path, { body, query, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: navigator.onLine === false ? 'OFFLINE' : 'NETWORK',
      message: navigator.onLine === false ? 'You appear to be offline.' : 'Cannot reach the DisplaceOS server right now.',
    });
  }
  return parse(res);
}

// Single-flight refresh: concurrent 401s share one refresh call.
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = raw('POST', '/auth/refresh', { body: {}, auth: false })
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data;
      })
      .catch((err) => {
        setAccessToken(null);
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Credential endpoints never trigger a refresh-and-retry.
const NO_REFRESH = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']);

export async function request(method, path, opts = {}) {
  try {
    return await raw(method, path, opts);
  } catch (err) {
    const canRetry = err instanceof ApiError && err.status === 401 && opts.auth !== false && accessToken && !NO_REFRESH.has(path);
    if (!canRetry) throw err;
    await refreshSession();
    return raw(method, path, opts);
  }
}

export const api = {
  get: (path, query, opts) => request('GET', path, { query, ...opts }),
  post: (path, body = {}, opts) => request('POST', path, { body, ...opts }),
  patch: (path, body = {}, opts) => request('PATCH', path, { body, ...opts }),
};

// Convenience for React Query: return only `data`.
export const getData = async (path, query, opts) => (await api.get(path, query, opts)).data;
