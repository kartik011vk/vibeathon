# DisplaceOS integration matrix

Each row maps a screen action to the real backend route or event, who may use it, how the UI handles failure,
and how it was checked. Request and response schemas are documented in the backend OpenAPI
(`http://localhost:4000/api/docs`; request bodies are generated from the Zod validators).

Status key:
- **VERIFIED**: exercised end to end against the running backend with real data. Done by the headless-browser
  run (Chrome, 2026-10-23), the backend Supertest suite, or both.
- **PARTIAL**: works, with the limitation stated.
- **UNAVAILABLE**: needs a provider that is not configured.

## Public and citizen screens

| Screen · action | Method & route / event | Roles | Error and empty handling | Status |
|---|---|---|---|---|
| App load · restore session | `POST /auth/refresh` (cookie) → `GET /auth/me` | anyone | 401 → treated as signed out | VERIFIED |
| Sign in | `POST /auth/login` | anyone | wrong password / rate limited shown inline | VERIFIED (browser, tests) |
| Register | `POST /auth/register` (no role field; always CITIZEN) | anyone | field errors from `details[]` | VERIFIED (tests) |
| Sign out | `POST /auth/logout` | signed in | clears local session even if offline | VERIFIED (browser) |
| Profile edit | `PATCH /users/me` | signed in | inline error | PARTIAL (built; not browser-tested) |
| Notification settings | `GET`/`PATCH /notification-preferences` | signed in | inline error | PARTIAL (built; email/SMS flags have no provider) |
| Home · alert strip | `GET /alerts/active` (public scope: zone alerts only) | anyone | "could not be loaded" / "no active alerts" | VERIFIED |
| Home · live figures | `GET /map/resources`, `GET /disaster-zones`, `GET /alerts/active` | anyone | section hidden on error | VERIFIED |
| Home · 3D Earth markers | `GET /map/resources`, `GET /disaster-zones`, `GET /map/requests` (own), `GET /map/teams` (coordinators) | per route | legend says when nothing is mapped; 2D fallback | VERIFIED (WebGL render checked by screenshot) |
| Request wizard · items | `GET /inventory?category=` (catalogue) | signed in | error + retry; free-text items allowed | VERIFIED |
| Request wizard · camp list | `GET /locations?type=CAMP,SHELTER` | public | error + retry | VERIFIED |
| Request wizard · submit | `POST /requests` → shows `referenceCode` from the response | CITIZEN, CAMP_MANAGER, coordinators | API message + details; no success state on failure; button disabled while pending | VERIFIED (browser: DR-97SRXG; unit tests) |
| GPS / manual location | browser Geolocation (only on click) / map pin / coordinates | — | denial → manual fallback | VERIFIED (unit test) |
| Find nearby help | `GET /inventory/availability?category&latitude&longitude&locationId` | public | empty → "no stock recorded" + request link; error + retry | VERIFIED (browser: 22 km / 30 km straight-line, "Distance unavailable") |
| Disaster updates | `GET /disaster-zones`, `GET /alerts/active` | public | empty states; "no external feed configured" notice | VERIFIED |
| Track · my requests | `GET /requests?mine=true&search=` | signed in | empty / error | VERIFIED |
| Request detail | `GET /requests/:id`, `GET /requests/:id/tracking` | owner or scoped staff | 404 for out-of-scope | VERIFIED |
| Request detail · cancel | `POST /requests/:id/cancel` | owner (SUBMITTED/VERIFIED), staff | reason required; error in dialog | VERIFIED (tests) |
| Request detail · "situation got worse" | `POST /requests/:id/escalate` (no severity → request only) | owner | dialog error | VERIFIED (tests) |
| Share tracking link | `POST/GET /requests/:id/tracking-tokens`, `POST …/:tokenId/revoke` | owner, coordinators, camp managers | token shown once | VERIFIED (tests) |
| Public tracking link | `GET /tracking/:token` | anyone with the link | 404 → "link not valid / expired" | VERIFIED (tests) |
| Notifications | `GET /notifications`, `POST /notifications/:id/read` | signed in | empty / error | VERIFIED (browser badge count) |
| Live updates | Socket.IO `auth.token`; `subscribe {type:'request'}` on detail page; all events invalidate React Query caches | signed in | header shows Live / Reconnecting / Offline; polling continues | VERIFIED ("Live updates" shown in browser; socket auth/rooms in tests) |

## Responders, donors and live location (v1.1)

