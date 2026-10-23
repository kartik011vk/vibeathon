import { Router } from 'express';
import {
  auditLogs,
  dashboardCtl,
  health,
  locationsCtl,
  mapCtl,
  notificationsCtl,
  rulesCtl,
  zonesCtl,
} from '../controllers/platform.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicReadLimiter } from '../middleware/rateLimit.js';
import { idParam } from '../validators/common.js';
import * as v from '../validators/ops.validators.js';

const COORD = ['RELIEF_COORDINATOR', 'ADMIN'];

export const healthRouter = Router();
healthRouter.get('/', health);

export const locationsRouter = Router();
locationsRouter.get('/', publicReadLimiter, validate({ query: v.listLocationsQuery }), locationsCtl.list);
locationsRouter.get('/:locationId', publicReadLimiter, validate({ params: idParam('locationId') }), locationsCtl.get);
locationsRouter.post('/', authenticate, requireRole('ADMIN'), validate({ body: v.createLocationBody }), locationsCtl.create);

export const zonesRouter = Router();
zonesRouter.get('/', publicReadLimiter, validate({ query: v.listZonesQuery }), zonesCtl.list);
zonesRouter.get('/:zoneId', publicReadLimiter, validate({ params: idParam('zoneId') }), zonesCtl.get);
zonesRouter.post('/', authenticate, requireRole(...COORD), validate({ body: v.createZoneBody }), zonesCtl.create);
zonesRouter.patch('/:zoneId', authenticate, requireRole(...COORD), validate({ params: idParam('zoneId'), body: v.updateZoneBody }), zonesCtl.update);

export const mapRouter = Router();
mapRouter.get('/resources', publicReadLimiter, validate({ query: v.mapResourcesQuery }), mapCtl.resources);
mapRouter.get('/requests', authenticate, validate({ query: v.mapRequestsQuery }), mapCtl.requests);
mapRouter.get('/teams', authenticate, requireRole('RESPONSE_TEAM', ...COORD), mapCtl.teams);

export const routesRouter = Router();
routesRouter.get('/estimate', authenticate, validate({ query: v.routeEstimateQuery }), mapCtl.routeEstimate);

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', validate({ query: v.listNotificationsQuery }), notificationsCtl.list);
notificationsRouter.post('/:notificationId/read', validate({ params: idParam('notificationId') }), notificationsCtl.read);

export const preferencesRouter = Router();
preferencesRouter.use(authenticate);
preferencesRouter.get('/', notificationsCtl.getPrefs);
preferencesRouter.patch('/', validate({ body: v.preferencesBody }), notificationsCtl.updatePrefs);

export const rulesRouter = Router();
rulesRouter.use(authenticate, requireRole(...COORD));
rulesRouter.get('/', rulesCtl.list);
rulesRouter.post('/', validate({ body: v.createRuleBody }), rulesCtl.create);
rulesRouter.patch('/:ruleId', validate({ params: idParam('ruleId'), body: v.updateRuleBody }), rulesCtl.update);

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);
dashboardRouter.get('/summary', requireRole(...COORD), dashboardCtl.summary);
dashboardRouter.get('/critical-needs', requireRole(...COORD, 'CAMP_MANAGER'), dashboardCtl.criticalNeeds);
dashboardRouter.get('/resource-distribution', requireRole(...COORD, 'INVENTORY_MANAGER'), dashboardCtl.resourceDistribution);
dashboardRouter.get('/response-times', requireRole(...COORD), validate({ query: v.responseTimesQuery }), dashboardCtl.responseTimes);

export const auditRouter = Router();
auditRouter.get('/', authenticate, requireRole('ADMIN'), validate({ query: v.auditQuery }), auditLogs);
