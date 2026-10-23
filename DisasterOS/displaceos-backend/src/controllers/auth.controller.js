import * as auth from '../services/auth.service.js';
import * as users from '../services/user.service.js';
import { config } from '../config/env.js';
import { created, ok } from '../utils/respond.js';

// Browser clients receive the refresh token only as an httpOnly cookie scoped to the auth routes.
// Non-browser clients may opt into body delivery with { "tokenDelivery": "body" }.
export const REFRESH_COOKIE = 'dos_refresh';
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/api/v1/auth',
  maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

function deliver(res, result, delivery) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return {
    user: result.user,
    accessToken: result.accessToken,
    tokenType: 'Bearer',
    expiresIn: config.ACCESS_TOKEN_TTL,
    ...(delivery === 'body' ? { refreshToken: result.refreshToken } : {}),
  };
}

export async function register(req, res) {
  const { tokenDelivery, ...input } = req.valid.body;
  const result = await auth.register(input, req);
  created(res, deliver(res, result, tokenDelivery));
}

export async function login(req, res) {
  const { tokenDelivery, ...input } = req.valid.body;
  const result = await auth.login(input, req);
  ok(res, deliver(res, result, tokenDelivery));
}

export async function refresh(req, res) {
  const token = req.valid.body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  try {
    const result = await auth.refresh(token, req);
    ok(res, deliver(res, result, req.valid.body.tokenDelivery));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    throw err;
  }
}

export async function logout(req, res) {
  const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  await auth.logout(token, req.user, req);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  ok(res, { loggedOut: true });
}

export async function me(req, res) {
  ok(res, await users.me(req.user.id));
}
