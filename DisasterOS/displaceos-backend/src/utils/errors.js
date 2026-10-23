// Stable error codes shared with API consumers. Do not rename existing codes.
export const ErrorCodes = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export class AppError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, ErrorCodes.VALIDATION_ERROR, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, ErrorCodes.UNAUTHORIZED, message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, ErrorCodes.FORBIDDEN, message);
export const notFound = (what = 'Resource') => new AppError(404, ErrorCodes.NOT_FOUND, `${what} not found`);
export const conflict = (message, details) => new AppError(409, ErrorCodes.CONFLICT, message, details);
export const invalidTransition = (from, to, entity = 'Record') =>
  new AppError(409, ErrorCodes.INVALID_STATE_TRANSITION, `${entity} cannot move from ${from} to ${to}`, [
    { from, to },
  ]);
export const insufficientStock = (details) =>
  new AppError(409, ErrorCodes.INSUFFICIENT_STOCK, 'Not enough available stock to complete this action', details);
