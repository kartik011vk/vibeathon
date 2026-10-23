import { logger } from '../utils/logger.js';

// Thin wrapper so services can emit after a database commit without importing the Socket.IO server.
// Payloads must be minimal (ids, status, timestamps); clients refetch details over REST.
let io = null;

export function setIo(server) {
  io = server;
}

export function emit(rooms, event, payload) {
  if (!io) return;
  const list = (Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean);
  if (!list.length) return;
  try {
    io.to(list).emit(event, { ...payload, emittedAt: new Date().toISOString() });
  } catch (err) {
    logger.warn({ err: err.message, event }, 'Socket emit failed');
  }
}

export const rooms = {
  user: (id) => `user:${id}`,
  request: (id) => `request:${id}`,
  dispatch: (id) => `dispatch:${id}`,
  team: (id) => `team:${id}`,
  camp: (id) => `camp:${id}`,
  location: (id) => `location:${id}`,
  ops: 'ops',
  inventory: 'inventory',
};
