// Every figure here is computed from database records at request time. Nothing is estimated or padded.
import { prisma } from '../utils/prisma.js';
import { OPEN_REQUEST_STATUSES, SEVERITY_LABELS, severityRank } from '../utils/constants.js';
import { requestScope } from './access.service.js';

const countBy = (rows, key, keys) => {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) out[r[key]] = r._count;
  return out;
};

export async function summary(user) {
  const scope = requestScope(user);
  const [byStatus, bySeverity, alerts, dispatches, teams, balances, peopleOpen] = await Promise.all([
    prisma.reliefRequest.groupBy({ by: ['status'], where: scope, _count: true }),
    prisma.reliefRequest.groupBy({ by: ['severity'], where: { ...scope, status: { in: OPEN_REQUEST_STATUSES } }, _count: true }),
    prisma.alert.groupBy({ by: ['severity'], where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }, _count: true }),
    prisma.dispatch.groupBy({ by: ['status'], _count: true }),
    prisma.responseTeam.groupBy({ by: ['availability'], _count: true }),
    prisma.inventoryBalance.findMany({ include: { item: { select: { lowStockThreshold: true, isActive: true } } } }),
    prisma.reliefRequest.aggregate({ where: { ...scope, status: { in: OPEN_REQUEST_STATUSES } }, _sum: { peopleAffected: true } }),
  ]);
  const requests = countBy(byStatus, 'status', ['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED']);
  return {
    requests: {
      byStatus: requests,
      open: OPEN_REQUEST_STATUSES.reduce((s, k) => s + requests[k], 0),
      awaitingVerification: requests.SUBMITTED,
      openBySeverity: countBy(bySeverity, 'severity', ['NORMAL', 'HIGH', 'RED', 'HYPER_RED']),
      peopleAffectedOpen: peopleOpen._sum.peopleAffected ?? 0,
    },
    alerts: { openBySeverity: countBy(alerts, 'severity', ['NORMAL', 'HIGH', 'RED', 'HYPER_RED']) },
    dispatches: countBy(dispatches, 'status', ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED', 'DELIVERED', 'FAILED', 'CANCELLED']),
    teams: countBy(teams, 'availability', ['AVAILABLE', 'BUSY', 'OFF_DUTY']),
    inventory: {
      stockLines: balances.length,
      lowStockLines: balances.filter((b) => b.item.isActive && b.onHand - b.reserved <= b.item.lowStockThreshold).length,
    },
    generatedAt: new Date(),
  };
}

export async function criticalNeeds(user) {
  const rows = await prisma.reliefRequest.findMany({
    where: { ...requestScope(user), status: { in: OPEN_REQUEST_STATUSES }, severity: { in: ['HIGH', 'RED', 'HYPER_RED'] } },
    include: { items: true, camp: { select: { name: true } }, disasterZone: { select: { name: true } } },
    take: 200,
  });
  return rows
    .map((r) => ({
      id: r.id,
      referenceCode: r.referenceCode,
      category: r.category,
      severity: r.severity,
      severityLabel: SEVERITY_LABELS[r.severity],
      status: r.status,
      peopleAffected: r.peopleAffected,
      vulnerableCount: r.vulnerableCount,
      camp: r.camp?.name ?? null,
      zone: r.disasterZone?.name ?? null,
      remainingUnits: r.items.reduce((s, i) => s + Math.max(0, i.quantity - i.deliveredQuantity), 0),
      waitingMinutes: Math.round((Date.now() - r.createdAt.getTime()) / 60000),
      createdAt: r.createdAt,
    }))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.createdAt - b.createdAt);
}

export async function resourceDistribution() {
  const [balances, deliveredLines] = await Promise.all([
    prisma.inventoryBalance.findMany({ include: { item: { select: { category: true } }, location: { select: { id: true, name: true } } } }),
    prisma.requestItem.groupBy({ by: ['category'], _sum: { deliveredQuantity: true, quantity: true } }),
  ]);
  const byCategory = {};
  for (const b of balances) {
    const c = (byCategory[b.item.category] ??= { category: b.item.category, onHand: 0, reserved: 0, available: 0, requested: 0, delivered: 0 });
    c.onHand += b.onHand;
    c.reserved += b.reserved;
    c.available += b.onHand - b.reserved;
  }
  for (const d of deliveredLines) {
    const c = (byCategory[d.category] ??= { category: d.category, onHand: 0, reserved: 0, available: 0, requested: 0, delivered: 0 });
    c.requested += d._sum.quantity ?? 0;
    c.delivered += d._sum.deliveredQuantity ?? 0;
  }
  const byLocation = {};
  for (const b of balances) {
    const l = (byLocation[b.location.id] ??= { locationId: b.location.id, name: b.location.name, onHand: 0, reserved: 0, available: 0 });
    l.onHand += b.onHand;
    l.reserved += b.reserved;
    l.available += b.onHand - b.reserved;
  }
  return {
    note: 'Units are summed per category across items; categories mix units (kits, litres, packs) and are for operational overview only.',
    byCategory: Object.values(byCategory),
    byLocation: Object.values(byLocation).sort((a, b) => b.onHand - a.onHand),
  };
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

export async function responseTimes({ days }) {
  const since = new Date(Date.now() - days * 86400000);
  const [verified, dispatches] = await Promise.all([
    prisma.reliefRequest.findMany({ where: { verifiedAt: { not: null }, createdAt: { gte: since } }, select: { createdAt: true, verifiedAt: true } }),
    prisma.dispatch.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, startedAt: true, completedAt: true, status: true, request: { select: { verifiedAt: true } } },
    }),
  ]);
  const mins = (a, b) => (b.getTime() - a.getTime()) / 60000;
  const toVerify = verified.map((r) => mins(r.createdAt, r.verifiedAt));
  const toDispatch = dispatches.filter((d) => d.request.verifiedAt).map((d) => mins(d.request.verifiedAt, d.createdAt));
  const toDeliver = dispatches.filter((d) => d.status === 'DELIVERED' && d.startedAt && d.completedAt).map((d) => mins(d.startedAt, d.completedAt));
  const metric = (xs) => ({ samples: xs.length, averageMinutes: avg(xs), medianMinutes: median(xs) });
  return {
    windowDays: days,
    submittedToVerified: metric(toVerify),
    verifiedToDispatched: metric(toDispatch),
    transitToDelivered: metric(toDeliver),
    note: 'Metrics are null when there are no samples in the window.',
  };
}
