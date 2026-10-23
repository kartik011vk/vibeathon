import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { channels } from '../src/adapters/index.js';
import { api, auth, createRequest, prisma, setup, verify } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

describe('severity suggestions (server rules)', () => {
  it('routine small food request → NORMAL, no alert', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const row = await prisma.reliefRequest.findUnique({ where: { id: r.id } });
    expect(row.suggestedSeverity).toBe('NORMAL');
    expect(await prisma.alert.count({ where: { requestId: r.id } })).toBe(0);
  });

  it('water for 60 people → HIGH', async () => {
    const r = await createRequest(f.tokens.citizen, { category: 'WATER', peopleAffected: 60, items: [{ inventoryItemId: f.items.water.id, quantity: 20 }] }, f);
    expect((await prisma.reliefRequest.findUnique({ where: { id: r.id } })).suggestedSeverity).toBe('HIGH');
  });

  it('essentials inside an active RED zone → RED with a persisted SYSTEM_RULE alert', async () => {
    const r = await createRequest(f.tokens.citizen, { campId: f.campA.id, destinationAddress: undefined }, f);
    const row = await prisma.reliefRequest.findUnique({ where: { id: r.id } });
    expect(row.severity).toBe('RED');
    expect(row.disasterZoneId).toBe(f.zone.id);
    const alert = await prisma.alert.findFirst({ where: { requestId: r.id } });
    expect(alert).toMatchObject({ severity: 'RED', status: 'ACTIVE', source: 'SYSTEM_RULE' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'ALERT_CREATED', entityId: alert.id } });
    expect(audit).toBeTruthy();
  });

  it('medicine for 25+ vulnerable people at coordinates inside the zone → HYPER_RED', async () => {
    const r = await createRequest(
      f.tokens.citizen,
      { category: 'MEDICINE', peopleAffected: 80, vulnerableCount: 30, latitude: 30.301, longitude: 78.002, items: [{ inventoryItemId: f.items.meds.id, quantity: 5 }] },
      f,
    );
    const row = await prisma.reliefRequest.findUnique({ where: { id: r.id } });
    expect(row.severity).toBe('HYPER_RED');
    expect(row.severityReason).toMatch(/HYPER_RED/);
  });

  it('custom escalation rules created through the API change future suggestions', async () => {
    const rule = await api()
      .post('/api/v1/escalation-rules')
      .set(auth(f.tokens.coord))
      .send({ name: 'Clothing for many', conditions: { categories: ['CLOTHING'], minPeopleAffected: 30 }, resultingSeverity: 'HIGH' });
    expect(rule.status).toBe(201);
    const r = await createRequest(f.tokens.citizen, { category: 'CLOTHING', peopleAffected: 35, items: [{ name: 'Jackets', unit: 'pieces', quantity: 30 }] }, f);
    expect((await prisma.reliefRequest.findUnique({ where: { id: r.id } })).severity).toBe('HIGH');
    const list = await api().get('/api/v1/escalation-rules').set(auth(f.tokens.coord));
    expect(list.body.data.builtIn.length).toBeGreaterThan(0);
    expect(list.body.data.custom).toHaveLength(1);
    expect((await api().get('/api/v1/escalation-rules').set(auth(f.tokens.citizen))).status).toBe(403);
  });
});

describe('authorized severity overrides and escalation', () => {
  it('only coordinators can override severity, with reason, actor and before/after audited', async () => {
    const r = await createRequest(f.tokens.citizen, { campId: f.campA.id, destinationAddress: undefined, description: 'Camp food request' }, f);
    const campTry = await api().post(`/api/v1/requests/${r.id}/verify`).set(auth(f.tokens.campMgr)).send({ decision: 'VERIFY', reason: 'Looks fine to me', severity: 'NORMAL' });
    expect(campTry.status).toBe(403);
    const res = await verify(f, r.id, { severity: 'HYPER_RED', reason: 'Field report: children showing signs of malnutrition' });
    expect(res.severity).toBe('HYPER_RED');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'REQUEST_SEVERITY_OVERRIDE', entityId: r.id } });
    expect(audit.before.severity).toBe('RED');
    expect(audit.after).toMatchObject({ severity: 'HYPER_RED', reason: 'Field report: children showing signs of malnutrition' });
    expect(audit.actorId).toBe(f.users.coord.id);
    const alert = await prisma.alert.findFirst({ where: { requestId: r.id } });
    expect(alert.severity).toBe('HYPER_RED');
  });

  it('downgrading at verification resolves the automatic alert', async () => {
    const r = await createRequest(f.tokens.citizen, { campId: f.campA.id, destinationAddress: undefined, description: 'Second camp request' }, f);
    await verify(f, r.id, { severity: 'HIGH', reason: 'Camp kitchen already covering most needs' });
    const alert = await prisma.alert.findFirst({ where: { requestId: r.id } });
    expect(alert.status).toBe('RESOLVED');
  });

  it('coordinator escalation to RED creates an alert; escalation must raise severity', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const lower = await api().post(`/api/v1/requests/${r.id}/escalate`).set(auth(f.tokens.coord)).send({ severity: 'NORMAL', reason: 'no change' });
    expect(lower.status).toBe(400);
    const res = await api().post(`/api/v1/requests/${r.id}/escalate`).set(auth(f.tokens.coord)).send({ severity: 'RED', reason: 'Flood water rising at address' });
    expect(res.status).toBe(200);
    expect(res.body.meta.escalationApplied).toBe(true);
    expect(res.body.data.severity).toBe('RED');
    const alert = await prisma.alert.findFirst({ where: { requestId: r.id } });
    expect(alert).toMatchObject({ severity: 'RED', source: 'COORDINATOR_ESCALATION' });
  });
});

