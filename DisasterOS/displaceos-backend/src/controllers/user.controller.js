import * as users from '../services/user.service.js';
import { ok } from '../utils/respond.js';

export const updateMe = async (req, res) => ok(res, await users.updateMe(req.user, req.valid.body, req));

export async function list(req, res) {
  const { items, meta } = await users.listUsers(req.user, req.valid.query);
  ok(res, items, meta);
}

export const changeRole = async (req, res) =>
  ok(res, await users.changeRole(req.user, req.valid.params.userId, req.valid.body, req));
