import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setAccessToken } from '../api/client.js';

const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setAccessToken(null);
  });

  it('unwraps the success envelope into data and meta', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(200, { success: true, data: [{ id: 1 }], meta: { total: 1 } }));
    const res = await api.get('/requests', { status: ['SUBMITTED', 'VERIFIED'], empty: '' });
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.meta.total).toBe(1);
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('status=SUBMITTED%2CVERIFIED');
    expect(url).not.toContain('empty');
  });

  it('turns the error envelope into an ApiError with field details', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Some fields are missing', details: [{ path: 'peopleAffected', message: 'Required' }] }, requestId: 'abc' }),
    );
    const err = await api.post('/requests', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.requestId).toBe('abc');
    expect(err.fieldErrors()).toEqual({ peopleAffected: 'Required' });
  });

  it('reports network failures without inventing data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await api.get('/health').catch((e) => e);
    expect(err.code).toMatch(/NETWORK|OFFLINE/);
    expect(err.status).toBe(0);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('expired');
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      calls.push([url, opts.headers.Authorization]);
      if (url.endsWith('/auth/refresh')) return json(200, { success: true, data: { accessToken: 'fresh' } });
      if (opts.headers.Authorization === 'Bearer expired') return json(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'expired' } });
      return json(200, { success: true, data: { ok: true } });
    });
    const res = await api.get('/auth/me');
    expect(res.data.ok).toBe(true);
    expect(calls.map((c) => c[1])).toEqual(['Bearer expired', undefined, 'Bearer fresh']);
  });
});
