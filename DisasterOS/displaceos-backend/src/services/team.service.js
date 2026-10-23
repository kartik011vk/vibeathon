import { prisma } from '../utils/prisma.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { Roles } from '../utils/constants.js';
import { config } from '../config/env.js';
import { audit } from './audit.service.js';
import { canSeeExactTeamLocation, isCoordinator, isTeamMember } from './access.service.js';
import { emit, rooms } from '../sockets/emitter.js';

const teamInclude = {
  baseLocation: { select: { id: true, name: true, area: true } },
  members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
  dispatches: { where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'] } }, select: { id: true, status: true, requestId: true } },
};

export function isLocationStale(at) {
  return !at || Date.now() - new Date(at).getTime() > config.LOCATION_STALE_MINUTES * 60 * 1000;
}

function shape(user, t) {
  const exact = canSeeExactTeamLocation(user, t.id);
  return {
    id: t.id,
    name: t.name,
    callSign: t.callSign,
    availability: t.availability,
    baseLocation: t.baseLocation,
    members: exact || user.role === Roles.ADMIN ? t.members.map((m) => ({ userId: m.user.id, fullName: m.user.fullName, roleInTeam: m.roleInTeam })) : undefined,
    memberCount: t.members.length,
    activeDispatches: exact ? t.dispatches : t.dispatches.length,
    location: exact
      ? {
          latitude: t.lastLatitude,
          longitude: t.lastLongitude,
          updatedAt: t.lastLocationAt,
          available: t.lastLatitude != null && t.lastLongitude != null,
          stale: isLocationStale(t.lastLocationAt),
        }
      : { restricted: true },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export async function createTeam(user, { name, callSign, baseLocationId, members = [] }, req) {
  if (members.length) {
    const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } } });
    const invalid = members.filter((m) => !users.find((u) => u.id === m.userId && u.role === Roles.RESPONSE_TEAM));
    if (invalid.length) throw badRequest('Team members must be existing RESPONSE_TEAM users', invalid.map((m) => ({ userId: m.userId })));
  }
  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.responseTeam.create({
      data: { name, callSign, baseLocationId, members: { create: members.map((m) => ({ userId: m.userId, roleInTeam: m.roleInTeam })) } },
    });
    await audit(tx, { actor: user, action: 'TEAM_CREATED', entityType: 'ResponseTeam', entityId: t.id, after: { name, members: members.length }, req });
    return t;
  });
  return getTeam(user, team.id);
}

export async function listTeams(user, q) {
  const where = {
    ...(user.role === Roles.RESPONSE_TEAM ? { id: { in: user.teamIds } } : {}),
    ...(q.availability ? { availability: q.availability } : {}),
  };
  const teams = await prisma.responseTeam.findMany({ where, include: teamInclude, orderBy: { name: 'asc' } });
  return teams.map((t) => shape(user, t));
}

export async function getTeam(user, id) {
  if (user.role === Roles.RESPONSE_TEAM && !user.teamIds.includes(id)) throw notFound('Team');
  const team = await prisma.responseTeam.findUnique({ where: { id }, include: teamInclude });
  if (!team) throw notFound('Team');
  return shape(user, team);
}

function assertTeamActor(user, teamId) {
  if (isCoordinator(user) || isTeamMember(user, teamId)) return;
  throw forbidden('Only members of this team or coordinators can update it');
}

export async function setAvailability(user, id, availability, req) {
  assertTeamActor(user, id);
  const before = await prisma.responseTeam.findUnique({ where: { id } });
  if (!before) throw notFound('Team');
  const team = await prisma.responseTeam.update({ where: { id }, data: { availability } });
  await audit(null, { actor: user, action: 'TEAM_AVAILABILITY_CHANGED', entityType: 'ResponseTeam', entityId: id, before: { availability: before.availability }, after: { availability }, req });
  emit([rooms.ops, rooms.team(id)], 'team:updated', { id, availability });
  return getTeam(user, team.id);
}

export async function setLocation(user, id, { latitude, longitude }, req) {
  assertTeamActor(user, id);
  const exists = await prisma.responseTeam.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound('Team');
  await prisma.responseTeam.update({ where: { id }, data: { lastLatitude: latitude, lastLongitude: longitude, lastLocationAt: new Date() } });
  await audit(null, { actor: user, action: 'TEAM_LOCATION_UPDATED', entityType: 'ResponseTeam', entityId: id, req });
  // Coordinates are not broadcast; authorized clients refetch.
  emit([rooms.ops, rooms.team(id)], 'team:updated', { id, locationUpdated: true });
  return getTeam(user, id);
}
