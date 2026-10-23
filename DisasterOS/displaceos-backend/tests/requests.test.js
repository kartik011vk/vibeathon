import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, createRequest, prisma, setup, verify } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

describe('request creation', () => {
  it('creates a SUBMITTED request with a server-generated reference and timeline', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    expect(r.status).toBe('SUBMITTED');
    expect(r.referenceCode).toMatch(/^DR-[2-9A-HJ-NP-Z]{6}$/);
    expect(r.items[0]).toMatchObject({ name: 'Ration kit', unit: 'kits', quantity: 10, deliveredQuantity: 0, remainingQuantity: 10 });
    expect(r.suggestedSeverity).toBeUndefined(); // internal rule output is hidden from citizens
    const events = await prisma.requestTimelineEvent.findMany({ where: { requestId: r.id } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['CREATED', 'SEVERITY_SUGGESTED']));
    const audit = await prisma.auditLog.findFirst({ where: { action: 'REQUEST_CREATED', entityId: r.id } });
    expect(audit.actorId).toBe(f.users.citizen.id);
  });

  it('rejects client-controlled severity, status and requester fields', async () => {
    for (const extra of [{ severity: 'HYPER_RED' }, { status: 'DELIVERED' }, { requesterId: f.users.citizen2.id }]) {
      const res = await api()
        .post('/api/v1/requests')
        .set(auth(f.tokens.citizen))
        .send({ category: 'FOOD', description: 'Need food please', peopleAffected: 2, destinationAddress: 'x', items: [{ inventoryItemId: f.items.food.id, quantity: 1 }], ...extra });
      expect(res.status).toBe(400);
    }
  });

  it('validates location, item and quantity rules', async () => {
    const base = { category: 'FOOD', description: 'Need food please', peopleAffected: 2, items: [{ inventoryItemId: f.items.food.id, quantity: 1 }] };
    const cases = [
      { ...base }, // no camp/address/coordinates
      { ...base, destinationAddress: 'x', latitude: 30.1 }, // latitude without longitude
      { ...base, destinationAddress: 'x', latitude: 120, longitude: 10 }, // out of range
      { ...base, destinationAddress: 'x', items: [{ inventoryItemId: f.items.food.id, quantity: 0 }] },
      { ...base, destinationAddress: 'x', vulnerableCount: 5 }, // more vulnerable than affected
      { ...base, destinationAddress: 'x', items: [{ name: 'Mystery item', quantity: 2 }] }, // free-text item without unit
    ];
    for (const body of cases) {
      const res = await api().post('/api/v1/requests').set(auth(f.tokens.citizen)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('accepts free-text items with a unit for needs outside the catalogue', async () => {
    const r = await createRequest(f.tokens.citizen, { category: 'OTHER', items: [{ name: 'Wheelchair', unit: 'pieces', quantity: 1 }] }, f);
    expect(r.items[0]).toMatchObject({ inventoryItemId: null, name: 'Wheelchair', category: 'OTHER' });
  });
});

describe('request lifecycle', () => {
  it('lets the owner edit while SUBMITTED, then locks edits after verification', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const edit = await api().patch(`/api/v1/requests/${r.id}`).set(auth(f.tokens.citizen)).send({ peopleAffected: 12 });
    expect(edit.status).toBe(200);
    expect(edit.body.data.peopleAffected).toBe(12);
    await verify(f, r.id);
    const late = await api().patch(`/api/v1/requests/${r.id}`).set(auth(f.tokens.citizen)).send({ peopleAffected: 40 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('verifies once; a second verification is an invalid transition', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const v = await verify(f, r.id);
    expect(v.status).toBe('VERIFIED');
    expect(v.verified).toBe(true);
    const again = await api().post(`/api/v1/requests/${r.id}/verify`).set(auth(f.tokens.coord)).send({ decision: 'VERIFY', reason: 'again' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('records rejection with a reason and blocks later cancellation', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const res = await api().post(`/api/v1/requests/${r.id}/verify`).set(auth(f.tokens.coord)).send({ decision: 'REJECT', reason: 'Duplicate of an earlier request' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(res.body.data.rejectionReason).toBe('Duplicate of an earlier request');
    const cancel = await api().post(`/api/v1/requests/${r.id}/cancel`).set(auth(f.tokens.citizen)).send({ reason: 'never mind' });
    expect(cancel.status).toBe(409);
  });

  it('requires a reason to verify or cancel', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    expect((await api().post(`/api/v1/requests/${r.id}/verify`).set(auth(f.tokens.coord)).send({ decision: 'VERIFY' })).status).toBe(400);
    expect((await api().post(`/api/v1/requests/${r.id}/cancel`).set(auth(f.tokens.citizen)).send({})).status).toBe(400);
  });

  it('cancels with a reason and persists the timeline event', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const res = await api().post(`/api/v1/requests/${r.id}/cancel`).set(auth(f.tokens.citizen)).send({ reason: 'Help arrived from neighbours' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.cancelledReason).toBe('Help arrived from neighbours');
    const tl = await api().get(`/api/v1/requests/${r.id}/timeline`).set(auth(f.tokens.citizen));
    expect(tl.body.data.at(-1)).toMatchObject({ type: 'CANCELLED' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'REQUEST_CANCELLED', entityId: r.id } });
    expect(audit.after.reason).toBe('Help arrived from neighbours');
  });

  it('shows requesters only public timeline events and no staff identities', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    await verify(f, r.id);
    const citizenView = await api().get(`/api/v1/requests/${r.id}/timeline`).set(auth(f.tokens.citizen));
    expect(citizenView.body.data.every((e) => e.isPublic)).toBe(true);
    expect(citizenView.body.data.some((e) => e.type === 'SEVERITY_SUGGESTED')).toBe(false);
    expect(citizenView.body.data.every((e) => !e.actor?.fullName)).toBe(true);
    const staffView = await api().get(`/api/v1/requests/${r.id}/timeline`).set(auth(f.tokens.coord));
    expect(staffView.body.data.length).toBeGreaterThan(citizenView.body.data.length);
  });

  it('timeline is append-only: events accumulate and are never rewritten', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const before = await prisma.requestTimelineEvent.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' } });
    await api().patch(`/api/v1/requests/${r.id}`).set(auth(f.tokens.citizen)).send({ description: 'Updated description text' });
    await verify(f, r.id);
    const after = await prisma.requestTimelineEvent.findMany({ where: { requestId: r.id }, orderBy: { createdAt: 'asc' } });
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('lets requesters ask for escalation without changing severity', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const res = await api().post(`/api/v1/requests/${r.id}/escalate`).set(auth(f.tokens.citizen)).send({ severity: 'HYPER_RED', reason: 'Child is unwell' });
    expect(res.status).toBe(200);
    expect(res.body.meta.escalationApplied).toBe(false);
    expect(res.body.data.severity).toBe('NORMAL');
    const ev = await prisma.requestTimelineEvent.findFirst({ where: { requestId: r.id, type: 'ESCALATION_REQUESTED' } });
    expect(ev).toBeTruthy();
    const note = await prisma.notification.findFirst({ where: { userId: f.users.coord.id, type: 'ESCALATION_REQUESTED' } });
    expect(note).toBeTruthy();
  });

  it('finds nearby requests for staff with straight-line distance', async () => {
    const r = await createRequest(f.tokens.citizen, { latitude: 30.31, longitude: 78.01 }, f);
    const res = await api().get('/api/v1/requests/nearby?latitude=30.3&longitude=78.0&radiusKm=5').set(auth(f.tokens.coord));
    expect(res.status).toBe(200);
    const hit = res.body.data.find((x) => x.id === r.id);
    expect(hit.distanceKm).toBeGreaterThan(0);
    expect(hit.distanceBasis).toBe('STRAIGHT_LINE');
    expect((await api().get('/api/v1/requests/nearby?latitude=30.3&longitude=78.0').set(auth(f.tokens.citizen))).status).toBe(403);
  });

  it('paginates, filters and rejects unknown sort fields', async () => {
    const res = await api().get('/api/v1/requests?pageSize=2&page=1&status=SUBMITTED,VERIFIED').set(auth(f.tokens.coord));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2 });
    expect(res.body.meta.total).toBeGreaterThan(2);
    expect((await api().get('/api/v1/requests?sortBy=passwordHash').set(auth(f.tokens.coord))).status).toBe(400);
  });
});
