import jwt from 'jsonwebtoken';
import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { randomToken } from '../utils/crypto.js';

const ISSUER = 'displaceos';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: 'displaceos-api',
    jwtid: randomUUID(),
  });
}

// Returns the payload or null. The role claim is informational only; authorization always reloads the user.
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: 'displaceos-api' });
  } catch {
    return null;
  }
}

// Refresh tokens are opaque random strings. Only an HMAC of the token is persisted.
export function newRefreshToken() {
  return randomToken(48);
}

export function hashRefreshToken(token) {
  return createHmac('sha256', config.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export function refreshExpiry() {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