| Screen · action | Method & route / event | Roles | Error and empty handling | Status |
|---|---|---|---|---|
| Join as a responder · register organisation | `POST /organizations/register` | anyone | field errors; duplicate name/email → 409 | VERIFIED (browser) |
| Join as a responder · join with code | `POST /organizations/join` | anyone | invalid/rotated code → 404 message | VERIFIED (tests) |
| My organisation · status, join code, members | `GET /organizations/mine`, `POST /mine/join-code`, `POST /mine/members/:id/decision` | members / approved lead | pending and rejected states explained | VERIFIED (browser, tests) |
| Admin · responder organisations | `GET /organizations`, `POST /:id/approve`, `/reject` | ADMIN | reason required to reject | VERIFIED (browser) |
| Open needs board + map | `GET /requests/open-needs` | RESPONSE_TEAM, coordinators | empty state; no requester identity; ~1 km positions | VERIFIED (browser, tests) |
| Offer to deliver · withdraw | `POST /requests/:id/offers`, `POST …/offers/:offerId/withdraw` | RESPONSE_TEAM (own team) | duplicate → 409 | VERIFIED (browser, tests) |
| Coordinator · assign offering team | `GET /requests/:id/offers` → `POST /dispatches` (team preselected) | coordinators | "reserve stock first" when no approved allocation | VERIFIED (browser) |
| Team · share live location | browser `watchPosition` (on switch) → `PATCH /dispatches/:id/location` every ≥15 s | assigned team | permission denied stops sharing with a message | VERIFIED (browser with simulated GPS) |
| Requester · live delivery map | `GET /requests/:id/tracking` (15 s polling while live), `location.sharedWithRequester` | requester while IN_TRANSIT / PARTIALLY_DELIVERED | stale position flagged | VERIFIED (browser, tests) |
| Donate supplies | `GET /inventory` (catalogue), `POST /supply-offers` | signed in | pickup needs an address; nothing counted as stock yet | VERIFIED (browser, tests) |
| My donations · detail and impact | `GET /supply-offers?mine=true`, `GET /supply-offers/:id`; event `supply:updated` | donor | not found for other users | VERIFIED (browser) |
| Ops · donations accept / count in / decline | `POST /supply-offers/:id/accept|receive|reject` | RC/A/IM; receive = IM of the location or admin | unmapped items must be matched; wrong location → 403 | VERIFIED (browser, tests) |
| Globe · zoom, borders, place names, search | static Natural Earth data in `src/data/` (lazy chunks) | anyone | flat map fallback | VERIFIED (browser screenshots at three zoom levels) |

## Live India hazard feeds (v1.3)

| Screen · action | Method & route / event | Roles | Error and empty handling | Status |
|---|---|---|---|---|
| Disaster updates · Live alerts across India | `GET /hazards` (60 s refresh, `hazard:*` events) | public | source health shown; unreachable feed named; empty state | VERIFIED (browser on live data: 3 feeds healthy, 34 active alerts) |
| Filters: type, official only, near me, last 7 days | `GET /hazards?type&source&latitude&longitude&radiusKm&activeOnly&sinceHours` | public | near me needs GPS consent; NDMA items are unmapped | VERIFIED (tests) |
| Pop-up for new high-impact events | `GET /hazards?sinceHours=3` + `hazard:new` | everyone | once per event; dismissal remembered | VERIFIED (browser with a temporary test event, then deleted) |
| Create disaster zone from an event | `POST /hazards/:id/zone` | RC/A | unmapped → 400; twice → 409 | VERIFIED (tests) |
| Home strip and globe markers | `GET /hazards?activeOnly=true` | public | hidden when nothing is active | VERIFIED (browser) |

## Emergency SOS and delivery verification (v1.2)

| Screen · action | Method & route / event | Roles | Error and empty handling | Status |
|---|---|---|---|---|
| Header SOS button → `/sos` send | browser GPS (asked on open) → `POST /sos` | signed in (visitors are asked to sign in, and shown 112) | location denied → address required; second open SOS → 409 | VERIFIED (browser) |
| Global red pop-up + strip | `GET /sos/active` (15 s polling) + `sos:created` / `sos:updated` | everyone; details for responders only | none open → nothing shown | VERIFIED (browser: responder 0.6 s, visitor 13.6 s; private message hidden from visitor) |
| I'm responding | `POST /sos/:id/respond` | RT, CM, RC, A | already taken → 409 message | VERIFIED (browser, tests) |
| Requester status page | `GET /sos/:id`, `PATCH /sos/:id/location`, `POST /sos/:id/cancel` | owner | — | VERIFIED (browser, tests) |
| Close SOS with location check | browser GPS → `POST /sos/:id/resolve` | the responder, RC/A | location unavailable → closed unverified | VERIFIED (browser: "location verified") |
| Hand-over checklist with GPS check | browser GPS → `POST /dispatches/:id/complete` with position | assigned team, RC/A | far away → note required | VERIFIED (browser: 38 m, verified; tests: too far) |
| Recipient confirms receipt | `POST /requests/:id/confirm-receipt` | requester | twice → 409 | VERIFIED (browser, tests) |

## Operations screens

