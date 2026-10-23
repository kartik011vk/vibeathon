import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, balance, dispatchFixture, prisma, receive, setup } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
  await receive(f.items.food.id, f.warehouse.id, 400);
});
afterAll(() => prisma.$disconnect());

const post = (path, token, body = {}) => api().post(`/api/v1/dispatches${path}`).set(auth(token)).send(body);
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

describe('dispatch lifecycle and authorization', () => {
  it('rejects invalid transitions and unauthorized actors', async () => {
    const { dispatch } = await dispatchFixture(f);
    expect(dispatch.status).toBe('ASSIGNED');

    const early = await post(`/${dispatch.id}/start`, f.tokens.team1);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [] , final: true })).status).toBe(409);

    // A member of a different team cannot see or act on this dispatch.
    expect((await post(`/${dispatch.id}/accept`, f.tokens.team2)).status).toBe(404);
    expect((await api().get(`/api/v1/dispatches/${dispatch.id}`).set(auth(f.tokens.team2))).status).toBe(404);
    // Accepting is a team action; citizens and coordinators cannot accept for the team.
    expect((await post(`/${dispatch.id}/accept`, f.tokens.citizen)).status).toBe(403);
    expect((await post(`/${dispatch.id}/accept`, f.tokens.coord)).status).toBe(403);

    expect((await post(`/${dispatch.id}/accept`, f.tokens.team1)).body.data.status).toBe('ACCEPTED');
    expect((await post(`/${dispatch.id}/accept`, f.tokens.team1)).status).toBe(409);
    expect((await post(`/${dispatch.id}/start`, f.tokens.team1)).body.data.status).toBe('IN_TRANSIT');
    expect((await post(`/${dispatch.id}/cancel`, f.tokens.coord, { reason: 'too late to cancel' })).status).toBe(409);

    const history = await prisma.dispatchStatusEvent.findMany({ where: { dispatchId: dispatch.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT']);
    expect(history.at(-1).actorId).toBe(f.users.team1.id);
  });

  it('only the assigned team reports location; team 2 cannot', async () => {
    const { dispatch } = await dispatchFixture(f);
    await post(`/${dispatch.id}/accept`, f.tokens.team1);
    const other = await api().patch(`/api/v1/dispatches/${dispatch.id}/location`).set(auth(f.tokens.team2)).send({ latitude: 30.2, longitude: 78.1 });
    expect(other.status).toBe(404);
    const own = await api().patch(`/api/v1/dispatches/${dispatch.id}/location`).set(auth(f.tokens.team1)).send({ latitude: 30.2, longitude: 78.1 });
    expect(own.status).toBe(200);
    expect(own.body.data.location).toMatchObject({ available: true, stale: false, latitude: 30.2, longitude: 78.1 });
  });
});

describe('ETA history', () => {
  it('reports ETA unavailable until one is recorded, preserves history and flags delays', async () => {
    const { request, dispatch } = await dispatchFixture(f);
    const before = await api().get(`/api/v1/requests/${request.id}/tracking`).set(auth(f.tokens.citizen));
    expect(before.body.data.eta).toMatchObject({ etaAvailable: false, reasonCode: 'NO_ETA_RECORDED' });
    expect(before.body.data.eta.reason).toBeTruthy();

    expect((await post(`/${dispatch.id}/eta`, f.tokens.team1, { eta: inMinutes(60), reason: 'Loading done' })).status).toBe(200);
    const t1 = await api().get(`/api/v1/requests/${request.id}/tracking`).set(auth(f.tokens.citizen));
    expect(t1.body.data.eta).toMatchObject({ etaAvailable: true, etaSource: 'MANUAL', delayStatus: 'ON_TRACK' });

    await post(`/${dispatch.id}/eta`, f.tokens.team1, { eta: inMinutes(120), reason: 'Road flooded, detour' });
    const t2 = await api().get(`/api/v1/requests/${request.id}/tracking`).set(auth(f.tokens.citizen));
    expect(t2.body.data.eta.delayStatus).toBe('DELAYED');
    const delayNote = await prisma.notification.findFirst({ where: { userId: f.users.citizen.id, type: 'DELIVERY_DELAYED' } });
    expect(delayNote).toBeTruthy();

    await post(`/${dispatch.id}/eta`, f.tokens.coord, { eta: null, reason: 'Contact with team lost' });
    const t3 = await api().get(`/api/v1/dispatches/${dispatch.id}/tracking`).set(auth(f.tokens.coord));
    expect(t3.body.data.eta).toMatchObject({ etaAvailable: false, reasonCode: 'MARKED_UNAVAILABLE', reason: 'Contact with team lost' });
    expect(t3.body.data.etaHistory).toHaveLength(3);
    expect(t3.body.data.etaHistory.map((h) => h.available)).toEqual([true, true, false]);
    expect(t3.body.data.etaHistory[1].previousEta).toBe(t3.body.data.etaHistory[0].newEta);
    expect(t3.body.data.etaHistory[2].source).toBe('UNAVAILABLE');

    expect((await post(`/${dispatch.id}/eta`, f.tokens.team1, { eta: inMinutes(-30), reason: 'in the past' })).status).toBe(400);
    expect((await post(`/${dispatch.id}/eta`, f.tokens.team1, { eta: inMinutes(30) })).status).toBe(400); // reason required
    expect((await post(`/${dispatch.id}/eta`, f.tokens.team2, { eta: inMinutes(30), reason: 'not my team' })).status).toBe(404);
  });

  it('route estimates report "not configured" instead of inventing one', async () => {
    const res = await api().get('/api/v1/routes/estimate?fromLat=30.3&fromLng=78&toLat=30.2&toLng=78.1').set(auth(f.tokens.coord));
    expect(res.body.data).toMatchObject({ available: false, configured: false });
  });
});

