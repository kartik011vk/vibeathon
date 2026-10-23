import { Router } from 'express';
import { authRouter, usersRouter } from './auth.routes.js';
import { requestsRouter } from './request.routes.js';
import { hazardsRouter, offersRouter, organizationsRouter, sosRouter, supplyOffersRouter } from './responder.routes.js';
import { alertsRouter, allocationsRouter, dispatchesRouter, inventoryRouter, publicTrackingRouter, teamsRouter } from './ops.routes.js';
import {
  auditRouter,
  dashboardRouter,
  healthRouter,
  locationsRouter,
  mapRouter,
  notificationsRouter,
  preferencesRouter,
  routesRouter,
  rulesRouter,
  zonesRouter,
} from './platform.routes.js';

export const apiRouter = Router();
apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
// Offers router first so /requests/open-needs is not captured by /requests/:requestId.
apiRouter.use('/requests', offersRouter);
apiRouter.use('/requests', requestsRouter);
apiRouter.use('/organizations', organizationsRouter);
apiRouter.use('/supply-offers', supplyOffersRouter);
apiRouter.use('/sos', sosRouter);
apiRouter.use('/hazards', hazardsRouter);
apiRouter.use('/alerts', alertsRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/allocations', allocationsRouter);
apiRouter.use('/teams', teamsRouter);
apiRouter.use('/dispatches', dispatchesRouter);
apiRouter.use('/tracking', publicTrackingRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/notification-preferences', preferencesRouter);
apiRouter.use('/escalation-rules', rulesRouter);
apiRouter.use('/locations', locationsRouter);
apiRouter.use('/disaster-zones', zonesRouter);
apiRouter.use('/map', mapRouter);
apiRouter.use('/routes', routesRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/audit-logs', auditRouter);
