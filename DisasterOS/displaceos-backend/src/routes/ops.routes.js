import { Router } from 'express';
import { z } from 'zod';
import { alertsCtl, allocationsCtl, dispatchesCtl, inventoryCtl, publicTrackingCtl, teamsCtl } from '../controllers/ops.controller.js';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicReadLimiter, publicTrackingLimiter } from '../middleware/rateLimit.js';
import { STAFF_ROLES } from '../utils/constants.js';
import { idParam, reasonBody } from '../validators/common.js';
import * as v from '../validators/ops.validators.js';

const COORD = ['RELIEF_COORDINATOR', 'ADMIN'];

// Alerts
export const alertsRouter = Router();
const aid = { params: idParam('alertId') };
alertsRouter.get('/active', publicReadLimiter, optionalAuth, alertsCtl.active);
alertsRouter.use(authenticate);
alertsRouter.post('/', requireRole(...COORD), validate({ body: v.createAlertBody }), alertsCtl.create);
alertsRouter.get('/', requireRole(...STAFF_ROLES), validate({ query: v.listAlertsQuery }), alertsCtl.list);
alertsRouter.get('/summary', requireRole(...STAFF_ROLES), alertsCtl.summary);
alertsRouter.get('/:alertId', requireRole(...STAFF_ROLES), validate(aid), alertsCtl.get);
alertsRouter.post('/:alertId/acknowledge', requireRole(...COORD, 'CAMP_MANAGER'), validate({ ...aid, body: v.ackBody }), alertsCtl.acknowledge);
alertsRouter.post('/:alertId/escalate', requireRole(...COORD), validate({ ...aid, body: v.alertEscalateBody }), alertsCtl.escalate);
alertsRouter.post('/:alertId/resolve', requireRole(...COORD), validate({ ...aid, body: v.resolveBody }), alertsCtl.resolve);

// Inventory
export const inventoryRouter = Router();
const iid = { params: idParam('itemId') };
inventoryRouter.get('/', publicReadLimiter, optionalAuth, validate({ query: v.listItemsQuery }), inventoryCtl.list);
inventoryRouter.get('/availability', publicReadLimiter, validate({ query: v.availabilityQuery }), inventoryCtl.availability);
inventoryRouter.post('/items', authenticate, requireRole('INVENTORY_MANAGER', 'ADMIN'), validate({ body: v.createItemBody }), inventoryCtl.createItem);
inventoryRouter.get('/low-stock', authenticate, requireRole('INVENTORY_MANAGER', ...COORD), inventoryCtl.lowStock);
inventoryRouter.get('/locations', authenticate, requireRole(...STAFF_ROLES), inventoryCtl.locations);
inventoryRouter.get('/transactions', authenticate, requireRole('INVENTORY_MANAGER', ...COORD), validate({ query: v.listTransactionsQuery }), inventoryCtl.transactions);
inventoryRouter.post('/transactions', authenticate, requireRole('INVENTORY_MANAGER', 'ADMIN'), validate({ body: v.transactionBody }), inventoryCtl.transaction);
inventoryRouter.get('/:itemId', authenticate, validate(iid), inventoryCtl.get);
inventoryRouter.patch('/:itemId', authenticate, requireRole('INVENTORY_MANAGER', 'ADMIN'), validate({ ...iid, body: v.updateItemBody }), inventoryCtl.update);

// Allocations
export const allocationsRouter = Router();
const alid = { params: idParam('allocationId') };
const ALLOC_VIEW = [...COORD, 'INVENTORY_MANAGER', 'CAMP_MANAGER'];
allocationsRouter.use(authenticate);
allocationsRouter.post('/', requireRole(...COORD), validate({ body: v.createAllocationBody }), allocationsCtl.create);
allocationsRouter.get('/', requireRole(...ALLOC_VIEW), validate({ query: v.listAllocationsQuery }), allocationsCtl.list);
allocationsRouter.get('/suggestions', requireRole(...COORD, 'INVENTORY_MANAGER'), validate({ query: v.suggestionsQuery }), allocationsCtl.suggestions);
allocationsRouter.get('/:allocationId', requireRole(...ALLOC_VIEW), validate(alid), allocationsCtl.get);
allocationsRouter.post('/:allocationId/approve', requireRole(...COORD, 'INVENTORY_MANAGER'), validate(alid), allocationsCtl.approve);
allocationsRouter.post('/:allocationId/reject', requireRole(...COORD, 'INVENTORY_MANAGER'), validate({ ...alid, body: reasonBody }), allocationsCtl.reject);
allocationsRouter.post('/:allocationId/release', requireRole(...COORD, 'INVENTORY_MANAGER'), validate({ ...alid, body: reasonBody }), allocationsCtl.release);

// Teams
export const teamsRouter = Router();
const tid = { params: idParam('teamId') };
teamsRouter.use(authenticate, requireRole(...STAFF_ROLES));
teamsRouter.post('/', requireRole(...COORD), validate({ body: v.createTeamBody }), teamsCtl.create);
teamsRouter.get('/', validate({ query: v.listTeamsQuery }), teamsCtl.list);
teamsRouter.get('/:teamId', validate(tid), teamsCtl.get);
teamsRouter.patch('/:teamId/availability', requireRole('RESPONSE_TEAM', ...COORD), validate({ ...tid, body: v.availabilityBody }), teamsCtl.availability);
teamsRouter.patch('/:teamId/location', requireRole('RESPONSE_TEAM', ...COORD), validate({ ...tid, body: v.coordsBody }), teamsCtl.location);

// Dispatches
export const dispatchesRouter = Router();
const did = { params: idParam('dispatchId') };
const FIELD = ['RESPONSE_TEAM', ...COORD];
dispatchesRouter.use(authenticate);
dispatchesRouter.post('/', requireRole(...COORD), validate({ body: v.createDispatchBody }), dispatchesCtl.create);
dispatchesRouter.get('/', validate({ query: v.listDispatchesQuery }), dispatchesCtl.list);
dispatchesRouter.get('/:dispatchId', validate(did), dispatchesCtl.get);
dispatchesRouter.get('/:dispatchId/tracking', validate(did), dispatchesCtl.tracking);
dispatchesRouter.post('/:dispatchId/accept', requireRole('RESPONSE_TEAM'), validate(did), dispatchesCtl.accept);
dispatchesRouter.post('/:dispatchId/start', requireRole(...FIELD), validate(did), dispatchesCtl.start);
dispatchesRouter.post('/:dispatchId/complete', requireRole(...FIELD), validate({ ...did, body: v.completeBody }), dispatchesCtl.complete);
dispatchesRouter.post('/:dispatchId/fail', requireRole(...FIELD), validate({ ...did, body: v.failBody }), dispatchesCtl.fail);
dispatchesRouter.post('/:dispatchId/cancel', requireRole(...COORD), validate({ ...did, body: v.failBody }), dispatchesCtl.cancel);
dispatchesRouter.patch('/:dispatchId/location', requireRole('RESPONSE_TEAM'), validate({ ...did, body: v.coordsBody }), dispatchesCtl.location);
dispatchesRouter.post('/:dispatchId/eta', requireRole(...FIELD), validate({ ...did, body: v.etaBody }), dispatchesCtl.eta);

// Public tracking by link token
export const publicTrackingRouter = Router();
publicTrackingRouter.get(
  '/:token',
  publicTrackingLimiter,
  validate({ params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{30,100}$/, 'Invalid tracking link') }) }),
  publicTrackingCtl,
);