describe('partial and full delivery', () => {
  it('tracks delivered vs remaining, consumes reserved stock and completes the request', async () => {
    const before = await balance(f.items.food.id, f.warehouse.id);
    const { request, dispatch } = await dispatchFixture(f);
    await post(`/${dispatch.id}/accept`, f.tokens.team1);
    await post(`/${dispatch.id}/start`, f.tokens.team1);
    const line = dispatch.lines[0];

    const partial = await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [{ dispatchLineId: line.id, quantity: 4 }], notes: 'First drop' });
    expect(partial.status).toBe(200);
    expect(partial.body.data.status).toBe('PARTIALLY_DELIVERED');
    expect(partial.body.data.lines[0]).toMatchObject({ quantity: 10, deliveredQuantity: 4, remainingQuantity: 6 });

    const tracking = await api().get(`/api/v1/requests/${request.id}/tracking`).set(auth(f.tokens.citizen));
    expect(tracking.body.data.request.status).toBe('PARTIALLY_DELIVERED');
    expect(tracking.body.data.items[0]).toMatchObject({ requested: 10, delivered: 4, remaining: 6, onTheWay: 6 });
    expect(tracking.body.data.totals).toEqual({ requested: 10, delivered: 4, remaining: 6 });
    const mid = await balance(f.items.food.id, f.warehouse.id);
    expect(mid.onHand).toBe(before.onHand - 4);
    expect(mid.reserved).toBe(before.reserved + 6);

    const over = await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [{ dispatchLineId: line.id, quantity: 7 }] });
    expect(over.status).toBe(400);

    const done = await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [{ dispatchLineId: line.id, quantity: 6 }] });
    expect(done.body.data.status).toBe('DELIVERED');
    const req = await prisma.reliefRequest.findUnique({ where: { id: request.id } });
    expect(req.status).toBe('DELIVERED');
    expect(req.deliveredAt).toBeTruthy();
    const after = await balance(f.items.food.id, f.warehouse.id);
    expect(after).toMatchObject({ onHand: before.onHand - 10, reserved: before.reserved });
    expect(await prisma.deliveryEvent.count({ where: { dispatchId: dispatch.id } })).toBe(2);
    expect((await prisma.responseTeam.findUnique({ where: { id: f.teamA.id } })).availability).toBe('AVAILABLE');
    expect((await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [], final: true })).status).toBe(409);
  });

  it('closing a run with a shortfall releases the remainder and leaves the request partly delivered', async () => {
    const before = await balance(f.items.food.id, f.warehouse.id);
    const { request, dispatch } = await dispatchFixture(f);
    await post(`/${dispatch.id}/accept`, f.tokens.team1);
    await post(`/${dispatch.id}/start`, f.tokens.team1);
    const res = await post(`/${dispatch.id}/complete`, f.tokens.team1, { lines: [{ dispatchLineId: dispatch.lines[0].id, quantity: 3 }], final: true, notes: 'Bridge out' });
    expect(res.body.data.status).toBe('DELIVERED');
    const after = await balance(f.items.food.id, f.warehouse.id);
    expect(after).toMatchObject({ onHand: before.onHand - 3, reserved: before.reserved });
    const req = await prisma.reliefRequest.findUnique({ where: { id: request.id }, include: { items: true } });
    expect(req.status).toBe('PARTIALLY_DELIVERED');
    expect(req.items[0].deliveredQuantity).toBe(3);
  });

  it('failing a dispatch releases reserved stock and returns the request to VERIFIED', async () => {
    const before = await balance(f.items.food.id, f.warehouse.id);
    const { request, allocation, dispatch } = await dispatchFixture(f);
    await post(`/${dispatch.id}/accept`, f.tokens.team1);
    const fail = await post(`/${dispatch.id}/fail`, f.tokens.team1, { reason: 'Vehicle breakdown' });
    expect(fail.body.data).toMatchObject({ status: 'FAILED', failureReason: 'Vehicle breakdown' });
    expect(await balance(f.items.food.id, f.warehouse.id)).toMatchObject({ onHand: before.onHand, reserved: before.reserved });
    expect((await prisma.allocation.findUnique({ where: { id: allocation.id } })).status).toBe('RELEASED');
    expect((await prisma.reliefRequest.findUnique({ where: { id: request.id } })).status).toBe('VERIFIED');
    expect((await post(`/${dispatch.id}/fail`, f.tokens.team1, { reason: 'again!' })).status).toBe(409);
  });

  it('cancelling before transit keeps the reservation so the allocation can be re-dispatched', async () => {
    const { allocation, dispatch } = await dispatchFixture(f);
    const cancel = await post(`/${dispatch.id}/cancel`, f.tokens.coord, { reason: 'Switching to Team Two' });
    expect(cancel.body.data.status).toBe('CANCELLED');
    expect((await prisma.allocation.findUnique({ where: { id: allocation.id } })).status).toBe('APPROVED');
    const again = await api().post('/api/v1/dispatches').set(auth(f.tokens.coord)).send({ allocationId: allocation.id, teamId: f.teamB.id });
    expect(again.status).toBe(201);
    expect(await prisma.dispatch.count({ where: { allocationId: allocation.id } })).toBe(2);
  });
});

