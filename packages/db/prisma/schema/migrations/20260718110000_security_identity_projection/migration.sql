-- Phase-2 hardening H-2 (G-SEC-4) — Security's read projection of Identity-owned Users/Organizations/
-- Memberships. Additive: three new tables in the existing `security` schema. Identity owns these; these
-- are read-optimised copies kept current by the identity.* event consumers (LWW by occurred_at) for
-- principal/membership/organization resolution. No cross-context FKs; tenant_id (row scope) on every
-- row (ADR-0008). No PII (ADR-0006): ids, tenant, org slug, role name only.

CREATE TABLE "security"."identity_user_projection" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "user_tenant" TEXT,
  "status"      TEXT NOT NULL,
  "occurred_at" TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "identity_user_projection_user_key" ON "security"."identity_user_projection" ("tenant_id", "user_id");

CREATE TABLE "security"."identity_organization_projection" (
  "id"              UUID PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "slug"            TEXT NOT NULL,
  "org_tenant"      TEXT,
  "occurred_at"     TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "identity_organization_projection_org_key" ON "security"."identity_organization_projection" ("tenant_id", "organization_id");

CREATE TABLE "security"."identity_membership_projection" (
  "id"              UUID PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "membership_id"   TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "role"            TEXT NOT NULL,
  "occurred_at"     TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "identity_membership_projection_membership_key" ON "security"."identity_membership_projection" ("tenant_id", "membership_id");
CREATE INDEX "identity_membership_projection_user_idx" ON "security"."identity_membership_projection" ("tenant_id", "user_id");
