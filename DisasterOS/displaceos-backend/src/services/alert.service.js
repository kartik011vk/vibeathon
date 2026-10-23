import { prisma } from '../utils/prisma.js';
import { conflict, forbidden, invalidTransition, notFound, badRequest } from '../utils/errors.js';
import { SEVERITY_LABELS, severityRank, STAFF_ROLES } from '../utils/constants.js';
import { pageMeta } from '../utils/pagination.js';
import { audit } from './audit.service.js';
import { addTimelineEvent } from './timeline.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { emit, rooms } from '../sockets/emitter.js';

const alertInclude = {
  request: { select: { id: true, referenceCode: true, category: true, status: true, campId: true } },
  disasterZone: { select: { id: true, name: true, hazardType: true } },
  acknowledgements: { select: { userId: true, note: true, createdAt: true, user: { select: { fullName: true, role: true } } } },
  createdBy: { select: { id: true, fullName: true, role: true } },
  resolvedBy: { select: { id: true, fullName: true, role: true } },
};

export const isRedLevel = (severity) => severityRank(severity) >= severityRank('RED');

// Fields safe for non-staff viewers (zone-level public alerts only).
const publicAlert = (a) => ({
  id: a.id,
  title: a.title,
  message: a.message,
  severity: a.severity,
  severityLabel: SEVERITY_LABELS[a.severity],
  status: a.status,
  source: a.source,
  disasterZone: a.disasterZone ?? null,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const withLabel = (a) => ({ ...a, severityLabel: SEVERITY_LABELS[a.severity] });

// Inside a transaction: create a RED/HYPER_RED alert for a request, or escalate its existing open alert.
// Returns { alert, created } so the caller can notify after commit.
export async function upsertRequestAlertTx(tx, { request, severity, source, reason, actor }) {
  const existing = await tx.alert.findFirst({
    where: { requestId: request.id, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    if (severityRank(severity) <= severityRank(existing.severity)) return { alert: existing, created: false, changed: false };
    const alert = await tx.alert.update({
      where: { id: existing.id },
      data: { severity, status: 'ACTIVE', escalationLevel: { increment: 1 }, message: `${existing.message}\nEscalated: ${reason}` },
    });
    await audit(tx, { actor, action: 'ALERT_ESCALATED', entityType: 'Alert', entityId: alert.id, before: { severity: existing.severity }, after: { severity, reason } });
    return { alert, created: false, changed: true };
  }
  const alert = await tx.alert.create({
    data: {
      title: `${SEVERITY_LABELS[severity]}: ${request.category.toLowerCase()} request ${request.referenceCode}`,
      message: `${request.peopleAffected} people affected${request.vulnerableCount ? ` (${request.vulnerableCount} vulnerable)` : ''}. ${reason}`,
      severity,
      source,
      requestId: request.id,
      disasterZoneId: request.disasterZoneId ?? null,
      createdById: actor?.id ?? null,
    },
  });
  await audit(tx, { actor, action: 'ALERT_CREATED', entityType: 'Alert', entityId: alert.id, after: { severity, source, requestId: request.id } });
  await addTimelineEvent(tx, {
    requestId: request.id,
    type: 'ALERT_RAISED',
    message: `${SEVERITY_LABELS[severity]} alert raised for coordinator attention`,
    actor,
    isPublic: false,
    data: { alertId: alert.id, severity },
  });
  return { alert, created: true, changed: true };
}

// After commit: notify staff and emit realtime events. Never throws.
export async function announceAlert(alert, { created }) {
  emit([rooms.ops], created ? 'alert:created' : 'alert:updated', {
    id: alert.id,
    severity: alert.severity,
    status: alert.status,
    requestId: alert.requestId,
  });
  if (!alert.requestId) emit(['broadcast'], created ? 'alert:created' : 'alert:updated', { id: alert.id, severity: alert.severity, status: alert.status });
  await notifyRoles(['RELIEF_COORDINATOR', 'ADMIN'], {
    type: created ? 'ALERT_CREATED' : 'ALERT_UPDATED',
    title: alert.title,
    body: alert.message.slice(0, 280),
    severity: alert.severity,
    data: { alertId: alert.id, requestId: alert.requestId },
  });
}

export async function createAlert(actor, input, req) {
  if (input.requestId) {
    const exists = await prisma.reliefRequest.findUnique({ where: { id: input.requestId }, select: { id: true } });
    if (!exists) throw badRequest('Linked request does not exist');
  }
  if (input.disasterZoneId) {
    const zone = await prisma.disasterZone.findUnique({ where: { id: input.disasterZoneId }, select: { id: true } });
    if (!zone) throw badRequest('Linked disaster zone does not exist');
  }
  // Persist alert + audit (+ timeline) first; notifications follow and may fail independently.
  const alert = await prisma.$transaction(async (tx) => {
    const a = await tx.alert.create({
      data: { ...input, source: input.source ?? 'COORDINATOR', createdById: actor.id },
    });
    await audit(tx, { actor, action: 'ALERT_CREATED', entityType: 'Alert', entityId: a.id, after: input, req });
    if (a.requestId) {
      await addTimelineEvent(tx, {
        requestId: a.requestId,
        type: 'ALERT_RAISED',
        message: `${SEVERITY_LABELS[a.severity]} alert raised`,
        actor,
        isPublic: false,
        data: { alertId: a.id },
      });
    }
    return a;
  });
  await announceAlert(alert, { created: true });
  return getAlert(alert.id);
}

export async function getAlert(id) {
  const alert = await prisma.alert.findUnique({ where: { id }, include: alertInclude });
  if (!alert) throw notFound('Alert');
  return withLabel(alert);
}

export async function listAlerts(query) {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.requestId ? { requestId: query.requestId } : {}),
    ...(query.disasterZoneId ? { disasterZoneId: query.disasterZoneId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: alertInclude,
      orderBy: [{ [query.sortBy]: query.sortOrder }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.alert.count({ where }),
  ]);
  return { items: items.map(withLabel), meta: pageMeta(query, total) };
}

export async function activeAlerts(user) {
  const staff = user && STAFF_ROLES.includes(user.role);
  const where = { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] }, ...(staff ? {} : { requestId: null }) };
  const items = await prisma.alert.findMany({
    where,
    include: staff ? alertInclude : { disasterZone: alertInclude.disasterZone },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
  });
  items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return { items: staff ? items.map(withLabel) : items.map(publicAlert), scope: staff ? 'operational' : 'public' };
}

export async function summary() {
  const [bySeverity, byStatus] = await Promise.all([
    prisma.alert.groupBy({ by: ['severity'], where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }, _count: true }),
    prisma.alert.groupBy({ by: ['status'], _count: true }),
  ]);
  const open = { NORMAL: 0, HIGH: 0, RED: 0, HYPER_RED: 0 };
  for (const row of bySeverity) open[row.severity] = row._count;
  const statuses = { ACTIVE: 0, ACKNOWLEDGED: 0, RESOLVED: 0 };
  for (const row of byStatus) statuses[row.status] = row._count;
  return { openBySeverity: open, byStatus: statuses, openTotal: statuses.ACTIVE + statuses.ACKNOWLEDGED };
}

export async function acknowledge(actor, id, note, req) {
  const alert = await prisma.$transaction(async (tx) => {
    const current = await tx.alert.findUnique({ where: { id } });
    if (!current) throw notFound('Alert');
    if (current.status === 'RESOLVED') throw invalidTransition(current.status, 'ACKNOWLEDGED', 'Alert');
    const already = await tx.alertAcknowledgement.findUnique({ where: { alertId_userId: { alertId: id, userId: actor.id } } });
    if (already) throw conflict('You have already acknowledged this alert');
    await tx.alertAcknowledgement.create({ data: { alertId: id, userId: actor.id, note } });
    const updated = await tx.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED' } });
    await audit(tx, { actor, action: 'ALERT_ACKNOWLEDGED', entityType: 'Alert', entityId: id, before: { status: current.status }, after: { status: 'ACKNOWLEDGED', note }, req });
    return updated;
  });
  emit([rooms.ops], 'alert:updated', { id: alert.id, status: alert.status, severity: alert.severity, requestId: alert.requestId });
  return getAlert(id);
}

export async function escalate(actor, id, { severity, reason }, req) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.alert.findUnique({ where: { id }, include: { request: true } });
    if (!current) throw notFound('Alert');
    if (current.status === 'RESOLVED') throw invalidTransition('RESOLVED', 'ESCALATED', 'Alert');
    if (severityRank(severity) <= severityRank(current.severity)) {
      throw badRequest('Escalation must raise the severity level', [{ path: 'severity', message: `Current level is ${current.severity}` }]);
    }
    const updated = await tx.alert.update({
      where: { id },
      data: { severity, status: 'ACTIVE', escalationLevel: { increment: 1 } },
    });
    await audit(tx, { actor, action: 'ALERT_ESCALATED', entityType: 'Alert', entityId: id, before: { severity: current.severity }, after: { severity, reason }, req });
    // Keep the linked request's effective severity in step (never lowers it).
    if (current.request && severityRank(severity) > severityRank(current.request.severity)) {
      await tx.reliefRequest.update({ where: { id: current.request.id }, data: { severity, severityReason: `Alert escalated: ${reason}` } });
      await audit(tx, { actor, action: 'REQUEST_SEVERITY_OVERRIDE', entityType: 'ReliefRequest', entityId: current.request.id, before: { severity: current.request.severity }, after: { severity, reason }, req });
      await addTimelineEvent(tx, {
        requestId: current.request.id,
        type: 'SEVERITY_CHANGED',
        message: `Priority raised to ${SEVERITY_LABELS[severity]}`,
        actor,
        data: { from: current.request.severity, to: severity, reason },
      });
    }
    return updated;
  });
  await announceAlert(result, { created: false });
  if (result.requestId) emit([rooms.request(result.requestId), rooms.ops], 'request:updated', { id: result.requestId });
  return getAlert(id);
}

