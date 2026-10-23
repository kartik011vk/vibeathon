// Shared test fixtures. Every test file calls `setup()` in beforeAll, which empties the test database
// and builds a small, known world: one active RED zone, a warehouse, two camps, one user per role and two teams.
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/utils/prisma.js';
import { hashPassword } from '../src/services/auth.service.js';
import * as inventory from '../src/services/inventory.service.js';

export const app = createApp();
export const api = () => request(app);
export const PASSWORD = 'TestPass2026!';
export const auth = (token) => ({ Authorization: `Bearer ${token}` });
export const fakeReq = { id: 'test', ip: null, get: () => 'vitest' };

let passwordHash;

export async function resetDb() {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function actorFor(email) {
  const u = await prisma.user.findUnique({ where: { email }, include: { locationAssignments: true, teamMemberships: true } });
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    locationIds: u.locationAssignments.map((a) => a.locationId),
    teamIds: u.teamMemberships.map((m) => m.teamId),
  };
}

async function makeUser(email, role, extra = {}) {
  passwordHash ??= await hashPassword(PASSWORD);
  return prisma.user.create({ data: { email, fullName: `${role} tester`, role, passwordHash, preference: { create: {} }, ...extra } });
}

export async function login(email, password = PASSWORD) {
  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

export async function receive(itemId, locationId, quantity) {
  const admin = await actorFor('admin@test.dev');
  return inventory.recordTransaction(admin, { type: 'RECEIPT', itemId, locationId, quantity, reason: 'test stock' }, fakeReq);
}

export async function setup() {
  await resetDb();
  const zone = await prisma.disasterZone.create({
    data: { name: 'Test flood zone', hazardType: 'FLOOD', status: 'ACTIVE', severity: 'RED', centerLat: 30.3, centerLng: 78.0, radiusKm: 5, source: 'test' },
  });
  const warehouse = await prisma.location.create({ data: { name: 'Test warehouse', type: 'WAREHOUSE', latitude: 30.35, longitude: 77.9 } });
  const depot = await prisma.location.create({ data: { name: 'Test depot (no coords)', type: 'DISTRIBUTION_POINT' } });
  const campA = await prisma.location.create({ data: { name: 'Camp A', type: 'CAMP', latitude: 30.3, longitude: 78.0, disasterZoneId: zone.id } });
  const campB = await prisma.location.create({ data: { name: 'Camp B', type: 'CAMP', latitude: 30.5, longitude: 78.4 } });

  const users = {
    admin: await makeUser('admin@test.dev', 'ADMIN'),
    coord: await makeUser('coord@test.dev', 'RELIEF_COORDINATOR'),
    campMgr: await makeUser('camp@test.dev', 'CAMP_MANAGER', { locationAssignments: { create: [{ locationId: campA.id }] } }),
    inv: await makeUser('inv@test.dev', 'INVENTORY_MANAGER', { locationAssignments: { create: [{ locationId: warehouse.id }] } }),
    team1: await makeUser('team1@test.dev', 'RESPONSE_TEAM'),
    team2: await makeUser('team2@test.dev', 'RESPONSE_TEAM'),
    citizen: await makeUser('citizen@test.dev', 'CITIZEN'),
    citizen2: await makeUser('citizen2@test.dev', 'CITIZEN'),
  };
  const teamA = await prisma.responseTeam.create({ data: { name: 'Team One', members: { create: [{ userId: users.team1.id }] } } });
  const teamB = await prisma.responseTeam.create({ data: { name: 'Team Two', members: { create: [{ userId: users.team2.id }] } } });

  const items = {
    water: await prisma.inventoryItem.create({ data: { sku: 'T-WATER', name: 'Water can', category: 'WATER', unit: 'cans', lowStockThreshold: 5 } }),
    food: await prisma.inventoryItem.create({ data: { sku: 'T-FOOD', name: 'Ration kit', category: 'FOOD', unit: 'kits', lowStockThreshold: 5 } }),
    meds: await prisma.inventoryItem.create({ data: { sku: 'T-MEDS', name: 'Medicine kit', category: 'MEDICINE', unit: 'kits', lowStockThreshold: 2 } }),
  };
  await receive(items.water.id, warehouse.id, 100);
  await receive(items.food.id, warehouse.id, 100);
  await receive(items.meds.id, warehouse.id, 50);

  const tokens = {};
  for (const [key, u] of Object.entries(users)) tokens[key] = await login(u.email);

  return { zone, warehouse, depot, campA, campB, users, teamA, teamB, items, tokens };
}

// Creates a request via the API as `token`. Defaults to a small food request with an address.
export async function createRequest(token, overrides = {}, f) {
  const body = {
    category: 'FOOD',
    description: 'Families need food for three days',
    peopleAffected: 10,
    destinationAddress: 'Test street 1',
    items: [{ inventoryItemId: f.items.food.id, quantity: 10 }],
    ...overrides,
  };
  const res = await api().post('/api/v1/requests').set(auth(token)).send(body);
  if (res.status !== 201) throw new Error(`createRequest failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function verify(f, requestId, extra = {}) {
  const res = await api().post(`/api/v1/requests/${requestId}/verify`).set(auth(f.tokens.coord)).send({ decision: 'VERIFY', reason: 'checked in test', ...extra });
  if (res.status !== 200) throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function proposeAllocation(f, request, { locationId, quantities } = {}) {
  const res = await api()
    .post('/api/v1/allocations')
    .set(auth(f.tokens.coord))
    .send({
      requestId: request.id,
      sourceLocationId: locationId ?? f.warehouse.id,
      lines: request.items.map((i, idx) => ({ requestItemId: i.id, quantity: quantities?.[idx] ?? i.quantity })),
    });
  if (res.status !== 201) throw new Error(`allocation failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

// Verified request → approved allocation → dispatch assigned to Team One. Returns ids.
export async function dispatchFixture(f, { citizenToken, items } = {}) {
  const request = await createRequest(citizenToken ?? f.tokens.citizen, items ? { items } : {}, f);
  await verify(f, request.id);
  const allocation = await proposeAllocation(f, request);
  const approved = await api().post(`/api/v1/allocations/${allocation.id}/approve`).set(auth(f.tokens.coord));
  if (approved.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.body)}`);
  const d = await api().post('/api/v1/dispatches').set(auth(f.tokens.coord)).send({ allocationId: allocation.id, teamId: f.teamA.id });
  if (d.status !== 201) throw new Error(`dispatch failed: ${JSON.stringify(d.body)}`);
  return { request, allocation, dispatch: d.body.data };
}

export function balance(itemId, locationId) {
  return prisma.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
}

export { prisma };
