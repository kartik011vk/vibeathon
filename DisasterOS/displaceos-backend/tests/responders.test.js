import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, balance, createRequest, dispatchFixture, prisma, proposeAllocation, setup, verify } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const account = (email) => ({ fullName: 'Responder Person', email, password: 'Responder2026!' });

describe('responder organisation onboarding', () => {
  let lead;
  let orgId;

  it('registers an organisation whose lead has no responder powers until approved', async () => {
    const res = await api()
      .post('/api/v1/organizations/register')
      .send({ organization: { name: 'Valley Relief NGO', type: 'NGO', area: 'Dehradun', contactPhone: '+91 90000 11111' }, account: account('lead@ngo.dev'), role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('CITIZEN');
    expect(res.body.data.organization.status).toBe('PENDING');
    lead = res.body.data.accessToken;
    orgId = res.body.data.organization.id;

    // Pending lead cannot use responder endpoints.
    expect((await api().get('/api/v1/requests/open-needs').set(auth(lead))).status).toBe(403);
    expect((await api().post('/api/v1/organizations/mine/join-code').set(auth(lead))).status).toBe(403);
    const mine = await api().get('/api/v1/organizations/mine').set(auth(lead));
    expect(mine.body.data).toMatchObject({ status: 'PENDING', myRole: 'LEAD', isLead: false });
  });

  it('rejects duplicate organisation names', async () => {
    const res = await api()
      .post('/api/v1/organizations/register')
      .send({ organization: { name: 'Valley Relief NGO', type: 'NGO', area: 'Rishikesh', contactPhone: '+91 90000 22222' }, account: account('other@ngo.dev') });
    expect(res.status).toBe(409);
  });

  it('only admins approve; approval grants RESPONSE_TEAM and creates a team', async () => {
    expect((await api().post(`/api/v1/organizations/${orgId}/approve`).set(auth(f.tokens.coord)).send({})).status).toBe(403);
    const ok = await api().post(`/api/v1/organizations/${orgId}/approve`).set(auth(f.tokens.admin)).send({ note: 'Registration checked' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    expect((await api().post(`/api/v1/organizations/${orgId}/approve`).set(auth(f.tokens.admin)).send({})).status).toBe(409);

    const user = await prisma.user.findUnique({ where: { email: 'lead@ngo.dev' }, include: { teamMemberships: { include: { team: true } } } });
    expect(user.role).toBe('RESPONSE_TEAM');
    expect(user.teamMemberships[0].team.organizationId).toBe(orgId);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'ORGANIZATION_APPROVED', entityId: orgId } });
    expect(audit.actorId).toBe(f.users.admin.id);
  });

  it('members join with a code and need the lead to approve them', async () => {
    const code = await api().post('/api/v1/organizations/mine/join-code').set(auth(lead));
    expect(code.status).toBe(200);
    const joinCode = code.body.data.joinCode;
    expect(joinCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    expect((await api().post('/api/v1/organizations/join').send({ joinCode: 'ZZZZ-ZZZZ', account: account('nobody@ngo.dev') })).status).toBe(404);
    const joined = await api().post('/api/v1/organizations/join').send({ joinCode: joinCode.toLowerCase().replace('-', ''), account: account('member@ngo.dev') });
    expect(joined.status).toBe(201);
    expect(joined.body.data.user.role).toBe('CITIZEN');
    const memberId = joined.body.data.user.id;

    // A member cannot approve themselves, and a lead of another organisation cannot either.
    expect((await api().post(`/api/v1/organizations/mine/members/${memberId}/decision`).set(auth(joined.body.data.accessToken)).send({ decision: 'APPROVE' })).status).toBe(403);
    const ok = await api().post(`/api/v1/organizations/mine/members/${memberId}/decision`).set(auth(lead)).send({ decision: 'APPROVE' });
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: memberId } })).role).toBe('RESPONSE_TEAM');
    expect(ok.body.data.members.find((m) => m.id === memberId).membershipStatus).toBe('APPROVED');

    // Rotating the code invalidates the old one.
    await api().post('/api/v1/organizations/mine/join-code').set(auth(lead));
    expect((await api().post('/api/v1/organizations/join').send({ joinCode, account: account('late@ngo.dev') })).status).toBe(404);
  });
});

