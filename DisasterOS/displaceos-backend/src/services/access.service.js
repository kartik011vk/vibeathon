// Central resource-scope rules. Every read/write of a request or dispatch goes through these filters,
// so out-of-scope records behave exactly like records that do not exist (no IDOR, no existence leaks).
import { prisma } from '../utils/prisma.js';
import { notFound } from '../utils/errors.js';
import { Roles } from '../utils/constants.js';

export const isCoordinator = (user) => user.role === Roles.RELIEF_COORDINATOR || user.role === Roles.ADMIN;

export function requestScope(user) {
  switch (user.role) {
    case Roles.ADMIN:
    case Roles.RELIEF_COORDINATOR:
      return {};
    case Roles.CITIZEN:
      return { requesterId: user.id };
    case Roles.CAMP_MANAGER:
      return { campId: { in: user.locationIds } };
    case Roles.INVENTORY_MANAGER:
      return { allocations: { some: { sourceLocationId: { in: user.locationIds } } } };
    case Roles.RESPONSE_TEAM:
      return { dispatches: { some: { teamId: { in: user.teamIds } } } };
    default:
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}

export function dispatchScope(user) {
  switch (user.role) {
    case Roles.ADMIN:
    case Roles.RELIEF_COORDINATOR:
      return {};
    case Roles.RESPONSE_TEAM:
      return { teamId: { in: user.teamIds } };
    case Roles.CAMP_MANAGER:
      return { request: { campId: { in: user.locationIds } } };
    case Roles.INVENTORY_MANAGER:
      return { allocation: { sourceLocationId: { in: user.locationIds } } };
    case Roles.CITIZEN:
      return { request: { requesterId: user.id } };
    default:
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}

export function allocationScope(user) {
  switch (user.role) {
    case Roles.ADMIN:
    case Roles.RELIEF_COORDINATOR:
      return {};
    case Roles.INVENTORY_MANAGER:
      return { sourceLocationId: { in: user.locationIds } };
    case Roles.CAMP_MANAGER:
      return { request: { campId: { in: user.locationIds } } };
    default:
      return { id: '00000000-0000-0000-0000-000000000000' };
  }
}

export async function findRequestInScope(user, id, args = {}, db = prisma) {
  const request = await db.reliefRequest.findFirst({ where: { id, ...requestScope(user) }, ...args });
  if (!request) throw notFound('Request');
  return request;
}

export async function findDispatchInScope(user, id, args = {}, db = prisma) {
  const dispatch = await db.dispatch.findFirst({ where: { id, ...dispatchScope(user) }, ...args });
  if (!dispatch) throw notFound('Dispatch');
  return dispatch;
}

// Exact requester coordinates are visible to the requester and operational staff; never to other citizens.
export const canSeeExactRequestLocation = (user, request) =>
  user.role !== Roles.CITIZEN || request.requesterId === user.id;

// Exact team positions: coordinators/admins and the team's own members only.
export const canSeeExactTeamLocation = (user, teamId) =>
  isCoordinator(user) || (user.role === Roles.RESPONSE_TEAM && user.teamIds.includes(teamId));

export const isTeamMember = (user, teamId) => user.role === Roles.RESPONSE_TEAM && user.teamIds.includes(teamId);
