-- Lead Site Part C — leads: one row per saved lead-form submission. Written by hand, NOT applied by
-- the agent; the owner deploys it before the release that reads this table. Additive and
-- expand-only (MIGRATIONS.md §1): a new schema and one new table, nothing existing is altered, no
-- backfill. Tenant-scoped with its OWN RLS policy, exactly as 20261027000000_online_store_identity.
-- No FKs to other schemas (bare-id refs, D-002). No grants: earlier migrations add none.
-- "submission_key" is the client-minted idempotency key: a repeat of the same key for a tenant hits
-- the unique index instead of adding a second lead.
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "leads";

CREATE TABLE "leads"."leads" (
  "id"              UUID         NOT NULL,
  "tenant_id"       TEXT         NOT NULL,
  "form_id"         TEXT         NOT NULL,
  "name"            TEXT         NOT NULL,
  "phone"           TEXT         NOT NULL,
  "phone_e164"      TEXT         NOT NULL,
  "email"           TEXT,
  "message"         TEXT,
  "status"          TEXT         NOT NULL,
  "tracking_status" TEXT         NOT NULL,
  "event_id"        TEXT         NOT NULL,
  "session_id"      TEXT         NOT NULL,
  "submission_key"  TEXT         NOT NULL,
  "spam_reason"     TEXT,
  "attribution"     JSONB        NOT NULL DEFAULT '{}',
  "version"         INTEGER      NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leads_status_check" CHECK ("status" IN ('new', 'contacted', 'qualified', 'converted', 'rejected', 'spam')),
  CONSTRAINT "leads_tracking_status_check" CHECK ("tracking_status" IN ('pending', 'suppressed', 'skipped_spam', 'sent', 'failed')),
  CONSTRAINT "leads_spam_reason_check" CHECK ("spam_reason" IS NULL OR "spam_reason" IN ('honeypot', 'too_fast'))
);
CREATE UNIQUE INDEX "leads_tenant_id_submission_key_key" ON "leads"."leads" ("tenant_id", "submission_key");
CREATE INDEX "leads_tenant_id_id_idx" ON "leads"."leads" ("tenant_id", "id" DESC);
CREATE INDEX "leads_tenant_id_status_id_idx" ON "leads"."leads" ("tenant_id", "status", "id" DESC);
ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads"."leads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "leads"."leads";
CREATE POLICY tenant_isolation ON "leads"."leads" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

RESET row_security;
