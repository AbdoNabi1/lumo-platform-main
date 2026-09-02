-- P1.1 Enterprise Control Plane — Feature Registry (ADR-0027). The single source of truth for every platform
-- capability. Additive: a new schema + one table; nothing existing is dropped or renamed.

CREATE SCHEMA IF NOT EXISTS "feature_registry";

CREATE TABLE "feature_registry"."feature_definitions" (
  "id"                        UUID PRIMARY KEY,
  "tenant_id"                 TEXT NOT NULL,
  "key"                       TEXT NOT NULL,
  "name"                      TEXT NOT NULL,
  "lifecycle"                 TEXT NOT NULL, -- draft | active | deprecated | removed
  "category"                  TEXT NOT NULL,
  "visibility"                TEXT NOT NULL, -- public | internal | beta | hidden
  "published_version_number"  INTEGER,
  "replacement_key"           TEXT,
  "versions"                  JSONB NOT NULL DEFAULT '[]', -- append-only FeatureVersion[] snapshots
  "version"                   INTEGER NOT NULL DEFAULT 0,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "feature_definitions_tenant_key_key" ON "feature_registry"."feature_definitions" ("tenant_id", "key");
CREATE INDEX "feature_definitions_lifecycle_idx" ON "feature_registry"."feature_definitions" ("tenant_id", "lifecycle");
CREATE INDEX "feature_definitions_category_idx" ON "feature_registry"."feature_definitions" ("tenant_id", "category");
