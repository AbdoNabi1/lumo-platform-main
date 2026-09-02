# Sprint A0 — Preconditions — Implementation Report

**Status:** Complete. Implements the prerequisite-infrastructure subset of Wave 1 identified in
`IMPLEMENTATION_DEPENDENCY_GRAPH.md`, scoped down per explicit user direction to exclude Payment
Truth (all A1 items), the Purchase Saga, PSP/notification adapters, and any runtime/route/event-
contract/business-logic change. Does **not** start Sprint A1. Waiting for approval before any
further sprint begins.

**Inputs:** `ARCHITECTURE_REMEDIATION_PLAN.md`, `ARCHITECTURE_EXECUTION_MATRIX.md`,
`IMPLEMENTATION_DEPENDENCY_GRAPH.md`, `PRODUCTION_CUTOVER_PLAN.md` (none of these name a sprint
"A0" — the label and its exact scope were supplied by the user in this session and confirmed via
an explicit scoping question before any code was written).

---

## 1. Scope (as confirmed)

**In scope:**

1. **A6a — opt-in atomic consumer idempotency.** An additive `handleAtomic(event, tx)` capability
   on `EventHandler`, wired through `EventConsumer` and `KafkaConsumerRuntime`, reusing the
   already-existing `TransactionalUnitOfWork` port (`@platform/repository`) and `PrismaUnitOfWork`
   (`@platform/db`) rather than inventing a new abstraction.
2. **Three additive database migrations + unique constraints** (Reservation, PaymentIntent,
   Shipment), hand-authored as `migration.sql` per this repo's established offline-migration
   convention (no live database host in this environment).
3. **Repository scaffolding** — three new read-path lookup methods, dormant until a later sprint
   threads business logic through them.
4. Tests and this report.

**Explicitly excluded (per user direction):** all A1 (Payment Truth) items, the Purchase Saga
(`apps/runtime/src/purchase-saga-activities.ts` and everything under `apps/runtime/src/purchase/`),
PSP adapters, notification adapters, any HTTP route/controller change, any event-contract/payload
change, any business-logic change, `apps/runtime/src/composition.ts` (no consumer opts into
`handleAtomic` this sprint, so there is nothing to wire there yet).

---

## 2. Files changed, and why

### A6a — opt-in atomic idempotency capability

