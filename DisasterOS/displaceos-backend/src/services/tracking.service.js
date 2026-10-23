import { prisma } from '../utils/prisma.js';
import { notFound } from '../utils/errors.js';
import { sha256 } from '../utils/crypto.js';
import { REQUEST_STATUS_LABELS, Roles } from '../utils/constants.js';
import { findRequestInScope } from './access.service.js';
import { dispatchInclude, etaInfo, OPEN_DISPATCH_STATUSES, shapeDispatch } from './dispatch.service.js';
import { getTimeline } from './request.service.js';

const DISCLAIMER =
  'Arrival times are estimates and may change. DisplaceOS coordinates relief supplies; it is not an emergency rescue service. In immediate danger, contact your local emergency services.';

function itemProgress(items, allocations, dispatches) {
  return items.map((i) => {
    const reserved = allocations
      .filter((a) => a.status === 'APPROVED')
      .flatMap((a) => a.lines)
      .filter((l) => l.requestItemId === i.id)
      .reduce((s, l) => s + l.quantity, 0);
    const onTheWay = dispatches
      .filter((d) => OPEN_DISPATCH_STATUSES.includes(d.status))
      .flatMap((d) => d.lines)
      .filter((l) => l.requestItemId === i.id)
      .reduce((s, l) => s + (l.quantity - l.deliveredQuantity), 0);
    return {
      requestItemId: i.id,
      name: i.name,
      unit: i.unit,
      requested: i.quantity,
      delivered: i.deliveredQuantity,
      remaining: Math.max(0, i.quantity - i.deliveredQuantity),
      reservedNotYetDispatched: reserved,
      onTheWay,
    };
  });
}

// The "primary" ETA is the soonest available estimate among open dispatches, if any.
function primaryEta(dispatches) {
  const open = dispatches.filter((d) => OPEN_DISPATCH_STATUSES.includes(d.status));
  if (!open.length) {
    return { etaAvailable: false, eta: null, reasonCode: 'NO_ACTIVE_DISPATCH', reason: 'No delivery is on the way yet' };
  }
  const infos = open.map(etaInfo);
  const available = infos.filter((i) => i.etaAvailable).sort((a, b) => a.eta - b.eta);
  return available[0] ?? infos[0];
}

export async function requestTracking(user, requestId) {
  const request = await findRequestInScope(user, requestId, {
    include: {
      items: { orderBy: { name: 'asc' } },
      allocations: { include: { lines: true } },
      dispatches: { include: dispatchInclude, orderBy: { createdAt: 'asc' } },
      camp: { select: { id: true, name: true } },
    },
  });
  const timeline = await getTimeline(user, requestId);
  const dispatches = request.dispatches.map((d) => shapeDispatch(user, d));
  const items = itemProgress(request.items, request.allocations, request.dispatches);
  const stamps = [request.updatedAt, ...request.dispatches.map((d) => d.updatedAt), ...timeline.map((t) => t.createdAt)].map((d) => new Date(d).getTime());
  return {
    request: {
      id: request.id,
      referenceCode: request.referenceCode,
      category: request.category,
      status: request.status,
      statusLabel: REQUEST_STATUS_LABELS[request.status],
      verified: Boolean(request.verifiedAt),
      verifiedAt: request.verifiedAt,
      camp: request.camp,
      createdAt: request.createdAt,
      rejectionReason: request.rejectionReason,
      cancelledReason: request.cancelledReason,
    },
    items,
    totals: {
      requested: items.reduce((s, i) => s + i.requested, 0),
      delivered: items.reduce((s, i) => s + i.delivered, 0),
      remaining: items.reduce((s, i) => s + i.remaining, 0),
    },
    allocationProgress: {
      approved: request.allocations.filter((a) => ['APPROVED', 'DISPATCHED', 'FULFILLED'].includes(a.status)).length,
      pendingReview: user.role === Roles.CITIZEN ? undefined : request.allocations.filter((a) => a.status === 'PROPOSED').length,
    },
    dispatches,
    eta: primaryEta(request.dispatches),
    lastUpdatedAt: new Date(Math.max(...stamps)),
    timeline,
    disclaimer: DISCLAIMER,
  };
}

// Restricted public view for holders of an unexpired, unrevoked tracking link.
// Returns only non-identifying operational facts: no names, addresses, coordinates or contact details.
export async function publicTracking(rawToken) {
  const record = await prisma.publicTrackingToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) throw notFound('Tracking link');
  await prisma.publicTrackingToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  const request = await prisma.reliefRequest.findUnique({
    where: { id: record.requestId },
    include: {
      items: { orderBy: { name: 'asc' } },
      dispatches: { include: { lines: true }, orderBy: { createdAt: 'asc' } },
      timeline: { where: { isPublic: true }, orderBy: { createdAt: 'asc' }, select: { type: true, message: true, createdAt: true } },
    },
  });
  return {
    referenceCode: request.referenceCode,
    category: request.category,
    status: request.status,
    statusLabel: REQUEST_STATUS_LABELS[request.status],
    items: request.items.map((i) => ({
      name: i.name,
      unit: i.unit,
      requested: i.quantity,
      delivered: i.deliveredQuantity,
      remaining: Math.max(0, i.quantity - i.deliveredQuantity),
    })),
    eta: (() => {
      const e = primaryEta(request.dispatches);
      return { etaAvailable: e.etaAvailable, eta: e.eta, delayStatus: e.delayStatus ?? null, reason: e.etaAvailable ? null : e.reason };
    })(),
    lastUpdatedAt: request.updatedAt,
    timeline: request.timeline,
    linkExpiresAt: record.expiresAt,
    disclaimer: DISCLAIMER,
  };
}
