// Inventory invariants (also enforced by database CHECK constraints):
//   onHand >= 0, reserved >= 0, reserved <= onHand, available = onHand - reserved.
// Every stock change is a single conditional UPDATE, so concurrent writers cannot oversell or double-reserve.
import { prisma } from '../utils/prisma.js';
import { badRequest, forbidden, insufficientStock, notFound } from '../utils/errors.js';
import { haversineKm, hasCoords } from '../utils/geo.js';
import { pageMeta } from '../utils/pagination.js';
import { config } from '../config/env.js';
import { Roles, STAFF_ROLES } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { emit, rooms } from '../sockets/emitter.js';

export const STOCK_LOCATION_TYPES = ['WAREHOUSE', 'DISTRIBUTION_POINT', 'CAMP', 'SHELTER', 'MEDICAL_POINT'];

export function assertCanManageLocation(user, locationId) {
  if (user.role === Roles.ADMIN) return;
  if (user.role === Roles.INVENTORY_MANAGER && user.locationIds.includes(locationId)) return;
  throw forbidden('You are not assigned to manage stock at this location');
}

async function ensureBalance(tx, itemId, locationId) {
  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "itemId", "locationId", "onHand", "reserved", "updatedAt")
    VALUES (gen_random_uuid(), ${itemId}::uuid, ${locationId}::uuid, 0, 0, now())
    ON CONFLICT ("itemId", "locationId") DO NOTHING`;
}

async function recordTxn(tx, row, { type, quantity, reason, actor, requestId, allocationId, dispatchId }) {
  return tx.inventoryTransaction.create({
    data: {
      type,
      itemId: row.itemId,
      locationId: row.locationId,
      quantity,
      onHandAfter: row.onHand,
      reservedAfter: row.reserved,
      reason,
      actorId: actor?.id ?? null,
      requestId: requestId ?? null,
      allocationId: allocationId ?? null,
      dispatchId: dispatchId ?? null,
    },
  });
}

// ─── Atomic primitives (must run inside a transaction) ───────────────────

export async function reserveTx(tx, { itemId, locationId, quantity, ...ctx }) {
  const rows = await tx.$queryRaw`
    UPDATE "InventoryBalance" SET "reserved" = "reserved" + ${quantity}, "updatedAt" = now()
    WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid AND "onHand" - "reserved" >= ${quantity}
    RETURNING "itemId", "locationId", "onHand", "reserved"`;
  if (!rows.length) {
    const bal = await tx.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
    throw insufficientStock([{ itemId, locationId, requested: quantity, available: bal ? bal.onHand - bal.reserved : 0 }]);
  }
  await recordTxn(tx, rows[0], { type: 'RESERVATION', quantity, ...ctx });
  return rows[0];
}

export async function releaseTx(tx, { itemId, locationId, quantity, ...ctx }) {
  if (quantity <= 0) return null;
  const rows = await tx.$queryRaw`
    UPDATE "InventoryBalance" SET "reserved" = "reserved" - ${quantity}, "updatedAt" = now()
    WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid AND "reserved" >= ${quantity}
    RETURNING "itemId", "locationId", "onHand", "reserved"`;
  if (!rows.length) throw insufficientStock([{ itemId, locationId, release: quantity, reason: 'Reserved quantity is lower than release' }]);
  await recordTxn(tx, rows[0], { type: 'RELEASE', quantity: -quantity, ...ctx });
  return rows[0];
}

// Delivery consumes stock that was previously reserved for the dispatch.
export async function consumeReservedTx(tx, { itemId, locationId, quantity, ...ctx }) {
  if (quantity <= 0) return null;
  const rows = await tx.$queryRaw`
    UPDATE "InventoryBalance" SET "onHand" = "onHand" - ${quantity}, "reserved" = "reserved" - ${quantity}, "updatedAt" = now()
    WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid AND "reserved" >= ${quantity} AND "onHand" >= ${quantity}
    RETURNING "itemId", "locationId", "onHand", "reserved"`;
  if (!rows.length) throw insufficientStock([{ itemId, locationId, consume: quantity }]);
  await recordTxn(tx, rows[0], { type: 'CONSUMPTION', quantity: -quantity, ...ctx });
  return rows[0];
}

// ─── Manual transactions (RECEIPT, ADJUSTMENT, CONSUMPTION) ──────────────

export async function recordTransaction(user, input, req) {
  assertCanManageLocation(user, input.locationId);
  const [item, location] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: input.itemId } }),
    prisma.location.findUnique({ where: { id: input.locationId } }),
  ]);
  if (!item) throw badRequest('Unknown inventory item', [{ path: 'itemId', message: 'Not found' }]);
  if (!location || !STOCK_LOCATION_TYPES.includes(location.type)) {
    throw badRequest('Location cannot hold stock', [{ path: 'locationId', message: 'Not a stock location' }]);
  }
  const { itemId, locationId, quantity, reason, type } = input;

  const txn = await prisma.$transaction(async (tx) => {
    await ensureBalance(tx, itemId, locationId);
    let rows;
    if (type === 'RECEIPT') {
      if (quantity <= 0) throw badRequest('Receipt quantity must be positive');
      rows = await tx.$queryRaw`
        UPDATE "InventoryBalance" SET "onHand" = "onHand" + ${quantity}, "lastCountedAt" = now(), "updatedAt" = now()
        WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid
        RETURNING "itemId", "locationId", "onHand", "reserved"`;
    } else if (type === 'ADJUSTMENT') {
      if (quantity === 0) throw badRequest('Adjustment quantity cannot be zero');
      // An adjustment may never push on-hand below what is already reserved for approved allocations.
      rows = await tx.$queryRaw`
        UPDATE "InventoryBalance" SET "onHand" = "onHand" + ${quantity}, "lastCountedAt" = now(), "updatedAt" = now()
        WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid AND "onHand" + ${quantity} >= "reserved"
        RETURNING "itemId", "locationId", "onHand", "reserved"`;
    } else if (type === 'CONSUMPTION') {
      if (quantity <= 0) throw badRequest('Consumption quantity must be positive');
      rows = await tx.$queryRaw`
        UPDATE "InventoryBalance" SET "onHand" = "onHand" - ${quantity}, "updatedAt" = now()
        WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid AND "onHand" - "reserved" >= ${quantity}
        RETURNING "itemId", "locationId", "onHand", "reserved"`;
    } else {
      throw badRequest('Reservations and releases are created through the allocation workflow');
    }
    if (!rows.length) {
      const bal = await tx.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId, locationId } } });
      throw insufficientStock([{ itemId, locationId, change: quantity, onHand: bal?.onHand ?? 0, reserved: bal?.reserved ?? 0 }]);
    }
    const signed = type === 'CONSUMPTION' ? -quantity : quantity;
    const t = await recordTxn(tx, rows[0], { type, quantity: signed, reason, actor: user, requestId: input.requestId });
    await audit(tx, { actor: user, action: `INVENTORY_${type}`, entityType: 'InventoryTransaction', entityId: t.id, after: { itemId, locationId, quantity: signed, reason }, req });
    return t;
  });
  emit([rooms.inventory, rooms.ops], 'inventory:updated', { itemId, locationId });
  return txn;
}

// ─── Catalogue and balances ──────────────────────────────────────────────

const shapeBalance = (b) => ({
  locationId: b.locationId,
  location: b.location ? { id: b.location.id, name: b.location.name, type: b.location.type, area: b.location.area } : undefined,
  onHand: b.onHand,
  reserved: b.reserved,
  available: b.onHand - b.reserved,
  lastCountedAt: b.lastCountedAt,
  updatedAt: b.updatedAt,
});

export async function createItem(user, data, req) {
  const item = await prisma.inventoryItem.create({ data });
  await audit(null, { actor: user, action: 'INVENTORY_ITEM_CREATED', entityType: 'InventoryItem', entityId: item.id, after: data, req });
  return item;
}

export async function updateItem(user, id, data, req) {
  const before = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!before) throw notFound('Inventory item');
  const item = await prisma.inventoryItem.update({ where: { id }, data });
  await audit(null, { actor: user, action: 'INVENTORY_ITEM_UPDATED', entityType: 'InventoryItem', entityId: id, before, after: data, req });
  return item;
}

export async function listItems(user, q) {
  const staff = user && STAFF_ROLES.includes(user.role);
  const where = {
    ...(q.category ? { category: q.category } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    ...(staff && q.includeInactive ? {} : { isActive: true }),
  };
  const [items, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: staff ? { balances: { include: { location: true } } } : undefined,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.inventoryItem.count({ where }),
  ]);
  const shaped = items.map((i) => {
    const base = { id: i.id, sku: i.sku, name: i.name, category: i.category, unit: i.unit, description: i.description };
    if (!staff) return base;
    const balances = i.balances.map(shapeBalance);
    return {
      ...base,
      lowStockThreshold: i.lowStockThreshold,
      isActive: i.isActive,
      totals: {
        onHand: balances.reduce((s, b) => s + b.onHand, 0),
        reserved: balances.reduce((s, b) => s + b.reserved, 0),
        available: balances.reduce((s, b) => s + b.available, 0),
      },
      balances,
    };
  });
  return { items: shaped, meta: pageMeta(q, total) };
}

export async function getItem(user, id) {
  const staff = STAFF_ROLES.includes(user.role);
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: staff ? { balances: { include: { location: true } } } : undefined,
  });
  if (!item) throw notFound('Inventory item');
  if (!staff) return { id: item.id, sku: item.sku, name: item.name, category: item.category, unit: item.unit, description: item.description };
  return { ...item, balances: item.balances.map(shapeBalance) };
}

export async function listTransactions(user, q) {
  const scope = user.role === Roles.INVENTORY_MANAGER ? { locationId: { in: user.locationIds } } : {};
  const where = {
    ...scope,
    ...(q.itemId ? { itemId: q.itemId } : {}),
    ...(q.locationId ? { locationId: q.locationId } : {}),
    ...(q.type ? { type: q.type } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: {
        item: { select: { name: true, unit: true } },
        location: { select: { name: true } },
        actor: { select: { fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);
  return { items, meta: pageMeta(q, total) };
}

export async function lowStock(user) {
  const scope = user.role === Roles.INVENTORY_MANAGER ? { locationId: { in: user.locationIds } } : {};
  const balances = await prisma.inventoryBalance.findMany({
    where: { ...scope, item: { isActive: true } },
    include: { item: true, location: true },
  });
  return balances
    .filter((b) => b.onHand - b.reserved <= b.item.lowStockThreshold)
    .map((b) => ({
      item: { id: b.item.id, name: b.item.name, unit: b.item.unit, category: b.item.category, lowStockThreshold: b.item.lowStockThreshold },
      ...shapeBalance(b),
    }))
    .sort((a, b) => a.available - b.available);
}

export async function stockLocations(user) {
  const locations = await prisma.location.findMany({
    where: { isActive: true, type: { in: STOCK_LOCATION_TYPES } },
    include: { balances: { include: { item: { select: { lowStockThreshold: true } } } } },
    orderBy: { name: 'asc' },
  });
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    area: l.area,
    address: l.address,
    latitude: l.latitude,
    longitude: l.longitude,
    assignedToMe: user.locationIds?.includes(l.id) ?? false,
    itemCount: l.balances.length,
    totals: {
      onHand: l.balances.reduce((s, b) => s + b.onHand, 0),
      reserved: l.balances.reduce((s, b) => s + b.reserved, 0),
      available: l.balances.reduce((s, b) => s + (b.onHand - b.reserved), 0),
    },
    lowStockCount: l.balances.filter((b) => b.onHand - b.reserved <= b.item.lowStockThreshold).length,
  }));
}

// Availability status is derived only from recorded balances and their freshness.
export function availabilityStatus(balance, item) {
  const staleMs = config.INVENTORY_STALE_HOURS * 3600 * 1000;
  if (!balance.lastCountedAt || Date.now() - new Date(balance.lastCountedAt).getTime() > staleMs) {
    return { status: 'NOT_CONFIRMED', reason: 'Stock has not been confirmed recently' };
  }
  const available = balance.onHand - balance.reserved;
  if (available <= 0) return { status: 'NOT_AVAILABLE', reason: 'No unreserved stock recorded' };
  if (available <= item.lowStockThreshold) return { status: 'LIMITED', reason: 'Stock is at or below the low-stock level' };
  return { status: 'AVAILABLE', reason: null };
}

export async function availability(q) {
  const where = {
    location: { isActive: true, ...(q.locationId ? { id: q.locationId } : {}), ...(q.locationType ? { type: q.locationType } : {}) },
    item: { isActive: true, ...(q.category ? { category: q.category } : {}), ...(q.itemId ? { id: q.itemId } : {}) },
  };
  const balances = await prisma.inventoryBalance.findMany({ where, include: { item: true, location: true }, take: 1000 });
  const origin = q.latitude != null && q.longitude != null ? { lat: q.latitude, lng: q.longitude } : null;
  const rows = balances.map((b) => {
    const { status, reason } = availabilityStatus(b, b.item);
    const distanceKm = origin && hasCoords(b.location) ? haversineKm(origin.lat, origin.lng, b.location.latitude, b.location.longitude) : null;
    return {
      location: {
        id: b.location.id,
        name: b.location.name,
        type: b.location.type,
        area: b.location.area,
        address: b.location.address,
        latitude: b.location.latitude,
        longitude: b.location.longitude,
      },
      item: { id: b.item.id, name: b.item.name, category: b.item.category, unit: b.item.unit },
      available: status === 'NOT_CONFIRMED' ? null : Math.max(0, b.onHand - b.reserved),
      lastConfirmedAt: b.lastCountedAt,
      availabilityStatus: status,
      availabilityReason: reason,
      distanceKm,
      distanceBasis: distanceKm != null ? 'STRAIGHT_LINE' : null,
    };
  });
  const filtered = q.radiusKm && origin ? rows.filter((r) => r.distanceKm != null && r.distanceKm <= q.radiusKm) : rows;
  filtered.sort((a, b) => {
    if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm != null) return -1;
    if (b.distanceKm != null) return 1;
    return a.location.name.localeCompare(b.location.name);
  });
  return {
    items: filtered,
    meta: {
      origin: origin ?? null,
      distanceNote: origin ? 'Distances are approximate straight-line distances, not road distances.' : 'No origin supplied; distance unavailable.',
      staleAfterHours: config.INVENTORY_STALE_HOURS,
    },
  };
}

