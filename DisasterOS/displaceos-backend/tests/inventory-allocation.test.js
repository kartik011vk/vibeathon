import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, balance, createRequest, prisma, proposeAllocation, receive, setup, verify } from './helpers.js';

let f;
beforeAll(async () => {
  f = await setup();
});
afterAll(() => prisma.$disconnect());

const txn = (token, body) => api().post('/api/v1/inventory/transactions').set(auth(token)).send(body);

async function newItem(sku, qty) {
  const item = await prisma.inventoryItem.create({ data: { sku, name: `Item ${sku}`, category: 'SHELTER', unit: 'pieces', lowStockThreshold: 2 } });
  if (qty) await receive(item.id, f.warehouse.id, qty);
  return item;
}

async function verifiedRequestFor(item, quantity) {
  const r = await createRequest(f.tokens.citizen, { category: 'SHELTER', items: [{ inventoryItemId: item.id, quantity }] }, f);
  await verify(f, r.id);
  return r;
}

describe('manual inventory transactions', () => {
  it('records receipts, adjustments and consumption with a running ledger', async () => {
    const item = await newItem('T-LEDGER', 0);
    const receipt = await txn(f.tokens.inv, { type: 'RECEIPT', itemId: item.id, locationId: f.warehouse.id, quantity: 50, reason: 'Truck arrival' });
    expect(receipt.status).toBe(201);
    expect(receipt.body.data).toMatchObject({ type: 'RECEIPT', quantity: 50, onHandAfter: 50, reservedAfter: 0 });
    const adj = await txn(f.tokens.inv, { type: 'ADJUSTMENT', itemId: item.id, locationId: f.warehouse.id, quantity: -5, reason: 'Water damaged' });
    expect(adj.body.data.onHandAfter).toBe(45);
    const use = await txn(f.tokens.inv, { type: 'CONSUMPTION', itemId: item.id, locationId: f.warehouse.id, quantity: 15, reason: 'Walk-in distribution' });
    expect(use.body.data).toMatchObject({ quantity: -15, onHandAfter: 30 });
    const b = await balance(item.id, f.warehouse.id);
    expect(b).toMatchObject({ onHand: 30, reserved: 0 });
    expect(b.lastCountedAt).toBeTruthy();
    const ledger = await api().get(`/api/v1/inventory/transactions?itemId=${item.id}`).set(auth(f.tokens.inv));
    expect(ledger.body.data.map((t) => t.type)).toEqual(['CONSUMPTION', 'ADJUSTMENT', 'RECEIPT']);
    expect(ledger.body.data[0].actor.role).toBe('INVENTORY_MANAGER');
  });

  it('never lets stock go negative or below the reserved amount', async () => {
    const item = await newItem('T-NEG', 10);
    const over = await txn(f.tokens.inv, { type: 'CONSUMPTION', itemId: item.id, locationId: f.warehouse.id, quantity: 11, reason: 'Too much' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_STOCK');
    const r = await verifiedRequestFor(item, 6);
    const a = await proposeAllocation(f, r);
    await api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.coord));
    const belowReserved = await txn(f.tokens.inv, { type: 'ADJUSTMENT', itemId: item.id, locationId: f.warehouse.id, quantity: -5, reason: 'Recount' });
    expect(belowReserved.status).toBe(409);
    const consumeReserved = await txn(f.tokens.inv, { type: 'CONSUMPTION', itemId: item.id, locationId: f.warehouse.id, quantity: 5, reason: 'Would eat reserved' });
    expect(consumeReserved.status).toBe(409);
    expect(await balance(item.id, f.warehouse.id)).toMatchObject({ onHand: 10, reserved: 6 });
  });

  it('only allows reservations/releases through the allocation workflow', async () => {
    const res = await txn(f.tokens.inv, { type: 'RESERVATION', itemId: f.items.food.id, locationId: f.warehouse.id, quantity: 1, reason: 'manual' });
    expect(res.status).toBe(400);
  });

  it('the database CHECK constraints back up the invariants', async () => {
    await expect(
      prisma.inventoryBalance.update({ where: { itemId_locationId: { itemId: f.items.food.id, locationId: f.warehouse.id } }, data: { reserved: 100000 } }),
    ).rejects.toThrow();
  });
});