| Screen · action | Method & route / event | Roles | Error and empty handling | Status |
|---|---|---|---|---|
| Overview stats | `GET /dashboard/summary`, `/response-times`, `/resource-distribution` | RELIEF_COORDINATOR, ADMIN | error + retry; "no samples yet" | VERIFIED |
| Critical needs | `GET /dashboard/critical-needs` | coordinators, CAMP_MANAGER | empty state | VERIFIED |
| Request queue | `GET /requests?open|status&severity&category&search&sortBy=severity` | all staff (scoped server-side) | empty / error; pagination | VERIFIED |
| Verify / reject (+ severity override) | `POST /requests/:id/verify` | coordinators; CAMP_MANAGER (no override) | reason required | VERIFIED (browser) |
| Raise priority | `POST /requests/:id/escalate {severity, reason}` | coordinators | must be higher | VERIFIED (tests) |
| Find stock | `GET /allocations/suggestions?requestId=` | coordinators, INVENTORY_MANAGER | notes shown; empty → "no unreserved stock" | VERIFIED (browser) |
| Propose allocation | `POST /allocations` | coordinators | outstanding-quantity errors shown | VERIFIED (browser) |
| Approve / reject / release | `POST /allocations/:id/approve|reject|release` | coordinators; INVENTORY_MANAGER of the source location | `INSUFFICIENT_STOCK` / conflict shown | VERIFIED (browser; concurrency tests) |
| Assign team | `GET /teams`, `POST /dispatches` | coordinators | off-duty teams disabled | VERIFIED (browser) |
| Alerts list | `GET /alerts/active`, `GET /alerts?status=RESOLVED`, `GET /alerts/summary` | staff | empty / error | VERIFIED |
| Publish / acknowledge / escalate / resolve alert | `POST /alerts`, `/alerts/:id/acknowledge|escalate|resolve` | coordinators (ack also CAMP_MANAGER) | dialog errors; duplicate ack → 409 | VERIFIED (tests) |
| Inventory locations and stock | `GET /inventory/locations`, `GET /inventory` (staff view with balances), `GET /inventory/low-stock` | INVENTORY_MANAGER, coordinators | error + retry | VERIFIED |
| Record stock change | `POST /inventory/transactions` (RECEIPT, ADJUSTMENT, CONSUMPTION) | INVENTORY_MANAGER (assigned locations), ADMIN | `INSUFFICIENT_STOCK` explained | VERIFIED (tests) |
| Ledger | `GET /inventory/transactions` | INVENTORY_MANAGER, coordinators | empty | VERIFIED (tests) |
| New catalogue item | `POST /inventory/items` | INVENTORY_MANAGER, ADMIN | inline error | VERIFIED (tests) |
| Dispatch · accept / start | `POST /dispatches/:id/accept`, `/start` | assigned RESPONSE_TEAM (start also coordinators) | invalid transition → 409 shown | VERIFIED (browser) |
| Dispatch · ETA / "unknown" | `POST /dispatches/:id/eta {eta|null, reason}`; history `GET /dispatches/:id/tracking` | assigned team, coordinators | past / far-future ETA rejected | VERIFIED (browser; tests) |
| Dispatch · share position | browser Geolocation (on click) → `PATCH /dispatches/:id/location` | assigned team | denial message | PARTIAL (API tested; browser GPS not exercised headless) |
| Dispatch · hand-over (partial / final) | `POST /dispatches/:id/complete {lines, final}` | assigned team, coordinators | quantity > remaining blocked | VERIFIED (tests; seed run) |
| Dispatch · cannot complete / cancel | `POST /dispatches/:id/fail`, `/cancel` | team or coordinators / coordinators | reason required | VERIFIED (tests) |
| Teams and positions | `GET /teams`, `PATCH /teams/:id/availability`, `GET /map/teams` | staff / team or coordinators | "no position shared" | VERIFIED (tests) |
| Admin · users and roles | `GET /users`, `PATCH /users/:id/role` | ADMIN | reason required; audited | VERIFIED (tests) |
| Admin · zones and locations | `GET/POST/PATCH /disaster-zones`, `GET/POST /locations` | ADMIN (zones also coordinators via API) | inline errors | PARTIAL (API tested; admin UI form not browser-tested) |
| Admin · severity rules | `GET/POST/PATCH /escalation-rules` | coordinators, ADMIN | validator message shown | PARTIAL (API tested) |
| Admin · audit log | `GET /audit-logs` | ADMIN | pagination | PARTIAL (API tested) |

## Not available in this build

| Capability | Why | What the UI does |
|---|---|---|
| Road distance, travel time, route ETA | No routing provider ships (`GET /routes/estimate` → `available:false`) | Shows straight-line distance only, clearly labelled |
| Email / SMS delivery | Only a `console` development adapter exists | Preferences are saved; settings text says delivery needs a configured provider |
| Official external alert feeds | None configured | Disaster updates page says so and shows each item's source |
| File uploads for attachments | Backend stores attachment metadata only | Wizard does not offer uploads |
| Coordinator UI for zones and rules | Admin screen only; coordinators can use the API | — |

## Contract adjustments made during integration

4. (v1.1) Requesters now receive the team's exact position while their dispatch is on the road
   (`location.sharedWithRequester`). Previously they only got the approximate distance. Tests and docs were updated.

1. `POST /auth/refresh` got its own rate limit (300 per 15 min). It runs on every page load to restore the
   session, so the strict login limit (20 per 15 min) was signing out users who reload often. Found by the
   browser run (HTTP 429).
2. Frontend client: refresh-and-retry now skips only the credential endpoints. `/auth/me` with an expired
   access token correctly refreshes. Found by a unit test.
3. Embedded PostgreSQL is initialised as UTF-8 (`--encoding=UTF8`). Windows defaulted to WIN1252, which
   rejected characters such as "→". Found by the seed run.
