import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createRequest, prisma, setup } from './helpers.js';

let f;
let ownReq;
let otherReq;
let campReqA;
let campReqB;

beforeAll(async () => {
  f = await setup();
  ownReq = await createRequest(f.tokens.citizen, {}, f);
  otherReq = await createRequest(f.tokens.citizen2, { description: 'Other family needs food' }, f);
  campReqA = await createRequest(f.tokens.citizen, { campId: f.campA.id, destinationAddress: undefined }, f);
  campReqB = await createRequest(f.tokens.citizen2, { campId: f.campB.id, destinationAddress: undefined }, f);
});
afterAll(() => prisma.$disconnect());

describe('authentication is required', () => {
  const protectedRoutes = [
    ['get', '/api/v1/requests'],
    ['post', '/api/v1/requests'],
    ['get', '/api/v1/alerts'],
    ['get', '/api/v1/allocations'],
    ['get', '/api/v1/dispatches'],
    ['get', '/api/v1/teams'],
    ['get', '/api/v1/notifications'],
    ['get', '/api/v1/notification-preferences'],
    ['get', '/api/v1/dashboard/summary'],
    ['get', '/api/v1/audit-logs'],
    ['get', '/api/v1/users'],
    ['get', '/api/v1/map/requests'],
    ['post', '/api/v1/inventory/transactions'],
  ];
  it.each(protectedRoutes)('%s %s → 401', async (method, path) => {
    const res = await api()[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('request ownership and camp scope', () => {
  it('citizens only list their own requests', async () => {
    const res = await api().get('/api/v1/requests').set(auth(f.tokens.citizen));
    const ids = res.body.data.map((r) => r.id);
    expect(ids).toContain(ownReq.id);
    expect(ids).not.toContain(otherReq.id);
    expect(res.body.data.every((r) => r.isOwn)).toBe(true);
  });

  it("returns 404 (not 403) for another citizen's request so existence is not leaked", async () => {
    for (const path of ['', '/timeline', '/tracking']) {
      const res = await api().get(`/api/v1/requests/${otherReq.id}${path}`).set(auth(f.tokens.citizen));
      expect(res.status).toBe(404);
    }
    const patch = await api().patch(`/api/v1/requests/${otherReq.id}`).set(auth(f.tokens.citizen)).send({ description: 'hijacked text' });
    expect(patch.status).toBe(404);
    const cancel = await api().post(`/api/v1/requests/${otherReq.id}/cancel`).set(auth(f.tokens.citizen)).send({ reason: 'not mine' });
    expect(cancel.status).toBe(404);
  });

  it('camp managers see only requests for their assigned camps', async () => {
    const list = await api().get('/api/v1/requests').set(auth(f.tokens.campMgr));
    const ids = list.body.data.map((r) => r.id);
    expect(ids).toEqual([campReqA.id]);
    expect((await api().get(`/api/v1/requests/${campReqB.id}`).set(auth(f.tokens.campMgr))).status).toBe(404);
    expect((await api().get(`/api/v1/requests/${campReqA.id}`).set(auth(f.tokens.campMgr))).status).toBe(200);
  });

  it('camp managers cannot file requests for camps they do not manage', async () => {
    const res = await api()
      .post('/api/v1/requests')
      .set(auth(f.tokens.campMgr))
      .send({ category: 'FOOD', description: 'Food for the camp', peopleAffected: 5, campId: f.campB.id, items: [{ inventoryItemId: f.items.food.id, quantity: 1 }] });
    expect(res.status).toBe(403);
  });

  it('response teams and inventory managers cannot browse unrelated requests', async () => {
    for (const key of ['team1', 'inv']) {
      const res = await api().get('/api/v1/requests').set(auth(f.tokens[key]));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    }
  });

  it('citizens cannot change fields reserved for staff', async () => {
    const res = await api().patch(`/api/v1/requests/${ownReq.id}`).set(auth(f.tokens.citizen)).send({ disasterZoneId: f.zone.id });
    expect(res.status).toBe(403);
  });

  it('citizens never receive exact coordinates of other people on the map', async () => {
    const res = await api().get('/api/v1/map/requests').set(auth(f.tokens.citizen));
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.isOwn)).toBe(true);
    expect((await api().get('/api/v1/map/teams').set(auth(f.tokens.citizen))).status).toBe(403);
  });
});

describe('privilege escalation is prevented', () => {
  it('non-admins cannot change roles', async () => {
    for (const key of ['citizen', 'coord', 'campMgr', 'inv']) {
      const res = await api().patch(`/api/v1/users/${f.users[key].id}/role`).set(auth(f.tokens[key])).send({ role: 'ADMIN', reason: 'let me in' });
      expect(res.status).toBe(403);
    }
    const u = await prisma.user.findUnique({ where: { id: f.users.citizen.id } });
    expect(u.role).toBe('CITIZEN');
  });

  it('admins can change roles; the change is audited and old sessions are revoked', async () => {
    const res = await api()
      .patch(`/api/v1/users/${f.users.citizen2.id}/role`)
      .set(auth(f.tokens.admin))
      .send({ role: 'CAMP_MANAGER', locationIds: [f.campB.id], reason: 'Volunteer promoted to camp manager' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('CAMP_MANAGER');
    const log = await prisma.auditLog.findFirst({ where: { action: 'USER_ROLE_CHANGED', entityId: f.users.citizen2.id } });
    expect(log.before.role).toBe('CITIZEN');
    expect(log.after.role).toBe('CAMP_MANAGER');
    expect(log.actorId).toBe(f.users.admin.id);
    const live = await prisma.refreshSession.count({ where: { userId: f.users.citizen2.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('admins cannot demote themselves', async () => {
    const res = await api().patch(`/api/v1/users/${f.users.admin.id}/role`).set(auth(f.tokens.admin)).send({ role: 'CITIZEN', reason: 'oops' });
    expect(res.status).toBe(400);
  });

  it('coordinators can list staff but not citizen accounts; citizens cannot list users', async () => {
    const res = await api().get('/api/v1/users').set(auth(f.tokens.coord));
    expect(res.status).toBe(200);
    expect(res.body.data.some((u) => u.role === 'CITIZEN')).toBe(false);
    expect((await api().get('/api/v1/users').set(auth(f.tokens.citizen))).status).toBe(403);
  });

  it('role-restricted actions are rejected for other roles', async () => {
    expect((await api().post(`/api/v1/requests/${ownReq.id}/verify`).set(auth(f.tokens.citizen)).send({ decision: 'VERIFY', reason: 'self verify' })).status).toBe(403);
    expect((await api().post('/api/v1/alerts').set(auth(f.tokens.citizen)).send({ title: 'Fake', message: 'Fake alert', severity: 'HYPER_RED' })).status).toBe(403);
    expect((await api().post('/api/v1/inventory/transactions').set(auth(f.tokens.citizen)).send({ type: 'RECEIPT', itemId: f.items.food.id, locationId: f.warehouse.id, quantity: 5, reason: 'free stock' })).status).toBe(403);
    expect((await api().get('/api/v1/audit-logs').set(auth(f.tokens.coord))).status).toBe(403);
    expect((await api().post('/api/v1/locations').set(auth(f.tokens.coord)).send({ name: 'X', type: 'CAMP' })).status).toBe(403);
  });

  it('inventory managers can only move stock at their assigned locations', async () => {
    const res = await api()
      .post('/api/v1/inventory/transactions')
      .set(auth(f.tokens.inv))
      .send({ type: 'RECEIPT', itemId: f.items.food.id, locationId: f.depot.id, quantity: 5, reason: 'not my site' });
    expect(res.status).toBe(403);
  });
});
