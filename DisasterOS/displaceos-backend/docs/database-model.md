# Database model

Schema: `prisma/schema.prisma`. Migration: `prisma/migrations/*_init/migration.sql` (Prisma DDL plus hand-written
CHECK constraints). All ids are UUIDs, all timestamps are `timestamptz` (UTC). Quantities are integers in the
item's declared `unit`.

## Entities

| Area | Models |
|---|---|
| Identity | `User`, `RefreshSession` (HMAC token hash, family id for rotation/reuse detection), `UserLocationAssignment` (camps for CAMP_MANAGER, stock sites for INVENTORY_MANAGER) |
| Places | `DisasterZone` (hazard, status, severity, optional centre/radius, `source`, `sourceUrl`, `isVerified`), `Location` (type, optional coordinates) |
| Requests | `ReliefRequest` (reference code, status, `suggestedSeverity`, effective `severity`, `severityReason`, verification and cancellation fields), `RequestItem` (quantity, `deliveredQuantity`), `RequestAttachment` (metadata only), `RequestTimelineEvent` (append-only, `isPublic`) |
| Alerts | `Alert` (severity, status, source, escalation level, resolution), `AlertAcknowledgement` (unique per alert+user), `EscalationRule` (JSON conditions → severity) |
| Inventory | `InventoryItem` (SKU, category, unit, low-stock threshold), `InventoryBalance` (per item × location: `onHand`, `reserved`, `lastCountedAt`), `InventoryTransaction` (signed ledger with after-balances and links to request/allocation/dispatch) |
| Allocation | `Allocation` (source location, status, proposer/approver), `AllocationLine` |
| Dispatch | `ResponseTeam`, `TeamMember`, `Dispatch` (status, position, current ETA), `DispatchLine` (planned vs delivered), `DispatchStatusEvent` (who/when/why for each transition), `DeliveryEvent` + `DeliveryEventLine`, `EtaHistory` (append-only) |
| Messaging & audit | `Notification` (channel, status PENDING/SENT/FAILED/SKIPPED, error), `NotificationPreference`, `AuditLog` (actor, action, entity, before/after JSON, ip, requestId), `PublicTrackingToken` (SHA-256 hash, expiry, revocation) |

Indexes cover status, severity, `createdAt`, foreign keys and common filters (see `@@index` lines in the schema).

## Status machines

- **ReliefRequest**: `SUBMITTED → VERIFIED | REJECTED | CANCELLED`; after verification the status is recomputed
  from allocations/dispatches/deliveries (`timeline.service.js#recomputeRequestStatus`):
  `VERIFIED → ALLOCATED → DISPATCHED → PARTIALLY_DELIVERED → DELIVERED`.
- **Allocation**: `PROPOSED → APPROVED → DISPATCHED → FULFILLED`; `PROPOSED → REJECTED`; `APPROVED → RELEASED`.
  A cancelled dispatch returns its allocation to `APPROVED` (reservation kept); a failed dispatch releases it.
- **Dispatch**: `CREATED → ASSIGNED → ACCEPTED → IN_TRANSIT → PARTIALLY_DELIVERED → DELIVERED`;
  `FAILED` from ASSIGNED/ACCEPTED/IN_TRANSIT/PARTIALLY_DELIVERED; `CANCELLED` from CREATED/ASSIGNED/ACCEPTED.
  Several dispatches may exist for one allocation over time (history is kept), but only one can be open.
- **Alert**: `ACTIVE ⇄ ACKNOWLEDGED → RESOLVED` (escalation sets ACTIVE again).

## Inventory invariants

```
onHand   >= 0
reserved >= 0
reserved <= onHand
available = onHand - reserved
```

Enforced twice:

1. **Application**: every change is one conditional SQL statement, e.g. reservation
   `UPDATE "InventoryBalance" SET reserved = reserved + n WHERE … AND "onHand" - reserved >= n RETURNING …`.
   Zero rows → `INSUFFICIENT_STOCK` and the surrounding transaction rolls back. PostgreSQL re-checks the `WHERE`
   clause after waiting on a concurrent row lock, so two approvals cannot both reserve the last units.
2. **Database CHECK constraints** (in the init migration): `inventory_balance_onhand_nonneg`,
   `inventory_balance_reserved_nonneg`, `inventory_balance_reserved_le_onhand`, plus positive-quantity checks on
   `RequestItem`, `AllocationLine`, `DispatchLine` (`deliveredQuantity <= quantity`) and `DeliveryEventLine`.

Ledger semantics (`InventoryTransaction.quantity` is signed):

| Type | Changes | Produced by |
|---|---|---|
| RECEIPT | onHand + | manual (IM/A); sets `lastCountedAt` |
| ADJUSTMENT | onHand ± (never below reserved) | manual; sets `lastCountedAt` |
| CONSUMPTION | onHand − (from available, or from reserved on delivery) | manual walk-in distribution; dispatch delivery |
| RESERVATION | reserved + | allocation approval |
| RELEASE | reserved − | allocation release, dispatch failure, close of a run with a shortfall |

Concurrency is covered by `tests/inventory-allocation.test.js` (two competing approvals; five parallel approvals
over 10 units; the same allocation approved three times in parallel).
