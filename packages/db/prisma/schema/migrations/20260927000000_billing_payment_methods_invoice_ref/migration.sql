-- G-74 (8) — the billing TRANSACTION callback needs a signed path from Paymob's callback to the
-- invoice it settles. Written by hand and NOT applied by the agent that authored it: this
-- repository's `.env` points at the live database, so deploying is the operator's step.
--
-- ORDERING. This is purely ADDITIVE (one nullable column, no backfill, no constraint on existing
-- rows) and depends only on `20260924020000_billing_payment_methods` existing first, which it does
-- in this migration history. It may be deployed independently of, and in any order relative to,
-- the other three migrations already pending at the time this was written
-- (`20260923000000_wp13_merchant_payments`, `20260924000000_wp14_platform_plans`,
-- `20260924010000_open_payment_provider_registry`) — none of the four touch the same table.
--
-- WHY A NEW MIGRATION AND NOT AN EDIT. `20260924020000_billing_payment_methods` is itself still
-- CREATED, NOT APPLIED per the platform gap register, but that cannot be verified from inside this
-- session (direct database access is out of scope for this task) and an already-applied migration
-- file must never be edited — doing so corrupts `_prisma_migrations`' checksum history for every
-- other environment that already ran it. Expand-only, per `packages/db/prisma/MIGRATIONS.md` §1.
--
-- WHAT THE COLUMN IS. `invoice_ref` records the invoice `BeginCardEnrolment` started the merchant's
-- interactive first payment for (`services/licensing/src/application/payment-method.use-cases.ts`).
-- Paymob's billing TRANSACTION callback signs `order.id` (among 20 fixed fields,
-- `packages/psp-paymob/src/webhook-signature.ts`) but never the invoice id itself, and does NOT sign
-- `special_reference` (the field that happens to carry `<invoiceId>:<version>:enrol` today) — so
-- without this column there is no signed path from the callback to the invoice it should settle.
-- `RecordInvoiceTransaction` correlates the signed `order.id` to this table's existing
-- `provider_order_id` unique index first, THEN reads `invoice_ref` off that row; it never reads
-- `special_reference`.
--
-- NULLABLE, NO BACKFILL. Any row already `pending`/`active`/`revoked` before this deploys was
-- enrolled before this column existed and has no recorded invoice; `RecordInvoiceTransaction`
-- treats an absent `invoice_ref` exactly like "no enrolment for this order" (settles nothing, logs
-- loudly) rather than guessing one. No CHECK constraint is added: a `pending` row created by the
-- OLD code (no `invoice_ref` in the INSERT) must remain valid until the new application version is
-- the only one writing this table — the expand→migrate→contract discipline this file's directory
-- documents.
--
-- NO RLS CHANGE. The table's existing `tenant_isolation` policy (from the parent migration) already
-- covers every column on the row, including this new one; a plain `ALTER TABLE ... ADD COLUMN` adds
-- no new policy surface.

ALTER TABLE "licensing"."billing_payment_methods"
  ADD COLUMN "invoice_ref" TEXT;

COMMENT ON COLUMN "licensing"."billing_payment_methods"."invoice_ref" IS
  'The invoice BeginCardEnrolment started this checkout for. Recorded so the billing TRANSACTION callback (signed order.id only) can reach the invoice without trusting the unsigned special_reference field (G-74 (8)). Nullable: absent on a row enrolled before this column existed.';
