import { channels } from '../adapters/index.js';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { severityRank } from '../utils/constants.js';

const DEFAULT_PREF = { inApp: true, email: false, sms: false, minSeverity: 'NORMAL', mutedTypes: [] };

function wanted(pref, { type, severity }) {
  if (pref.mutedTypes.includes(type)) return false;
  if (severity && severityRank(severity) < severityRank(pref.minSeverity)) return false;
  return true;
}

async function deliverOne(channelKey, channelEnum, user, payload) {
  const adapter = channels[channelKey];
  const notification = await prisma.notification.create({
    data: {
      userId: user.id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? undefined,
      channel: channelEnum,
      status: adapter ? 'PENDING' : 'SKIPPED',
      error: adapter ? null : 'Provider not configured',
    },
  });
  if (!adapter) return notification;
  try {
    await adapter.deliver({ user, notification, title: payload.title, body: payload.body, data: payload.data });
    return prisma.notification.update({ where: { id: notification.id }, data: { status: 'SENT' } });
  } catch (err) {
    logger.warn({ channel: channelEnum, type: payload.type, err: err.message }, 'Notification delivery failed');
    return prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', error: String(err.message ?? 'Delivery failed').slice(0, 300) },
    });
  }
}

// Sends notifications to users. Call only AFTER the operational change has committed.
// This function never throws: a notification failure must not undo or hide a valid operational state.
export async function notifyUsers(userIds, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const results = [];
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, email: true, preference: true },
    });
    for (const user of users) {
      const pref = user.preference ?? DEFAULT_PREF;
      if (!wanted(pref, payload)) continue;
      try {
        if (pref.inApp) results.push(await deliverOne('inApp', 'IN_APP', user, payload));
        if (pref.email) results.push(await deliverOne('email', 'EMAIL', user, payload));
        if (pref.sms) results.push(await deliverOne('sms', 'SMS', user, payload));
      } catch (err) {
        logger.error({ err: err.message, type: payload.type }, 'Could not record notification');
      }
    }
  } catch (err) {
    logger.error({ err: err.message, type: payload.type }, 'Notification fan-out failed');
  }
  return results;
}

export async function notifyRoles(roles, payload, { locationIds } = {}) {
  try {
    const where = { role: { in: roles }, isActive: true };
    if (locationIds?.length) where.locationAssignments = { some: { locationId: { in: locationIds } } };
    const users = await prisma.user.findMany({ where, select: { id: true } });
    return notifyUsers(
      users.map((u) => u.id),
      payload,
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Role notification lookup failed');
    return [];
  }
}

export async function listForUser(userId, { page, pageSize, unreadOnly }) {
  const where = { userId, channel: 'IN_APP', ...(unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } }),
  ]);
  return { items, total, unread };
}

export async function markRead(userId, notificationId) {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  const n = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  return { notification: n, changed: count > 0 };
}

export async function getPreferences(userId) {
  return (
    (await prisma.notificationPreference.findUnique({ where: { userId } })) ??
    prisma.notificationPreference.create({ data: { userId } })
  );
}

export async function updatePreferences(userId, data) {
  return prisma.notificationPreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}
