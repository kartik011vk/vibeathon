// Allocation workflow: PROPOSED → APPROVED (stock reserved) → DISPATCHED → FULFILLED
//                      PROPOSED → REJECTED;  APPROVED → RELEASED (reservation returned to stock).
// Suggestions are rule-based and explainable. There is no optimiser or AI model.
import { prisma } from '../utils/prisma.js';
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { haversineKm, hasCoords } from '../utils/geo.js';
import { pageMeta } from '../utils/pagination.js';
import { Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { addTimelineEvent, recomputeRequestStatus } from './timeline.service.js';
import { availabilityStatus, releaseTx, reserveTx, STOCK_LOCATION_TYPES } from './inventory.service.js';
import { allocationScope, isCoordinator } from './access.service.js';
import { notifyUsers } from './notification.service.js';
import { emit, rooms } from '../sockets/emitter.js';

const ALLOCATABLE_REQUEST_STATUSES = ['VERIFIED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED'];

const allocationInclude = {
  lines: { include: { item: { select: { id: true, name: true, unit: true, category: true } }, requestItem: { select: { id: true, name: true, quantity: true } } } },
  sourceLocation: { select: { id: true, name: true, type: true, area: true, latitude: true, longitude: true } },
  request: { select: { id: true, referenceCode: true, status: true, severity: true, category: true, campId: true } },
  proposedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  dispatches: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } },
};

