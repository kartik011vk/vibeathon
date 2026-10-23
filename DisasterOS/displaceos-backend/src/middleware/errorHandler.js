import { Prisma } from '@prisma/client';
import { config } from '../config/env.js';
import { AppError, ErrorCodes } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function send(res, req, status, code, message, details = []) {
  res.status(status).json({ success: false, error: { code, message, details }, requestId: req.id });
}

export function notFoundHandler(req, res) {
  send(res, req, 404, ErrorCodes.NOT_FOUND, 'Route not found');
}

// Central error handler. Never returns stack traces, SQL, secrets or internal identifiers of the failure.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return send(res, req, err.status, err.code, err.message, err.details);
  }

  if (err?.type === 'entity.too.large') {
    return send(res, req, 413, ErrorCodes.PAYLOAD_TOO_LARGE, 'Request body is too large');
  }
  if (err?.type === 'entity.parse.failed') {
    return send(res, req, 400, ErrorCodes.VALIDATION_ERROR, 'Request body is not valid JSON');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(res, req, 409, ErrorCodes.CONFLICT, 'A record with these details already exists');
    if (err.code === 'P2025') return send(res, req, 404, ErrorCodes.NOT_FOUND, 'Resource not found');
    if (err.code === 'P2003') return send(res, req, 400, ErrorCodes.VALIDATION_ERROR, 'A referenced record does not exist');
  }

  // CHECK constraint violations on inventory balances surface as raw database errors.
  if (String(err?.message ?? '').includes('inventory_balance_')) {
    return send(res, req, 409, ErrorCodes.INSUFFICIENT_STOCK, 'Not enough available stock to complete this action');
  }

  logger.error({ err: config.isProduction ? { message: err?.message } : err, requestId: req.id }, 'Unhandled error');
  send(res, req, 500, ErrorCodes.INTERNAL_ERROR, 'Something went wrong. Please try again.');
}