describe('open needs board and team offers', () => {
  it('lists verified requests without requester identity and lets a team offer once', async () => {
    const req = await createRequest(f.tokens.citizen, { latitude: 30.31234, longitude: 78.01987 }, f);
    await verify(f, req.id);
    const board = await api().get('/api/v1/requests/open-needs').set(auth(f.tokens.team1));
    expect(board.status).toBe(200);
    const need = board.body.data.find((n) => n.id === req.id);
    expect(need).toBeTruthy();
    expect(need.approximateLocation).toEqual({ latitude: 30.31, longitude: 78.02 });
    const text = JSON.stringify(need);
    for (const secret of ['Test street', 'tester', 'citizen@test.dev', 'requesterId']) expect(text).not.toContain(secret);

    // Citizens cannot see the board.
    expect((await api().get('/api/v1/requests/open-needs').set(auth(f.tokens.citizen))).status).toBe(403);

    // Team 1 cannot offer on behalf of Team 2.
    expect((await api().post(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.team1)).send({ teamId: f.teamB.id })).status).toBe(403);
    const offer = await api().post(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.team1)).send({ teamId: f.teamA.id, note: 'We have a van nearby', ownSupplies: true });
    expect(offer.status).toBe(201);
    expect((await api().post(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.team1)).send({ teamId: f.teamA.id })).status).toBe(409);

    const list = await api().get(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.coord));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].team.name).toBe('Team One');
    // The other team sees no offers that are not theirs.
    expect((await api().get(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.team2))).body.data).toHaveLength(0);

    // Assigning the dispatch to the offering team accepts the offer and removes the request from the board.
    const allocation = await proposeAllocation(f, req);
    await api().post(`/api/v1/allocations/${allocation.id}/approve`).set(auth(f.tokens.coord));
    const d = await api().post('/api/v1/dispatches').set(auth(f.tokens.coord)).send({ allocationId: allocation.id, teamId: f.teamA.id });
    expect(d.status).toBe(201);
    expect((await prisma.teamOffer.findUnique({ where: { id: offer.body.data.id } })).status).toBe('ACCEPTED');
    const after = await api().get('/api/v1/requests/open-needs').set(auth(f.tokens.team1));
    expect(after.body.data.find((n) => n.id === req.id)).toBeUndefined();
  });

  it('lets the offering team withdraw', async () => {
    const req = await createRequest(f.tokens.citizen, {}, f);
    await verify(f, req.id);
    const offer = await api().post(`/api/v1/requests/${req.id}/offers`).set(auth(f.tokens.team2)).send({ teamId: f.teamB.id });
    expect((await api().post(`/api/v1/requests/${req.id}/offers/${offer.body.data.id}/withdraw`).set(auth(f.tokens.team1))).status).toBe(403);
    const w = await api().post(`/api/v1/requests/${req.id}/offers/${offer.body.data.id}/withdraw`).set(auth(f.tokens.team2));
    expect(w.body.data.status).toBe('WITHDRAWN');
    expect((await api().post(`/api/v1/requests/${req.id}/offers/${offer.body.data.id}/withdraw`).set(auth(f.tokens.team2))).status).toBe(409);
  });
});

