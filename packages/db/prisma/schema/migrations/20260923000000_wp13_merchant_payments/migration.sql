-- WP-13 (Morbeh F-19) — merchant payments. Additive, expand-only (MIGRATIONS.md §1). Written by hand
-- and NOT applied by the agent that authored it: this repository's `.env` points at the live
-- database, so deploying is the operator's step.
--
-- 1. payments.payment_intents gains the payment method the shopper selected and, for providers whose
--    charge id differs from the intent's own reference (Paymob), that transaction id.
-- 2. payments.merchant_payment_settings — one row per merchant. New tenant-scoped table, so it needs
--    its OWN RLS policy explicitly: the loop-based 20260823000000_rls_tenant_isolation migration only
--    covers tables that existed when it ran (G-63). Same shape as
--    20260922010000_g72_signup_tokens.

-- (1) `provider` is NOT NULL with no long-term default: rows that pre-date this migration were all
-- created when Stripe was the only provider, so they are backfilled to 'stripe' by a TRANSIENT
-- default, which is then dropped — every new row must state its provider explicitly, matching the
-- domain (a shopper's explicit choice; nothing infers one).
ALTER TABLE "payments"."payment_intents" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "payments"."payment_intents" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "payments"."payment_intents" ADD COLUMN "provider_transaction_ref" TEXT;
ALTER TABLE "payments"."payment_intents"
  ADD CONSTRAINT "payment_intents_provider_check" CHECK ("provider" IN ('stripe', 'paymob', 'cod'));

-- (2) Merchant payment settings. `paymob_credentials` holds only a sealed envelope (never plaintext).
CREATE TABLE "payments"."merchant_payment_settings" (
  "tenant_id" TEXT NOT NULL,
  "enabled_methods" TEXT[],
  "paymob_region" TEXT,
  "paymob_integration_id" INTEGER,
  "paymob_credentials" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_payment_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "payments"."merchant_payment_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments"."merchant_payment_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payments"."merchant_payment_settings";
CREATE POLICY tenant_isolation ON "payments"."merchant_payment_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
