# API guide

Base URL: `/api/v1`. Interactive docs: `GET /api/docs` (Swagger UI), raw spec: `GET /api/openapi.json`
(both controlled by `SWAGGER_ENABLED`). Request body/query schemas in the spec are generated from the same Zod
validators the server enforces.

## Response envelope

```json
{ "success": true, "data": { }, "meta": { } }
```
```json
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Some fields are missing or invalid",
             "details": [{ "location": "body", "path": "peopleAffected", "message": "Expected number" }] },
  "requestId": "6f1c…" }
```

Error codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
`INVALID_STATE_TRANSITION` 409, `INSUFFICIENT_STOCK` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429,
`INTERNAL_ERROR` 500. 500 responses always carry the generic message "Something went wrong. Please try again."
Every response has an `X-Request-Id` header (an incoming well-formed `X-Request-Id` is reused for correlation).

## Pagination and filtering

Collection endpoints accept `page` (default 1), `pageSize` (default 20, max 100), `sortOrder` (`asc|desc`) and an
allow-listed `sortBy`. `meta` = `{ page, pageSize, total, totalPages }`. Multi-value filters accept comma lists,
e.g. `GET /requests?status=SUBMITTED,VERIFIED&severity=RED,HYPER_RED`. Unknown sort fields are rejected (400).

## Authentication and token storage

| Token | Lifetime | Where the browser keeps it |
|---|---|---|
| Access token (JWT, HS256) | `ACCESS_TOKEN_TTL` (15 min) | **In memory only** (JS variable). Sent as `Authorization: Bearer …`. |
| Refresh token (opaque, 384-bit) | `REFRESH_TOKEN_TTL_DAYS` (7 d) | **httpOnly cookie `dos_refresh`**, `SameSite=Lax`, `Path=/api/v1/auth`, `Secure` in production. JS never sees it. |

- On page load the frontend calls `POST /auth/refresh` (cookie sent automatically) to restore the session.
- Refresh rotates the token. Presenting an already-rotated token revokes the whole session family (theft signal).
- Only an HMAC of each refresh token is stored (`RefreshSession.tokenHash`).
- The development frontend uses a **Vite proxy** so `/api` and `/socket.io` are same-origin; no cross-site cookie
  configuration is needed. For a separate production origin, add it to `CORS_ORIGINS` and serve over HTTPS.
- Non-browser clients may send `"tokenDelivery": "body"` to login/register/refresh to also receive the refresh
  token in the JSON body, and pass it back as `{ "refreshToken": "…" }`.
- Authorization is re-evaluated on every request from the database (role, active flag, assigned locations, team
  membership). The `role` claim in the JWT is informational only.

## Endpoints

Roles: C citizen, CM camp manager, RC relief coordinator, IM inventory manager, RT response team, A admin,
S any staff role, — public.

