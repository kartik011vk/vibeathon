// Dispatch lifecycle:
//   CREATED → ASSIGNED → ACCEPTED → IN_TRANSIT → PARTIALLY_DELIVERED → DELIVERED
//   FAILED from ASSIGNED / ACCEPTED / IN_TRANSIT / PARTIALLY_DELIVERED
//   CANCELLED from CREATED / ASSIGNED / ACCEPTED (reservation is kept so the allocation can be re-dispatched)
import { prisma } from '../utils/prisma.js';
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { haversineKm, hasCoords } from '../utils/geo.js';
import { pageMeta } from '../utils/pagination.js';
import { config } from '../config/env.js';
import { DISPATCH_STATUS_LABELS, Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { addTimelineEvent, recomputeRequestStatus } from './timeline.service.js';
import { consumeReservedTx, releaseTx } from './inventory.service.js';
import { canSeeExactTeamLocation, dispatchScope, findDispatchInScope, isCoordinator, isTeamMember } from './access.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { isLocationStale } from './team.service.js';
import { routing } from '../adapters/index.js';
import { emit, rooms } from '../sockets/emitter.js';

export const TRANSITIONS = Object.freeze({
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'FAILED', 'CANCELLED'],
  ACCEPTED: ['IN_TRANSIT', 'FAILED', 'CANCELLED'],
  IN_TRANSIT: ['PARTIALLY_DELIVERED', 'DELIVERED', 'FAILED'],
  PARTIALLY_DELIVERED: ['PARTIALLY_DELIVERED', 'DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
});

const OPEN = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'];

const fromStatesFor = (to) => Object.entries(TRANSITIONS).filter(([, tos]) => tos.includes(to)).map(([from]) => from);

const dispatchInclude = {
  lines: { include: { item: { select: { id: true, name: true, unit: true } } } },
  team: { select: { id: true, name: true, callSign: true } },
  request: {
    select: {
      id: true,
      referenceCode: true,
      status: true,
      category: true,
      severity: true,
      requesterId: true,
      campId: true,
      destinationAddress: true,
      latitude: true,
      longitude: true,
      camp: { select: { id: true, name: true, latitude: true, longitude: true, address: true } },
    },
  },
  allocation: { select: { id: true, status: true, sourceLocation: { select: { id: true, name: true, area: true } } } },
  statusEvents: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true, role: true } } } },
};

function dispatchRooms(d) {
  return [rooms.dispatch(d.id), rooms.request(d.requestId), rooms.ops, d.teamId ? rooms.team(d.teamId) : null];
}

function assertTeamActor(user, dispatch, { allowCoordinator = true } = {}) {
  if (allowCoordinator && isCoordinator(user)) return;
  if (dispatch.teamId && isTeamMember(user, dispatch.teamId)) return;
  throw forbidden('Only the assigned response team can update this dispatch');
}

// Atomic transition: succeeds only if the row is still in an allowed source state.
async function transition(tx, dispatch, to, actor, reason, extra = {}) {
  const from = fromStatesFor(to);
  const { count } = await tx.dispatch.updateMany({ where: { id: dispatch.id, status: { in: from } }, data: { status: to, ...extra } });
  if (count === 0) {
    const now = await tx.dispatch.findUnique({ where: { id: dispatch.id }, select: { status: true } });
    throw invalidTransition(now.status, to, 'Dispatch');
  }
  await tx.dispatchStatusEvent.create({ data: { dispatchId: dispatch.id, fromStatus: dispatch.status, toStatus: to, reason, actorId: actor.id } });
}

