# Sprint A0 — Deferred Items

**Purpose:** Sprint A0 was reviewed and approved as a 4-file superset (see
`SPRINT_A0_ARCHITECTURE_REVIEW_PACK.md` and its appendix) that included Shipment-context work.
At commit time, 4 files plus one migration step could not be included in a commit scoped to
"Sprint A0 only" without either (a) dragging in a large amount of unrelated pre-existing
uncommitted work, or (b) committing a non-compiling fragment. This document records exactly what
was deferred, why, and confirms the deferral is safe.

---

## 1. What was deferred

| #   | File                                                                                        | Status                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `packages/db/prisma/schema/shipping.prisma`                                                 | Not committed                                                                                                                  |
| 2   | `services/shipping/src/domain/shipment-repository.ts`                                       | Not committed                                                                                                                  |
| 3   | `services/shipping/src/infrastructure/prisma-shipment-repository.ts`                        | Not committed                                                                                                                  |
| 4   | `services/shipping/src/infrastructure/in-memory-shipment-repository.ts`                     | Not committed                                                                                                                  |
| 5   | `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts`                      | Not committed (depends on #4)                                                                                                  |
| 6   | `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql` | Committed with only Steps 1–2 (Reservation, PaymentIntent); Step 3 (Shipment) is not part of this commit's version of the file |

All 6 items remain present and unchanged **in the working tree** — nothing was deleted or reverted.
They are simply not part of this commit's index.

---

## 2. Per-item detail

### `packages/db/prisma/schema/shipping.prisma`

**Sprint A0's hunk (could not be isolated):**

```diff
   attempts         Json      @default("[]") // append-only ShippingAttempt[] (attempt/audit log)
+  idempotencyKey   String?   @map("idempotency_key")
   version          Int       @default(0)
   ...
+  @@unique([tenantId, fulfillmentRef, idempotencyKey])
   @@index([tenantId, fulfillmentRef])
```

**Why it can't be isolated:** `services/shipping/` — the entire directory, including
`shipping.prisma` — has **zero tracked files** (`git ls-files -- services/shipping | wc -l` → 0;
confirmed the same for `packages/db/prisma/schema/shipping.prisma`). There is no prior committed
version of this file to diff Sprint A0's hunk against. The `Shipment`/`ShippingProcessedWebhook`
models the hunk depends on (for the surrounding file to even parse) are themselves uncommitted
Sprint 4.10 work, not part of Sprint A0.

**Future sprint:** whatever sprint first commits the Shipping context's base implementation
(originally Sprint 4.10, per `docs/implementation/SPRINT_4_10_SHIPPING_CORE_REPORT.md`, still
uncommitted). Sprint A0's `idempotencyKey` column + unique constraint should land in that same
commit or immediately after it.

### `services/shipping/src/domain/shipment-repository.ts`

**Sprint A0's hunk:**

```diff
   findById(id: string, tx?: unknown): Promise<Shipment | null>;
+  findByIdempotencyKey(
+    fulfillmentRef: string,
+    idempotencyKey: string,
+    tx?: unknown,
+  ): Promise<Shipment | null>;
 }
```

**Why it can't be isolated:** same reason — the `ShipmentRepository` interface itself (`save`,
`findById`) that this method is added to has never been committed. Isolating just the new method
would produce an interface with only `findByIdempotencyKey` and no `save`/`findById`, which no
implementation in the working tree actually satisfies.

**Future sprint:** same as above.

### `services/shipping/src/infrastructure/prisma-shipment-repository.ts`

**Sprint A0's hunk:**

```diff
+  /** Scaffolding for A8's Fulfillment->Shipping idempotency (Sprint A0 precondition); not yet called by any use case. */
+  async findByIdempotencyKey(
+    fulfillmentRef: string,
+    idempotencyKey: string,
+    tx?: unknown,
+  ): Promise<Shipment | null> {
+    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
+    const row = await client.shipment.findFirst({
+      where: { fulfillmentRef, idempotencyKey, tenantId: this.deps.tenantId },
+    });
+    return row === null ? null : ShipmentMapper.toDomain(row);
+  }
```

**Why it can't be isolated:** `PrismaShipmentRepository` (the class this method belongs to),
`ShipmentMapper`, and the `save`/`findById` methods it sits alongside are all uncommitted.

**Future sprint:** same as above.

### `services/shipping/src/infrastructure/in-memory-shipment-repository.ts`

**Sprint A0's hunk:**

```diff
+  async findByIdempotencyKey(
+    _fulfillmentRef: string,
+    _idempotencyKey: string,
+  ): Promise<Shipment | null> {
+    return null;
+  }
```

**Why it can't be isolated:** same reason — `InMemoryShipmentRepository` itself is uncommitted.

**Future sprint:** same as above.

### `services/shipping/src/infrastructure/find-by-idempotency-key.test.ts`

This file is 100% new Sprint A0 content (not an edit to a pre-existing file), but it directly
imports `InMemoryShipmentRepository` from `./in-memory-shipment-repository` (deferred item #4
above) and `Shipment`/`Carrier`/`CarrierService`/`ShipmentPackage` from the equally-uncommitted
`services/shipping/src/domain/*`. Committing this test alone, without its imports existing in the
same commit, would be a file that cannot resolve its own module graph.