describe('requester tracking privacy', () => {
  it('hides exact team coordinates from requesters but gives approximate distance', async () => {
    const { request, dispatch } = await dispatchFixture(f, {});
    await prisma.reliefRequest.update({ where: { id: request.id }, data: { latitude: 30.3, longitude: 78.0 } });
    await post(`/${dispatch.id}/accept`, f.tokens.team1);
    await api().patch(`/api/v1/dispatches/${dispatch.id}/location`).set(auth(f.tokens.team1)).send({ latitude: 30.25, longitude: 78.05 });
    const citizen = await api().get(`/api/v1/requests/${request.id}/tracking`).set(auth(f.tokens.citizen));
    const loc = citizen.body.data.dispatches[0].location;
    expect(loc.latitude).toBeUndefined();
    expect(loc.longitude).toBeUndefined();
    expect(loc.approxDistanceToDestinationKm).toBeGreaterThan(0);
    expect(loc.distanceBasis).toBe('STRAIGHT_LINE');
    const coord = await api().get(`/api/v1/dispatches/${dispatch.id}/tracking`).set(auth(f.tokens.coord));
    expect(coord.body.data.location.latitude).toBe(30.25);
  });

  it('marks stale positions as stale', async () => {
    const { dispatch } = await dispatchFixture(f);
    await prisma.dispatch.update({ where: { id: dispatch.id }, data: { currentLatitude: 30.2, currentLongitude: 78.0, locationUpdatedAt: new Date(Date.now() - 3 * 3600 * 1000) } });
    const res = await api().get(`/api/v1/dispatches/${dispatch.id}`).set(auth(f.tokens.coord));
    expect(res.body.data.location.stale).toBe(true);
  });
});