export async function createDispatch(user, { allocationId, teamId, notes }, req) {
  if (!isCoordinator(user)) throw forbidden();
  const team = await prisma.responseTeam.findUnique({ where: { id: teamId } });
  if (!team) throw badRequest('Response team not found', [{ path: 'teamId' }]);
  if (team.availability === 'OFF_DUTY') throw conflict('This team is off duty');

  const dispatch = await prisma.$transaction(async (tx) => {
    const { count } = await tx.allocation.updateMany({ where: { id: allocationId, status: 'APPROVED' }, data: { status: 'DISPATCHED' } });
    if (count === 0) {
      const a = await tx.allocation.findUnique({ where: { id: allocationId } });
      if (!a) throw notFound('Allocation');
      throw invalidTransition(a.status, 'DISPATCHED', 'Allocation');
    }
    const allocation = await tx.allocation.findUnique({ where: { id: allocationId }, include: { lines: true } });
    // Earlier cancelled dispatches for this allocation are kept for history; only one may be open.
    const open = await tx.dispatch.count({ where: { allocationId, status: { in: OPEN } } });
    if (open > 0) throw conflict('This allocation already has an open dispatch');
    const d = await tx.dispatch.create({
      data: {
        allocationId,
        requestId: allocation.requestId,
        teamId,
        notes,
        status: 'ASSIGNED',
        createdById: user.id,
        lines: {
          create: allocation.lines.map((l) => ({ allocationLineId: l.id, requestItemId: l.requestItemId, itemId: l.itemId, quantity: l.quantity })),
        },
        statusEvents: {
          create: [
            { fromStatus: null, toStatus: 'CREATED', actorId: user.id, reason: 'Dispatch created' },
            { fromStatus: 'CREATED', toStatus: 'ASSIGNED', actorId: user.id, reason: `Assigned to ${team.name}` },
          ],
        },
      },
    });
    await tx.responseTeam.update({ where: { id: teamId }, data: { availability: 'BUSY' } });
    await recomputeRequestStatus(tx, allocation.requestId);
    await addTimelineEvent(tx, { requestId: allocation.requestId, type: 'DISPATCH_ASSIGNED', message: 'A response team has been assigned to deliver your supplies', actor: user, data: { dispatchId: d.id } });
    await audit(tx, { actor: user, action: 'DISPATCH_CREATED', entityType: 'Dispatch', entityId: d.id, after: { allocationId, teamId }, req });
    return d;
  });

  emit(dispatchRooms(dispatch), 'dispatch:assigned', { id: dispatch.id, status: dispatch.status, requestId: dispatch.requestId });
  emit([rooms.request(dispatch.requestId), rooms.ops], 'request:updated', { id: dispatch.requestId });
  const members = await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } });
  await notifyUsers(members.map((m) => m.userId), { type: 'DISPATCH_ASSIGNED', title: 'New delivery assigned', body: 'Your team has a new dispatch. Please accept it.', data: { dispatchId: dispatch.id } });
  const request = await prisma.reliefRequest.findUnique({ where: { id: dispatch.requestId }, select: { requesterId: true, referenceCode: true } });
  await notifyUsers([request.requesterId], { type: 'DISPATCH_ASSIGNED', title: `Team assigned for ${request.referenceCode}`, body: 'A response team has been assigned to deliver your supplies.', data: { requestId: dispatch.requestId } });
  return getDispatch(user, dispatch.id);
}

export async function acceptDispatch(user, id, req) {
  const d = await findDispatchInScope(user, id);
  assertTeamActor(user, d, { allowCoordinator: false });
  await prisma.$transaction(async (tx) => {
    await transition(tx, d, 'ACCEPTED', user, 'Accepted by team', { acceptedAt: new Date() });
    await addTimelineEvent(tx, { requestId: d.requestId, type: 'DISPATCH_ACCEPTED', message: 'The response team has accepted the delivery', actor: user });
    await audit(tx, { actor: user, action: 'DISPATCH_ACCEPTED', entityType: 'Dispatch', entityId: id, req });
  });
  emit(dispatchRooms(d), 'dispatch:updated', { id, status: 'ACCEPTED', requestId: d.requestId });
  return getDispatch(user, id);
}

export async function startDispatch(user, id, req) {
  const d = await findDispatchInScope(user, id);
  assertTeamActor(user, d);
  await prisma.$transaction(async (tx) => {
    await transition(tx, d, 'IN_TRANSIT', user, 'Delivery started', { startedAt: new Date() });
    await recomputeRequestStatus(tx, d.requestId);
    await addTimelineEvent(tx, { requestId: d.requestId, type: 'DISPATCH_STARTED', message: 'Delivery in progress', actor: user });
    await audit(tx, { actor: user, action: 'DISPATCH_STARTED', entityType: 'Dispatch', entityId: id, req });
  });
  emit(dispatchRooms(d), 'dispatch:started', { id, status: 'IN_TRANSIT', requestId: d.requestId });
  const request = await prisma.reliefRequest.findUnique({ where: { id: d.requestId }, select: { requesterId: true, referenceCode: true } });
  await notifyUsers([request.requesterId], { type: 'DISPATCH_STARTED', title: `Delivery started for ${request.referenceCode}`, body: 'Your supplies are on the way. Arrival times are estimates and may change.', data: { requestId: d.requestId } });
  return getDispatch(user, id);
}

