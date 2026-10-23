# DisplaceOS frontend

The DisplaceOS website: request essential supplies, find nearby help, follow disaster updates and track
deliveries, plus role-specific operations screens for camp managers, relief coordinators, inventory managers,
response teams and administrators.

Stack: React 19 · Vite 6 · React Router 7 · TanStack Query · Three.js via React Three Fiber (3D Earth) ·
Leaflet + OpenStreetMap (street maps) · Socket.IO client · lucide icons · Vitest + Testing Library. JavaScript only.

## Run

The backend must be running first (see `../displaceos-backend/README.md`, or `npm run dev` from the project root).

```bash
npm install
cp .env.example .env     # defaults work for local development
npm run dev              # http://localhost:5173
npm test                 # 36 tests
npm run build            # production bundle in dist/
```

In development Vite proxies `/api` and `/socket.io` to `VITE_DEV_PROXY_TARGET` (default `http://localhost:4000`),
so the browser sees a single origin and the httpOnly refresh cookie works without cross-site setup.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | REST base URL |
| `VITE_SOCKET_URL` | current origin | Socket.IO origin |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:4000` | Dev proxy target |

Every `VITE_` variable is public. No secrets belong in this project.

## Structure

```
src/api/            client.js (envelope, errors, token refresh) · services.js (one function per backend route)
src/app/            AuthContext (session restore via refresh cookie) · SocketContext (events → refetch) · Toast
src/components/     ui/ (states, badges, dialogs) · layout/ · globe/ (3D Earth + 2D fallback) · map/ (Leaflet)
src/features/       home · auth · requests · resources · disaster · tracking · ops · inventory · dispatch · admin · notifications
src/lib/            labels for backend enums, date/distance formatting, geo helpers
src/test/           Vitest suites
```

## Design decisions

- **Palette**: warm orange `#DD6F25`, amber `#F4AE37`, brown `#663E23`, cream `#FFF9ED`, pale yellow `#FFEFCF`,
  charcoal `#2D221B`; no blue or green anywhere. Primary buttons use a deeper orange (`#C2561A`) so white text
  meets WCAG AA contrast. Map tiles are passed through a warm sepia filter.
- **3D Earth**: a real WebGL sphere. Its texture is painted at runtime from Natural Earth country polygons
  (`world-atlas`), so the geography is genuine and stays in the warm palette. It rotates slowly, can be dragged,
  and focuses on a marker when selected. Zoom uses buttons, pinch or Ctrl/⌘ + scroll — a plain wheel always scrolls the page. Nearby markers are
  clustered so they stay clickable. The globe is lazy-loaded; a 2D SVG map of the same data is used when WebGL
  is missing, when the user prefers reduced motion, or on request. Every place is also listed as plain links.
- **Map-app labels on the globe**: country borders and coastlines are vector lines (crisp at any zoom). State and
  province lines load lazily once you zoom in. Labels are pooled DOM elements projected every other frame, with
  level of detail by camera distance, horizon culling and collision avoidance. Data lives in `src/data/`;
  see `scripts/geodata/README.md` for how it is generated from Natural Earth.
- **Responders and donors**: `/join-responder` (separate sign-up with admin and lead approval), `/organization`,
  `/ops/needs` (open needs and offers), `/donate`, `/donations`, `/ops/donations`. Teams share live location with
  `useLiveLocation` (watchPosition, at most every 15 s). Requesters see the live map only while the backend marks
  `location.sharedWithRequester`.
- **Live India alerts**: `src/features/hazards/LiveIndiaFeed.jsx` (Disaster updates page, globe markers, home strip)
  and `HazardPopup` (global; shows each new high-impact event once, dismissals kept in localStorage).
- **SOS**: `SosAlertLayer` (in the layout) polls `/sos/active` every 15 s and is refreshed instantly by
  `sos:created` / `sos:updated` socket events. It shows a full-screen red alert (vibration on phones) plus a sticky
  strip. Responders get the exact location, message, contact and "I'm responding"; everyone else gets the area and
  112. Pages: `/sos` (send), `/sos/:id` (status), `/ops/sos` (board).
- **Hand-over checklist**: responders tick items; the dialog reads the phone position and shows whether it is within
  300 m (+ accuracy) of the delivery point before saving. Requesters confirm receipt from the request page.
- **Honesty rules**: availability comes only from recorded stock. Stale counts read "Availability not confirmed".
  Distance appears only when both points have coordinates, labelled "straight-line". The ETA appears only when a
  team has entered one, labelled as an estimate. Nothing falls back to placeholder data when a request fails.
- **Location**: browser GPS is requested only when the user presses a button, with an explanation and a manual
  (map pin / coordinates / camp list) fallback.
- **Security**: the access token is kept in memory only; the refresh token is an httpOnly cookie. Hiding buttons
  is for convenience; the backend enforces every permission and scope.

## Tests (`npm test`)

API client envelope/error/refresh handling; distance and label rules; globe marker clustering and focus maths;
request wizard (exact backend payload, no client severity, reference only after success, error without success,
validation); GPS denied → manual fallback; availability statuses and "Distance unavailable"; tracking with ETA
unavailable / estimate, delivered vs remaining; role gating and requester view without staff panels.
