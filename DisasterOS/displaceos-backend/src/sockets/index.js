// Authenticated Socket.IO. Clients authenticate with the same short-lived access token as REST:
//   io(url, { auth: { token: accessToken } })
// Rooms are joined only by the server. Clients may ask to watch a request or dispatch with
//   socket.emit('subscribe', { type: 'request' | 'dispatch', id }, ack)
// and the server checks the same scope rules as REST before joining. Arbitrary room names are never accepted.
import { Server } from 'socket.io';
import { z } from 'zod';
import { config } from '../config/env.js';
import { loadUser } from '../middleware/auth.js';
import { findDispatchInScope, findRequestInScope } from '../services/access.service.js';
import { Roles } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { rooms, setIo } from './emitter.js';

const subscription = z.object({ type: z.enum(['request', 'dispatch']), id: z.string().uuid() });

export function baseRoomsFor(user) {
  const list = [rooms.user(user.id), 'broadcast'];
  if (user.role === Roles.RELIEF_COORDINATOR || user.role === Roles.ADMIN) list.push(rooms.ops, rooms.inventory);
  if (user.role === Roles.INVENTORY_MANAGER) list.push(rooms.inventory);
  if (user.role === Roles.CAMP_MANAGER) list.push(...user.locationIds.map(rooms.camp));
  if (user.role === Roles.RESPONSE_TEAM) list.push(...user.teamIds.map(rooms.team));
  return list;
}

export async function authorizeSubscription(user, input) {
  const parsed = subscription.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_ERROR' };
  const { type, id } = parsed.data;
  try {
    if (type === 'request') await findRequestInScope(user, id, { select: { id: true } });
    else await findDispatchInScope(user, id, { select: { id: true } });
    return { ok: true, room: type === 'request' ? rooms.request(id) : rooms.dispatch(id) };
  } catch {
    // Same answer for "missing" and "not yours" to avoid leaking existence.
    return { ok: false, error: 'NOT_FOUND' };
  }
}

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = token ? await loadUser(token) : null;
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.userId = user.id;
      socket.data.user = user;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(baseRoomsFor(socket.data.user));

    socket.on('subscribe', async (input, ack) => {
      // Reload the user so role or scope changes since connecting are honoured.
      const token = socket.handshake.auth?.token;
      const user = token ? await loadUser(token) : null;
      if (!user) {
        if (typeof ack === 'function') ack({ ok: false, error: 'UNAUTHORIZED' });
        return socket.disconnect(true);
      }
      const result = await authorizeSubscription(user, input);
      if (result.ok) socket.join(result.room);
      if (typeof ack === 'function') ack(result.ok ? { ok: true } : result);
    });

    socket.on('unsubscribe', (input) => {
      const parsed = subscription.safeParse(input);
      if (parsed.success) socket.leave(parsed.data.type === 'request' ? rooms.request(parsed.data.id) : rooms.dispatch(parsed.data.id));
    });
  });

  io.engine.on('connection_error', (err) => logger.debug({ code: err.code }, 'Socket connection error'));
  setIo(io);
  return io;
}