describe('alert lifecycle', () => {
  let alertId;
  it('creates, acknowledges once, escalates upward and resolves once', async () => {
    const created = await api().post('/api/v1/alerts').set(auth(f.tokens.coord)).send({ title: 'Bridge closed', message: 'Use northern route', severity: 'HIGH', disasterZoneId: f.zone.id });
    expect(created.status).toBe(201);
    alertId = created.body.data.id;

    const ack = await api().post(`/api/v1/alerts/${alertId}/acknowledge`).set(auth(f.tokens.campMgr)).send({ note: 'Seen' });
    expect(ack.status).toBe(200);
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
    expect((await api().post(`/api/v1/alerts/${alertId}/acknowledge`).set(auth(f.tokens.campMgr)).send({})).status).toBe(409);
    expect((await api().post(`/api/v1/alerts/${alertId}/acknowledge`).set(auth(f.tokens.citizen)).send({})).status).toBe(403);

    expect((await api().post(`/api/v1/alerts/${alertId}/escalate`).set(auth(f.tokens.coord)).send({ severity: 'NORMAL', reason: 'down' })).status).toBe(400);
    const esc = await api().post(`/api/v1/alerts/${alertId}/escalate`).set(auth(f.tokens.coord)).send({ severity: 'RED', reason: 'Second bridge also closed' });
    expect(esc.body.data).toMatchObject({ severity: 'RED', status: 'ACTIVE', escalationLevel: 1 });

    const resolved = await api().post(`/api/v1/alerts/${alertId}/resolve`).set(auth(f.tokens.coord)).send({ note: 'Bridges reopened' });
    expect(resolved.body.data.status).toBe('RESOLVED');
    const again = await api().post(`/api/v1/alerts/${alertId}/resolve`).set(auth(f.tokens.coord)).send({ note: 'again' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await api().post(`/api/v1/alerts/${alertId}/escalate`).set(auth(f.tokens.coord)).send({ severity: 'HYPER_RED', reason: 'late' })).status).toBe(409);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'Alert', entityId: alertId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_ESCALATED', 'ALERT_RESOLVED']));
  });

  it('persists the alert even when notification delivery fails', async () => {
    const original = channels.inApp.deliver;
    channels.inApp.deliver = async () => {
      throw new Error('push gateway down');
    };
    try {
      const res = await api().post('/api/v1/alerts').set(auth(f.tokens.coord)).send({ title: 'Delivery outage test', message: 'Should still persist', severity: 'RED' });
      expect(res.status).toBe(201);
      const stored = await prisma.alert.findUnique({ where: { id: res.body.data.id } });
      expect(stored).toBeTruthy();
      const notes = await prisma.notification.findMany({ where: { type: 'ALERT_CREATED', title: 'Delivery outage test' } });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.status === 'FAILED' && n.error === 'push gateway down')).toBe(true);
    } finally {
      channels.inApp.deliver = original;
    }
  });

  it('public active alerts expose zone-level alerts only', async () => {
    const res = await api().get('/api/v1/alerts/active');
    expect(res.status).toBe(200);
    expect(res.body.meta.scope).toBe('public');
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const a of res.body.data) {
      expect(a.request).toBeUndefined();
      expect(a.createdBy).toBeUndefined();
    }
    const requestAlerts = await prisma.alert.count({ where: { requestId: { not: null }, status: { not: 'RESOLVED' } } });
    expect(requestAlerts).toBeGreaterThan(0);
    const staff = await api().get('/api/v1/alerts/active').set(auth(f.tokens.coord));
    expect(staff.body.meta.scope).toBe('operational');
    expect(staff.body.data.length).toBeGreaterThan(res.body.data.length);
  });

  it('summarises open alerts from the database', async () => {
    const res = await api().get('/api/v1/alerts/summary').set(auth(f.tokens.coord));
    const open = await prisma.alert.count({ where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } });
    expect(res.body.data.openTotal).toBe(open);
  });
});