describe('supply donations', () => {
  it('becomes stock only when received and counted at the receiving location', async () => {
    const before = (await balance(f.items.water.id, f.warehouse.id)).onHand;
    const created = await api()
      .post('/api/v1/supply-offers')
      .set(auth(f.tokens.citizen2))
      .send({
        donorName: 'Corner Store',
        deliveryMode: 'DROP_OFF',
        lines: [
          { inventoryItemId: f.items.water.id, quantity: 30 },
          { name: 'Bottled water 1L', unit: 'bottles', quantity: 100 },
        ],
      });
    expect(created.status).toBe(201);
    const offer = created.body.data;
    expect(offer.referenceCode).toMatch(/^DN-/);
    expect(offer.status).toBe('PENDING');
    expect((await balance(f.items.water.id, f.warehouse.id)).onHand).toBe(before);

    // Other people cannot see this offer.
    expect((await api().get(`/api/v1/supply-offers/${offer.id}`).set(auth(f.tokens.citizen))).status).toBe(404);
    expect((await api().post(`/api/v1/supply-offers/${offer.id}/accept`).set(auth(f.tokens.citizen2)).send({ receivingLocationId: f.warehouse.id })).status).toBe(403);

    // Free-text lines must be matched to the catalogue before acceptance.
    const unmapped = await api().post(`/api/v1/supply-offers/${offer.id}/accept`).set(auth(f.tokens.coord)).send({ receivingLocationId: f.warehouse.id });
    expect(unmapped.status).toBe(400);
    const freeLine = offer.lines.find((l) => !l.inventoryItemId);
    const accepted = await api()
      .post(`/api/v1/supply-offers/${offer.id}/accept`)
      .set(auth(f.tokens.coord))
      .send({ receivingLocationId: f.warehouse.id, note: 'Gate 2', lines: [{ lineId: freeLine.id, inventoryItemId: f.items.water.id }] });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.events.at(-1).message).toContain('Please bring the supplies to Test warehouse');

    // Coordinators cannot record receipts; the warehouse inventory manager can.
    const lines = accepted.body.data.lines.map((l) => ({ lineId: l.id, receivedQuantity: l.quantity === 30 ? 28 : 100 }));
    expect((await api().post(`/api/v1/supply-offers/${offer.id}/receive`).set(auth(f.tokens.coord)).send({ lines })).status).toBe(403);
    const received = await api().post(`/api/v1/supply-offers/${offer.id}/receive`).set(auth(f.tokens.inv)).send({ lines, note: 'Counted at gate' });
    expect(received.status).toBe(200);
    expect(received.body.data.status).toBe('RECEIVED');
    expect((await balance(f.items.water.id, f.warehouse.id)).onHand).toBe(before + 128);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RECEIPT', reason: { contains: offer.referenceCode } } })).toBe(2);

    const donorView = await api().get(`/api/v1/supply-offers/${offer.id}`).set(auth(f.tokens.citizen2));
    expect(donorView.body.data.events.map((e) => e.type)).toEqual(['OFFERED', 'ACCEPTED', 'RECEIVED']);
    expect(donorView.body.data.impact).toMatchObject({ deliveriesSinceArrival: expect.any(Number) });
    expect(donorView.body.data.donor).toBeUndefined();
    expect((await api().post(`/api/v1/supply-offers/${offer.id}/receive`).set(auth(f.tokens.inv)).send({ lines })).status).toBe(409);
  });

  it('requires a pickup address for collection and lets the donor withdraw', async () => {
    const bad = await api().post('/api/v1/supply-offers').set(auth(f.tokens.citizen)).send({ deliveryMode: 'PICKUP', lines: [{ inventoryItemId: f.items.food.id, quantity: 5 }] });
    expect(bad.status).toBe(400);
    const ok = await api().post('/api/v1/supply-offers').set(auth(f.tokens.citizen)).send({ deliveryMode: 'PICKUP', pickupAddress: 'Shop 4, Main road', lines: [{ inventoryItemId: f.items.food.id, quantity: 5 }] });
    expect(ok.status).toBe(201);
    const mine = await api().get('/api/v1/supply-offers').set(auth(f.tokens.citizen));
    expect(mine.body.data.every((o) => o.isOwn)).toBe(true);
    const c = await api().post(`/api/v1/supply-offers/${ok.body.data.id}/cancel`).set(auth(f.tokens.citizen)).send({ reason: 'Sold out' });
    expect(c.body.data.status).toBe('CANCELLED');
  });
});

describe('profile exposes organisation membership', () => {
  it('returns organisation details on /auth/me', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'lead@ngo.dev', password: 'Responder2026!' });
    const me = await api().get('/api/v1/auth/me').set(auth(login.body.data.accessToken));
    expect(me.body.data).toMatchObject({ role: 'RESPONSE_TEAM', orgRole: 'LEAD', membershipStatus: 'APPROVED', organization: { name: 'Valley Relief NGO', status: 'APPROVED' } });
  });

  it('keeps existing dispatch fixtures working', async () => {
    const { dispatch } = await dispatchFixture(f);
    expect(dispatch.status).toBe('ASSIGNED');
  });
});
