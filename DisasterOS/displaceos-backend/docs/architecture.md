# Architecture

DisplaceOS backend is a single Node.js (ES modules) service: Express for REST, Socket.IO for real-time
notifications, PostgreSQL via Prisma for all state. There is no in-memory state that matters for correctness —
the database is the source of truth and sockets only tell clients *that* something changed.

```
             ┌────────────── HTTP /api/v1 ──────────────┐
browser ───► │ requestId → pino-http → helmet → cors →  │
             │ json(100kb) → cookies → rate limits →     │
             │ route: authenticate → requireRole →       │
             │        validate(Zod) → controller          │
             │                     ↓                      │
             │                  service ── Prisma ──► PostgreSQL
             │                     ↓ (after commit)       │
             │           notifications + socket emit      │
             └────────────────────────────────────────────┘
             Socket.IO (same port): JWT handshake, server-side rooms only
```

## Layers

| Folder | Responsibility |
|---|---|
| `src/config/` | `env.js` validates environment with Zod and exits with a list of bad variable *names* (never values). `severityRules.js` holds built-in severity rules. |
| `src/routes/` | URL → middleware chain. Every route declares authentication, role gate and Zod schema. |
| `src/controllers/` | Thin adapters: read `req.valid`, call a service, wrap in the response envelope. |
| `src/services/` | All business rules, transactions, scope checks, audit and timeline writes. |
| `src/middleware/` | Request id, auth, validation, rate limits, central error handler. |
| `src/validators/` | Zod schemas (also used to generate the OpenAPI request schemas). |
| `src/sockets/` | Socket.IO server (`index.js`) and the post-commit emitter (`emitter.js`). |
| `src/adapters/` | Optional providers (email/SMS console adapter, routing placeholder). |
| `src/jobs/` | Optional in-process escalation job (`ESCALATION_JOB_ENABLED`). No Redis required. |
| `src/openapi/` | OpenAPI 3 document served at `/api/openapi.json` and Swagger UI at `/api/docs`. |
| `src/utils/` | Prisma client, logger, errors, pagination, geo, crypto helpers, constants. |

`src/app.js` builds the Express app (used by tests); `src/server.js` adds the HTTP server, Socket.IO, the
optional job and graceful shutdown.

## Key design rules

1. **Persist, then announce.** Services commit the database transaction (including audit and timeline rows)
   before sending notifications or socket events. Notification failure is caught and recorded on the
   `Notification` row; it never rolls back operational state.
2. **Scope = query filter.** `src/services/access.service.js` turns the authenticated user into a Prisma `where`
   clause. A record outside your scope is indistinguishable from one that does not exist (404).
3. **Atomic stock changes.** Every stock movement is one conditional `UPDATE … WHERE available >= n RETURNING`,
   backed by database CHECK constraints. See `database-model.md`.
4. **Conditional state transitions.** State changes use `updateMany({ where: { id, status: <allowed> } })` and
   check the affected row count, so duplicate or concurrent transitions fail cleanly with 409.
5. **Server-owned severity.** Clients never send severity; rules suggest it and staff confirm/override with a reason.
6. **No invented data.** ETA, distance, availability and route data are only returned when backed by records;
   otherwise the API returns an explicit "unavailable" state with a reason.

## Optional pieces

| Feature | Default | Notes |
|---|---|---|
| Email / SMS | off | `EMAIL_PROVIDER=console` / `SMS_PROVIDER=console` logs a masked line instead of sending. No real provider ships. |
| Routing ETA | off | No provider ships. `/routes/estimate` returns `available:false`. Adapter contract is in `src/adapters/index.js`. |
| Escalation job | off | Re-evaluates waiting requests every `ESCALATION_JOB_INTERVAL_SECONDS`. |
| File uploads | metadata only | `RequestAttachment` stores name/type/size/storage reference; bytes are never stored in PostgreSQL. |
