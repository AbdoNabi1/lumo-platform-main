-- P1.1.1 Feature Registry Hardening (additive). Adds FeatureBundle (commercial collections, §2). The additive
-- feature-version spec fields (groups/compatibility/ai, §1/§9/§10) live inside the existing `versions` JSONB and
-- need no DDL. Nothing existing is dropped or renamed.

CREATE TABLE "feature_registry"."feature_bundles" (
  "id"           UUID PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT NOT NULL DEFAULT '',
  "status"       TEXT NOT NULL, -- active | archived
  "feature_keys" JSONB NOT NULL DEFAULT '[]',
  "groups"       JSONB NOT NULL DEFAULT '[]',
  "version"      INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "feature_bundles_tenant_key_key" ON "feature_registry"."feature_bundles" ("tenant_id", "key");
CREATE INDEX "feature_bundles_status_idx" ON "feature_registry"."feature_bundles" ("tenant_id", "status");