describe('availability, locations and low stock', () => {
  it('reports status, freshness and straight-line distance only from recorded data', async () => {
    await receive(f.items.food.id, f.depot.id, 30);
    await prisma.inventoryBalance.update({
      where: { itemId_locationId: { itemId: f.items.food.id, locationId: f.depot.id } },
      data: { lastCountedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) },
    });
    const res = await api().get(`/api/v1/inventory/availability?itemId=${f.items.food.id}&latitude=30.3&longitude=78.0`);
    expect(res.status).toBe(200);
    const wh = res.body.data.find((r) => r.location.id === f.warehouse.id);
    expect(wh.availabilityStatus).toBe('AVAILABLE');
    expect(wh.distanceKm).toBeGreaterThan(5);
    expect(wh.distanceBasis).toBe('STRAIGHT_LINE');
    const stale = res.body.data.find((r) => r.location.id === f.depot.id);
    expect(stale).toMatchObject({ availabilityStatus: 'NOT_CONFIRMED', available: null, distanceKm: null, distanceBasis: null });
    expect(res.body.meta.distanceNote).toMatch(/straight-line/i);
  });

  it('marks zero and low stock correctly', async () => {
    const item = await newItem('T-LOW', 2);
    const res = await api().get(`/api/v1/inventory/availability?itemId=${item.id}`);
    expect(res.body.data[0].availabilityStatus).toBe('LIMITED');
    await txn(f.tokens.inv, { type: 'CONSUMPTION', itemId: item.id, locationId: f.warehouse.id, quantity: 2, reason: 'Given out' });
    const after = await api().get(`/api/v1/inventory/availability?itemId=${item.id}`);
    expect(after.body.data[0]).toMatchObject({ availabilityStatus: 'NOT_AVAILABLE', available: 0 });
    const low = await api().get('/api/v1/inventory/low-stock').set(auth(f.tokens.inv));
    expect(low.body.data.some((l) => l.item.id === item.id)).toBe(true);
  });

  it('citizens get the catalogue without balances; staff get balances', async () => {
    const pub = await api().get('/api/v1/inventory');
    expect(pub.status).toBe(200);
    expect(pub.body.data[0].balances).toBeUndefined();
    const staff = await api().get('/api/v1/inventory').set(auth(f.tokens.inv));
    expect(staff.body.data[0].balances).toBeDefined();
    const locs = await api().get('/api/v1/inventory/locations').set(auth(f.tokens.inv));
    expect(locs.body.data.find((l) => l.id === f.warehouse.id).assignedToMe).toBe(true);
  });
});

