-- Sprint 5.6 — SaaS refinements (ADR-0008 addendum-2 + ADR-0018 addendum-2). Purely ADDITIVE:
-- Workspace white-label config, Subscription lifecycle columns, and the new MerchantCapabilities aggregate.
-- Nothing is dropped or renamed; existing rows default cleanly.

-- Workspace white-label / storefront configuration (ADR-0008 addendum-2 §2)
ALTER TABLE "tenancy"."workspaces" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';

-- Subscription lifecycle (ADR-0018 addendum-2 §H)
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "paused"              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "resume_at"           TIMESTAMP(3);
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "renewal_schedule"    TEXT;
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "grace_period_days"   INTEGER;
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "retry_policy"        TEXT;
ALTER TABLE "licensing"."subscriptions" ADD COLUMN "cancellation_reason" TEXT;

-- MerchantCapabilities — the operational override layer, distinct from Subscription (ADR-0018 addendum-2 §F)
CREATE TABLE "licensing"."merchant_capabilities" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "tenant_ref"  TEXT NOT NULL,
  "feature_key" TEXT NOT NULL,
  "effect"      TEXT NOT NULL,
  "source"      TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3),
  "reason"      TEXT NOT NULL DEFAULT '',
  "notes"       TEXT NOT NULL DEFAULT '',
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "history"     JSONB NOT NULL DEFAULT '[]',
  "version"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "merchant_capabilities_tenant_key_key" ON "licensing"."merchant_capabilities" ("tenant_id", "key");
CREATE INDEX "merchant_capabilities_lookup_idx" ON "licensing"."merchant_capabilities" ("tenant_id", "tenant_ref", "feature_key", "active");