// Records a delivery event. Delivered quantities consume the reserved stock; when the run is closed,
// any undelivered remainder is released back to available stock.
export async function completeDispatch(user, id, { lines = [], notes, final }, req) {
  const d = await findDispatchInScope(user, id, { include: { lines: true, request: { select: { requesterId: true, referenceCode: true } } } });
  assertTeamActor(user, d);
  if (!['IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status)) throw invalidTransition(d.status, 'DELIVERED', 'Dispatch');

  const byId = new Map(d.lines.map((l) => [l.id, l]));
  const seen = new Set();
  for (const [idx, l] of lines.entries()) {
    const line = byId.get(l.dispatchLineId);
    if (!line) throw badRequest('Line does not belong to this dispatch', [{ path: `lines.${idx}.dispatchLineId` }]);
    if (seen.has(l.dispatchLineId)) throw badRequest('Each line may appear once', [{ path: `lines.${idx}` }]);
    seen.add(l.dispatchLineId);
    const remaining = line.quantity - line.deliveredQuantity;
    if (l.quantity > remaining) throw badRequest(`Only ${remaining} units remain on this line`, [{ path: `lines.${idx}.quantity`, remaining }]);
  }
  const deliveredNow = lines.reduce((s, l) => s + l.quantity, 0);
  if (deliveredNow === 0 && !final) throw badRequest('Record at least one delivered quantity, or close the run with final=true');

  const outcome = await prisma.$transaction(async (tx) => {
    const sourceLocationId = (await tx.allocation.findUnique({ where: { id: d.allocationId } })).sourceLocationId;
    // Lock the dispatch row so two simultaneous delivery reports serialise.
    const locked = await tx.$queryRaw`SELECT "status" FROM "Dispatch" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!['IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(locked[0].status)) throw invalidTransition(locked[0].status, 'DELIVERED', 'Dispatch');

    const event = await tx.deliveryEvent.create({ data: { dispatchId: id, recordedById: user.id, isFinal: Boolean(final), notes } });
    for (const l of lines.filter((x) => x.quantity > 0)) {
      const line = byId.get(l.dispatchLineId);
      const { count } = await tx.dispatchLine.updateMany({
        where: { id: line.id, deliveredQuantity: { lte: line.quantity - l.quantity } },
        data: { deliveredQuantity: { increment: l.quantity } },
      });
      if (count === 0) throw conflict('Delivered quantity changed concurrently; refresh and try again');
      await tx.requestItem.update({ where: { id: line.requestItemId }, data: { deliveredQuantity: { increment: l.quantity } } });
      await tx.deliveryEventLine.create({ data: { deliveryEventId: event.id, dispatchLineId: line.id, quantity: l.quantity } });
      await consumeReservedTx(tx, { itemId: line.itemId, locationId: sourceLocationId, quantity: l.quantity, reason: `Delivered on dispatch ${id}`, actor: user, requestId: d.requestId, allocationId: d.allocationId, dispatchId: id });
    }
    const fresh = await tx.dispatchLine.findMany({ where: { dispatchId: id } });
    const allDone = fresh.every((l) => l.deliveredQuantity >= l.quantity);
    const closing = allDone || final;
    const to = closing ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
    const delivered = fresh.reduce((s, l) => s + l.deliveredQuantity, 0);
    const planned = fresh.reduce((s, l) => s + l.quantity, 0);
    const reason = closing && !allDone ? `Run closed with ${planned - delivered} units undelivered${notes ? `: ${notes}` : ''}` : notes ?? null;
    await transition(tx, { ...d, status: locked[0].status }, to, user, reason, closing ? { completedAt: new Date(), currentEta: null } : {});
    if (closing) {
      for (const l of fresh) {
        await releaseTx(tx, { itemId: l.itemId, locationId: sourceLocationId, quantity: l.quantity - l.deliveredQuantity, reason: 'Undelivered remainder released at close of run', actor: user, requestId: d.requestId, allocationId: d.allocationId, dispatchId: id });
      }
      await tx.allocation.update({ where: { id: d.allocationId }, data: { status: 'FULFILLED' } });
      await tx.responseTeam.update({ where: { id: d.teamId }, data: { availability: 'AVAILABLE' } });
    }
    await recomputeRequestStatus(tx, d.requestId);
    await addTimelineEvent(tx, {
      requestId: d.requestId,
      type: closing ? 'DELIVERY_COMPLETED' : 'PARTIAL_DELIVERY',
      message: closing
        ? allDone
          ? 'All supplies on this delivery were handed over'
          : `Delivery run finished: ${delivered} of ${planned} units handed over`
        : `Partly delivered: ${deliveredNow} units handed over`,
      actor: user,
      data: { dispatchId: id, deliveredNow, delivered, planned },
    });
    await audit(tx, { actor: user, action: closing ? 'DISPATCH_COMPLETED' : 'DISPATCH_PARTIAL_DELIVERY', entityType: 'Dispatch', entityId: id, after: { lines, final: Boolean(final), delivered, planned }, req });
    return { to, delivered, planned };
  });

  emit(dispatchRooms(d), outcome.to === 'DELIVERED' ? 'dispatch:completed' : 'dispatch:partially_delivered', { id, status: outcome.to, requestId: d.requestId });
  emit([rooms.request(d.requestId), rooms.ops], 'request:updated', { id: d.requestId });
  emit([rooms.inventory], 'inventory:updated', { dispatchId: id });
  await notifyUsers([d.request.requesterId], {
    type: outcome.to === 'DELIVERED' ? 'DELIVERY_COMPLETED' : 'PARTIAL_DELIVERY',
    title: outcome.to === 'DELIVERED' ? `Delivery update for ${d.request.referenceCode}` : `Partly delivered: ${d.request.referenceCode}`,
    body: `${outcome.delivered} of ${outcome.planned} units on this delivery have been handed over.`,
    data: { requestId: d.requestId },
  });
  return getDispatch(user, id);
}

export async function failDispatch(user, id, { reason }, req) {
  const d = await findDispatchInScope(user, id, { include: { lines: true, request: { select: { requesterId: true, referenceCode: true } } } });
  assertTeamActor(user, d);
  await prisma.$transaction(async (tx) => {
    await transition(tx, d, 'FAILED', user, reason, { failureReason: reason, completedAt: new Date(), currentEta: null });
    const allocation = await tx.allocation.findUnique({ where: { id: d.allocationId } });
    for (const l of d.lines) {
      await releaseTx(tx, { itemId: l.itemId, locationId: allocation.sourceLocationId, quantity: l.quantity - l.deliveredQuantity, reason: `Dispatch failed: ${reason}`, actor: user, requestId: d.requestId, allocationId: d.allocationId, dispatchId: id });
    }
    await tx.allocation.update({ where: { id: d.allocationId }, data: { status: 'RELEASED', releasedReason: `Dispatch failed: ${reason}` } });
    if (d.teamId) await tx.responseTeam.update({ where: { id: d.teamId }, data: { availability: 'AVAILABLE' } });
    await recomputeRequestStatus(tx, d.requestId);
    await addTimelineEvent(tx, { requestId: d.requestId, type: 'DISPATCH_FAILED', message: 'This delivery could not be completed. Coordinators have been informed.', actor: user, data: { dispatchId: id, reason } });
    await audit(tx, { actor: user, action: 'DISPATCH_FAILED', entityType: 'Dispatch', entityId: id, after: { reason }, req });
  });
  emit(dispatchRooms(d), 'dispatch:updated', { id, status: 'FAILED', requestId: d.requestId });
  emit([rooms.request(d.requestId), rooms.ops], 'request:updated', { id: d.requestId });
  await notifyUsers([d.request.requesterId], { type: 'DISPATCH_FAILED', title: `Delivery problem for ${d.request.referenceCode}`, body: 'A delivery could not be completed. Relief coordinators have been informed and will re-plan.', data: { requestId: d.requestId } });
  await notifyRoles([Roles.RELIEF_COORDINATOR], { type: 'DISPATCH_FAILED', title: `Dispatch failed for ${d.request.referenceCode}`, body: reason, severity: 'HIGH', data: { dispatchId: id } });
  return getDispatch(user, id);
}

export async function cancelDispatch(user, id, { reason }, req) {
  if (!isCoordinator(user)) throw forbidden();
  const d = await findDispatchInScope(user, id);
  await prisma.$transaction(async (tx) => {
    await transition(tx, d, 'CANCELLED', user, reason, { completedAt: new Date(), currentEta: null });
    // Reservation stays in place; the allocation returns to APPROVED and can be dispatched again.
    await tx.allocation.update({ where: { id: d.allocationId }, data: { status: 'APPROVED' } });
    if (d.teamId) await tx.responseTeam.update({ where: { id: d.teamId }, data: { availability: 'AVAILABLE' } });
    await recomputeRequestStatus(tx, d.requestId);
    await addTimelineEvent(tx, { requestId: d.requestId, type: 'DISPATCH_CANCELLED', message: 'A planned delivery was cancelled and will be re-assigned', actor: user, data: { dispatchId: id, reason } });
    await audit(tx, { actor: user, action: 'DISPATCH_CANCELLED', entityType: 'Dispatch', entityId: id, after: { reason }, req });
  });
  emit(dispatchRooms(d), 'dispatch:updated', { id, status: 'CANCELLED', requestId: d.requestId });
  return getDispatch(user, id);
}

export async function updateLocation(user, id, { latitude, longitude }, req) {
  const d = await findDispatchInScope(user, id, { include: { request: { include: { camp: true } } } });
  assertTeamActor(user, d, { allowCoordinator: false });
  if (!['ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status)) throw invalidTransition(d.status, 'LOCATION_UPDATE', 'Dispatch');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.dispatch.update({ where: { id }, data: { currentLatitude: latitude, currentLongitude: longitude, locationUpdatedAt: now } });
    if (d.teamId) await tx.responseTeam.update({ where: { id: d.teamId }, data: { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: now } });
    await audit(tx, { actor: user, action: 'DISPATCH_LOCATION_UPDATED', entityType: 'Dispatch', entityId: id, req });
  });
  // A configured routing provider could refresh the ETA here. None ships by default, so ETA stays as recorded.
  if (routing.adapter) {
    const dest = hasCoords(d.request) ? d.request : d.request.camp;
    if (hasCoords(dest)) {
      try {
        const est = await routing.adapter.estimate({ from: { lat: latitude, lng: longitude }, to: { lat: dest.latitude, lng: dest.longitude } });
        await recordEta(user, d, { eta: new Date(Date.now() + est.durationMinutes * 60000), reason: 'Route estimate', source: 'ROUTING_PROVIDER', provider: routing.adapter.name, distanceKm: est.distanceKm }, req);
      } catch {
        // Provider failure leaves the previous ETA in place; tracking reports its source and age.
      }
    }
  }
  // Coordinates are not included in the event; authorized clients refetch tracking.
  emit([rooms.dispatch(id), rooms.ops, d.teamId ? rooms.team(d.teamId) : null], 'dispatch:location_updated', { id, requestId: d.requestId, updatedAt: now });
  emit([rooms.request(d.requestId)], 'dispatch:location_updated', { id, requestId: d.requestId, updatedAt: now });
  return getDispatch(user, id);
}

async function recordEta(user, d, { eta, reason, source = 'MANUAL', provider = null, distanceKm = null }, req) {
  const previousEta = d.currentEta;
  const available = Boolean(eta);
  const thresholdMs = config.ETA_DELAY_THRESHOLD_MINUTES * 60000;
  const delayed = Boolean(available && previousEta && eta.getTime() - previousEta.getTime() > thresholdMs);
  const improved = Boolean(available && previousEta && previousEta.getTime() - eta.getTime() > thresholdMs);
  await prisma.$transaction(async (tx) => {
    await tx.etaHistory.create({
      data: { dispatchId: d.id, previousEta, newEta: eta ?? null, available, source: available ? source : 'UNAVAILABLE', provider, reason, distanceKm, actorId: user.id },
    });
    await tx.dispatch.update({
      where: { id: d.id },
      data: { currentEta: eta ?? null, etaSource: available ? source : 'UNAVAILABLE', etaUpdatedAt: new Date(), etaReason: reason, isDelayed: delayed ? true : improved || !previousEta ? false : d.isDelayed },
    });
    await addTimelineEvent(tx, {
      requestId: d.requestId,
      type: available ? (delayed ? 'ETA_DELAYED' : 'ETA_UPDATED') : 'ETA_UNAVAILABLE',
      message: available
        ? `${delayed ? 'Delivery delayed. ' : ''}Estimated arrival updated (an estimate, not a guarantee)`
        : 'Arrival time is not available yet',
      actor: user,
      data: { eta, previousEta, reason, source },
    });
    await audit(tx, { actor: user, action: 'DISPATCH_ETA_UPDATED', entityType: 'Dispatch', entityId: d.id, before: { eta: previousEta }, after: { eta, reason, source }, req });
  });
  emit(dispatchRooms(d), 'dispatch:eta_updated', { id: d.id, requestId: d.requestId, etaAvailable: available });
  if (delayed) emit(dispatchRooms(d), 'dispatch:delayed', { id: d.id, requestId: d.requestId });
  const meaningful = !previousEta || delayed || improved || !available;
  if (meaningful) {
    const request = await prisma.reliefRequest.findUnique({ where: { id: d.requestId }, select: { requesterId: true, referenceCode: true } });
    await notifyUsers([request.requesterId], {
      type: delayed ? 'DELIVERY_DELAYED' : 'ETA_UPDATED',
      title: delayed ? `Delivery delayed: ${request.referenceCode}` : `Arrival estimate updated: ${request.referenceCode}`,
      body: available ? 'Open tracking to see the new estimated arrival time. Estimates can change.' : 'Arrival time is not available at the moment.',
      data: { requestId: d.requestId },
    });
  }
}

export async function setEta(user, id, { eta, reason }, req) {
  const d = await findDispatchInScope(user, id);
  assertTeamActor(user, d);
  if (!['ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status)) throw invalidTransition(d.status, 'ETA_UPDATE', 'Dispatch');
  await recordEta(user, d, { eta: eta ? new Date(eta) : null, reason }, req);
  return getDispatch(user, id);
}

// ─── Read models ─────────────────────────────────────────────────────────

export function etaInfo(d) {
  if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(d.status)) {
    return { etaAvailable: false, eta: null, reasonCode: 'DISPATCH_CLOSED', reason: 'This delivery is closed' };
  }
  if (!d.currentEta) {
    return {
      etaAvailable: false,
      eta: null,
      etaSource: d.etaSource ?? null,
      etaUpdatedAt: d.etaUpdatedAt ?? null,
      reasonCode: d.etaSource === 'UNAVAILABLE' ? 'MARKED_UNAVAILABLE' : 'NO_ETA_RECORDED',
      reason: d.etaReason && d.etaSource === 'UNAVAILABLE' ? d.etaReason : 'No arrival estimate has been recorded yet',
    };
  }
  if (d.etaSource === 'ROUTING_PROVIDER' && isLocationStale(d.locationUpdatedAt)) {
    return { etaAvailable: false, eta: null, reasonCode: 'LOCATION_STALE', reason: 'Team location is out of date, so the route estimate cannot be trusted' };
  }
  const overdue = d.currentEta.getTime() < Date.now();
  return {
    etaAvailable: true,
    eta: d.currentEta,
    etaSource: d.etaSource,
    etaUpdatedAt: d.etaUpdatedAt,
    etaReason: d.etaReason,
    delayStatus: overdue ? 'OVERDUE' : d.isDelayed ? 'DELAYED' : 'ON_TRACK',
    disclaimer: 'Estimated time only. It is not a guarantee of arrival.',
  };
}

export function shapeDispatch(user, d) {
  const exact = canSeeExactTeamLocation(user, d.teamId);
  const dest = hasCoords(d.request) ? d.request : hasCoords(d.request?.camp) ? d.request.camp : null;
  const hasLoc = d.currentLatitude != null && d.currentLongitude != null;
  const staff = user.role !== Roles.CITIZEN;
  return {
    id: d.id,
    status: d.status,
    statusLabel: DISPATCH_STATUS_LABELS[d.status],
    team: d.team ? { id: d.team.id, name: d.team.name, callSign: d.team.callSign } : null,
    request: d.request
      ? {
          id: d.request.id,
          referenceCode: d.request.referenceCode,
          status: d.request.status,
          category: d.request.category,
          severity: staff ? d.request.severity : undefined,
          destinationAddress: staff || d.request.requesterId === user.id ? d.request.destinationAddress : null,
          destination: staff && dest ? { latitude: dest.latitude, longitude: dest.longitude } : null,
          camp: d.request.camp ? { id: d.request.camp.id, name: d.request.camp.name } : null,
        }
      : undefined,
    source: d.allocation?.sourceLocation ?? null,
    lines: d.lines?.map((l) => ({
      id: l.id,
      item: l.item,
      requestItemId: l.requestItemId,
      quantity: l.quantity,
      deliveredQuantity: l.deliveredQuantity,
      remainingQuantity: l.quantity - l.deliveredQuantity,
    })),
    notes: staff ? d.notes : undefined,
    failureReason: d.failureReason,
    location: {
      available: hasLoc,
      updatedAt: d.locationUpdatedAt,
      stale: hasLoc ? isLocationStale(d.locationUpdatedAt) : null,
      latitude: exact && hasLoc ? d.currentLatitude : undefined,
      longitude: exact && hasLoc ? d.currentLongitude : undefined,
      // Approximate distance to destination is shared without revealing the team's exact position.
      approxDistanceToDestinationKm: hasLoc && dest ? haversineKm(d.currentLatitude, d.currentLongitude, dest.latitude, dest.longitude) : null,
      distanceBasis: hasLoc && dest ? 'STRAIGHT_LINE' : null,
    },
    eta: etaInfo(d),
    statusHistory: d.statusEvents?.map((e) => ({
      from: e.fromStatus,
      to: e.toStatus,
      reason: staff ? e.reason : undefined,
      at: e.createdAt,
      actor: staff && e.actor ? { fullName: e.actor.fullName, role: e.actor.role } : undefined,
    })),
    acceptedAt: d.acceptedAt,
    startedAt: d.startedAt,
    completedAt: d.completedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export async function getDispatch(user, id) {
  const d = await findDispatchInScope(user, id, { include: dispatchInclude });
  return shapeDispatch(user, d);
}

export async function listDispatches(user, q) {
  const where = {
    AND: [
      dispatchScope(user),
      q.status ? { status: { in: q.status } } : {},
      q.teamId ? { teamId: q.teamId } : {},
      q.requestId ? { requestId: q.requestId } : {},
      q.active ? { status: { in: OPEN } } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.dispatch.findMany({ where, include: dispatchInclude, orderBy: { [q.sortBy]: q.sortOrder }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.dispatch.count({ where }),
  ]);
  return { items: items.map((d) => shapeDispatch(user, d)), meta: pageMeta(q, total) };
}

export async function dispatchTracking(user, id) {
  const d = await findDispatchInScope(user, id, {
    include: { ...dispatchInclude, etaHistory: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true, role: true } } } }, deliveryEvents: { orderBy: { createdAt: 'asc' }, include: { lines: true } } },
  });
  const staff = user.role !== Roles.CITIZEN;
  return {
    ...shapeDispatch(user, d),
    etaHistory: d.etaHistory.map((h) => ({
      previousEta: h.previousEta,
      newEta: h.newEta,
      available: h.available,
      source: h.source,
      provider: h.provider,
      reason: h.reason,
      distanceKm: h.distanceKm,
      createdAt: h.createdAt,
      actor: h.actor ? (staff ? { fullName: h.actor.fullName, role: h.actor.role } : { role: h.actor.role }) : null,
    })),
    deliveries: d.deliveryEvents.map((e) => ({
      id: e.id,
      isFinal: e.isFinal,
      notes: staff ? e.notes : undefined,
      createdAt: e.createdAt,
      lines: e.lines.map((l) => ({ dispatchLineId: l.dispatchLineId, quantity: l.quantity })),
    })),
  };
}

export { dispatchInclude, OPEN as OPEN_DISPATCH_STATUSES };
