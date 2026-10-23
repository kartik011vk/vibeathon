import { prisma } from '../utils/prisma.js';
import { badRequest, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { referenceCode, randomToken, sha256 } from '../utils/crypto.js';
import { boundingBox, haversineKm, hasCoords } from '../utils/geo.js';
import { pageMeta } from '../utils/pagination.js';
import { config } from '../config/env.js';
import {
  OPEN_REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  Roles,
  SEVERITY_LABELS,
  severityRank,
} from '../utils/constants.js';
import { audit } from './audit.service.js';
import { addTimelineEvent } from './timeline.service.js';
import { suggestSeverity } from './severity.service.js';
import { announceAlert, isRedLevel, upsertRequestAlertTx } from './alert.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { canSeeExactRequestLocation, findRequestInScope, isCoordinator, requestScope } from './access.service.js';
import { emit, rooms } from '../sockets/emitter.js';
import { declineOpenOffersTx } from './offer.service.js';

const requestRooms = (r) => [rooms.request(r.id), rooms.ops, r.campId ? rooms.camp(r.campId) : null];

async function resolveZone(db, { campId, latitude, longitude }) {
  if (campId) {
    const camp = await db.location.findUnique({ where: { id: campId }, include: { disasterZone: true } });
    if (camp?.disasterZone) return camp.disasterZone;
  }
  if (latitude == null || longitude == null) return null;
  const zones = await db.disasterZone.findMany({
    where: { status: 'ACTIVE', centerLat: { not: null }, centerLng: { not: null }, radiusKm: { not: null } },
  });
  let best = null;
  for (const z of zones) {
    const d = haversineKm(latitude, longitude, z.centerLat, z.centerLng);
    if (d != null && d <= z.radiusKm && (!best || severityRank(z.severity) > severityRank(best.severity))) best = z;
  }
  return best;
}

async function resolveItems(db, category, items) {
  const catalogIds = items.map((i) => i.inventoryItemId).filter(Boolean);
  const catalog = catalogIds.length
    ? await db.inventoryItem.findMany({ where: { id: { in: catalogIds }, isActive: true } })
    : [];
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const seen = new Set();
  return items.map((i, idx) => {
    if (i.inventoryItemId) {
      const c = byId.get(i.inventoryItemId);
      if (!c) throw badRequest('Unknown supply item', [{ path: `items.${idx}.inventoryItemId`, message: 'Item not found' }]);
      if (seen.has(c.id)) throw badRequest('Each item may only be listed once', [{ path: `items.${idx}` }]);
      seen.add(c.id);
      return { inventoryItemId: c.id, name: c.name, category: c.category, unit: c.unit, quantity: i.quantity };
    }
    if (!i.name || !i.unit) {
      throw badRequest('Items without a catalogue id need a name and unit', [{ path: `items.${idx}`, message: 'name and unit are required' }]);
    }
    return { inventoryItemId: null, name: i.name, category, unit: i.unit, quantity: i.quantity };
  });
}

async function assertCampAllowed(user, campId) {
  if (!campId) return;
  const camp = await prisma.location.findUnique({ where: { id: campId } });
  if (!camp || !camp.isActive || !['CAMP', 'SHELTER'].includes(camp.type)) {
    throw badRequest('Selected camp does not exist', [{ path: 'campId', message: 'Unknown or inactive camp' }]);
  }
  if (user.role === Roles.CAMP_MANAGER && !user.locationIds.includes(campId)) throw forbidden('You can only file requests for your assigned camps');
}

export async function createRequest(user, input, req) {
  if (![Roles.CITIZEN, Roles.CAMP_MANAGER, Roles.RELIEF_COORDINATOR, Roles.ADMIN].includes(user.role)) throw forbidden();
  await assertCampAllowed(user, input.campId);

  const items = await resolveItems(prisma, input.category, input.items);
  const zone = await resolveZone(prisma, input);
  const suggestion = await suggestSeverity({ ...input, items, zone });

  const { request, alertResult } = await prisma.$transaction(async (tx) => {
    const request = await tx.reliefRequest.create({
      data: {
        referenceCode: referenceCode(),
        requesterId: user.id,
        campId: input.campId ?? null,
        disasterZoneId: zone?.id ?? null,
        category: input.category,
        description: input.description,
        peopleAffected: input.peopleAffected,
        vulnerableCount: input.vulnerableCount ?? null,
        destinationAddress: input.destinationAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        suggestedSeverity: suggestion.severity,
        // Until staff verify it, the effective priority is the rule suggestion — never a client value.
        severity: suggestion.severity,
        severityReason: suggestion.reasons.join('; '),
        items: { create: items },
        attachments: input.attachments?.length
          ? { create: input.attachments.map((a) => ({ ...a, uploadedById: user.id })) }
          : undefined,
      },
    });
    await addTimelineEvent(tx, { requestId: request.id, type: 'CREATED', message: 'Request received', actor: user });
    await addTimelineEvent(tx, {
      requestId: request.id,
      type: 'SEVERITY_SUGGESTED',
      message: `Rules suggested ${SEVERITY_LABELS[suggestion.severity]} priority (awaiting review)`,
      isPublic: false,
      data: { severity: suggestion.severity, matchedRules: suggestion.matchedRules },
    });
    await audit(tx, { actor: user, action: 'REQUEST_CREATED', entityType: 'ReliefRequest', entityId: request.id, after: { category: request.category, suggestedSeverity: suggestion.severity }, req });
    let alertResult = null;
    if (isRedLevel(suggestion.severity)) {
      alertResult = await upsertRequestAlertTx(tx, {
        request,
        severity: suggestion.severity,
        source: 'SYSTEM_RULE',
        reason: `Suggested by rules (${suggestion.matchedRules.map((r) => r.name).join(', ')}); awaiting coordinator verification.`,
        actor: null,
      });
    }
    return { request, alertResult };
  });

  emit(requestRooms(request), 'request:created', { id: request.id, status: request.status, severity: request.severity });
  if (alertResult?.changed) await announceAlert(alertResult.alert, { created: alertResult.created });
  await notifyUsers([user.id], {
    type: 'REQUEST_RECEIVED',
    title: `Request ${request.referenceCode} received`,
    body: 'Your request has been recorded and is waiting to be checked by relief staff.',
    data: { requestId: request.id },
  });
  if (severityRank(request.severity) >= severityRank('HIGH')) {
    await notifyRoles([Roles.RELIEF_COORDINATOR], {
      type: 'REQUEST_NEEDS_REVIEW',
      title: `New ${SEVERITY_LABELS[request.severity].toLowerCase()} request ${request.referenceCode}`,
      body: `${request.category} for ${request.peopleAffected} people is waiting for verification.`,
      severity: request.severity,
      data: { requestId: request.id },
    });
  }
  return getRequest(user, request.id);
}

function shape(user, r) {
  const staff = user.role !== Roles.CITIZEN;
  const exact = canSeeExactRequestLocation(user, r);
  return {
    id: r.id,
    referenceCode: r.referenceCode,
    category: r.category,
    description: r.description,
    peopleAffected: r.peopleAffected,
    vulnerableCount: r.vulnerableCount,
    destinationAddress: exact ? r.destinationAddress : null,
    latitude: exact ? r.latitude : null,
    longitude: exact ? r.longitude : null,
    status: r.status,
    statusLabel: REQUEST_STATUS_LABELS[r.status],
    severity: r.severity,
    severityLabel: SEVERITY_LABELS[r.severity],
    suggestedSeverity: staff ? r.suggestedSeverity : undefined,
    severityReason: staff ? r.severityReason : undefined,
    verified: Boolean(r.verifiedAt),
    verifiedAt: r.verifiedAt,
    verifiedBy: staff && r.verifiedBy ? { id: r.verifiedBy.id, fullName: r.verifiedBy.fullName } : undefined,
    rejectionReason: r.rejectionReason,
    cancelledReason: r.cancelledReason,
    camp: r.camp ? { id: r.camp.id, name: r.camp.name, area: r.camp.area, latitude: r.camp.latitude, longitude: r.camp.longitude } : null,
    disasterZone: r.disasterZone ? { id: r.disasterZone.id, name: r.disasterZone.name, hazardType: r.disasterZone.hazardType } : null,
    requester: staff && r.requester ? { id: r.requester.id, fullName: r.requester.fullName, phone: r.requester.phone } : undefined,
    items: r.items?.map((i) => ({
      id: i.id,
      inventoryItemId: i.inventoryItemId,
      name: i.name,
      category: i.category,
      unit: i.unit,
      quantity: i.quantity,
      deliveredQuantity: i.deliveredQuantity,
      remainingQuantity: Math.max(0, i.quantity - i.deliveredQuantity),
    })),
    attachments: r.attachments,
    isOwn: r.requesterId === user.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deliveredAt: r.deliveredAt,
  };
}

const detailInclude = {
  items: { orderBy: { name: 'asc' } },
  camp: true,
  disasterZone: true,
  requester: { select: { id: true, fullName: true, phone: true } },
  verifiedBy: { select: { id: true, fullName: true } },
  attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
};

export async function getRequest(user, id) {
  const r = await findRequestInScope(user, id, { include: detailInclude });
  return shape(user, r);
}

export async function listRequests(user, q) {
  const where = {
    AND: [
      requestScope(user),
      q.status ? { status: { in: q.status } } : {},
      q.severity ? { severity: { in: q.severity } } : {},
      q.category ? { category: q.category } : {},
      q.campId ? { campId: q.campId } : {},
      q.mine ? { requesterId: user.id } : {},
      q.open ? { status: { in: OPEN_REQUEST_STATUSES } } : {},
      q.search
        ? { OR: [{ referenceCode: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] }
        : {},
    ],
  };
  const orderBy = q.sortBy === 'severity' ? [{ severity: q.sortOrder }, { createdAt: 'asc' }] : [{ [q.sortBy]: q.sortOrder }];
  const [rows, total] = await Promise.all([
    prisma.reliefRequest.findMany({ where, include: detailInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.reliefRequest.count({ where }),
  ]);
  return { items: rows.map((r) => shape(user, r)), meta: pageMeta(q, total) };
}

const CITIZEN_EDITABLE = ['description', 'peopleAffected', 'vulnerableCount', 'destinationAddress', 'latitude', 'longitude'];

export async function updateRequest(user, id, patch, req) {
  const current = await findRequestInScope(user, id, { include: { items: true } });
  let allowed;
  if (user.role === Roles.CITIZEN) {
    if (current.requesterId !== user.id) throw forbidden();
    if (current.status !== 'SUBMITTED') throw invalidTransition(current.status, 'EDITED', 'Request');
    allowed = CITIZEN_EDITABLE;
  } else if (user.role === Roles.CAMP_MANAGER) {
    if (!['SUBMITTED', 'VERIFIED'].includes(current.status)) throw invalidTransition(current.status, 'EDITED', 'Request');
    allowed = [...CITIZEN_EDITABLE, 'campId'];
  } else if (isCoordinator(user)) {
    if (!OPEN_REQUEST_STATUSES.includes(current.status)) throw invalidTransition(current.status, 'EDITED', 'Request');
    allowed = [...CITIZEN_EDITABLE, 'campId', 'disasterZoneId'];
  } else {
    throw forbidden();
  }
  const rejected = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (rejected.length) throw forbidden(`You cannot change: ${rejected.join(', ')}`);
  if ('campId' in patch) await assertCampAllowed(user, patch.campId);

  const data = { ...patch };
  const merged = { ...current, ...patch };
  if (!('disasterZoneId' in patch) && ('campId' in patch || 'latitude' in patch || 'longitude' in patch)) {
    data.disasterZoneId = (await resolveZone(prisma, merged))?.id ?? null;
  }
  const zoneId = 'disasterZoneId' in data ? data.disasterZoneId : current.disasterZoneId;
  const zone = zoneId ? await prisma.disasterZone.findUnique({ where: { id: zoneId } }) : null;
  if (zoneId && !zone) throw badRequest('Disaster zone does not exist', [{ path: 'disasterZoneId', message: 'Unknown zone' }]);
  const suggestion = await suggestSeverity({ ...merged, items: current.items, zone });
  data.suggestedSeverity = suggestion.severity;
  if (current.status === 'SUBMITTED') {
    data.severity = suggestion.severity;
    data.severityReason = suggestion.reasons.join('; ');
  }

  const { updated, alertResult } = await prisma.$transaction(async (tx) => {
    const updated = await tx.reliefRequest.update({ where: { id }, data });
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k]]));
    await audit(tx, { actor: user, action: 'REQUEST_UPDATED', entityType: 'ReliefRequest', entityId: id, before, after: patch, req });
    await addTimelineEvent(tx, { requestId: id, type: 'UPDATED', message: 'Request details updated', actor: user, data: { fields: Object.keys(patch) } });
    let alertResult = null;
    if (current.status === 'SUBMITTED' && isRedLevel(updated.severity)) {
      alertResult = await upsertRequestAlertTx(tx, { request: updated, severity: updated.severity, source: 'SYSTEM_RULE', reason: 'Suggested by rules after an update; awaiting verification.', actor: null });
    }
    return { updated, alertResult };
  });
  emit(requestRooms(updated), 'request:updated', { id, status: updated.status, severity: updated.severity });
  if (alertResult?.changed) await announceAlert(alertResult.alert, { created: alertResult.created });
  return getRequest(user, id);
}