describe('allocations', () => {
  it('suggests explainable sources and refuses to over-allocate a request', async () => {
    const r = await verifiedRequestFor(f.items.food, 10);
    const sug = await api().get(`/api/v1/allocations/suggestions?requestId=${r.id}`).set(auth(f.tokens.coord));
    expect(sug.status).toBe(200);
    expect(sug.body.data.method).toMatch(/Rule-based/);
    expect(sug.body.data.candidates[0].location.id).toBe(f.warehouse.id);
    expect(sug.body.data.candidates[0].rationale.length).toBeGreaterThan(0);

    const tooMuch = await api()
      .post('/api/v1/allocations')
      .set(auth(f.tokens.coord))
      .send({ requestId: r.id, sourceLocationId: f.warehouse.id, lines: [{ requestItemId: r.items[0].id, quantity: 11 }] });
    expect(tooMuch.status).toBe(400);
  });

  it('cannot allocate an unverified request', async () => {
    const r = await createRequest(f.tokens.citizen, {}, f);
    const res = await api()
      .post('/api/v1/allocations')
      .set(auth(f.tokens.coord))
      .send({ requestId: r.id, sourceLocationId: f.warehouse.id, lines: [{ requestItemId: r.items[0].id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('approval reserves stock exactly once; duplicates and invalid transitions are rejected', async () => {
    const item = await newItem('T-ONCE', 20);
    const r = await verifiedRequestFor(item, 5);
    const a = await proposeAllocation(f, r);
    const ok = await api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.coord));
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');
    const dup = await api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.coord));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect(await balance(item.id, f.warehouse.id)).toMatchObject({ onHand: 20, reserved: 5 });
    expect(await prisma.inventoryTransaction.count({ where: { allocationId: a.id, type: 'RESERVATION' } })).toBe(1);
    expect((await prisma.reliefRequest.findUnique({ where: { id: r.id } })).status).toBe('ALLOCATED');

    expect((await api().post(`/api/v1/allocations/${a.id}/reject`).set(auth(f.tokens.coord)).send({ reason: 'too late' })).status).toBe(409);
    const rel = await api().post(`/api/v1/allocations/${a.id}/release`).set(auth(f.tokens.coord)).send({ reason: 'Road blocked, re-plan' });
    expect(rel.body.data.status).toBe('RELEASED');
    const rel2 = await api().post(`/api/v1/allocations/${a.id}/release`).set(auth(f.tokens.coord)).send({ reason: 'again' });
    expect(rel2.status).toBe(409);
    expect(await balance(item.id, f.warehouse.id)).toMatchObject({ onHand: 20, reserved: 0 });
    expect((await prisma.reliefRequest.findUnique({ where: { id: r.id } })).status).toBe('VERIFIED');
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: { in: ['ALLOCATION_APPROVED', 'ALLOCATION_RELEASED'] } } })).toBe(2);
  });

  it('two allocations competing for the same stock: exactly one wins', async () => {
    const item = await newItem('T-RACE', 10);
    const r1 = await verifiedRequestFor(item, 8);
    const r2 = await verifiedRequestFor(item, 8);
    const a1 = await proposeAllocation(f, r1);
    const a2 = await proposeAllocation(f, r2);
    const results = await Promise.all([
      api().post(`/api/v1/allocations/${a1.id}/approve`).set(auth(f.tokens.coord)),
      api().post(`/api/v1/allocations/${a2.id}/approve`).set(auth(f.tokens.coord)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('INSUFFICIENT_STOCK');
    const b = await balance(item.id, f.warehouse.id);
    expect(b).toMatchObject({ onHand: 10, reserved: 8 });
    // The losing allocation was rolled back completely and is still PROPOSED.
    const states = (await prisma.allocation.findMany({ where: { id: { in: [a1.id, a2.id] } } })).map((a) => a.status).sort();
    expect(states).toEqual(['APPROVED', 'PROPOSED']);
  });

  it('many parallel approvals never oversell', async () => {
    const item = await newItem('T-STORM', 10);
    const allocations = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await verifiedRequestFor(item, 3);
      allocations.push(await proposeAllocation(f, r));
    }
    const results = await Promise.all(allocations.map((a) => api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.coord))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    const b = await balance(item.id, f.warehouse.id);
    expect(b.reserved).toBe(9);
    expect(b.reserved).toBeLessThanOrEqual(b.onHand);
  });

  it('the same allocation approved twice at once is only approved once', async () => {
    const item = await newItem('T-TWICE', 10);
    const r = await verifiedRequestFor(item, 4);
    const a = await proposeAllocation(f, r);
    const results = await Promise.all([1, 2, 3].map(() => api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.coord))));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await balance(item.id, f.warehouse.id)).toMatchObject({ reserved: 4 });
  });

  it('inventory managers approve only allocations from their own locations', async () => {
    await receive(f.items.food.id, f.campB.id, 20);
    const r = await verifiedRequestFor(f.items.food, 3);
    const a = await proposeAllocation(f, r, { locationId: f.campB.id });
    expect((await api().post(`/api/v1/allocations/${a.id}/approve`).set(auth(f.tokens.inv))).status).toBe(403);
    const own = await proposeAllocation(f, await verifiedRequestFor(f.items.food, 2));
    expect((await api().post(`/api/v1/allocations/${own.id}/approve`).set(auth(f.tokens.inv))).status).toBe(200);
  });
});
