import { prisma } from '../utils/prisma.js';

// Records an audit entry. Pass a transaction client as `db` so the entry commits atomically with the change.
export async function audit(db, { actor, action, entityType, entityId, before, after, req }) {
  return (db ?? prisma).auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: req?.ip ?? null,
      requestId: req?.id ?? null,
    },
  });
}