async function closeOpenAlerts(tx, requestId, actor, note) {
  const open = await tx.alert.findMany({ where: { requestId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } });
  for (const a of open) {
    await tx.alert.update({ where: { id: a.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: note } });
    await audit(tx, { actor, action: 'ALERT_RESOLVED', entityType: 'Alert', entityId: a.id, after: { note, automatic: true } });
  }
  return open;
}

export async function cancelRequest(user, id, reason, req) {
  const current = await findRequestInScope(user, id);
  const citizenOwner = user.role === Roles.CITIZEN && current.requesterId === user.id;
  const staffAllowed = user.role === Roles.CAMP_MANAGER || isCoordinator(user);
  if (!citizenOwner && !staffAllowed) throw forbidden();
  const cancellable = citizenOwner ? ['SUBMITTED', 'VERIFIED'] : ['SUBMITTED', 'VERIFIED', 'ALLOCATED'];
  if (!cancellable.includes(current.status)) throw invalidTransition(current.status, 'CANCELLED', 'Request');

  const { releaseAllocationTx } = await import('./allocation.service.js');
  const closed = await prisma.$transaction(async (tx) => {
    // Conditional update prevents racing with a concurrent verification/allocation.
    const { count } = await tx.reliefRequest.updateMany({
      where: { id, status: { in: cancellable } },
      data: { status: 'CANCELLED', cancelledReason: reason, cancelledAt: new Date() },
    });
    if (count === 0) throw invalidTransition(current.status, 'CANCELLED', 'Request');
    const allocations = await tx.allocation.findMany({ where: { requestId: id, status: { in: ['PROPOSED', 'APPROVED'] } } });
    for (const a of allocations) {
      if (a.status === 'APPROVED') await releaseAllocationTx(tx, a.id, user, `Request cancelled: ${reason}`);
      else await tx.allocation.update({ where: { id: a.id }, data: { status: 'REJECTED', rejectedReason: `Request cancelled: ${reason}` } });
    }
    await declineOpenOffersTx(tx, id);
    await addTimelineEvent(tx, { requestId: id, type: 'CANCELLED', message: `Request cancelled: ${reason}`, actor: user });
    await audit(tx, { actor: user, action: 'REQUEST_CANCELLED', entityType: 'ReliefRequest', entityId: id, before: { status: current.status }, after: { status: 'CANCELLED', reason }, req });
    return closeOpenAlerts(tx, id, user, 'Request cancelled');
  });
  emit(requestRooms(current), 'request:updated', { id, status: 'CANCELLED' });
  for (const a of closed) emit([rooms.ops], 'alert:updated', { id: a.id, status: 'RESOLVED' });
  if (!citizenOwner) {
    await notifyUsers([current.requesterId], { type: 'REQUEST_CANCELLED', title: `Request ${current.referenceCode} cancelled`, body: reason, data: { requestId: id } });
  }
  return getRequest(user, id);
}

