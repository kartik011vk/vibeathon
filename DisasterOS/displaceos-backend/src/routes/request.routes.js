import { Router } from 'express';
import { z } from 'zod';
import * as ctl from '../controllers/request.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { STAFF_ROLES } from '../utils/constants.js';
import { idParam, reasonBody, uuid } from '../validators/common.js';
import {
  createRequestBody,
  escalateBody,
  listRequestsQuery,
  nearbyQuery,
  trackingTokenBody,
  updateRequestBody,
  verifyBody,
} from '../validators/request.validators.js';

const rid = { params: idParam('requestId') };

export const requestsRouter = Router();
requestsRouter.use(authenticate);

requestsRouter.post('/', validate({ body: createRequestBody }), ctl.create);
requestsRouter.get('/', validate({ query: listRequestsQuery }), ctl.list);
requestsRouter.get('/nearby', requireRole(...STAFF_ROLES), validate({ query: nearbyQuery }), ctl.nearby);
requestsRouter.get('/:requestId', validate(rid), ctl.get);
requestsRouter.patch('/:requestId', validate({ ...rid, body: updateRequestBody }), ctl.update);
requestsRouter.post('/:requestId/cancel', validate({ ...rid, body: reasonBody }), ctl.cancel);
requestsRouter.post('/:requestId/verify', requireRole('RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'), validate({ ...rid, body: verifyBody }), ctl.verify);
requestsRouter.post('/:requestId/escalate', validate({ ...rid, body: escalateBody }), ctl.escalate);
requestsRouter.get('/:requestId/timeline', validate(rid), ctl.timeline);
requestsRouter.get('/:requestId/tracking', validate(rid), ctl.tracking);
requestsRouter.post('/:requestId/tracking-tokens', validate({ ...rid, body: trackingTokenBody }), ctl.createToken);
requestsRouter.get('/:requestId/tracking-tokens', validate(rid), ctl.listTokens);
requestsRouter.post(
  '/:requestId/tracking-tokens/:tokenId/revoke',
  validate({ params: z.object({ requestId: uuid, tokenId: uuid }) }),
  ctl.revokeToken,
);
