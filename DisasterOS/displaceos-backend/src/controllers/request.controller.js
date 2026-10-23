import * as requests from '../services/request.service.js';
import { requestTracking } from '../services/tracking.service.js';
import { created, ok } from '../utils/respond.js';

const id = (req) => req.valid.params.requestId;

export const create = async (req, res) => created(res, await requests.createRequest(req.user, req.valid.body, req));

export async function list(req, res) {
  const { items, meta } = await requests.listRequests(req.user, req.valid.query);
  ok(res, items, meta);
}

export const get = async (req, res) => ok(res, await requests.getRequest(req.user, id(req)));
export const update = async (req, res) => ok(res, await requests.updateRequest(req.user, id(req), req.valid.body, req));
export const cancel = async (req, res) => ok(res, await requests.cancelRequest(req.user, id(req), req.valid.body.reason, req));
export const verify = async (req, res) => ok(res, await requests.verifyRequest(req.user, id(req), req.valid.body, req));

export async function escalate(req, res) {
  const { applied, request } = await requests.escalateRequest(req.user, id(req), req.valid.body, req);
  ok(res, request, { escalationApplied: applied });
}

export const timeline = async (req, res) => ok(res, await requests.getTimeline(req.user, id(req)));
export const tracking = async (req, res) => ok(res, await requestTracking(req.user, id(req)));

export async function nearby(req, res) {
  const items = await requests.nearbyRequests(req.user, req.valid.query);
  ok(res, items, { count: items.length, distanceBasis: 'STRAIGHT_LINE' });
}

export const createToken = async (req, res) => created(res, await requests.createTrackingToken(req.user, id(req), req.valid.body, req));
export const listTokens = async (req, res) => ok(res, await requests.listTrackingTokens(req.user, id(req)));
export const revokeToken = async (req, res) =>
  ok(res, await requests.revokeTrackingToken(req.user, id(req), req.valid.params.tokenId, req));
