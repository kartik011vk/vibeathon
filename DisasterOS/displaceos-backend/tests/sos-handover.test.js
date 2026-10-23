import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, dispatchFixture, prisma, setup } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const SOS_AT = { latitude: 30.301, longitude: 78.002 };

describe('emergency SOS', () => {
  let sos;

  it('requires a location or an address', async () => {
    const res = await api().post('/api/v1/sos').set(auth(f.tokens.citizen)).send({ message: 'Water rising in the house' });
    expect(res.status).toBe(400);
  });

  it('raises an SOS, names the area without exposing the exact spot publicly', async () => {
    const res = await api().post('/api/v1/sos').set(auth(f.tokens.citizen)).send({ ...SOS_AT, accuracyMeters: 20, message: 'Trapped on the roof with my mother', peopleCount: 2 });
    expect(res.status).toBe(201);
    sos = res.body.data;
    expect(sos.referenceCode).toMatch(/^SOS-/);
    expect(sos.status).toBe('ACTIVE');
    expect(sos.areaLabel).toContain('Camp A');

    // A second SOS from the same person while one is open is refused.
    expect((await api().post('/api/v1/sos').set(auth(f.tokens.citizen)).send({ ...SOS_AT, message: 'again please' })).status).toBe(409);

    // Anonymous and other citizens: area only — no coordinates, message or identity.
    for (const req of [api().get('/api/v1/sos/active'), api().get('/api/v1/sos/active').set(auth(f.tokens.citizen2))]) {
      const r = await req;
      expect(r.status).toBe(200);
      expect(r.body.meta.scope).toBe('public');
      const item = r.body.data.find((s) => s.id === sos.id);
      expect(item).toMatchObject({ areaLabel: sos.areaLabel, peopleCount: 2, status: 'ACTIVE' });
      const text = JSON.stringify(item);
      for (const secret of ['latitude', 'longitude', 'roof', 'tester', 'phone']) expect(text).not.toContain(secret);
    }
    expect((await api().get(`/api/v1/sos/${sos.id}`).set(auth(f.tokens.citizen2))).status).toBe(404);

    // Responders see the exact position, message and who asked.
    const team = await api().get('/api/v1/sos/active').set(auth(f.tokens.team1));
    const full = team.body.data.find((s) => s.id === sos.id);
    expect(team.body.meta.scope).toBe('responder');
    expect(full).toMatchObject({ latitude: 30.301, longitude: 78.002, message: 'Trapped on the roof with my mother' });
    expect(full.requester.id).toBe(f.users.citizen.id);
  });

  it('lets one responder take it, and only that responder or a coordinator close it', async () => {
    expect((await api().post(`/api/v1/sos/${sos.id}/respond`).set(auth(f.tokens.citizen2))).status).toBe(403);
    const take = await api().post(`/api/v1/sos/${sos.id}/respond`).set(auth(f.tokens.team1));
    expect(take.status).toBe(200);
    expect(take.body.data.status).toBe('RESPONDING');
    expect(take.body.data.respondingTeam).toBe('Team One');
    expect((await api().post(`/api/v1/sos/${sos.id}/respond`).set(auth(f.tokens.team2))).status).toBe(409);

    const notMine = await api().post(`/api/v1/sos/${sos.id}/resolve`).set(auth(f.tokens.team2)).send({ outcome: 'RESCUED', note: 'done' });
    expect(notMine.status).toBe(403);

    // The person who asked sees who is coming.
    const own = await api().get(`/api/v1/sos/${sos.id}`).set(auth(f.tokens.citizen));
    expect(own.body.data.respondingTeam).toBe('Team One');

    // Closing about 110 m away is verified by location.
    const done = await api()
      .post(`/api/v1/sos/${sos.id}/resolve`)
      .set(auth(f.tokens.team1))
      .send({ outcome: 'RESCUED', note: 'Both people moved to Camp A', latitude: 30.302, longitude: 78.002, accuracyMeters: 15 });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'RESCUED', locationCheck: 'VERIFIED' });
    expect(done.body.data.resolverDistanceM).toBeLessThan(200);
    expect((await api().get('/api/v1/sos/active')).body.data.find((s) => s.id === sos.id)).toBeUndefined();
    expect(await prisma.sosEvent.count({ where: { sosId: sos.id } })).toBe(3);
  });

  it('lets the person report they are safe', async () => {
    const res = await api().post('/api/v1/sos').set(auth(f.tokens.citizen2)).send({ address: 'Behind the school, Camp B road', message: 'Car stuck in flood water' });
    expect(res.status).toBe(201);
    expect(res.body.data.areaLabel).toBe('Location given as an address');
    const c = await api().post(`/api/v1/sos/${res.body.data.id}/cancel`).set(auth(f.tokens.citizen2)).send({ reason: 'Water went down, I am safe' });
    expect(c.body.data.status).toBe('CANCELLED');
  });
});