export async function verifyRequest(user, id, { decision, reason, severity }, req) {
  if (!(isCoordinator(user) || user.role === Roles.CAMP_MANAGER)) throw forbidden();
  if (severity && !isCoordinator(user)) throw forbidden('Only relief coordinators can override severity');
  const current = await findRequestInScope(user, id);
  if (current.status !== 'SUBMITTED') throw invalidTransition(current.status, decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED', 'Request');

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    if (decision === 'REJECT') {
      const { count } = await tx.reliefRequest.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: { status: 'REJECTED', rejectionReason: reason, verifiedById: user.id, verifiedAt: now },
      });
      if (count === 0) throw invalidTransition(current.status, 'REJECTED', 'Request');
      await addTimelineEvent(tx, { requestId: id, type: 'REJECTED', message: `Request not approved: ${reason}`, actor: user });
      await audit(tx, { actor: user, action: 'REQUEST_REJECTED', entityType: 'ReliefRequest', entityId: id, after: { reason }, req });
      const closed = await closeOpenAlerts(tx, id, user, 'Request rejected after review');
      return { closed, alertResult: null };
    }

    const finalSeverity = severity ?? current.suggestedSeverity;
    const { count } = await tx.reliefRequest.updateMany({
      where: { id, status: 'SUBMITTED' },
      data: {
        status: 'VERIFIED',
        verifiedById: user.id,
        verifiedAt: now,
        severity: finalSeverity,
        severityReason: severity && severity !== current.suggestedSeverity ? `Override by coordinator: ${reason}` : current.severityReason,
      },
    });
    if (count === 0) throw invalidTransition(current.status, 'VERIFIED', 'Request');
    await addTimelineEvent(tx, { requestId: id, type: 'VERIFIED', message: 'Request checked and verified by relief staff', actor: user, data: { reason } });
    await audit(tx, { actor: user, action: 'REQUEST_VERIFIED', entityType: 'ReliefRequest', entityId: id, after: { reason, severity: finalSeverity }, req });
    if (finalSeverity !== current.severity) {
      await audit(tx, { actor: user, action: 'REQUEST_SEVERITY_OVERRIDE', entityType: 'ReliefRequest', entityId: id, before: { severity: current.severity }, after: { severity: finalSeverity, reason }, req });
      await addTimelineEvent(tx, {
        requestId: id,
        type: 'SEVERITY_CHANGED',
        message: `Priority set to ${SEVERITY_LABELS[finalSeverity]} after review`,
        actor: user,
        data: { from: current.severity, to: finalSeverity, reason },
      });
    }
    let alertResult = null;
    let closed = [];
    const updated = await tx.reliefRequest.findUnique({ where: { id } });
    if (isRedLevel(finalSeverity)) {
      alertResult = await upsertRequestAlertTx(tx, { request: updated, severity: finalSeverity, source: 'COORDINATOR_VERIFICATION', reason: `Verified: ${reason}`, actor: user });
    } else {
      closed = await closeOpenAlerts(tx, id, user, `Reviewed and set to ${SEVERITY_LABELS[finalSeverity]}`);
    }
    return { closed, alertResult };
  });

  emit(requestRooms(current), 'request:verified', { id, status: decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED' });
  for (const a of result.closed) emit([rooms.ops], 'alert:updated', { id: a.id, status: 'RESOLVED' });
  if (result.alertResult?.changed) await announceAlert(result.alertResult.alert, { created: result.alertResult.created });
  await notifyUsers([current.requesterId], {
    type: decision === 'VERIFY' ? 'REQUEST_VERIFIED' : 'REQUEST_REJECTED',
    title: decision === 'VERIFY' ? `Request ${current.referenceCode} verified` : `Request ${current.referenceCode} not approved`,
    body: decision === 'VERIFY' ? 'Relief staff have checked your request. Supplies are being arranged.' : reason,
    data: { requestId: id },
  });
  return getRequest(user, id);
}

export async function escalateRequest(user, id, { severity, reason }, req) {
  const current = await findRequestInScope(user, id);
  if (!OPEN_REQUEST_STATUSES.includes(current.status)) throw invalidTransition(current.status, 'ESCALATED', 'Request');

  if (!isCoordinator(user)) {
    // Requesters and camp managers can ask for escalation; only coordinators can apply it.
    if (!(user.role === Roles.CAMP_MANAGER || (user.role === Roles.CITIZEN && current.requesterId === user.id))) throw forbidden();
    await prisma.$transaction(async (tx) => {
      await addTimelineEvent(tx, { requestId: id, type: 'ESCALATION_REQUESTED', message: 'Escalation requested — waiting for a coordinator', actor: user, data: { reason } });
      await audit(tx, { actor: user, action: 'REQUEST_ESCALATION_REQUESTED', entityType: 'ReliefRequest', entityId: id, after: { reason }, req });
    });
    await notifyRoles([Roles.RELIEF_COORDINATOR], {
      type: 'ESCALATION_REQUESTED',
      title: `Escalation requested for ${current.referenceCode}`,
      body: reason,
      severity: 'HIGH',
      data: { requestId: id },
    });
    emit(requestRooms(current), 'request:updated', { id, status: current.status });
    return { applied: false, request: await getRequest(user, id) };
  }

  if (!severity) throw badRequest('severity is required to apply an escalation', [{ path: 'severity', message: 'Required' }]);
  if (severityRank(severity) <= severityRank(current.severity)) {
    throw badRequest('Escalation must raise the severity level', [{ path: 'severity', message: `Current level is ${current.severity}` }]);
  }
  const alertResult = await prisma.$transaction(async (tx) => {
    const updated = await tx.reliefRequest.update({ where: { id }, data: { severity, severityReason: `Escalated by coordinator: ${reason}` } });
    await audit(tx, { actor: user, action: 'REQUEST_SEVERITY_OVERRIDE', entityType: 'ReliefRequest', entityId: id, before: { severity: current.severity }, after: { severity, reason }, req });
    await addTimelineEvent(tx, { requestId: id, type: 'SEVERITY_CHANGED', message: `Priority raised to ${SEVERITY_LABELS[severity]}`, actor: user, data: { from: current.severity, to: severity, reason } });
    if (isRedLevel(severity)) {
      return upsertRequestAlertTx(tx, { request: updated, severity, source: 'COORDINATOR_ESCALATION', reason, actor: user });
    }
    return null;
  });
  emit(requestRooms(current), 'request:updated', { id, status: current.status, severity });
  if (alertResult?.changed) await announceAlert(alertResult.alert, { created: alertResult.created });
  return { applied: true, request: await getRequest(user, id) };
}

export async function getTimeline(user, id) {
  const request = await findRequestInScope(user, id, { select: { id: true, requesterId: true } });
  const staff = user.role !== Roles.CITIZEN;
  const events = await prisma.requestTimelineEvent.findMany({
    where: { requestId: request.id, ...(staff ? {} : { isPublic: true }) },
    include: { actor: { select: { fullName: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    message: e.message,
    createdAt: e.createdAt,
    isPublic: e.isPublic,
    actor: e.actor ? (staff ? { fullName: e.actor.fullName, role: e.actor.role } : { role: e.actor.role }) : null,
    data: staff ? e.data : undefined,
  }));
}

export async function nearbyRequests(user, { latitude, longitude, radiusKm, open }) {
  const box = boundingBox(latitude, longitude, radiusKm);
  const rows = await prisma.reliefRequest.findMany({
    where: {
      AND: [
        requestScope(user),
        { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
        open ? { status: { in: OPEN_REQUEST_STATUSES } } : {},
      ],
    },
    include: detailInclude,
    take: 500,
  });
  return rows
    .map((r) => ({ ...shape(user, r), distanceKm: haversineKm(latitude, longitude, r.latitude, r.longitude), distanceBasis: 'STRAIGHT_LINE' }))
    .filter((r) => r.distanceKm != null && r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ─── Public tracking tokens ───────────────────────────────────────────────

export async function createTrackingToken(user, requestId, { ttlHours }, req) {
  const request = await findRequestInScope(user, requestId, { select: { id: true, requesterId: true } });
  if (!(request.requesterId === user.id || isCoordinator(user) || user.role === Roles.CAMP_MANAGER)) throw forbidden();
  const token = randomToken(32);
  const hours = Math.min(ttlHours ?? config.PUBLIC_TRACKING_TOKEN_TTL_HOURS, 24 * 30);
  const record = await prisma.publicTrackingToken.create({
    data: { requestId, tokenHash: sha256(token), createdById: user.id, expiresAt: new Date(Date.now() + hours * 3600 * 1000) },
  });
  await audit(null, { actor: user, action: 'TRACKING_TOKEN_CREATED', entityType: 'PublicTrackingToken', entityId: record.id, after: { requestId, expiresAt: record.expiresAt }, req });
  // The raw token is returned exactly once and never stored.
  return { id: record.id, token, expiresAt: record.expiresAt };
}

export async function listTrackingTokens(user, requestId) {
  await findRequestInScope(user, requestId, { select: { id: true } });
  return prisma.publicTrackingToken.findMany({
    where: { requestId },
    select: { id: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeTrackingToken(user, requestId, tokenId, req) {
  const request = await findRequestInScope(user, requestId, { select: { id: true, requesterId: true } });
  if (!(request.requesterId === user.id || isCoordinator(user) || user.role === Roles.CAMP_MANAGER)) throw forbidden();
  const { count } = await prisma.publicTrackingToken.updateMany({
    where: { id: tokenId, requestId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw notFound('Active tracking link');
  await audit(null, { actor: user, action: 'TRACKING_TOKEN_REVOKED', entityType: 'PublicTrackingToken', entityId: tokenId, req });
  return { revoked: true };
}