describe('public tracking links', () => {
  it('work while valid, stop on revoke or expiry, and expose no private fields', async () => {
    const { request } = await dispatchFixture(f);
    await prisma.reliefRequest.update({ where: { id: request.id }, data: { latitude: 30.31, longitude: 78.01 } });
    const created = await api().post(`/api/v1/requests/${request.id}/tracking-tokens`).set(auth(f.tokens.citizen)).send({});
    expect(created.status).toBe(201);
    const { token, id } = created.body.data;
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(await prisma.publicTrackingToken.count({ where: { tokenHash: token } })).toBe(0);

    const pub = await api().get(`/api/v1/tracking/${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.referenceCode).toBe(request.referenceCode);
    const raw = JSON.stringify(pub.body);
    for (const forbidden of ['Test street', 'tester', 'citizen@test.dev', 'latitude', 'longitude', 'requesterId', 'phone', 'Team One']) {
      expect(raw).not.toContain(forbidden);
    }

    // Another citizen cannot mint a link for this request.
    expect((await api().post(`/api/v1/requests/${request.id}/tracking-tokens`).set(auth(f.tokens.citizen2)).send({})).status).toBe(404);

    const revoke = await api().post(`/api/v1/requests/${request.id}/tracking-tokens/${id}/revoke`).set(auth(f.tokens.citizen));
    expect(revoke.status).toBe(200);
    expect((await api().get(`/api/v1/tracking/${token}`)).status).toBe(404);

    const second = await api().post(`/api/v1/requests/${request.id}/tracking-tokens`).set(auth(f.tokens.citizen)).send({ ttlHours: 1 });
    await prisma.publicTrackingToken.update({ where: { id: second.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().get(`/api/v1/tracking/${second.body.data.token}`)).status).toBe(404);

    expect((await api().get('/api/v1/tracking/not-a-real-token-but-long-enough-xxxxxxxx')).status).toBe(404);
  });
});

describe('notifications, dashboards and audit', () => {
  it('requesters receive in-app notifications and can mark them read', async () => {
    const list = await api().get('/api/v1/notifications').set(auth(f.tokens.citizen));
    expect(list.status).toBe(200);
    expect(list.body.data.some((n) => n.type === 'DISPATCH_ASSIGNED')).toBe(true);
    const first = list.body.data[0];
    const read = await api().post(`/api/v1/notifications/${first.id}/read`).set(auth(f.tokens.citizen));
    expect(read.body.data.readAt).toBeTruthy();
    expect((await api().post(`/api/v1/notifications/${first.id}/read`).set(auth(f.tokens.citizen2))).status).toBe(404);
    const prefs = await api().patch('/api/v1/notification-preferences').set(auth(f.tokens.citizen)).send({ minSeverity: 'HIGH' });
    expect(prefs.body.data.minSeverity).toBe('HIGH');
  });

  it('dashboards report database-derived counts', async () => {
    const res = await api().get('/api/v1/dashboard/summary').set(auth(f.tokens.coord));
    expect(res.status).toBe(200);
    const delivered = await prisma.reliefRequest.count({ where: { status: 'DELIVERED' } });
    expect(res.body.data.requests.byStatus.DELIVERED).toBe(delivered);
    expect(res.body.data.dispatches.FAILED).toBe(await prisma.dispatch.count({ where: { status: 'FAILED' } }));
    const rt = await api().get('/api/v1/dashboard/response-times?days=7').set(auth(f.tokens.coord));
    expect(rt.body.data.submittedToVerified.samples).toBeGreaterThan(0);
    expect((await api().get('/api/v1/dashboard/critical-needs').set(auth(f.tokens.campMgr))).status).toBe(200);
    expect((await api().get('/api/v1/dashboard/summary').set(auth(f.tokens.citizen))).status).toBe(403);
  });

  it('audit log covers dispatch and ETA changes and is admin-only', async () => {
    for (const a of ['DISPATCH_CREATED', 'DISPATCH_ACCEPTED', 'DISPATCH_ETA_UPDATED', 'DISPATCH_PARTIAL_DELIVERY', 'DISPATCH_COMPLETED', 'DISPATCH_FAILED', 'INVENTORY_RECEIPT']) {
      const res = await api().get(`/api/v1/audit-logs?action=${a}`).set(auth(f.tokens.admin));
      expect(res.body.meta.total, a).toBeGreaterThan(0);
    }
    expect((await api().get('/api/v1/audit-logs').set(auth(f.tokens.coord))).status).toBe(403);
  });
});