| Method & path | Roles | Notes |
|---|---|---|
| GET `/health` | — | `status`, `database`, optional provider status; no secrets |
| POST `/auth/register` | — | Always creates CITIZEN; `role` in body is ignored |
| POST `/auth/login` · `/auth/refresh` · `/auth/logout` | — | Rate limited |
| GET `/auth/me` | any | Includes `assignedLocations`, `teams` |
| PATCH `/users/me` | any | `fullName`, `phone` |
| GET `/users` | RC, A | RC sees staff only |
| PATCH `/users/:userId/role` | A | `{ role, locationIds?, isActive?, reason }`, audited, revokes sessions |
| POST `/requests` | C, CM, RC, A | `{ category, description, peopleAffected, vulnerableCount?, items[], campId?, destinationAddress?, latitude?, longitude?, attachments? }` |
| GET `/requests` | any (scoped) | filters `status, severity, category, campId, search, mine, open` |
| GET `/requests/nearby` | S | `latitude, longitude, radiusKm` → `distanceKm` (straight line) |
| GET/PATCH `/requests/:id` | scoped | Editable fields depend on role and status |
| POST `/requests/:id/cancel` | owner, CM, RC, A | `{ reason }` |
| POST `/requests/:id/verify` | RC, A, CM | `{ decision: VERIFY|REJECT, reason, severity? }` (severity override RC/A only) |
| POST `/requests/:id/escalate` | owner, CM, RC, A | RC/A apply `{ severity, reason }`; others request escalation (`meta.escalationApplied=false`) |
| GET `/requests/:id/timeline` | scoped | Requesters see public events only |
| GET `/requests/:id/tracking` | scoped | Status, items delivered/remaining, dispatches, ETA, timeline |
| POST/GET `/requests/:id/tracking-tokens` | owner, CM, RC, A | Token returned once |
| POST `/requests/:id/tracking-tokens/:tokenId/revoke` | owner, CM, RC, A | |
| GET `/tracking/:token` | — | Minimal public view; rate limited |
| POST `/alerts` | RC, A | |
| GET `/alerts`, `/alerts/summary`, `/alerts/:id` | S | |
| GET `/alerts/active` | — / S | Public: zone-level alerts only; staff: all open |
| POST `/alerts/:id/acknowledge` | RC, A, CM | Once per user |
| POST `/alerts/:id/escalate` · `/resolve` | RC, A | Escalation must raise severity |
| GET `/inventory` | — / S | Catalogue; staff also get balances |
| POST `/inventory/items`, PATCH `/inventory/:itemId` | IM, A | |
| GET `/inventory/:itemId` | any | |
| POST `/inventory/transactions` | IM (assigned locations), A | `RECEIPT | ADJUSTMENT | CONSUMPTION` |
| GET `/inventory/transactions` | IM, RC, A | Ledger |
| GET `/inventory/low-stock` | IM, RC, A | |
| GET `/inventory/locations` | S | |
| GET `/inventory/availability` | — | `itemId, category, locationId, locationType, latitude, longitude, radiusKm` |
| POST `/allocations` | RC, A | `{ requestId, sourceLocationId, lines[{requestItemId, quantity}], notes? }` |
| GET `/allocations`, `/allocations/:id` | RC, A, IM, CM (scoped) | |
| GET `/allocations/suggestions?requestId=` | RC, A, IM | Rule-based with rationale |
| POST `/allocations/:id/approve` · `/reject` · `/release` | RC, A, IM (source location) | |
| POST `/teams` | RC, A | |
| GET `/teams`, `/teams/:id` | S | Exact position for RC/A and own team only |
| PATCH `/teams/:id/availability` · `/location` | RT (own), RC, A | |
| POST `/dispatches` | RC, A | `{ allocationId, teamId, notes? }` |
| GET `/dispatches`, `/dispatches/:id`, `/dispatches/:id/tracking` | scoped | |
| POST `/dispatches/:id/accept` | RT (assigned) | |
| POST `/dispatches/:id/start` · `/complete` · `/fail` | RT (assigned), RC, A | complete: `{ lines[{dispatchLineId, quantity}], notes?, final? }` |
| POST `/dispatches/:id/cancel` | RC, A | Before transit only |
| PATCH `/dispatches/:id/location` | RT (assigned) | |
| POST `/dispatches/:id/eta` | RT (assigned), RC, A | `{ eta: ISO | null, reason }` |
| GET `/notifications`, POST `/notifications/:id/read` | any (own) | |
| GET/PATCH `/notification-preferences` | any (own) | |
| GET/POST `/escalation-rules`, PATCH `/escalation-rules/:id` | RC, A | |
| GET `/locations`, `/locations/:id` | — | POST: A |
| GET `/disaster-zones`, `/disaster-zones/:id` | — | POST/PATCH: RC, A |
| GET `/map/resources` | — | Locations with coordinates + supply availability |
| GET `/map/requests` | any (scoped) | |
| GET `/map/teams` | RT (own), RC, A | |
| GET `/routes/estimate` | any | `available:false` unless a routing provider is configured |
| GET `/dashboard/summary` · `/response-times` | RC, A | |
| GET `/dashboard/critical-needs` | RC, A, CM | |
| GET `/dashboard/resource-distribution` | RC, A, IM | |
| GET `/audit-logs` | A | filters `action, entityType, entityId, actorId` |