| File                                                                          | Change                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/messaging/src/consumer/event-handler.ts`                            | Added optional `handleAtomic?(event, tx: TContext): Promise<void>` to `EventHandler<TPayload, TContext = unknown>`                                                                                                                              | The capability itself. Optional + defaulted generic ⇒ existing 17 handler implementations (which only define `handle`) are structurally unaffected — matches the execution matrix's explicit "opt-in, not blanket" correction for A6a.                                             |
| `packages/messaging/src/idempotency/duplicate-processed-event-error.ts` (new) | `DuplicateProcessedEventError`                                                                                                                                                                                                                  | Thrown inside the atomic transaction when `recordIfNew` loses the insert race, so the whole transaction (handler's domain write + marker) rolls back together instead of leaving a half-applied effect. Shared by both runtimes below — built once, not duplicated.                |
| `packages/messaging/src/consumer/event-consumer.ts`                           | `EventConsumerDeps<TContext>` gains optional `unitOfWork?: TransactionalUnitOfWork<TContext>`; `EventConsumer<TPayload, TContext>` branches to a new private `consumeAtomic` when both `handler.handleAtomic` and `deps.unitOfWork` are present | The in-process consumer runtime (used directly by tests and any non-Kafka transport). Non-atomic path is byte-for-byte unchanged.                                                                                                                                                  |
| `packages/messaging/src/index.ts`                                             | Export `DuplicateProcessedEventError`                                                                                                                                                                                                           | Needed by `packages/kafka`, which reuses it rather than redefining it.                                                                                                                                                                                                             |
| `packages/messaging/package.json`                                             | Added `@platform/repository` dependency                                                                                                                                                                                                         | `TransactionalUnitOfWork` lives there. Confirmed zero-cycle: `@platform/repository` depends only on `@platform/types`, and `.dependency-cruiser.cjs`'s `messaging-no-application-no-infra` rule does not forbid this edge (repository is a ports-only leaf, not an infra adapter). |
| `packages/kafka/src/consumer-runtime.ts`                                      | Same shape of change as `event-consumer.ts`, applied to `KafkaConsumerRuntime.handleMessage` (the production broker-facing runtime)                                                                                                             | This is the runtime that actually serves the 17 live consumers in production; the capability must exist here for it to matter.                                                                                                                                                     |
| `packages/kafka/package.json`                                                 | Added `@platform/repository` dependency                                                                                                                                                                                                         | Same reasoning as messaging's.                                                                                                                                                                                                                                                     |

**Explicitly not touched:** none of the 17 existing `EventHandler` implementations (Orders,
Fulfillment, Finance, Notifications, Tracking, Security). Confirmed via new regression tests (§3)
that the four handlers making external network calls with no DB write to make atomic — Tracking's
ingest handler and Security's Keto/Kratos consumers — do not implement `handleAtomic`.

### Migrations + repository scaffolding

| File                                                                                              | Change                                                                                                     | Why                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema/inventory.prisma`                                                      | `Reservation` gains `@@unique([tenantId, itemId, reference])`                                              | A3 precondition (dependency graph: "new unique constraint on `Reservation`"). Existing columns — **requires the pre-migration audit in §4 before deploy**.              |
| `packages/db/prisma/schema/payments.prisma`                                                       | `PaymentIntent` gains nullable `idempotencyKey` column + `@@unique([tenantId, idempotencyKey])`            | A3 precondition ("new unique constraint on `PaymentIntent`"). New column, safe by construction (see §4).                                                                |
| `packages/db/prisma/schema/shipping.prisma`                                                       | `Shipment` gains nullable `idempotencyKey` column + `@@unique([tenantId, fulfillmentRef, idempotencyKey])` | A8 precondition ("unique constraint `(tenantId, fulfillmentRef, idempotencyKey)`"). Same NULL-safety.                                                                   |
| `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql` (new) | Hand-authored SQL for the three changes above                                                              | Matches this repo's established convention (no live DB host in this environment; every prior migration since `20260704000000_init` was generated offline the same way). |
| `services/inventory/src/domain/inventory-item-repository.ts`                                      | Added `findByReservationReference(itemId, reference, tx?)` to the port                                     | Repository support A3 will call once it threads dedup-key semantics through `ReserveStock`.                                                                             |
| `services/inventory/src/infrastructure/prisma-inventory-item-repository.ts`                       | Implemented the method above                                                                               | —                                                                                                                                                                       |
| `services/inventory/src/infrastructure/in-memory-inventory-item-repository.ts`                    | Implemented the method above                                                                               | —                                                                                                                                                                       |
| `services/payments/src/domain/payment-intent-repository.ts`                                       | Added `findByIdempotencyKey(idempotencyKey, tx?)` to the port                                              | Repository support A3 will call once `PaymentIntent`/`CreatePaymentIntent` carry the field.                                                                             |
| `services/payments/src/infrastructure/prisma-payment-intent-repository.ts`                        | Implemented the method above (queries the new column; reuses the existing row→domain mapper unchanged)     | —                                                                                                                                                                       |
| `services/payments/src/infrastructure/in-memory-payment-intent-repository.ts`                     | Implemented the method above (always returns `null` — documented as dormant)                               | The domain aggregate carries no such field yet; deliberately not added in this sprint (business-logic change, out of scope).                                            |
| `services/shipping/src/domain/shipment-repository.ts`                                             | Added `findByIdempotencyKey(fulfillmentRef, idempotencyKey, tx?)` to the port                              | Repository support A8 will call once `Shipment`/`CreateShipment` carry the field.                                                                                       |
| `services/shipping/src/infrastructure/prisma-shipment-repository.ts`                              | Implemented the method above                                                                               | —                                                                                                                                                                       |
| `services/shipping/src/infrastructure/in-memory-shipment-repository.ts`                           | Implemented the method above (always returns `null`, same reasoning as PaymentIntent's)                    | —                                                                                                                                                                       |

**None of `PaymentIntent`, `Shipment`, or their `save()`/create write-paths were modified.** The new
columns are written by nothing today (all rows NULL) and the new lookup methods are unreachable
from any use case — proven dormant, not just claimed, in the tests below.

### Tests (new files)

- `packages/messaging/src/consumer/event-consumer.test.ts` — 3 new cases: non-opted-in handlers
  unaffected; `handleAtomic` + `recordIfNew` share one transaction (asserted via tx-object
  identity); a lost `recordIfNew` race rolls back cleanly (no dead-letter, no retry, logged as a
  benign duplicate).
- `packages/kafka/src/consumer-runtime.test.ts` (new) — the same three cases against
  `KafkaConsumerRuntime.handleMessage` directly (no broker needed — `handleMessage` never touches
  `deps.kafka`).
- `services/security/src/interfaces/relation-sync.consumer.test.ts` (new),
  `services/security/src/interfaces/session-revoked-all.consumer.test.ts` (new),
  `apps/runtime/src/tracking/tracking-ingest-atomic-opt-out.test.ts` (new) — structural regression
  tests confirming `RelationWrittenConsumer`, `RelationDeletedConsumer`, `SessionRevokedAllConsumer`,
  `TrackingIngestHandler` do **not** implement `handleAtomic`. This is the exact regression test the
  execution matrix calls for ("a future refactor can't accidentally regress this").
- `services/inventory/src/infrastructure/find-by-reservation-reference.test.ts` (new),
  `services/payments/src/infrastructure/find-by-idempotency-key.test.ts` (new),
  `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts` (new) — prove the three
  new repository methods behave correctly (and, for Payments/Shipping, prove they are dormant —
  always `null` — today).

---

## 3. Downstream-sprint verification

- **A1 (Payment Truth):** untouched. `Order`, `order-lifecycle.use-cases.ts`,
  `payment-captured.consumer.ts`, and every admin route are unmodified.
- **Purchase Saga:** untouched. `apps/runtime/src/purchase-saga-activities.ts` and
  `apps/runtime/src/purchase/*` are unmodified; `apps/runtime/src/composition.ts` is unmodified
  (no consumer opts into `handleAtomic`, so there is nothing to wire there yet — this is
  deliberate, see §1).
- **A4 (PSP adapter) / A7 (Notifications):** untouched. No composition-root file for
  Payments/Fulfillment/Returns/Notifications was edited.
- **A3 (saga-activity idempotency):** unblocked, not started. The two migrations + two repository
  methods it needs now exist; A3 still owns threading `idempotencyKey`/dedup semantics through
  `PaymentIntent`, `Reservation` creation, and the saga activities themselves.
- **A8 (Shipping idempotency):** unblocked, not started. Same relationship — migration + repository
  method exist; A8 still owns `CreateShipment`'s actual dedup check and the admin-route
  reconciliation.
- **A5a–e (Postgres-backed webhook stores):** unblocked, not started. A6a's capability is the hard
  predecessor the dependency graph requires before any of the five ship; it now exists.
- **A6b-i (Finance refund consumer), A7a-ii (notifications worker):** both list A6a as an optional
  "build atomic from day one" predecessor. Available; neither started.

No downstream sprint's scope was narrowed, widened, or reinterpreted by this work — every new
surface (the `handleAtomic` capability, the three lookup methods, the two new columns) is exactly
what the dependency graph/cutover plan already specified as needed, nothing more.

---

## 4. Migration notes

**File:** `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`

All three changes are additive (expand-only, per `MIGRATIONS.md`'s expand→migrate→contract
discipline). Hand-authored offline — this environment has no reachable Postgres host — following
the same convention every prior migration in this repo uses. Apply with `prisma migrate deploy`
against Postgres 16.

### Step 1 — Reservation unique constraint (`(tenant_id, item_id, reference)`)

**This step requires a pre-migration audit before it is safe to apply.** These are existing,
already-populated columns; if the very bug A3 will fix has already produced duplicate reservation
rows in production, the `CREATE UNIQUE INDEX` will fail outright. Run this query against the
target database **before** applying the migration:

```sql
SELECT tenant_id, item_id, reference, COUNT(*) AS duplicate_count
FROM inventory.reservations
GROUP BY tenant_id, item_id, reference
HAVING COUNT(*) > 1;
```

- **If zero rows returned:** the migration is safe to apply as-is.
- **If rows are returned:** each represents an already-happened duplicate-reservation incident from
  the pre-fix bug. Resolve manually (decide which row is authoritative, per Inventory's own stock
  reconciliation process) before applying the constraint — do not delete rows programmatically
  without an inventory-owner decision, since removing a live reservation row also needs a
  corresponding stock-level correction.

### Step 2 — PaymentIntent (`idempotency_key` + unique `(tenant_id, idempotency_key)`)

Safe to apply without an audit: the column is new, every existing row is NULL after the
`ALTER TABLE`, and Postgres unique indexes treat every NULL as distinct — no pre-existing row can
violate this constraint.

### Step 3 — Shipment (`idempotency_key` + unique `(tenant_id, fulfillment_ref, idempotency_key)`)

Same NULL-safety reasoning as Step 2.

**Ordering:** the three steps have no dependency on each other and may be split across separate
migration windows if preferred; they are combined in one file here because none of them touches a
table another step also touches.

---

## 5. Quality gate results

Scope: `@platform/messaging`, `@platform/kafka`, `@platform/db`, `@platform/inventory`,
`@platform/payments`, `@platform/shipping`, `@platform/security`, `@platform/runtime` (every
package this sprint touched, plus the two apps whose tests exercise the new consumer regression
checks).

| Gate                                                                                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --no-frozen-lockfile` (picks up the two new `@platform/repository` deps) | ✅ Green. Lockfile passes supply-chain policy. `prisma generate` regenerated the client from the updated schema.                                                                                                                                                                                                                                                                                                                                                                                      |
| `typecheck` (all 8 packages)                                                           | ✅ Green, no errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `test` (all 8 packages)                                                                | ✅ Green. `messaging` 19/19, `kafka` 8/9 (+1 skipped — the existing live-broker integration test, honestly gated, unrelated to this sprint), `inventory` all passing (incl. new test), `payments` all passing (incl. new test), `shipping` all passing (incl. new test), `security` 31/34 passing +3 pre-existing skips, `runtime` 174/174 passing.                                                                                                                                                   |
| `arch` (dependency-cruiser, full repo)                                                 | ✅ Green. "no dependency violations found (1527 modules, 6966 dependencies cruised)" — confirms the two new `messaging`/`kafka` → `@platform/repository` edges introduce no cycle and no layering violation.                                                                                                                                                                                                                                                                                          |
| `lint`                                                                                 | ✅ Green on every file this sprint added or edited. Two **pre-existing** failures found, both confirmed via `git status` to predate this session and to lie outside files this sprint touches: `services/payments/src/composition.ts` (a modified-but-uncommitted file from earlier work) and `apps/runtime/src/purchase/purchase-saga-routes.test.ts` (an untracked file from earlier work, inside the Purchase Saga area this sprint is explicitly barred from touching). Not fixed — out of scope. |
| `build`                                                                                | N/A — no package this sprint touched defines a `build` script; this monorepo's library packages are validated via `typecheck`, not a separate bundle step.                                                                                                                                                                                                                                                                                                                                            |

---

## 6. Deployment notes

1. Run the Step 1 audit query (§4) against production Postgres. Resolve any duplicates found.
2. Apply `20260726000000_sprint_a0_preconditions` via `prisma migrate deploy`. Expand-only; no app
   code depends on the new columns/constraint yet, so this can deploy independently of any code
   release, ahead of it.
3. Deploy the application code (the `handleAtomic` capability + repository scaffolding). Fully
   backward compatible — no consumer opts in, no use case calls the new repository methods, so
   this is a no-behavior-change deploy. Safe to ship in the same release as step 2's migration or a
   separate one.
4. No feature flag needed (unlike A1-ii/A4b/A4c, which the cutover plan flags as flag-gated) — this
   sprint ships no code path that is ever exercised by production traffic yet.
5. No sequencing dependency on any other in-flight work: this sprint is off Wave 1's own critical
   path items (A1-i) and does not touch any file the dependency graph's contention matrix lists as
   heavily shared.

---

## 7. Rollback notes

- **Application code:** trivial revert. Nothing calls the new capability or the new repository
  methods, so reverting the code changes has zero runtime effect on anything currently deployed.
- **Migration:** each of the three changes can be rolled back independently and safely, since
  nothing depends on them yet:
  - Reservation: `DROP INDEX "inventory"."reservations_tenant_id_item_id_reference_key";`
  - PaymentIntent: `DROP INDEX "payments"."payment_intents_tenant_id_idempotency_key_key"; ALTER TABLE "payments"."payment_intents" DROP COLUMN "idempotency_key";`
  - Shipment: `DROP INDEX "shipping"."shipments_tenant_id_fulfillment_ref_idempotency_key_key"; ALTER TABLE "shipping"."shipments" DROP COLUMN "idempotency_key";`
- **No data-loss risk on rollback:** the new columns are nullable and unwritten; dropping them
  discards nothing. The Reservation unique index, once applied cleanly (post-audit), only rejects
  future duplicate inserts — dropping it just removes that guard, it does not touch existing rows.

---

## 8. Next step

Sprint A1 has **not** been started, per instruction. Waiting for approval before proceeding.