export async function resolve(actor, id, { note }, req) {
  const alert = await prisma.$transaction(async (tx) => {
    const { count } = await tx.alert.updateMany({
      where: { id, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: note },
    });
    const current = await tx.alert.findUnique({ where: { id } });
    if (!current) throw notFound('Alert');
    if (count === 0) throw invalidTransition(current.status, 'RESOLVED', 'Alert');
    await audit(tx, { actor, action: 'ALERT_RESOLVED', entityType: 'Alert', entityId: id, after: { note }, req });
    if (current.requestId) {
      await addTimelineEvent(tx, { requestId: current.requestId, type: 'ALERT_RESOLVED', message: 'Alert resolved by coordinator', actor, isPublic: false, data: { alertId: id } });
    }
    return current;
  });
  emit([rooms.ops], 'alert:updated', { id: alert.id, status: alert.status, severity: alert.severity, requestId: alert.requestId });
  if (!alert.requestId) emit(['broadcast'], 'alert:updated', { id: alert.id, status: alert.status });
  if (alert.createdById && alert.createdById !== actor.id) {
    await notifyUsers([alert.createdById], { type: 'ALERT_RESOLVED', title: `Resolved: ${alert.title}`, body: note, severity: alert.severity, data: { alertId: alert.id } });
  }
  return getAlert(id);
}

export function assertStaff(user) {
  if (!user || !STAFF_ROLES.includes(user.role)) throw forbidden();
}