## Real-time (Socket.IO)

Connect to the API origin (`/socket.io`) with the access token:

```js
const socket = io('/', { auth: { token: accessToken } });
socket.emit('subscribe', { type: 'request', id: requestId }, (ack) => console.log(ack)); // { ok: true } or { ok:false, error:'NOT_FOUND' }
```

- Unauthenticated connections fail with `connect_error` message `UNAUTHORIZED`.
- The server joins rooms automatically: `user:<id>`, `broadcast`, plus `ops` (RC/A), `inventory` (IM, RC, A),
  `camp:<id>` (CM), `team:<id>` (RT). Clients can only request `request:<id>` / `dispatch:<id>` rooms through
  `subscribe`, which applies the same scope check as REST. Arbitrary room names are rejected.
- After a token refresh, reconnect with the new token.

| Event | Typical payload |
|---|---|
| `request:created`, `request:updated`, `request:verified` | `{ id, status?, severity? }` |
| `alert:created`, `alert:updated` | `{ id, severity, status, requestId? }` |
| `allocation:updated` | `{ id, status, requestId }` |
| `dispatch:assigned`, `dispatch:started`, `dispatch:updated`, `dispatch:partially_delivered`, `dispatch:completed` | `{ id, status, requestId }` |
| `dispatch:location_updated` | `{ id, requestId, updatedAt }` (never coordinates) |
| `dispatch:eta_updated`, `dispatch:delayed` | `{ id, requestId, etaAvailable? }` |
| `notification:created` | `{ id, type, title }` |
| `inventory:updated`, `team:updated`, `zone:updated` | ids only |

Every payload also has `emittedAt`. Payloads are intentionally minimal: clients refetch the REST resource.
REST remains fully usable (polling) when sockets are unavailable.


## Responders, offers and donations (added in v1.1)

| Endpoint | Auth | Notes |
|---|---|---|
| POST `/organizations/register` | — | Organisation + lead account. Lead stays CITIZEN until an admin approves. Returns a session like `/auth/register`. |
| POST `/organizations/join` | — | Join an APPROVED organisation with its join code; membership PENDING until the lead approves. |
| GET `/organizations/mine` | any | Own organisation, status, teams; the approved lead also gets the member list. |
| POST `/organizations/mine/join-code` | approved lead | New join code (returned once, stored hashed; old code stops working). |
| POST `/organizations/mine/members/:userId/decision` | approved lead | `{decision: APPROVE|REJECT}`; approval grants RESPONSE_TEAM and adds the member to the organisation's team. |
| GET `/organizations` · GET `/organizations/:id` | RC/A | Review list with lead contact details. |
| POST `/organizations/:id/approve` · `/reject` | A | Approval grants the lead RESPONSE_TEAM and creates the organisation's response team. |
| GET `/requests/open-needs` | RT, RC/A | Verified requests with no open dispatch; no requester identity; location rounded to ~1 km; straight-line distance from the team. |
| POST `/requests/:id/offers` · GET · POST `/:offerId/withdraw` | RT (own team) / RC/A read | One open offer per team per request; assigning the dispatch to that team marks it ACCEPTED. |
| POST `/supply-offers` · GET `/supply-offers` · GET `/:id` | any (own) / RC/A/IM all | Donations with append-only events and post-arrival impact. |
| POST `/supply-offers/:id/accept` | RC/A/IM | Choose receiving stock location; free-text lines must be mapped to catalogue items. |
| POST `/supply-offers/:id/receive` | IM of that location, A | Counted quantities become RECEIPT transactions. |
| POST `/supply-offers/:id/reject` · `/cancel` | RC/A/IM · donor | |

Socket event `supply:updated` `{ id, status }` goes to staff rooms and the donor's user room.
