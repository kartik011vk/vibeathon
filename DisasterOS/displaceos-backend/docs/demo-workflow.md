# Demo workflow

All demo accounts are created by `npm run db:seed` and share the **development-only** password `DemoPass2026!`.
Never create these accounts in production.

| Account | Role | Scope |
|---|---|---|
| `admin@displaceos.dev` | ADMIN | everything |
| `coordinator@displaceos.dev` | RELIEF_COORDINATOR | all requests |
| `camp.manager@displaceos.dev` | CAMP_MANAGER | Raipur Relief Camp (demo) |
| `inventory@displaceos.dev` | INVENTORY_MANAGER | Central warehouse, Rishikesh point, Doiwala medical point, Mobile kitchen |
| `team.alpha@displaceos.dev` / `team.bravo@displaceos.dev` | RESPONSE_TEAM | Team Alpha / Team Bravo |
| `citizen@displaceos.dev`, `citizen2@displaceos.dev` | CITIZEN | own requests |

The seed also creates two demo disaster zones, six locations (one deliberately without coordinates and one with a
stale stock count), 13 catalogue items with opening stock, two zone alerts and five requests in different states
(submitted RED, partly delivered with a live ETA, verified with a pending allocation, delivered, cancelled).

## Automated run

With the API running (`npm run dev`) and seeded:

```bash
npm run demo:workflow
```

It performs steps 3–11 below with real API calls and prints the evidence (reference code, alert, timeline,
stock ledger, 409 on duplicate approval, ETA history, delivered/remaining quantities, audit actions, dashboard
counts). It adds new records to the target database.

## Manual sequence (curl)

```bash
API=http://localhost:4000/api/v1
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"DemoPass2026!\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken'; }
```

1. **Start PostgreSQL and configure `.env`** — `npm run db:local` (separate terminal) or your own server; `cp .env.example .env` and fill in values.
2. **Migrate and seed** — `npm run db:migrate && npm run db:seed`, then `npm run dev`.
3. **Requester creates a request**
   ```bash
   CIT=$(login citizen@displaceos.dev)
   curl -s "$API/locations?type=CAMP"                      # pick a campId
   curl -s "$API/inventory?category=WATER"                 # pick an inventoryItemId
   curl -s -X POST $API/requests -H "authorization: Bearer $CIT" -H 'content-type: application/json' \
     -d '{"category":"WATER","description":"Water for a family block","peopleAffected":30,"vulnerableCount":6,"campId":"<campId>","items":[{"inventoryItemId":"<itemId>","quantity":12}]}'
   ```
   The response has `referenceCode`, `status: SUBMITTED` and a server-suggested `severity` (RED inside the active demo flood zone).
4. **Coordinator verifies/escalates; inspect alert and timeline**
   ```bash
   CO=$(login coordinator@displaceos.dev)
   curl -s -X POST $API/requests/<id>/verify -H "authorization: Bearer $CO" -H 'content-type: application/json' \
     -d '{"decision":"VERIFY","reason":"Confirmed with camp desk"}'
   curl -s "$API/alerts?requestId=<id>" -H "authorization: Bearer $CO"
   curl -s "$API/requests/<id>/timeline" -H "authorization: Bearer $CO"
   # optional: {"severity":"HYPER_RED","reason":"..."} to POST /requests/<id>/escalate
   ```
5. **Inventory manager checks and adds stock**
   ```bash
   INV=$(login inventory@displaceos.dev)
   curl -s "$API/inventory/availability?itemId=<itemId>"
   curl -s -X POST $API/inventory/transactions -H "authorization: Bearer $INV" -H 'content-type: application/json' \
     -d '{"type":"RECEIPT","itemId":"<itemId>","locationId":"<warehouseId>","quantity":20,"reason":"Tanker delivery"}'
   ```
6. **Allocate without overselling**
   ```bash
   curl -s "$API/allocations/suggestions?requestId=<id>" -H "authorization: Bearer $CO"
   curl -s -X POST $API/allocations -H "authorization: Bearer $CO" -H 'content-type: application/json' \
     -d '{"requestId":"<id>","sourceLocationId":"<locationId>","lines":[{"requestItemId":"<requestItemId>","quantity":12}]}'
   curl -s -X POST $API/allocations/<allocationId>/approve -H "authorization: Bearer $CO"   # 200
   curl -s -X POST $API/allocations/<allocationId>/approve -H "authorization: Bearer $CO"   # 409 CONFLICT
   ```
7. **Dispatch to a team**
   ```bash
   curl -s $API/teams -H "authorization: Bearer $CO"
   curl -s -X POST $API/dispatches -H "authorization: Bearer $CO" -H 'content-type: application/json' \
     -d '{"allocationId":"<allocationId>","teamId":"<teamBravoId>"}'
   ```
8. **Team accepts, starts, adds ETA and location**
   ```bash
   TB=$(login team.bravo@displaceos.dev)
   curl -s -X POST $API/dispatches/<dispatchId>/accept -H "authorization: Bearer $TB"
   curl -s -X POST $API/dispatches/<dispatchId>/start  -H "authorization: Bearer $TB"
   curl -s -X POST $API/dispatches/<dispatchId>/eta -H "authorization: Bearer $TB" -H 'content-type: application/json' \
     -d '{"eta":"2030-01-01T10:00:00Z","reason":"Driver estimate"}'     # must be in the future, within 14 days
   curl -s -X PATCH $API/dispatches/<dispatchId>/location -H "authorization: Bearer $TB" -H 'content-type: application/json' \
     -d '{"latitude":30.25,"longitude":78.15}'
   ```
9. **Requester tracking and ETA history**
   ```bash
   curl -s $API/requests/<id>/tracking -H "authorization: Bearer $CIT"          # exact team position only while IN_TRANSIT
   curl -s $API/dispatches/<dispatchId>/tracking -H "authorization: Bearer $CO"  # etaHistory[]
   ```
10. **Partial delivery, then complete (or fail)**
    ```bash
    curl -s -X POST $API/dispatches/<dispatchId>/complete -H "authorization: Bearer $TB" -H 'content-type: application/json' \
      -d '{"lines":[{"dispatchLineId":"<lineId>","quantity":6}],"notes":"First drop"}'     # PARTIALLY_DELIVERED
    curl -s -X POST $API/dispatches/<dispatchId>/complete -H "authorization: Bearer $TB" -H 'content-type: application/json' \
      -d '{"lines":[{"dispatchLineId":"<lineId>","quantity":6}]}'                         # DELIVERED
    # or: POST /dispatches/<dispatchId>/fail {"reason":"Vehicle breakdown"} → stock released
    ```
11. **Notifications, audit, dashboard**
    ```bash
    curl -s $API/notifications -H "authorization: Bearer $CIT"
    curl -s "$API/audit-logs?entityId=<dispatchId>" -H "authorization: Bearer $(login admin@displaceos.dev)"
    curl -s $API/dashboard/summary -H "authorization: Bearer $CO"
    ```
12. **Automated tests** — `npm test`.

## Last verified run

`npm run demo:workflow` was run against a seeded database on 2026-10-23 and completed all steps: request created
as RED (SYSTEM_RULE alert), verified, stock received, allocation approved (second approval → 409 CONFLICT),
dispatched to Team Bravo, manual ETA recorded, requester tracking showed the ETA without the team's coordinates,
6/12 then 12/12 delivered, request "Delivered", seven dispatch audit actions recorded.
