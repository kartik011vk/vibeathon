import { prisma } from '../utils/prisma.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { pageMeta } from '../utils/pagination.js';
import { Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { publicUser } from './auth.service.js';
import { notifyUsers } from './notification.service.js';

const withScope = {
  locationAssignments: { include: { location: { select: { id: true, name: true, type: true } } } },
  teamMemberships: { include: { team: { select: { id: true, name: true } } } },
  organization: { select: { id: true, name: true, type: true, status: true } },
};

export const profile = (u) => ({
  ...publicUser(u),
  assignedLocations: u.locationAssignments?.map((a) => a.location) ?? [],
  teams: u.teamMemberships?.map((m) => m.team) ?? [],
  organization: u.organization ?? null,
  orgRole: u.orgRole ?? null,
  membershipStatus: u.membershipStatus ?? null,
});

export async function me(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: withScope });
  if (!u) throw notFound('User');
  return profile(u);
}

export async function updateMe(user, data, req) {
  const u = await prisma.user.update({ where: { id: user.id }, data, include: withScope });
  await audit(null, { actor: user, action: 'USER_PROFILE_UPDATED', entityType: 'User', entityId: user.id, after: { fields: Object.keys(data) }, req });
  return profile(u);
}

export async function listUsers(actor, q) {
  const where = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { fullName: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  // Coordinators may look up staff (e.g. to build teams) but not browse citizen accounts.
  if (actor.role === Roles.RELIEF_COORDINATOR) where.role = q.role && q.role !== Roles.CITIZEN ? q.role : { not: Roles.CITIZEN };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, include: withScope, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.user.count({ where }),
  ]);
  return { items: items.map(profile), meta: pageMeta(q, total) };
}

// Admin-only. Role and scope assignment are audited with before/after values.
export async function changeRole(actor, userId, { role, locationIds, isActive, reason }, req) {
  if (actor.role !== Roles.ADMIN) throw forbidden();
  if (userId === actor.id && role !== Roles.ADMIN) throw badRequest('Admins cannot remove their own admin role');
  const before = await prisma.user.findUnique({ where: { id: userId }, include: withScope });
  if (!before) throw notFound('User');
  if (locationIds?.length) {
    const found = await prisma.location.count({ where: { id: { in: locationIds } } });
    if (found !== locationIds.length) throw badRequest('One or more locations do not exist', [{ path: 'locationIds' }]);
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role, ...(isActive != null ? { isActive } : {}) } });
    if (locationIds) {
      await tx.userLocationAssignment.deleteMany({ where: { userId } });
      if (locationIds.length) await tx.userLocationAssignment.createMany({ data: locationIds.map((locationId) => ({ userId, locationId })) });
    }
    if (role !== before.role || isActive === false) {
      // Force fresh sign-in so the new role is reflected everywhere.
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(tx, {
      actor,
      action: 'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId: userId,
      before: { role: before.role, isActive: before.isActive, locationIds: before.locationAssignments.map((a) => a.locationId) },
      after: { role, isActive: isActive ?? before.isActive, locationIds: locationIds ?? before.locationAssignments.map((a) => a.locationId), reason },
      req,
    });
    return tx.user.findUnique({ where: { id: userId }, include: withScope });
  });
  if (role !== before.role) {
    await notifyUsers([userId], { type: 'ROLE_CHANGED', title: 'Your access has changed', body: `Your role is now ${role.replace(/_/g, ' ').toLowerCase()}. Please sign in again.` });
  }
  return profile(updated);
}
