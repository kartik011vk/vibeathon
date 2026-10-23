import { Router } from 'express';
import { z } from 'zod';
import { confirmReceiptCtl, hazardCtl, offerCtl, orgCtl, sosCtl, supplyCtl } from '../controllers/responder.controller.js';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicReadLimiter, registerLimiter, sosLimiter } from '../middleware/rateLimit.js';
import { idParam, uuid } from '../validators/common.js';
import * as v from '../validators/responder.validators.js';

const COORD = ['RELIEF_COORDINATOR', 'ADMIN'];

// Responder organisations
export const organizationsRouter = Router();
organizationsRouter.post('/register', registerLimiter, validate({ body: v.registerOrgBody }), orgCtl.register);
organizationsRouter.post('/join', registerLimiter, validate({ body: v.joinOrgBody }), orgCtl.join);
organizationsRouter.get('/mine', authenticate, orgCtl.mine);
organizationsRouter.post('/mine/join-code', authenticate, orgCtl.rotateCode);
organizationsRouter.post('/mine/members/:userId/decision', authenticate, validate({ params: idParam('userId'), body: v.memberDecisionBody }), orgCtl.decideMember);
organizationsRouter.get('/', authenticate, requireRole(...COORD), validate({ query: v.listOrgsQuery }), orgCtl.list);
organizationsRouter.get('/:organizationId', authenticate, requireRole(...COORD), validate({ params: idParam('organizationId') }), orgCtl.get);
organizationsRouter.post('/:organizationId/approve', authenticate, requireRole('ADMIN'), validate({ params: idParam('organizationId'), body: v.approveOrgBody }), orgCtl.approve);
organizationsRouter.post('/:organizationId/reject', authenticate, requireRole('ADMIN'), validate({ params: idParam('organizationId'), body: v.supplyReasonBody }), orgCtl.reject);

// Open needs board and team offers (mounted under /requests before the :requestId routes)
export const offersRouter = Router();
offersRouter.get('/open-needs', authenticate, requireRole('RESPONSE_TEAM', ...COORD), validate({ query: v.openNeedsQuery }), offerCtl.openNeeds);
offersRouter.post('/:requestId/offers', authenticate, requireRole('RESPONSE_TEAM'), validate({ params: idParam('requestId'), body: v.createOfferBody }), offerCtl.create);
offersRouter.get('/:requestId/offers', authenticate, requireRole('RESPONSE_TEAM', ...COORD), validate({ params: idParam('requestId') }), offerCtl.list);
offersRouter.post('/:requestId/confirm-receipt', authenticate, validate({ params: idParam('requestId'), body: v.confirmReceiptBody }), confirmReceiptCtl);
offersRouter.post(
  '/:requestId/offers/:offerId/withdraw',
  authenticate,
  requireRole('RESPONSE_TEAM'),
  validate({ params: z.object({ requestId: uuid, offerId: uuid }) }),
  offerCtl.withdraw,
);

// Supply donations
export const supplyOffersRouter = Router();
const oid = { params: idParam('offerId') };
const HANDLERS = [...COORD, 'INVENTORY_MANAGER'];
supplyOffersRouter.use(authenticate);
supplyOffersRouter.post('/', validate({ body: v.createSupplyBody }), supplyCtl.create);
supplyOffersRouter.get('/', validate({ query: v.listSupplyQuery }), supplyCtl.list);
supplyOffersRouter.get('/:offerId', validate(oid), supplyCtl.get);
supplyOffersRouter.post('/:offerId/accept', requireRole(...HANDLERS), validate({ ...oid, body: v.acceptSupplyBody }), supplyCtl.accept);
supplyOffersRouter.post('/:offerId/receive', requireRole('INVENTORY_MANAGER', 'ADMIN'), validate({ ...oid, body: v.receiveSupplyBody }), supplyCtl.receive);
supplyOffersRouter.post('/:offerId/reject', requireRole(...HANDLERS), validate({ ...oid, body: v.supplyReasonBody }), supplyCtl.reject);
supplyOffersRouter.post('/:offerId/cancel', validate({ ...oid, body: v.supplyReasonBody }), supplyCtl.cancel);

// Emergency rescue (SOS)
export const sosRouter = Router();
const sid = { params: idParam('sosId') };
const SOS_ROLES = ['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'];
sosRouter.get('/active', publicReadLimiter, optionalAuth, sosCtl.active);
sosRouter.use(authenticate);
sosRouter.post('/', sosLimiter, validate({ body: v.raiseSosBody }), sosCtl.raise);
sosRouter.get('/mine', sosCtl.mine);
sosRouter.get('/:sosId', validate(sid), sosCtl.get);
sosRouter.patch('/:sosId/location', validate({ ...sid, body: v.sosLocationBody }), sosCtl.location);
sosRouter.post('/:sosId/respond', requireRole(...SOS_ROLES), validate(sid), sosCtl.respond);
sosRouter.post('/:sosId/resolve', requireRole(...SOS_ROLES), validate({ ...sid, body: v.resolveSosBody }), sosCtl.resolve);
sosRouter.post('/:sosId/cancel', validate({ ...sid, body: v.supplyReasonBody }), sosCtl.cancel);

// Live hazard feeds for India
export const hazardsRouter = Router();
hazardsRouter.get('/', publicReadLimiter, validate({ query: v.listHazardsQuery }), hazardCtl.list);
hazardsRouter.get('/status', publicReadLimiter, hazardCtl.status);
hazardsRouter.post('/refresh', authenticate, requireRole(...COORD), hazardCtl.refresh);
hazardsRouter.post('/:hazardId/zone', authenticate, requireRole(...COORD), validate({ params: idParam('hazardId'), body: v.hazardZoneBody }), hazardCtl.zone);
