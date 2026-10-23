import pino from 'pino';
import { config } from '../config/env.js';

// Paths redacted from every log line. Passwords, tokens and personal contact data never reach logs.
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.passwordHash',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.phone',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact,
  ...(config.isProduction || config.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