**Future sprint:** commit together with items #1–4, as part of the same Shipping-context base
commit.

### `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql` — Step 3 only

**Deferred hunk (present in the working-tree file, not in this commit's index):**

```sql
-- Step 3 (A8 precondition) — Shipment: new nullable idempotency key + unique constraint. Same
-- NULL-safety reasoning as step 2.
ALTER TABLE "shipping"."shipments" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "shipments_tenant_id_fulfillment_ref_idempotency_key_key"
  ON "shipping"."shipments"("tenant_id", "fulfillment_ref", "idempotency_key");
```

**Why it's deferred:** this statement alters `shipping.shipments`, a table whose own creation
migration (`packages/db/prisma/schema/migrations/20260712080000_shipping_core_sprint410/`) is
**also uncommitted** (confirmed: `git ls-files -- packages/db/prisma/schema/migrations/` returns
zero results — every migration directory in this repo, not just Sprint A0's, is currently
untracked). Committing Step 3 without the table-creation migration it depends on would mean that
running `prisma migrate deploy` against only this repo's committed migration history would fail —
`ALTER TABLE` on a table that was never created. Steps 1–2 have no such dependency: the
`inventory.reservations` and `payments.payment_intents` tables both predate this concern in the
same sense, but per the same check, **no migration in this repo is currently committed** — so
practically speaking, Steps 1–2 share the identical "runs only in the working tree's full migration
history, not git's committed history" characteristic as Step 3. They are included in this commit
because their target tables' schema declarations (`inventory.prisma`, `payments.prisma`) **are**
tracked and modified by this same commit, keeping the commit's own migration file internally
consistent with its own schema files — Step 3's target schema declaration (`shipping.prisma`) is
not part of this commit for the reasons above, so Step 3 is held back to match.

**Future sprint:** commit together with the Shipping context's base migration and schema, in the
same wave as items #1–5.

---

## 3. Confirmation: excluding these items does not break compilation, tests, architecture, or backward compatibility

**Method:** rather than assert this, it was verified directly. Using `git stash push --keep-index
-u`, the working tree was reduced to exactly this commit's staged content on top of `HEAD` (i.e.,
precisely what `git checkout` of this commit would produce), with every unstaged/untracked file —
including all 4 deferred Shipping files and every other pre-existing uncommitted change repo-wide
— temporarily removed. Gates were run against that isolated state, then the working tree was
restored via `git stash pop` (verified afterward to exactly match its pre-stash content).

**Results in isolation** (44 of 44 workspace projects resolved — the reduced count itself confirms
isolation was real, versus 81 with the full working tree present):

```
$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments typecheck
Scope: 5 of 44 workspace projects
packages/messaging typecheck: Done
packages/kafka typecheck: Done
packages/db typecheck: Done
services/inventory typecheck: Done
services/payments typecheck: Done

$ pnpm --filter @platform/messaging --filter @platform/kafka --filter @platform/db \
    --filter @platform/inventory --filter @platform/payments test -- --run
packages/messaging test: Test Files 7 passed (7) / Tests 19 passed (19)
packages/kafka test:     Test Files 2 passed | 1 skipped (3) / Tests 8 passed | 1 skipped (9)
services/inventory test: Test Files 4 passed (4) / Tests 14 passed (14)
services/payments test:  Test Files 4 passed (4) / Tests 14 passed (14)

$ pnpm arch
✔ no dependency violations found (450 modules, 1315 dependencies cruised)
```

- **Compilation:** clean. Zero errors across every package this commit touches, verified against
  `HEAD` directly (not the polluted working tree) — the deferred files were never in the module
  graph these packages depend on, so their absence changes nothing.
- **Tests:** clean. 355→41 tests scoped to the isolated packages all pass (the smaller count vs.
  the full-working-tree run reflects fewer _packages_ present, not any failure — every test that
  ran, passed). No test in the committed set imports anything from a deferred file.
- **Architecture:** clean, 0 violations. The deferred files were never part of any dependency edge
  this commit introduces (`@platform/messaging`→`@platform/repository`,
  `@platform/kafka`→`@platform/repository`) — those two new edges are fully internal to what's
  committed.
- **Backward compatibility:** unaffected. Nothing committed references
  `ShipmentRepository.findByIdempotencyKey`, the `shipping.idempotency_key` column, or migration
  Step 3 (proven in `SPRINT_A0_REVIEW_PACK_APPENDIX.md` §4/§7 — zero `UseCase` or other references
  to any new repository method, committed or deferred). Deferring the Shipping pieces removes
  nothing any other committed file depends on.

**One item to flag explicitly:** the _working tree_ (not this commit) still contains all 4
deferred Shipping files with Sprint A0's hunks already applied, plus the full-3-step
`migration.sql`. A future session picking up the Shipping context's base commit should check the
working tree for these pre-existing hunks before re-implementing them from scratch.
