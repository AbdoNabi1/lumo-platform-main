-- Wave 2b2 - each store sends customer email from ITS OWN email account (D46-D50).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it. Run it after 20261129000000_notification_settings.
--
-- ADDITIVE except ONE drop: the empty notifications.sender_domains table.
--
-- (1) notifications.email_connections: one row per tenant, the merchant's own email account
--     (kind 'resend' for now). `sealed_credentials` is the sealed envelope JSON
--     {v, alias, wrappedDek, ciphertext} ONLY (never a key reference, never the key in clear);
--     `secret_last4` is the only part of the key ever shown. `status` is 'connected' only after a
--     test send through the account succeeded. `last_error` is a sanitized provider message (no
--     address, no body, no key). `version` is the optimistic-lock counter the admin sends back.
-- (2) DROP notifications.sender_domains: Wave 2b's platform domain authentication is removed (D50).
--     The table was created by 20261129000000_notification_settings, which has never been applied,
--     so it is empty everywhere; its RLS policy, partial unique index and primary key go with it.
-- The new table is tenant-scoped, so it needs its OWN RLS block (the loop RLS migration does not
-- cover it).

CREATE TABLE "notifications"."email_connections" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('resend')),
  "from_email" TEXT NOT NULL,
  "sealed_credentials" TEXT NOT NULL,
  "secret_last4" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL CHECK ("status" IN ('connected','failed')),
  "last_error" TEXT,
  "last_error_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "notifications"."email_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"."email_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications"."email_connections";
CREATE POLICY tenant_isolation ON "notifications"."email_connections" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP TABLE IF EXISTS "notifications"."sender_domains";
