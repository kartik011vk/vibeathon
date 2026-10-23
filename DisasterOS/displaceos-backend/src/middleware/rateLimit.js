import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { ErrorCodes } from '../utils/errors.js';

function limiter(windowMinutes, limit) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests exercise auth flows many times in a row; limits are covered by a dedicated test toggle.
    skip: () => config.isTest && process.env.RATE_LIMIT_IN_TESTS !== 'true',
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCodes.RATE_LIMITED, message: 'Too many attempts. Please wait and try again.', details: [] },
        requestId: req.id,
      });
    },
  });
}

export const authLimiter = limiter(15, 20);
// Refresh runs on every page load to restore the session, so it gets a wider budget than login.
export const refreshLimiter = limiter(15, 300);
export const registerLimiter = limiter(60, 10);
export const publicTrackingLimiter = limiter(15, 60);
export const publicReadLimiter = limiter(1, 120);
export const apiLimiter = limiter(1, 600);
