-- Sprint A0 (Preconditions) — additive, expand-only (doc 15 §2.4). Prepares schema/repository
-- plumbing later Phase A items will need (A3), without any of A3/A1's business logic or saga
-- wiring. Generated offline (no database host in this environment); apply with
-- `prisma migrate deploy` against Postgres 16. See docs/implementation/SPRINT_A0_REPORT.md for the
-- required pre-migration audit before step 1 runs.
--
-- The Shipment idempotency_key step (A8 precondition) originally reviewed alongside these two is
-- deferred out of this commit — see docs/implementation/SPRINT_A0_DEFERRED_ITEMS.md. It still
-- exists in the working tree's full migration (pending the Shipping context's own base commit) but
-- is not part of this commit's migration file, since the `shipping` schema/`shipments` table this
-- step alters has no committed base migration to build on yet.

-- Step 1 (A3 precondition) — Reservation: unique constraint on already-populated columns. RUN THE
-- PRE-MIGRATION DUPLICATE AUDIT IN SPRINT_A0_REPORT.md FIRST; resolve any existing
-- (tenant_id, item_id, reference) duplicates manually before this statement runs, or it will fail.
CREATE UNIQUE INDEX "reservations_tenant_id_item_id_reference_key"
  ON "inventory"."reservations"("tenant_id", "item_id", "reference");

-- Step 2 (A3 precondition) — PaymentIntent: new nullable idempotency key + unique constraint.
-- Safe without an audit: the column is new (every existing row is NULL), and Postgres treats each
-- NULL as distinct in a unique index, so no pre-existing row can violate it.
ALTER TABLE "payments"."payment_intents" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "payment_intents_tenant_id_idempotency_key_key"
  ON "payments"."payment_intents"("tenant_id", "idempotency_key");
