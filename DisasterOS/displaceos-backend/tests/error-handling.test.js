import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { insufficientStock } from '../src/utils/errors.js';
import { api, auth, prisma, setup, PASSWORD } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const expectEnvelope = (res, code) => {
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
  expect(Array.isArray(res.body.error.details)).toBe(true);
  expect(res.body.requestId).toBeTruthy();
  expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object\.|node_modules|prisma\.|postgres/i);
};

describe('consistent error envelope', () => {
  it('unknown routes → 404 NOT_FOUND', async () => {
    const res = await api().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expectEnvelope(res, 'NOT_FOUND');
  });

  it('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expectEnvelope(res, 'VALIDATION_ERROR');
  });

  it('oversized bodies → 413', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expectEnvelope(res, 'PAYLOAD_TOO_LARGE');
  });

  it('invalid path ids → 400 with field details', async () => {
    const res = await api().get('/api/v1/requests/not-a-uuid').set(auth(f.tokens.coord));
    expect(res.status).toBe(400);
    expectEnvelope(res, 'VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ location: 'params', path: 'requestId' });
  });

  it('missing records → 404 NOT_FOUND', async () => {
    const res = await api().get('/api/v1/requests/00000000-0000-4000-8000-000000000000').set(auth(f.tokens.coord));
    expect(res.status).toBe(404);
    expectEnvelope(res, 'NOT_FOUND');
  });

  it('echoes a safe incoming X-Request-Id and replaces unsafe ones', async () => {
    const good = await api().get('/api/v1/nope').set('X-Request-Id', 'trace-12345678');
    expect(good.headers['x-request-id']).toBe('trace-12345678');
    expect(good.body.requestId).toBe('trace-12345678');
    const bad = await api().get('/api/v1/nope').set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('health exposes status only, no secrets or connection details', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/postgres|DATABASE_URL|JWT|secret|password|5433/i);
  });

  it('sets security headers and hides the framework', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('central error handler', () => {
  function appThrowing(err) {
    const a = express();
    a.use(requestId);
    a.get('/boom', () => {
      throw err;
    });
    a.use(errorHandler);
    return a;
  }

  it('turns unexpected errors into a generic 500 without leaking details', async () => {
    const err = new Error('connect ECONNREFUSED postgresql://admin:hunter2@db:5432/prod');
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(500);
    expectEnvelope(res, 'INTERNAL_ERROR');
    expect(res.body.error.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('maps known database errors to stable codes', async () => {
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', { code: 'P2002', clientVersion: 'x' });
    const res = await request(appThrowing(unique)).get('/boom');
    expect(res.status).toBe(409);
    expectEnvelope(res, 'CONFLICT');
    expect(res.body.error.message).not.toContain('email');
  });

  it('passes typed application errors through with details', async () => {
    const res = await request(appThrowing(insufficientStock([{ itemId: 'x', requested: 5, available: 2 }]))).get('/boom');
    expect(res.status).toBe(409);
    expectEnvelope(res, 'INSUFFICIENT_STOCK');
    expect(res.body.error.details[0].available).toBe(2);
  });
});

describe('rate limiting', () => {
  it('limits repeated login attempts with RATE_LIMITED', async () => {
    process.env.RATE_LIMIT_IN_TESTS = 'true';
    try {
      let last;
      for (let i = 0; i < 22; i += 1) {
        last = await api().post('/api/v1/auth/login').send({ email: 'citizen@test.dev', password: `${PASSWORD}-wrong` });
      }
      expect(last.status).toBe(429);
      expectEnvelope(last, 'RATE_LIMITED');
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});
