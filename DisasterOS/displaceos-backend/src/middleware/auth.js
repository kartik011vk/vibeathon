import { verifyAccessToken } from '../services/token.service.js';
import { prisma } from '../utils/prisma.js';
import { forbidden, unauthorized } from '../utils/errors.js';

function bearer(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

// Loads the user from the database on every request so deactivation and role changes take effect immediately.
async function loadUser(token) {
  const payload = verifyAccessToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      locationAssignments: { select: { locationId: true } },
      teamMemberships: { select: { teamId: true } },
    },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    locationIds: user.locationAssignments.map((a) => a.locationId),
    teamIds: user.teamMemberships.map((m) => m.teamId),
  };
}

export async function authenticate(req, res, next) {
  const token = bearer(req);
  if (!token) return next(unauthorized());
  const user = await loadUser(token);
  if (!user) return next(unauthorized('Session is invalid or has expired'));
  req.user = user;
  next();
}

// Attaches req.user when a valid token is present; never rejects.
export async function optionalAuth(req, res, next) {
  const token = bearer(req);
  if (token) req.user = (await loadUser(token)) ?? undefined;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export { loadUser };
