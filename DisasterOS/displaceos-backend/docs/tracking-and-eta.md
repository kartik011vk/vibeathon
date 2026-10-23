# Tracking and ETA

## What a requester sees — `GET /requests/:id/tracking`

```jsonc
{
  "request": { "referenceCode": "DR-7K3F9Q", "status": "PARTIALLY_DELIVERED", "statusLabel": "Partly delivered", "verified": true, … },
  "items": [{ "name": "Dry ration kit", "unit": "kits", "requested": 10, "delivered": 6, "remaining": 4,
              "reservedNotYetDispatched": 0, "onTheWay": 4 }],
  "totals": { "requested": 14, "delivered": 6, "remaining": 8 },
  "allocationProgress": { "approved": 1 },
  "dispatches": [{ "status": "PARTIALLY_DELIVERED", "team": { "name": "Team Alpha" },
                   "location": { "available": true, "stale": false, "updatedAt": "…",
                                 "approxDistanceToDestinationKm": 7.3, "distanceBasis": "STRAIGHT_LINE" },
                   "eta": { … }, "lines": [ … ] }],
  "eta": { "etaAvailable": true, "eta": "…", "etaSource": "MANUAL", "etaUpdatedAt": "…", "delayStatus": "ON_TRACK",
           "disclaimer": "Estimated time only. It is not a guarantee of arrival." },
  "lastUpdatedAt": "…",
  "timeline": [ … public events … ],
  "disclaimer": "Arrival times are estimates and may change. DisplaceOS … is not an emergency rescue service …"
}
```

Coordinators, admins and the assigned team additionally get exact `latitude/longitude` of the dispatch.
`GET /dispatches/:id/tracking` adds `etaHistory[]` and `deliveries[]`.

Request status labels (plain language, no extra states): SUBMITTED "Request received — waiting to be checked",
VERIFIED "Checked — supplies being arranged", ALLOCATED "Supplies reserved for your request", DISPATCHED "A response
team has been assigned", PARTIALLY_DELIVERED "Partly delivered", DELIVERED "Delivered", REJECTED "Not approved",
CANCELLED "Cancelled".

## ETA rules

| Situation | Response |
|---|---|
| No open dispatch | `etaAvailable:false`, `reasonCode: NO_ACTIVE_DISPATCH` |
| Dispatch open, no ETA ever recorded | `etaAvailable:false`, `NO_ETA_RECORDED`, "No arrival estimate has been recorded yet" |
| Team/coordinator recorded `eta:null` with a reason | `etaAvailable:false`, `MARKED_UNAVAILABLE`, reason = recorded reason |
| ETA from a routing provider but team location older than `LOCATION_STALE_MINUTES` | `etaAvailable:false`, `LOCATION_STALE` |
| Dispatch DELIVERED / FAILED / CANCELLED | `etaAvailable:false`, `DISPATCH_CLOSED` |
| Valid ETA | `etaAvailable:true`, `etaSource`, `etaUpdatedAt`, `delayStatus` |

`delayStatus`: `ON_TRACK`; `DELAYED` when an update pushed the ETA later by more than
`ETA_DELAY_THRESHOLD_MINUTES` (default 15); `OVERDUE` when the ETA has passed and the dispatch is still open.
An earlier ETA (by more than the threshold) clears the delayed flag.

- **Manual ETA (MVP):** `POST /dispatches/:id/eta { "eta": "<ISO, future, ≤14 days>" | null, "reason": "…" }` by
  the assigned team or a coordinator.
- **History is append-only:** each change writes `EtaHistory { previousEta, newEta, available, source, provider,
  reason, distanceKm, actorId, createdAt }`.
- **Notifications:** the requester gets an in-app notification for the first ETA, a delay, a meaningful
  improvement, or ETA becoming unavailable. Delivery failure is recorded on the notification and never affects the
  dispatch.
- **Routing provider:** none ships. `src/adapters/index.js` documents the `estimate({from,to})` contract; when one
  is added, location updates will record `ROUTING_PROVIDER` estimates. `GET /routes/estimate` currently returns
  `{ available:false, configured:false }`. Map tiles alone never produce an ETA.
- The backend never fabricates GPS positions, routes or arrival times.

## Location

`PATCH /dispatches/:id/location { latitude, longitude }` (assigned team, ACCEPTED/IN_TRANSIT/PARTIALLY_DELIVERED)
updates the dispatch and team position. Positions older than `LOCATION_STALE_MINUTES` (default 30) are reported
with `stale:true`. Socket events for location changes carry no coordinates.

## Partial deliveries

`POST /dispatches/:id/complete { lines:[{dispatchLineId, quantity}], notes?, final? }`

- Each call creates a `DeliveryEvent`; quantities cannot exceed what remains on the line.
- Delivered units are consumed from the reserved stock (`CONSUMPTION`), and `RequestItem.deliveredQuantity` grows.
- All lines delivered → dispatch `DELIVERED`. `final:true` with a remainder closes the run as `DELIVERED`
  ("Delivery run finished: X of Y units handed over"), releases the undelivered remainder back to stock, and leaves
  the request `PARTIALLY_DELIVERED` so coordinators can allocate the rest.
- Otherwise the dispatch is `PARTIALLY_DELIVERED`.

## Public tracking links

`POST /requests/:id/tracking-tokens { ttlHours? }` (owner, camp manager in scope, coordinator) returns a 256-bit
token **once**; only its SHA-256 hash is stored. Default lifetime `PUBLIC_TRACKING_TOKEN_TTL_HOURS` (168), max 30 days.
`GET /tracking/:token` (rate limited) returns reference code, category, status label, item
requested/delivered/remaining, ETA availability/time/delay status, last update and public timeline messages — no
names, addresses, coordinates, phone numbers or team identities. Revoked or expired tokens return 404.
