-- Sprint 5.5 — SaaS Foundation (Tenancy + Licensing & Plans).
-- ADR-0008 addendum (Tenancy context activated) + ADR-0018 addendum (versioned plans, immutable-pinned
-- subscriptions, billing, generic usage, merchant overrides). Additive; every existing decision preserved.
-- Conventions: `tenant_id` on every row, `version` int optimistic lock, tenant-led uniques/indexes, JSONB
-- for composite state, no cross-context FKs (D-002).

CREATE SCHEMA IF NOT EXISTS "tenancy";
CREATE SCHEMA IF NOT EXISTS "licensing";

-- ---------------------------------------------------------------------------
-- tenancy — Tenant + Workspace
-- ---------------------------------------------------------------------------
CREATE TABLE "tenancy"."tenants" (
  "id"               UUID PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "status"           TEXT NOT NULL,
  "isolation_tier"   TEXT NOT NULL,
  "branding"         JSONB NOT NULL DEFAULT '{}',
  "subscription_ref" TEXT,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "tenants_tenant_slug_key" ON "tenancy"."tenants" ("tenant_id", "slug");
CREATE INDEX "tenants_tenant_status_idx" ON "tenancy"."tenants" ("tenant_id", "status");

CREATE TABLE "tenancy"."workspaces" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "tenant_ref" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "env"        TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "workspaces_tenant_key_key" ON "tenancy"."workspaces" ("tenant_id", "key");
CREATE INDEX "workspaces_tenant_ref_idx" ON "tenancy"."workspaces" ("tenant_id", "tenant_ref");

-- ---------------------------------------------------------------------------
-- licensing — Plan + Subscription + MerchantFeatureOverride + UsageCounter + Invoice + Credit
-- ---------------------------------------------------------------------------
CREATE TABLE "licensing"."plans" (
  "id"                       UUID PRIMARY KEY,
  "tenant_id"                TEXT NOT NULL,
  "key"                      TEXT NOT NULL,
  "name"                     TEXT NOT NULL,
  "tier"                     TEXT NOT NULL,
  "published_version_number" INTEGER,
  "versions"                 JSONB NOT NULL DEFAULT '[]',
  "version"                  INTEGER NOT NULL DEFAULT 0,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "plans_tenant_key_key" ON "licensing"."plans" ("tenant_id", "key");
CREATE INDEX "plans_tenant_tier_idx" ON "licensing"."plans" ("tenant_id", "tier");

CREATE TABLE "licensing"."subscriptions" (
  "id"                  UUID PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "tenant_ref"          TEXT NOT NULL,
  "plan_key"            TEXT NOT NULL,
  "plan_version_number" INTEGER NOT NULL,
  "state"               TEXT NOT NULL,
  "trial_ends_at"       TIMESTAMP(3),
  "current_period_end"  TIMESTAMP(3),
  "version"             INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "subscriptions_tenant_ref_key" ON "licensing"."subscriptions" ("tenant_id", "tenant_ref");
CREATE INDEX "subscriptions_tenant_state_idx" ON "licensing"."subscriptions" ("tenant_id", "state");

CREATE TABLE "licensing"."merchant_feature_overrides" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "tenant_ref"  TEXT NOT NULL,
  "feature_key" TEXT NOT NULL,
  "level"       TEXT NOT NULL,
  "effect"      TEXT NOT NULL,
  "expires_at"  TIMESTAMP(3),
  "note"        TEXT NOT NULL DEFAULT '',
  "active"      BOOLEAN NOT NULL DEFAULT TRUE,
  "version"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "overrides_tenant_key_key" ON "licensing"."merchant_feature_overrides" ("tenant_id", "key");
CREATE INDEX "overrides_lookup_idx" ON "licensing"."merchant_feature_overrides" ("tenant_id", "tenant_ref", "feature_key", "level", "active");

CREATE TABLE "licensing"."usage_counters" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "tenant_ref" TEXT NOT NULL,
  "resource"   TEXT NOT NULL,
  "period"     TEXT NOT NULL,
  "current"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "limit"      DOUBLE PRECISION,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "usage_counters_tenant_key_key" ON "licensing"."usage_counters" ("tenant_id", "key");
CREATE INDEX "usage_counters_lookup_idx" ON "licensing"."usage_counters" ("tenant_id", "tenant_ref", "resource");

CREATE TABLE "licensing"."invoices" (
  "id"               UUID PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "number"           TEXT NOT NULL,
  "tenant_ref"       TEXT NOT NULL,
  "subscription_ref" TEXT NOT NULL,
  "currency"         TEXT NOT NULL,
  "lines"            JSONB NOT NULL DEFAULT '[]',
  "status"           TEXT NOT NULL,
  "due_at"           TIMESTAMP(3),
  "payment_ref"      TEXT,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "invoices_tenant_number_key" ON "licensing"."invoices" ("tenant_id", "number");
CREATE INDEX "invoices_lookup_idx" ON "licensing"."invoices" ("tenant_id", "tenant_ref", "status");

CREATE TABLE "licensing"."credits" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "tenant_ref" TEXT NOT NULL,
  "resource"   TEXT NOT NULL,
  "amount"     DOUBLE PRECISION NOT NULL,
  "remaining"  DOUBLE PRECISION NOT NULL,
  "reason"     TEXT NOT NULL DEFAULT '',
  "status"     TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "credits_tenant_key_key" ON "licensing"."credits" ("tenant_id", "key");
CREATE INDEX "credits_lookup_idx" ON "licensing"."credits" ("tenant_id", "tenant_ref", "status");
