// Controllers for locations, zones, maps, notifications, escalation rules, dashboards, audit and health.
import * as locations from '../services/location.service.js';
import * as notifications from '../services/notification.service.js';
import * as rules from '../services/escalationRule.service.js';
import * as dashboard from '../services/dashboard.service.js';
import { prisma } from '../utils/prisma.js';
import { notFound } from '../utils/errors.js';
import { pageMeta } from '../utils/pagination.js';
import { created, ok } from '../utils/respond.js';
import { channels, routingStatus } from '../adapters/index.js';

const p = (req, name) => req.valid.params[name];

export const locationsCtl = {
  create: async (req, res) => created(res, await locations.createLocation(req.user, req.valid.body, req)),
  list: async (req, res) => ok(res, await locations.listLocations(req.valid.query)),
  get: async (req, res) => ok(res, await locations.getLocation(p(req, 'locationId'))),
};

export const zonesCtl = {
  list: async (req, res) => ok(res, await locations.listZones(req.valid.query)),
  get: async (req, res) => ok(res, await locations.getZone(p(req, 'zoneId'))),
  create: async (req, res) => created(res, await locations.createZone(req.user, req.valid.body, req)),
  update: async (req, res) => ok(res, await locations.updateZone(req.user, p(req, 'zoneId'), req.valid.body, req)),
};

export const mapCtl = {
  resources: async (req, res) => ok(res, await locations.mapResources(req.valid.query)),
  requests: async (req, res) => ok(res, await locations.mapRequests(req.user, req.valid.query)),
  teams: async (req, res) => ok(res, await locations.mapTeams(req.user)),
  routeEstimate: async (req, res) => ok(res, locations.routeEstimate(req.valid.query)),
};

export const notificationsCtl = {
  list: async (req, res) => {
    const q = req.valid.query;
    const { items, total, unread } = await notifications.listForUser(req.user.id, q);
    ok(res, items, { ...pageMeta(q, total), unread });
  },
  read: async (req, res) => {
    const { notification } = await notifications.markRead(req.user.id, p(req, 'notificationId'));
    if (!notification) throw notFound('Notification');
    ok(res, notification);
  },
  getPrefs: async (req, res) => ok(res, await notifications.getPreferences(req.user.id)),
  updatePrefs: async (req, res) => ok(res, await notifications.updatePreferences(req.user.id, req.valid.body)),
};

export const rulesCtl = {
  list: async (req, res) => ok(res, await rules.listRules()),
  create: async (req, res) => created(res, await rules.createRule(req.user, req.valid.body, req)),
  update: async (req, res) => ok(res, await rules.updateRule(req.user, p(req, 'ruleId'), req.valid.body, req)),
};

export const dashboardCtl = {
  summary: async (req, res) => ok(res, await dashboard.summary(req.user)),
  criticalNeeds: async (req, res) => ok(res, await dashboard.criticalNeeds(req.user)),
  resourceDistribution: async (req, res) => ok(res, await dashboard.resourceDistribution()),
  responseTimes: async (req, res) => ok(res, await dashboard.responseTimes(req.valid.query)),
};

export async function auditLogs(req, res) {
  const q = req.valid.query;
  const where = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, fullName: true, role: true } } },
      orderBy: { createdAt: q.sortOrder },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  ok(res, items, pageMeta(q, total));
}

// Health: reports service status only — no versions, hostnames, connection strings or secrets.
export async function health(req, res) {
  let database = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  const status = database === 'up' ? 'ok' : 'degraded';
  res.status(database === 'up' ? 200 : 503).json({
    success: database === 'up',
    data: {
      status,
      database,
      time: new Date().toISOString(),
      optionalProviders: {
        email: channels.email ? 'configured' : 'not_configured',
        sms: channels.sms ? 'configured' : 'not_configured',
        routing: routingStatus().configured ? 'configured' : 'not_configured',
      },
    },
    meta: {},
  });
}
