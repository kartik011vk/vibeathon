import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { AppError, ErrorCodes, conflict, unauthorized } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { hashRefreshToken, newRefreshToken, refreshExpiry, signAccessToken } from './token.service.js';

const BCRYPT_ROUNDS = 12;

// Same work factor as a real comparison, so unknown emails are not distinguishable by timing.
const DUMMY_HASH = bcrypt.hashSync('displaceos-timing-equaliser', BCRYPT_ROUNDS);

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  phone: u.phone ?? null,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function issueSession(db, user, { familyId = randomUUID(), userAgent } = {}) {
  const refreshToken = newRefreshToken();
  const session = await db.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshExpiry(),
      userAgent: userAgent?.slice(0, 200) ?? null,
    },
  });
  return { accessToken: signAccessToken(user), refreshToken, session };
}

// Public registration always creates a CITIZEN. Any role in the payload is ignored by the validator.
export async function register({ email, password, fullName, phone }, req) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict('An account with this email already exists');
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, passwordHash, fullName, phone, role: 'CITIZEN' } });
    await tx.notificationPreference.create({ data: { userId: u.id } });
    await audit(tx, { actor: u, action: 'AUTH_REGISTER', entityType: 'User', entityId: u.id, req });
    return u;
  });
  const tokens = await issueSession(prisma, user, { userAgent: req.get('user-agent') });
  return { user: publicUser(user), ...tokens };
}

export async function login({ email, password }, req) {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    await audit(null, { actor: user, action: 'AUTH_LOGIN_FAILED', entityType: 'User', entityId: user?.id, req });
    throw unauthorized('Email or password is incorrect');
  }
  if (!user.isActive) throw new AppError(403, ErrorCodes.FORBIDDEN, 'This account has been deactivated');
  const tokens = await issueSession(prisma, user, { userAgent: req.get('user-agent') });
  await audit(null, { actor: user, action: 'AUTH_LOGIN', entityType: 'User', entityId: user.id, req });
  return { user: publicUser(user), ...tokens };
}

// Rotation with reuse detection: presenting an already-rotated token revokes the whole session family.
export async function refresh(refreshToken, req) {
  if (!refreshToken) throw unauthorized('Refresh token missing');
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) throw unauthorized('Session is invalid or has expired');

  if (session.revokedAt) {
    await prisma.refreshSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(null, {
      actor: session.user,
      action: 'AUTH_REFRESH_REUSE_DETECTED',
      entityType: 'RefreshSession',
      entityId: session.familyId,
      req,
    });
    throw unauthorized('Session is invalid or has expired');
  }
  if (session.expiresAt < new Date() || !session.user.isActive) throw unauthorized('Session is invalid or has expired');

  return prisma.$transaction(async (tx) => {
    // Conditional update guards against two concurrent refreshes both succeeding.
    const { count } = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw unauthorized('Session is invalid or has expired');
    const next = await issueSession(tx, session.user, { familyId: session.familyId, userAgent: req.get('user-agent') });
    await tx.refreshSession.update({ where: { id: session.id }, data: { replacedById: next.session.id } });
    return { user: publicUser(session.user), accessToken: next.accessToken, refreshToken: next.refreshToken };
  });
}

export async function logout(refreshToken, actor, req) {
  if (refreshToken) {
    const session = await prisma.refreshSession.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (session) {
      await prisma.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  if (actor) await audit(null, { actor, action: 'AUTH_LOGOUT', entityType: 'User', entityId: actor.id, req });
}
