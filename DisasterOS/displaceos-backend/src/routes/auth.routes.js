import { Router } from 'express';
import * as ctl from '../controllers/auth.controller.js';
import * as usersCtl from '../controllers/user.controller.js';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, refreshLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { changeRoleBody, listUsersQuery, loginBody, refreshBody, registerBody, updateMeBody } from '../validators/auth.validators.js';
import { idParam } from '../validators/common.js';

export const authRouter = Router();
authRouter.post('/register', registerLimiter, validate({ body: registerBody }), ctl.register);
authRouter.post('/login', authLimiter, validate({ body: loginBody }), ctl.login);
authRouter.post('/refresh', refreshLimiter, validate({ body: refreshBody }), ctl.refresh);
authRouter.post('/logout', optionalAuth, ctl.logout);
authRouter.get('/me', authenticate, ctl.me);

export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.patch('/me', validate({ body: updateMeBody }), usersCtl.updateMe);
usersRouter.get('/', requireRole('ADMIN', 'RELIEF_COORDINATOR'), validate({ query: listUsersQuery }), usersCtl.list);
usersRouter.patch('/:userId/role', requireRole('ADMIN'), validate({ params: idParam('userId'), body: changeRoleBody }), usersCtl.changeRole);
