# Deployment

> Production deployment has **not** been performed or tested for this project. The steps below describe the
> intended setup; verify them in your environment.

## Requirements

- Node.js 20.11+ (developed and tested on Node 24).
- PostgreSQL 14+ with a UTF-8 database (`ENCODING 'UTF8'`). Do not use `npm run db:local` in production — it is
  an embedded development server.
- HTTPS termination (reverse proxy or platform load balancer). The refresh cookie is `Secure` in production.

## Environment

Set at least: `NODE_ENV=production`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
(two different random values of 48+ bytes), `CORS_ORIGINS` (the exact frontend origin(s)), `SWAGGER_ENABLED`
(`false` unless the docs should be public), `LOG_LEVEL`. The server refuses to start with placeholder secrets.
Keep secrets in the platform's secret store, never in the repository.

## Steps

```bash
npm ci --omit=dev          # note: prisma CLI is a devDependency; run migrations from a build/CI step with dev deps,
                           # or install `prisma` in the release image
npx prisma generate
npx prisma migrate deploy  # never `migrate dev` or `migrate reset` against production
npm start                  # node src/server.js
```

Do **not** run `npm run db:seed` in production (it wipes all tables; it also refuses when `NODE_ENV=production`).
Create the first admin by registering a user and promoting it directly in the database
(`UPDATE "User" SET role='ADMIN' WHERE email='…'`), then manage roles through `PATCH /api/v1/users/:id/role`.

## Topology notes

- **Single instance** is the supported topology. Rate limits are stored in memory per process, and Socket.IO
  rooms are per process. To scale horizontally, add a shared rate-limit store and the Socket.IO Redis adapter.
  REST correctness does not depend on this (all state is in PostgreSQL).
- Socket.IO needs WebSocket upgrade support on the proxy (`/socket.io/`).
- `app.set('trust proxy', 1)` assumes one proxy hop so client IPs (rate limits, audit `ip`) are correct.
- Health check: `GET /api/v1/health` (200 when the database is reachable, 503 otherwise).
- Logs are JSON (pino) on stdout in production.

## Optional providers

None are required. `EMAIL_PROVIDER=console` / `SMS_PROVIDER=console` only log masked lines. No real email, SMS or
routing provider is implemented; add one in `src/adapters/index.js` following the documented contracts.

## Backups

Back up PostgreSQL regularly (e.g. `pg_dump`). The audit log, timeline and ETA history are append-only and are the
operational record of the response.
