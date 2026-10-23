# DisplaceOS backend

REST + Socket.IO API for DisplaceOS, a disaster-relief coordination platform: relief requests, rule-suggested
severity and RED/HYPER_RED alerts, inventory with transaction-safe reservations, allocations, response-team
dispatch, requester tracking with ETA history and partial deliveries, notifications, map data, dashboards and
an audit log.

Stack: Node.js (ES modules) · Express 5 · PostgreSQL · Prisma 6 · Zod · bcrypt (bcryptjs) · JWT + rotating refresh
sessions · Socket.IO · pino · Swagger UI · Vitest + Supertest.

## Quick start (development)

```bash
cd displaceos-backend
npm install
cp .env.example .env          # then edit .env (see below)
```

**Database** — choose one:

- No PostgreSQL installed? In a **separate terminal**: `npm run db:local`. This downloads nothing at runtime; it
  starts a real PostgreSQL 17 server bundled in the `embedded-postgres` dev dependency on port 5433, stores data in
  `.local-postgres/`, creates `displaceos` and `displaceos_test`, and prints the `DATABASE_URL` to use
  (`postgresql://displaceos:displaceos_dev_only@localhost:5433/displaceos?schema=public`). Leave it running.
  Development only.
- Own PostgreSQL: create two UTF-8 databases (app and test) and point `DATABASE_URL` / `TEST_DATABASE_URL` at them.

In `.env`, set `DATABASE_URL`, `TEST_DATABASE_URL`, and two different random secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Then:

```bash
npm run db:migrate     # prisma migrate deploy
npm run db:seed        # DEVELOPMENT demo data (wipes all tables first)
npm run dev            # http://localhost:4000/api/v1  ·  docs: http://localhost:4000/api/docs
```

Production-style start: `npm start`. Tests: `npm test`. Syntax check: `npm run lint`.
Demo sequence against the running API: `npm run demo:workflow`.

### Demo accounts (development only)

Password for all: `DemoPass2026!` — `admin@`, `coordinator@`, `camp.manager@`, `inventory@`, `team.alpha@`,
`team.bravo@`, `citizen@`, `citizen2@` … `displaceos.dev`. See `docs/demo-workflow.md`. Never use in production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API with file watching |
| `npm start` | API |
| `npm run db:local` | Embedded development PostgreSQL on port 5433 (keep running) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration after editing the schema |
| `npm run db:seed` | Reset tables and load demo data (refuses in production) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm test` | Applies migrations to `TEST_DATABASE_URL`, then runs Vitest (each file empties the test tables) |
| `npm run lint` | `node --check` over all project JS files |
| `npm run demo:workflow` | Runs the 12-step demo against `DEMO_API_URL` (default `http://localhost:4000/api/v1`) |

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 chars each).
Tests also need `TEST_DATABASE_URL` (must differ from `DATABASE_URL`). Everything else has defaults:
`PORT` 4000, `CORS_ORIGINS` `http://localhost:5173`, `ACCESS_TOKEN_TTL` 15m, `REFRESH_TOKEN_TTL_DAYS` 7,
`SWAGGER_ENABLED` true, `INVENTORY_STALE_HOURS` 48, `LOCATION_STALE_MINUTES` 30, `ETA_DELAY_THRESHOLD_MINUTES` 15,
`PUBLIC_TRACKING_TOKEN_TTL_HOURS` 168, `ESCALATION_JOB_ENABLED` false. Optional providers `EMAIL_PROVIDER`,
`SMS_PROVIDER` (`console` only), `ROUTING_PROVIDER` (none implemented).

## Layout

```
prisma/        schema.prisma, migrations/ (incl. stock CHECK constraints), seed.js
src/app.js     Express app (no listening)      src/server.js  HTTP + Socket.IO + optional job
src/config/    env validation, severity rules   src/routes/    route → auth → role → Zod → controller
src/services/  business logic & transactions    src/sockets/   Socket.IO auth, rooms, emitter
src/adapters/  optional email/SMS/routing       src/openapi/   OpenAPI generated from Zod validators
tests/         Vitest + Supertest suites        docs/          architecture, API, data model, security, tracking, demo, deployment
```

## Documentation

- `docs/architecture.md` — layers and design rules
- `docs/api-guide.md` — envelope, auth/token storage, endpoints, socket events
- `docs/database-model.md` — models, state machines, inventory invariants
- `docs/security-and-roles.md` — RBAC matrix, scope rules, audit
- `docs/tracking-and-eta.md` — tracking response, ETA rules, partial delivery, public links
- `docs/demo-workflow.md` — demo accounts and the 12-step sequence
- `docs/deployment.md` — production notes

## Verification status (2026-10-23, Windows 11, Node 24.18, embedded PostgreSQL 17.6)

**Verified by commands actually run**

- `npm run db:migrate` and `npm run db:seed` on a fresh database (seed drives the real services end to end).
- `npm run dev`: server starts, `/api/v1/health` returns `database: up`.
- `npm test` → **10 test files, 125 tests passed** (SOS and hand-over verification added in v1.2) (responder onboarding, offers, donations and live-location rules added in v1.1): auth (hashing, register-cannot-pick-role, refresh rotation and
  reuse detection, logout, deactivation), permissions (401s, ownership/camp scope → 404, role changes admin-only
  and audited), request lifecycle and timeline, severity rules and RED/HYPER_RED alerts, alert persistence when
  notification delivery throws, inventory ledger and invariants, concurrent allocation approvals (no overselling,
  single approval), dispatch transitions and team authorization, ETA history and "unavailable" states, partial /
  shortfall / failed / cancelled deliveries with stock reconciliation, public tracking link expiry/revocation and
  privacy, socket authentication and room authorization, central error handling and rate limiting.
- `npm run lint` → 0 syntax errors.
- `npm run demo:workflow` completed against a seeded database (separate server on the test database).

**Not configured / not implemented (by design for the MVP)**

- Real email/SMS delivery (only a `console` development adapter), routing/road ETA provider (route estimates
  return `available:false`), file upload storage (attachment metadata only), Redis / multi-instance Socket.IO.
- Production deployment has not been performed.
