-- Wave 2b - Settings > Notifications (customer emails from the merchant's email).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it.
--
-- PURELY ADDITIVE: three new per-tenant tables; nothing existing changes, no backfill. A tenant with
-- no row behaves with the in-code defaults (every template on, the store contact email as sender).
--
-- (1) notifications.notification_settings: one row per tenant, created on the first save. `version`
--     is the optimistic-lock counter the admin page sends back as `expectedVersion`.
-- (2) notifications.notification_template_overrides: a merchant's own subject/body for one template
--     and language. "Revert to default" deletes the row; the defaults live in code.
-- (3) notifications.sender_domains: the store's own sending domain as the email provider sees it
--     (filled by Task 2 of this wave; created here so there is exactly one migration).
-- Each is a new tenant-scoped table, so each needs its OWN RLS block (the loop RLS migration does
-- not cover it). No email address of a customer is stored here (ADR-0006).

CREATE TABLE "notifications"."notification_settings" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY,
  "sender_email" TEXT,
  "staff_recipients" JSONB NOT NULL DEFAULT '[]',
  "disabled_templates" TEXT[] NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "notifications"."notification_template_overrides" (
  "tenant_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "locale" TEXT NOT NULL CHECK ("locale" IN ('en','ar')),
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenant_id","key","locale")
);

CREATE TABLE "notifications"."sender_domains" (
  "tenant_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "provider_domain_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "records" JSONB NOT NULL,
  "verified_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("tenant_id","domain")
);

-- One verified owner per domain. Partial: Prisma cannot model it, so it lives only in SQL
-- (like security.staff_invitations_one_pending_per_email). Closes the race the unscoped
-- "verified by another store" read cannot (and RLS-enforcing roles would hide).
CREATE UNIQUE INDEX "sender_domains_verified_domain_key" ON "notifications"."sender_domains" ("domain") WHERE "status" = 'verified';

ALTER TABLE "notifications"."notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"."notification_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications"."notification_settings";
CREATE POLICY tenant_isolation ON "notifications"."notification_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "notifications"."notification_template_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"."notification_template_overrides" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications"."notification_template_overrides";
CREATE POLICY tenant_isolation ON "notifications"."notification_template_overrides" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "notifications"."sender_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"."sender_domains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications"."sender_domains";
CREATE POLICY tenant_isolation ON "notifications"."sender_domains" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