describe('hand-over verification and receipt confirmation', () => {
  async function onTheRoad() {
    const { request, dispatch } = await dispatchFixture(f);
    await prisma.reliefRequest.update({ where: { id: request.id }, data: { latitude: 30.3, longitude: 78.0 } });
    await api().post(`/api/v1/dispatches/${dispatch.id}/accept`).set(auth(f.tokens.team1));
    await api().post(`/api/v1/dispatches/${dispatch.id}/start`).set(auth(f.tokens.team1));
    const line = (await api().get(`/api/v1/dispatches/${dispatch.id}`).set(auth(f.tokens.team1))).body.data.lines[0];
    return { request, dispatch, line };
  }

  it('marks a hand-over at the delivery point as location verified', async () => {
    const { request, dispatch, line } = await onTheRoad();
    const res = await api()
      .post(`/api/v1/dispatches/${dispatch.id}/complete`)
      .set(auth(f.tokens.team1))
      .send({ lines: [{ dispatchLineId: line.id, quantity: line.quantity }], final: true, latitude: 30.3008, longitude: 78.0005, accuracyMeters: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data.lastHandover).toMatchObject({ locationCheck: 'VERIFIED' });
    const ev = await prisma.deliveryEvent.findFirst({ where: { dispatchId: dispatch.id } });
    expect(ev.locationCheck).toBe('VERIFIED');
    expect(ev.distanceM).toBeLessThan(150);

    // Requester confirms receipt once.
    expect((await api().post(`/api/v1/requests/${request.id}/confirm-receipt`).set(auth(f.tokens.citizen2)).send({})).status).toBe(404);
    const ok = await api().post(`/api/v1/requests/${request.id}/confirm-receipt`).set(auth(f.tokens.citizen)).send({ note: 'All 10 kits received' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.receiptConfirmedAt).toBeTruthy();
    expect((await api().post(`/api/v1/requests/${request.id}/confirm-receipt`).set(auth(f.tokens.citizen)).send({})).status).toBe(409);
    const tl = await prisma.requestTimelineEvent.findMany({ where: { requestId: request.id, type: { in: ['HANDOVER_LOCATION', 'RECEIPT_CONFIRMED'] } } });
    expect(tl.map((t) => t.type).sort()).toEqual(['HANDOVER_LOCATION', 'RECEIPT_CONFIRMED']);
  });

  it('requires a note when the hand-over is recorded far from the delivery point, then flags it', async () => {
    const { dispatch, line } = await onTheRoad();
    const far = { latitude: 30.35, longitude: 78.05 };
    const noNote = await api().post(`/api/v1/dispatches/${dispatch.id}/complete`).set(auth(f.tokens.team1)).send({ lines: [{ dispatchLineId: line.id, quantity: 2 }], ...far });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.details[0].path).toBe('notes');
    const withNote = await api()
      .post(`/api/v1/dispatches/${dispatch.id}/complete`)
      .set(auth(f.tokens.team1))
      .send({ lines: [{ dispatchLineId: line.id, quantity: 2 }], ...far, notes: 'Road blocked; family met us at the bridge' });
    expect(withNote.status).toBe(200);
    expect(withNote.body.data.lastHandover.locationCheck).toBe('TOO_FAR');
  });

  it('records hand-overs without a phone location as unverified, and refuses receipt before delivery', async () => {
    const { request, dispatch, line } = await onTheRoad();
    expect((await api().post(`/api/v1/requests/${request.id}/confirm-receipt`).set(auth(f.tokens.citizen)).send({})).status).toBe(409);
    const res = await api().post(`/api/v1/dispatches/${dispatch.id}/complete`).set(auth(f.tokens.team1)).send({ lines: [{ dispatchLineId: line.id, quantity: 1 }] });
    expect(res.body.data.lastHandover.locationCheck).toBe('NO_LOCATION');
  });
});