const lockRequest = (tx, requestId) => tx.$queryRaw`SELECT "id" FROM "ReliefRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;

// Quantity per request item already delivered or committed to an allocation/dispatch.
async function committedByRequestItem(tx, requestId, { includeProposed = true, excludeAllocationId } = {}) {
  const statuses = includeProposed ? ['PROPOSED', 'APPROVED'] : ['APPROVED'];
  const [items, lines, dispatchLines] = await Promise.all([
    tx.requestItem.findMany({ where: { requestId } }),
    tx.allocationLine.findMany({
      where: { allocation: { requestId, status: { in: statuses }, ...(excludeAllocationId ? { id: { not: excludeAllocationId } } : {}) } },
    }),
    tx.dispatchLine.findMany({
      where: { dispatch: { requestId, status: { in: ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'] } } },
    }),
  ]);
  const map = new Map(items.map((i) => [i.id, { item: i, committed: i.deliveredQuantity }]));
  for (const l of lines) map.get(l.requestItemId).committed += l.quantity;
  for (const d of dispatchLines) map.get(d.requestItemId).committed += d.quantity - d.deliveredQuantity;
  return map;
}

export async function outstandingForRequest(requestId, db = prisma) {
  const map = await committedByRequestItem(db, requestId);
  return [...map.values()].map(({ item, committed }) => ({
    requestItemId: item.id,
    inventoryItemId: item.inventoryItemId,
    name: item.name,
    unit: item.unit,
    requested: item.quantity,
    delivered: item.deliveredQuantity,
    outstanding: Math.max(0, item.quantity - committed),
  }));
}

export async function suggestions(user, requestId) {
  if (!(isCoordinator(user) || user.role === Roles.INVENTORY_MANAGER)) throw forbidden();
  const request = await prisma.reliefRequest.findUnique({ where: { id: requestId }, include: { camp: true } });
  if (!request) throw notFound('Request');
  const outstanding = (await outstandingForRequest(requestId)).filter((o) => o.outstanding > 0);
  const notes = [];
  const allocatable = outstanding.filter((o) => o.inventoryItemId);
  if (allocatable.length < outstanding.length) notes.push('Some items are not linked to the stock catalogue and need manual sourcing.');
  if (!ALLOCATABLE_REQUEST_STATUSES.includes(request.status)) notes.push(`Request is ${request.status}; allocations require a verified request.`);

  const dest = hasCoords(request) ? request : hasCoords(request.camp) ? request.camp : null;
  if (!dest) notes.push('Destination coordinates are unknown, so distance is not used for ranking.');

  const balances = allocatable.length
    ? await prisma.inventoryBalance.findMany({
        where: {
          itemId: { in: allocatable.map((o) => o.inventoryItemId) },
          location: { isActive: true, type: { in: STOCK_LOCATION_TYPES } },
        },
        include: { location: true, item: true },
      })
    : [];

  const byLocation = new Map();
  for (const b of balances) {
    const available = b.onHand - b.reserved;
    if (available <= 0) continue;
    if (!byLocation.has(b.locationId)) byLocation.set(b.locationId, { location: b.location, balances: [] });
    byLocation.get(b.locationId).balances.push(b);
  }

  const totalOutstanding = allocatable.reduce((s, o) => s + o.outstanding, 0);
  const candidates = [...byLocation.values()].map(({ location, balances: bs }) => {
    const lines = [];
    let stale = false;
    for (const o of allocatable) {
      const b = bs.find((x) => x.itemId === o.inventoryItemId);
      if (!b) continue;
      const available = b.onHand - b.reserved;
      const proposed = Math.min(available, o.outstanding);
      if (availabilityStatus(b, b.item).status === 'NOT_CONFIRMED') stale = true;
      lines.push({ requestItemId: o.requestItemId, itemId: o.inventoryItemId, name: o.name, unit: o.unit, outstanding: o.outstanding, available, proposedQuantity: proposed });
    }
    const covered = lines.reduce((s, l) => s + l.proposedQuantity, 0);
    const distanceKm = dest && hasCoords(location) ? haversineKm(dest.latitude, dest.longitude, location.latitude, location.longitude) : null;
    const fullyCovers = totalOutstanding > 0 && covered >= totalOutstanding;
    const rationale = [
      fullyCovers ? 'Can supply everything still outstanding' : `Can supply ${covered} of ${totalOutstanding} outstanding units`,
      distanceKm != null ? `approx. ${distanceKm} km away (straight-line distance)` : 'distance unknown',
      stale ? 'some stock counts are older than the freshness window — confirm before dispatch' : 'stock counts are recent',
    ];
    return {
      location: { id: location.id, name: location.name, type: location.type, area: location.area },
      lines,
      coveredUnits: covered,
      outstandingUnits: totalOutstanding,
      fullyCovers,
      distanceKm,
      distanceBasis: distanceKm != null ? 'STRAIGHT_LINE' : null,
      stockConfirmed: !stale,
      rationale,
    };
  });

  candidates.sort((a, b) => {
    if (a.fullyCovers !== b.fullyCovers) return a.fullyCovers ? -1 : 1;
    if (a.coveredUnits !== b.coveredUnits) return b.coveredUnits - a.coveredUnits;
    if (a.stockConfirmed !== b.stockConfirmed) return a.stockConfirmed ? -1 : 1;
    if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
    return a.distanceKm != null ? -1 : 1;
  });

  return {
    requestId,
    requestStatus: request.status,
    outstanding,
    candidates: candidates.slice(0, 5),
    method: 'Rule-based: full coverage first, then units covered, confirmed stock, then straight-line distance.',
    notes,
  };
}

export async function createAllocation(user, input, req) {
  if (!isCoordinator(user)) throw forbidden();
  const location = await prisma.location.findUnique({ where: { id: input.sourceLocationId } });
  if (!location || !location.isActive || !STOCK_LOCATION_TYPES.includes(location.type)) {
    throw badRequest('Source location cannot supply stock', [{ path: 'sourceLocationId', message: 'Not an active stock location' }]);
  }
  const allocation = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, input.requestId);
    const request = await tx.reliefRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw notFound('Request');
    if (!ALLOCATABLE_REQUEST_STATUSES.includes(request.status)) throw invalidTransition(request.status, 'ALLOCATED', 'Request');
    const committed = await committedByRequestItem(tx, input.requestId);
    const seen = new Set();
    const lines = input.lines.map((l, idx) => {
      const entry = committed.get(l.requestItemId);
      if (!entry) throw badRequest('Line does not belong to this request', [{ path: `lines.${idx}.requestItemId` }]);
      if (seen.has(l.requestItemId)) throw badRequest('Each request item may appear once', [{ path: `lines.${idx}` }]);
      seen.add(l.requestItemId);
      if (!entry.item.inventoryItemId) throw badRequest(`"${entry.item.name}" is not linked to a stock item`, [{ path: `lines.${idx}` }]);
      const outstanding = entry.item.quantity - entry.committed;
      if (l.quantity > outstanding) {
        throw badRequest(`Only ${Math.max(0, outstanding)} ${entry.item.unit} of "${entry.item.name}" are still outstanding`, [{ path: `lines.${idx}.quantity`, outstanding }]);
      }
      return { requestItemId: l.requestItemId, itemId: entry.item.inventoryItemId, quantity: l.quantity };
    });
    const created = await tx.allocation.create({
      data: {
        requestId: input.requestId,
        sourceLocationId: input.sourceLocationId,
        notes: input.notes,
        rationale: input.rationale ?? undefined,
        proposedById: user.id,
        lines: { create: lines },
      },
    });
    await audit(tx, { actor: user, action: 'ALLOCATION_PROPOSED', entityType: 'Allocation', entityId: created.id, after: { requestId: input.requestId, sourceLocationId: input.sourceLocationId, lines }, req });
    await addTimelineEvent(tx, { requestId: input.requestId, type: 'ALLOCATION_PROPOSED', message: `Allocation proposed from ${location.name}`, actor: user, isPublic: false, data: { allocationId: created.id } });
    return created;
  });
  emit([rooms.ops, rooms.inventory], 'allocation:updated', { id: allocation.id, status: allocation.status, requestId: allocation.requestId });
  return getAllocation(user, allocation.id);
}

function assertCanApprove(user, allocation) {
  if (isCoordinator(user)) return;
  if (user.role === Roles.INVENTORY_MANAGER && user.locationIds.includes(allocation.sourceLocationId)) return;
  throw forbidden('Only coordinators or the source location inventory manager can approve this allocation');
}

export async function approveAllocation(user, id, req) {
  const existing = await prisma.allocation.findUnique({ where: { id } });
  if (!existing) throw notFound('Allocation');
  assertCanApprove(user, existing);

  const allocation = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, existing.requestId);
    // Atomic state change: a second concurrent or repeated approval matches zero rows.
    const { count } = await tx.allocation.updateMany({
      where: { id, status: 'PROPOSED' },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
    });
    if (count === 0) {
      const now = await tx.allocation.findUnique({ where: { id } });
      throw conflict(`Allocation is already ${now.status}`, [{ status: now.status }]);
    }
    const request = await tx.reliefRequest.findUnique({ where: { id: existing.requestId } });
    if (!ALLOCATABLE_REQUEST_STATUSES.includes(request.status)) throw invalidTransition(request.status, 'ALLOCATED', 'Request');
    const lines = await tx.allocationLine.findMany({ where: { allocationId: id } });
    // Re-check against already approved commitments (other PROPOSED allocations do not hold stock).
    const committed = await committedByRequestItem(tx, existing.requestId, { includeProposed: false, excludeAllocationId: id });
    for (const l of lines) {
      const entry = committed.get(l.requestItemId);
      if (entry.committed + l.quantity > entry.item.quantity) {
        throw conflict(`"${entry.item.name}" is already covered by other allocations`, [{ requestItemId: l.requestItemId }]);
      }
    }
    for (const l of lines) {
      await reserveTx(tx, {
        itemId: l.itemId,
        locationId: existing.sourceLocationId,
        quantity: l.quantity,
        reason: `Reserved for request ${request.referenceCode}`,
        actor: user,
        requestId: request.id,
        allocationId: id,
      });
    }
    await recomputeRequestStatus(tx, request.id);
    await audit(tx, { actor: user, action: 'ALLOCATION_APPROVED', entityType: 'Allocation', entityId: id, before: { status: 'PROPOSED' }, after: { status: 'APPROVED' }, req });
    await addTimelineEvent(tx, { requestId: request.id, type: 'ALLOCATION_APPROVED', message: 'Supplies reserved for this request', actor: user, data: { allocationId: id } });
    return tx.allocation.findUnique({ where: { id }, include: { request: true } });
  });

  emit([rooms.ops, rooms.inventory, rooms.request(allocation.requestId)], 'allocation:updated', { id, status: 'APPROVED', requestId: allocation.requestId });
  emit([rooms.request(allocation.requestId), rooms.ops], 'request:updated', { id: allocation.requestId });
  await notifyUsers([allocation.request.requesterId], {
    type: 'SUPPLIES_RESERVED',
    title: `Supplies reserved for ${allocation.request.referenceCode}`,
    body: 'Stock has been set aside for your request. A delivery team will be assigned next.',
    data: { requestId: allocation.requestId },
  });
  return getAllocation(user, id);
}

export async function rejectAllocation(user, id, reason, req) {
  const existing = await prisma.allocation.findUnique({ where: { id } });
  if (!existing) throw notFound('Allocation');
  assertCanApprove(user, existing);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.allocation.updateMany({ where: { id, status: 'PROPOSED' }, data: { status: 'REJECTED', rejectedReason: reason } });
    if (count === 0) {
      const now = await tx.allocation.findUnique({ where: { id } });
      throw invalidTransition(now.status, 'REJECTED', 'Allocation');
    }
    await audit(tx, { actor: user, action: 'ALLOCATION_REJECTED', entityType: 'Allocation', entityId: id, after: { reason }, req });
    await addTimelineEvent(tx, { requestId: existing.requestId, type: 'ALLOCATION_REJECTED', message: `Allocation rejected: ${reason}`, actor: user, isPublic: false });
  });
  emit([rooms.ops, rooms.inventory], 'allocation:updated', { id, status: 'REJECTED', requestId: existing.requestId });
  return getAllocation(user, id);
}

// Inside a transaction: return every reserved unit of an APPROVED allocation to available stock.
export async function releaseAllocationTx(tx, id, actor, reason, req) {
  const { count } = await tx.allocation.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'RELEASED', releasedReason: reason } });
  if (count === 0) {
    const now = await tx.allocation.findUnique({ where: { id } });
    if (!now) throw notFound('Allocation');
    throw invalidTransition(now.status, 'RELEASED', 'Allocation');
  }
  const allocation = await tx.allocation.findUnique({ where: { id }, include: { lines: true } });
  for (const l of allocation.lines) {
    await releaseTx(tx, { itemId: l.itemId, locationId: allocation.sourceLocationId, quantity: l.quantity, reason: `Released: ${reason}`, actor, requestId: allocation.requestId, allocationId: id });
  }
  await audit(tx, { actor, action: 'ALLOCATION_RELEASED', entityType: 'Allocation', entityId: id, before: { status: 'APPROVED' }, after: { status: 'RELEASED', reason }, req });
  await addTimelineEvent(tx, { requestId: allocation.requestId, type: 'ALLOCATION_RELEASED', message: 'Reserved supplies were released', actor, isPublic: false, data: { allocationId: id, reason } });
  return allocation;
}

export async function releaseAllocation(user, id, reason, req) {
  const existing = await prisma.allocation.findUnique({ where: { id } });
  if (!existing) throw notFound('Allocation');
  assertCanApprove(user, existing);
  await prisma.$transaction(async (tx) => {
    await lockRequest(tx, existing.requestId);
    await releaseAllocationTx(tx, id, user, reason, req);
    await recomputeRequestStatus(tx, existing.requestId);
  });
  emit([rooms.ops, rooms.inventory, rooms.request(existing.requestId)], 'allocation:updated', { id, status: 'RELEASED', requestId: existing.requestId });
  emit([rooms.request(existing.requestId), rooms.ops], 'request:updated', { id: existing.requestId });
  return getAllocation(user, id);
}

export async function getAllocation(user, id) {
  const allocation = await prisma.allocation.findFirst({ where: { id, ...allocationScope(user) }, include: allocationInclude });
  if (!allocation) throw notFound('Allocation');
  return allocation;
}

export async function listAllocations(user, q) {
  const where = {
    AND: [
      allocationScope(user),
      q.status ? { status: q.status } : {},
      q.requestId ? { requestId: q.requestId } : {},
      q.sourceLocationId ? { sourceLocationId: q.sourceLocationId } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.allocation.findMany({ where, include: allocationInclude, orderBy: { createdAt: q.sortOrder }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.allocation.count({ where }),
  ]);
  return { items, meta: pageMeta(q, total) };
}
