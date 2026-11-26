-- Wave 2a - Settings > Checkout and Settings > Customer accounts.
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it.
--
-- PURELY ADDITIVE: one new per-tenant table and one new nullable column; nothing existing changes,
-- no backfill. A tenant with no row behaves exactly as before (the defaults below are today's
-- behaviour), so the release is safe even for a shop that never saves these settings.
--
-- (1) checkout.checkout_settings: one row per tenant, created on the first save. `version` is the
--     optimistic-lock counter the admin page sends back as `expectedVersion`. A shop cannot require
--     login while customer accounts are off (CHECK below; the domain refuses it first, with a message).
--     New tenant-scoped table, so it needs its OWN RLS block (the loop RLS migration does not cover it).
-- (2) checkout.checkout_sessions.marketing_opt_in: the shopper's tick of the marketing box, kept until
--     the order is placed. NULL = never asked / not answered.

CREATE TABLE "checkout"."checkout_settings" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "name_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("name_mode" IN ('required','optional')),
  "phone_mode" TEXT NOT NULL DEFAULT 'required' CHECK ("phone_mode" IN ('required','optional')),
  "line2_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("line2_mode" IN ('hidden','optional','required')),
  "marketing_email_prompt" TEXT NOT NULL DEFAULT 'hidden' CHECK ("marketing_email_prompt" IN ('hidden','show','preselect')),
  "cart_line_limit" INTEGER CHECK ("cart_line_limit" IS NULL OR "cart_line_limit" BETWEEN 1 AND 999),
  "require_login" BOOLEAN NOT NULL DEFAULT false,
  "accounts_mode" TEXT NOT NULL DEFAULT 'optional' CHECK ("accounts_mode" IN ('optional','disabled')),
  "show_account_link" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_settings_login_needs_accounts" CHECK (NOT ("require_login" AND "accounts_mode" = 'disabled'))
);

ALTER TABLE "checkout"."checkout_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout"."checkout_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "checkout"."checkout_settings";
CREATE POLICY tenant_isolation ON "checkout"."checkout_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "marketing_opt_in" BOOLEAN;

-- Shopper marketing consent at checkout: who made the choice (null = staff / older rows).
ALTER TABLE "identity"."consent_records" ADD COLUMN "source" TEXT;
