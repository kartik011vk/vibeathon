# DisasterOS — the DisplaceOS relief coordination platform

DisplaceOS helps people get food, water, medicine and shelter during a disaster. Citizens request supplies and
track delivery. Camps, warehouses, coordinators and response teams verify each request, reserve stock, dispatch
teams and record what was actually handed over. Every step is stored in PostgreSQL and audited.

```
DisasterOS/
├── displaceos-backend/    Node.js · Express 5 · PostgreSQL · Prisma · Socket.IO · Zod · JWT   (REST API under /api/v1)
├── displaceos-frontend/   React 19 · Vite · Three.js 3D Earth · Leaflet maps · TanStack Query · Socket.IO client
├── docs/
│   └── integration-matrix.md   every screen action → real route/event, roles, error states, verification status
├── scripts/               setup.js (one-time setup) · dev.js (start everything)
└── package.json           convenience scripts for the whole project
```

## Run it (Windows, macOS or Linux)

Requirements: **Node.js 20.11 or newer** (tested on Node 24) and an internet connection for the first
`npm install`. PostgreSQL is **not** required: a real PostgreSQL 17 server ships in a development dependency
(`embedded-postgres`). The street-map tiles and fonts load from the internet; everything else works offline.

```bash
cd DisasterOS
npm run setup      # once: installs both apps, creates .env files with fresh secrets, migrates and seeds the demo data
npm run dev        # every time: starts PostgreSQL (port 5433), the API (4000) and the website (5173)
```

Open **http://localhost:5173**. API documentation (Swagger UI): **http://localhost:4000/api/docs**.

Using your own PostgreSQL instead: put its URLs in `displaceos-backend/.env` (`DATABASE_URL`,
`TEST_DATABASE_URL`, both UTF-8), then run `npm run setup -- --own-db` and `npm run dev -- --own-db`.

Manual start order, if you prefer separate terminals:

1. `cd displaceos-backend && npm run db:local` (leave it running)
2. `cd displaceos-backend && npm run db:migrate && npm run db:seed && npm run dev`
3. `cd displaceos-frontend && npm run dev`

## Demo accounts (development seed only)

Password for every account: `DemoPass2026!`. The login page has one-click buttons for these accounts in development builds.

| Email | Role | What to try |
|---|---|---|
| `citizen@displaceos.dev` | Citizen | Request supplies; track the part-delivered food request; share a tracking link |
| `coordinator@displaceos.dev` | Relief coordinator | Verify the waiting water request, find stock, approve, assign a team; alerts; dashboards |
| `camp.manager@displaceos.dev` | Camp manager (Raipur camp) | Requests for the camp; verify; acknowledge alerts |
| `inventory@displaceos.dev` | Inventory manager | Stock levels, record receipts and adjustments, approve the pending medicine allocation |
| `team.alpha@displaceos.dev` / `team.bravo@displaceos.dev` | Response team | Accept and start deliveries; set an ETA; record partial or full hand-over |
| `responder@displaceos.dev` | NGO lead (approved, Himalayan Aid Network) | Open needs board, offer to deliver, share live location, approve volunteers |
| `volunteer@displaceos.dev` | NGO member waiting for the lead | See the "waiting for your lead" state |
| `ngo.pending@displaceos.dev` | Organisation waiting for admin approval | See the pending state; approve it as admin |
| `donor@displaceos.dev` | Donor (citizen account) | One donation received into stock, one waiting for review; donate more |
| `admin@displaceos.dev` | Administrator | Approve responder organisations, users and roles, zones and locations, severity rules, audit log |

All seeded places and events are labelled "(demo)" and do not describe a real emergency. `npm run seed`
resets the database to this demo state.

## Tests

```bash
npm test                                   # backend (118 tests on a separate test database) then frontend (28 tests)
cd displaceos-backend && npm run lint      # syntax check
cd displaceos-frontend && npm run build    # production bundle
```

## What it does

**For people affected**
- Find help: real stock by camp or warehouse, labelled Available / Limited / Not available / Availability not
  confirmed. Distance is "approx. X km (straight-line)" and appears only when both points have coordinates.
- Request supplies: a guided four-step form. The location is a camp, browser GPS (asked only on click) or a
  map pin. The reference number is shown only after the server confirms the request.
- Track: a progress stepper, delivered and remaining quantities per item, an ETA only when a team has entered
  one (always labelled as an estimate), and a timeline of every step. A private link can be shared with family.
- Disaster updates: zones and public alerts with their source, verification flag and update time.

**For responders (rescue teams, NGOs, government)** — a separate account type
- "Join as a responder": register an organisation (an admin verifies it) or join one with the lead's join code
  (the lead approves each member). Only then does the account get responder powers.
- Open needs board: verified requests nobody is delivering yet, with what is needed, how many people, roughly
  where (about 1 km) and the straight-line distance. Teams press "Offer to deliver"; a coordinator assigns them.
- Live location: on the road, the team switches on "Share live location". The family who asked sees the team moving
  on a map until the delivery is recorded, then sharing stops.

**For donors**
- "Donate supplies": offer items for drop-off or collection. Staff accept the offer and say where to bring it.
  Supplies become stock only when an inventory manager counts them in. The donor follows every step and then sees
  deliveries made from that location.

**For relief staff**
- Severity is suggested by configurable server rules. Staff verify it or override it with a reason; RED and
  HYPER RED raise alerts.
- Explainable stock suggestions; allocations reserve stock atomically, so it can never be promised twice.
- Dispatch lifecycle (assigned → accepted → in transit → partly delivered → delivered, or failed/cancelled)
  with ETA history and stock reconciliation.
- Dashboards computed from the database, live updates over authenticated Socket.IO, and a full audit log.

**The 3D Earth, styled like a map app**: real country borders and coastlines (Natural Earth 1:50m), with state
and province borders fading in as you zoom. Place names follow your zoom: large countries from far away, then more
countries, capitals and cities. 7,342 places are included and labels never overlap. Zoom with + and −, pinch, or
Ctrl/⌘ + scroll; plain scrolling still moves the page. Search any city, country or camp to fly there. It shows camps,
supply points, disaster zones, your requests and (for coordinators) team positions. A flat map with country names is
used when WebGL is missing or reduced motion is preferred. Street maps use OpenStreetMap, which shows boundaries and
names by zoom level too.

## Honest limits

- No road routing, email or SMS provider is configured. The app says so instead of inventing routes or
  claiming messages were sent.
- DisplaceOS coordinates supplies. It is **not** an emergency rescue service; the UI points people to local
  emergency services (112 in India).
- Production deployment has not been performed. See `displaceos-backend/docs/deployment.md`.

More detail: `displaceos-backend/README.md`, `displaceos-backend/docs/*`, `displaceos-frontend/README.md`,
`docs/integration-matrix.md`.
