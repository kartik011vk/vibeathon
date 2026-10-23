# Security and roles

## Roles

| Role | Can do |
|---|---|
| CITIZEN | Create requests; view/edit (while SUBMITTED)/cancel own requests; own timeline (public events), tracking, tracking links, notifications; ask for escalation |
| CAMP_MANAGER | Everything for requests at assigned camps (create, edit, verify/reject — no severity override, cancel, request escalation); acknowledge alerts; view camp allocations/dispatches; critical-needs dashboard |
| RELIEF_COORDINATOR | All requests; verify with severity override; apply escalation; alerts (create/ack/escalate/resolve); escalation rules; allocations (propose/approve/reject/release, suggestions); teams; dispatches (create/cancel/start/complete/fail/ETA); dashboards; list staff users |
| INVENTORY_MANAGER | Stock transactions at assigned locations; catalogue; ledger; low stock; approve/reject/release allocations sourced from assigned locations; resource-distribution dashboard |
| RESPONSE_TEAM | Dispatches assigned to own team: accept, start, location, ETA, partial/full delivery, fail; own team availability/location |
| ADMIN | Everything a coordinator can do, plus role/scope assignment, locations, audit log |

Public (no login): health, registration/login, active **zone-level** alerts, disaster zones, locations,
item catalogue, availability, map resources, public tracking by link token.

## Enforcement

1. **Route gate** — `requireRole(...)` in `src/routes/*.js` (coarse).
2. **Resource scope** — `src/services/access.service.js` (fine). Every read and write of a request/dispatch/
   allocation is filtered by:

| Role | Requests | Dispatches | Allocations |
|---|---|---|---|
| CITIZEN | `requesterId = me` | request is mine | — |
| CAMP_MANAGER | `campId ∈ my camps` | request at my camps | request at my camps |
| INVENTORY_MANAGER | has an allocation from my locations | allocation source ∈ my locations | source ∈ my locations |
| RESPONSE_TEAM | has a dispatch for my team | `teamId ∈ my teams` | — |
| RELIEF_COORDINATOR, ADMIN | all | all | all |

   Out-of-scope ids return **404**, the same as missing ids, to prevent IDOR/enumeration.
3. **Action rules in services** — e.g. only the assigned team may accept or report location; only coordinators
   override severity; inventory managers approve only their own sources; admins cannot demote themselves.
4. **SOS privacy** — an SOS is broadcast to everyone, but only RT, CM, RC and A receive its exact position, message
   and the requester's identity; the public broadcast and `/sos/active` for others carry only an approximate area
   label (nearest relief location within 15 km, else the zone, else a ~1 km grid).
5. **Field-level privacy** — the requester sees the assigned team's real reported position only while that dispatch
   is `IN_TRANSIT` or `PARTIALLY_DELIVERED` (`location.sharedWithRequester: true`); before the team starts and after
   the run closes they get only the approximate straight-line distance. Open-needs boards show responders no requester
   identity, phone or address and round positions to about 1 km; other citizens never get requester coordinates; staff identities are hidden from requester
   timelines; public tracking returns no names, addresses, coordinates or contact data.

Never trusted from the client: role, user id, ownership, severity, status, requester, disaster zone (derived from
camp or coordinates), ETA source, delivered quantities beyond what is planned.

## Authentication

- bcrypt (bcryptjs, cost 12) password hashes; login error messages do not reveal whether the email exists, and
  unknown emails still run a bcrypt comparison.
- Passwords: 10–128 chars with at least one letter and one number.
- Access JWT (15 min, issuer/audience checked). The user is reloaded on every request, so deactivation and role
  changes apply immediately. Role changes also revoke the user's refresh sessions.
- Refresh tokens: opaque random, HMAC-hashed at rest, rotated on every use, reuse revokes the family, logout
  revokes the family. Cookie: httpOnly, SameSite=Lax, path `/api/v1/auth`, Secure in production.
- Registration cannot assign roles (validator strips unknown keys; service hard-codes CITIZEN). Role changes are
  admin-only and audited with before/after values and reason.

## Transport and input

- Helmet headers, `x-powered-by` disabled, CORS allow-list from `CORS_ORIGINS` (credentials enabled).
- JSON body limit 100 kB.
- Zod validation for every body, query and path parameter (strict objects reject unknown keys on writes).
- Rate limits (per IP): login 20 per 15 min, refresh 300 per 15 min (it runs on every page load), register 10 per hour, public tracking 60 per 15 min, public
  reads 120 per min, all API 600 per min.
- Central error handler: stable codes, no stack traces, SQL or connection strings; generic message for 500.

## Logging and secrets

- Structured logs (pino) with request ids. Authorization headers, cookies, passwords, tokens and phone numbers are
  redacted; request bodies are not logged. Health output contains no versions, hosts or secrets.
- `.env` is git-ignored; `.env.example` has placeholders only. The server refuses to start in production with
  placeholder JWT secrets and refuses to run the demo seed in production.

## Audit log

Recorded actions include: `AUTH_REGISTER`, `AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `AUTH_LOGOUT`,
`AUTH_REFRESH_REUSE_DETECTED`, `USER_ROLE_CHANGED`, `USER_PROFILE_UPDATED`, `REQUEST_CREATED`, `REQUEST_UPDATED`,
`REQUEST_VERIFIED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`, `REQUEST_SEVERITY_OVERRIDE`,
`REQUEST_ESCALATION_REQUESTED`, `REQUEST_AUTO_ESCALATED`, `ALERT_CREATED/ACKNOWLEDGED/ESCALATED/RESOLVED`,
`INVENTORY_RECEIPT/ADJUSTMENT/CONSUMPTION`, `INVENTORY_ITEM_CREATED/UPDATED`,
`ALLOCATION_PROPOSED/APPROVED/REJECTED/RELEASED`, `TEAM_*`, `DISPATCH_CREATED/ACCEPTED/STARTED/PARTIAL_DELIVERY/
COMPLETED/FAILED/CANCELLED/LOCATION_UPDATED/ETA_UPDATED`, `TRACKING_TOKEN_CREATED/REVOKED`, `LOCATION_CREATED`,
`DISASTER_ZONE_CREATED/UPDATED`, `ESCALATION_RULE_CREATED/UPDATED`. Only ADMIN can read the audit log.
