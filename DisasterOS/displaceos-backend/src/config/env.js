import 'dotenv/config';
import { z } from 'zod';

const bool = (def) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const intWithDefault = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intWithDefault(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: intWithDefault(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SWAGGER_ENABLED: bool(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  INVENTORY_STALE_HOURS: intWithDefault(48),
  LOCATION_STALE_MINUTES: intWithDefault(30),
  ETA_DELAY_THRESHOLD_MINUTES: intWithDefault(15),
  PUBLIC_TRACKING_TOKEN_TTL_HOURS: intWithDefault(168),
  ESCALATION_JOB_ENABLED: bool(false),
  ESCALATION_JOB_INTERVAL_SECONDS: intWithDefault(300),
  EMAIL_PROVIDER: z.string().optional().default(''),
  SMS_PROVIDER: z.string().optional().default(''),
  ROUTING_PROVIDER: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Report variable names and rule violations only — never values.
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && /REPLACE_WITH/.test(env.JWT_ACCESS_SECRET + env.JWT_REFRESH_SECRET)) {
  console.error('Refusing to start in production with placeholder JWT secrets.');
  process.exit(1);
}

export const config = Object.freeze({
  ...env,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
});
