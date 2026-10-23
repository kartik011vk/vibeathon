import { beforeAll, describe, expect, it, afterAll } from 'vitest';
import request from 'supertest';
import { api, app, auth, prisma, setup, PASSWORD } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const refreshCookie = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('dos_refresh='));

describe('registration', () => {
  it('creates a CITIZEN and ignores a client-supplied role', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'New.Person@Test.dev', password: 'Secure12345', fullName: 'New Person', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('CITIZEN');
    expect(res.body.data.user.email).toBe('new.person@test.dev');
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    const u = await prisma.user.findUnique({ where: { email: 'new.person@test.dev' } });
    expect(u.role).toBe('CITIZEN');
    expect(u.passwordHash).not.toContain('Secure12345');
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const dup = await api().post('/api/v1/auth/register').send({ email: 'new.person@test.dev', password: 'Secure12345', fullName: 'Again' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const weak = await api().post('/api/v1/auth/register').send({ email: 'weak@test.dev', password: 'short', fullName: 'Weak' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect(weak.body.error.details.some((d) => d.path === 'password')).toBe(true);
  });
});

describe('login and session', () => {
  it('rejects a wrong password with a generic message', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'citizen@test.dev', password: 'WrongPass123' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email or password is incorrect');
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'nobody@test.dev', password: 'WrongPass123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('returns the current user from /auth/me', async () => {
    const res = await api().get('/api/v1/auth/me').set(auth(f.tokens.campMgr));
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('CAMP_MANAGER');
    expect(res.body.data.assignedLocations.map((l) => l.id)).toEqual([f.campA.id]);
  });

  it('rejects missing and tampered access tokens', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    const tampered = f.tokens.citizen.slice(0, -4) + 'abcd';
    expect((await api().get('/api/v1/auth/me').set(auth(tampered))).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when a rotated token is reused', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'citizen2@test.dev', password: PASSWORD });
    const firstCookie = refreshCookie(login).split(';')[0];

    const r1 = await agent.post('/api/v1/auth/refresh').send({});
    expect(r1.status).toBe(200);
    expect(r1.body.data.accessToken).toBeTruthy();
    const secondCookie = refreshCookie(r1).split(';')[0];
    expect(secondCookie).not.toBe(firstCookie);

    // Replaying the first (already rotated) token is treated as theft.
    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', firstCookie).send({});
    expect(replay.status).toBe(401);
    // ...and the legitimate newest token is now revoked as well.
    const after = await api().post('/api/v1/auth/refresh').set('Cookie', secondCookie).send({});
    expect(after.status).toBe(401);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'AUTH_REFRESH_REUSE_DETECTED' } });
    expect(audit).toBeTruthy();
  });

  it('supports body token delivery for non-browser clients and logout revokes it', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'citizen2@test.dev', password: PASSWORD, tokenDelivery: 'body' });
    const { refreshToken, accessToken } = login.body.data;
    expect(refreshToken).toBeTruthy();
    const r = await api().post('/api/v1/auth/refresh').send({ refreshToken, tokenDelivery: 'body' });
    expect(r.status).toBe(200);
    const next = r.body.data.refreshToken;
    const out = await api().post('/api/v1/auth/logout').set(auth(accessToken)).send({ refreshToken: next });
    expect(out.status).toBe(200);
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: next })).status).toBe(401);
  });

  it('stores refresh tokens hashed', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'citizen2@test.dev', password: PASSWORD, tokenDelivery: 'body' });
    const stored = await prisma.refreshSession.findMany({ where: { tokenHash: login.body.data.refreshToken } });
    expect(stored).toHaveLength(0);
  });

  it('blocks deactivated users immediately, even with a valid access token', async () => {
    const token = f.tokens.citizen2;
    await prisma.user.update({ where: { id: f.users.citizen2.id }, data: { isActive: false } });
    expect((await api().get('/api/v1/auth/me').set(auth(token))).status).toBe(401);
    const login = await api().post('/api/v1/auth/login').send({ email: 'citizen2@test.dev', password: PASSWORD });
    expect(login.status).toBe(403);
    await prisma.user.update({ where: { id: f.users.citizen2.id }, data: { isActive: true } });
  });

  it('lets users edit only their own safe profile fields', async () => {
    const ok = await api().patch('/api/v1/users/me').set(auth(f.tokens.citizen)).send({ fullName: 'Renamed Citizen' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.fullName).toBe('Renamed Citizen');
    const sneaky = await api().patch('/api/v1/users/me').set(auth(f.tokens.citizen)).send({ role: 'ADMIN' });
    expect(sneaky.status).toBe(400);
  });
});
