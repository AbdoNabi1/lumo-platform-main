-- Sprint 5.4 — Experience Platform (Commerce OS visual layer).
-- New bounded contexts: Content Blocks, Localization, SEO, Component Library, Theme System,
-- Experience Builder + Layout Engine, Dynamic Pages. Media Library EXTENDS the existing `media` schema.
-- Conventions (per docs/architecture/03 + ADR-0008): one Postgres schema per context, `tenant_id` on every
-- row, `version` int for optimistic locking, tenant-led uniques/indexes, JSONB for composite state.

-- ---------------------------------------------------------------------------
-- schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "content";
CREATE SCHEMA IF NOT EXISTS "seo";
CREATE SCHEMA IF NOT EXISTS "localization";
CREATE SCHEMA IF NOT EXISTS "components";
CREATE SCHEMA IF NOT EXISTS "theme";
CREATE SCHEMA IF NOT EXISTS "experience";
CREATE SCHEMA IF NOT EXISTS "pages";

-- ---------------------------------------------------------------------------
-- content — ContentBlock (reusable modular content)
-- ---------------------------------------------------------------------------
CREATE TABLE "content"."content_blocks" (
  "id"                UUID PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "key"               TEXT NOT NULL,
  "kind"              TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "data"              JSONB NOT NULL DEFAULT '{}',
  "locale_ref"        TEXT,
  "status"            TEXT NOT NULL,
  "scheduled_at"      TIMESTAMP(3),
  "published_version" INTEGER,
  "source"            TEXT NOT NULL DEFAULT 'manual',
  "metadata"          JSONB NOT NULL DEFAULT '{}',
  "versions"          JSONB NOT NULL DEFAULT '[]',
  "version"           INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "content_blocks_tenant_key_key" ON "content"."content_blocks" ("tenant_id", "key");
CREATE INDEX "content_blocks_tenant_status_idx" ON "content"."content_blocks" ("tenant_id", "status");
CREATE INDEX "content_blocks_tenant_kind_idx" ON "content"."content_blocks" ("tenant_id", "kind");

-- ---------------------------------------------------------------------------
-- localization — Locale + TranslationSet
-- ---------------------------------------------------------------------------
CREATE TABLE "localization"."locales" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "code"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "direction"  TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "locales_tenant_code_key" ON "localization"."locales" ("tenant_id", "code");
CREATE INDEX "locales_tenant_status_idx" ON "localization"."locales" ("tenant_id", "status");

CREATE TABLE "localization"."translation_sets" (
  "id"                 UUID PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "key"                TEXT NOT NULL,
  "default_locale_ref" TEXT NOT NULL,
  "fallback_chain"     JSONB NOT NULL DEFAULT '[]',
  "translations"       JSONB NOT NULL DEFAULT '[]',
  "version"            INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "translation_sets_tenant_key_key" ON "localization"."translation_sets" ("tenant_id", "key");

-- ---------------------------------------------------------------------------
-- media — Media Library (extends existing `media` schema)
-- ---------------------------------------------------------------------------
CREATE TABLE "media"."media_folders" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "parent_ref" TEXT,
  "status"     TEXT NOT NULL,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "media_folders_tenant_key_key" ON "media"."media_folders" ("tenant_id", "key");
CREATE INDEX "media_folders_tenant_parent_idx" ON "media"."media_folders" ("tenant_id", "parent_ref");

CREATE TABLE "media"."media_assets" (
  "id"           UUID PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "storage_key"  TEXT NOT NULL,
  "asset_type"   TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "folder_ref"   TEXT,
  "tags"         JSONB NOT NULL DEFAULT '[]',
  "collections"  JSONB NOT NULL DEFAULT '[]',
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "variants"     JSONB NOT NULL DEFAULT '[]',
  "presets"      JSONB NOT NULL DEFAULT '[]',
  "usages"       JSONB NOT NULL DEFAULT '[]',
  "status"       TEXT NOT NULL,
  "version"      INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "media_assets_tenant_key_key" ON "media"."media_assets" ("tenant_id", "key");
CREATE INDEX "media_assets_tenant_status_idx" ON "media"."media_assets" ("tenant_id", "status");
CREATE INDEX "media_assets_tenant_folder_idx" ON "media"."media_assets" ("tenant_id", "folder_ref");
CREATE INDEX "media_assets_tenant_type_idx" ON "media"."media_assets" ("tenant_id", "asset_type");

-- ---------------------------------------------------------------------------
-- seo — SeoProfile + Redirect + Sitemap + RobotsPolicy
-- ---------------------------------------------------------------------------
CREATE TABLE "seo"."seo_profiles" (
  "id"            UUID PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "target_ref"    TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "canonical_url" TEXT,
  "robots_index"  BOOLEAN NOT NULL DEFAULT TRUE,
  "robots_follow" BOOLEAN NOT NULL DEFAULT TRUE,
  "open_graph"    JSONB NOT NULL DEFAULT '{}',
  "twitter"       JSONB NOT NULL DEFAULT '{}',
  "json_ld"       TEXT,
  "locale_ref"    TEXT,
  "status"        TEXT NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "seo_profiles_tenant_target_key" ON "seo"."seo_profiles" ("tenant_id", "target_ref");
CREATE INDEX "seo_profiles_tenant_status_idx" ON "seo"."seo_profiles" ("tenant_id", "status");

CREATE TABLE "seo"."redirects" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  TEXT NOT NULL,
  "from_path"  TEXT NOT NULL,
  "to_path"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "redirects_tenant_from_key" ON "seo"."redirects" ("tenant_id", "from_path");
CREATE INDEX "redirects_tenant_status_idx" ON "seo"."redirects" ("tenant_id", "status");

CREATE TABLE "seo"."sitemaps" (
  "id"                UUID PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "key"               TEXT NOT NULL,
  "locale_ref"        TEXT,
  "entries"           JSONB NOT NULL DEFAULT '[]',
  "last_generated_at" TIMESTAMP(3),
  "version"           INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "sitemaps_tenant_key_key" ON "seo"."sitemaps" ("tenant_id", "key");

CREATE TABLE "seo"."robots_policies" (
  "id"          UUID PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "rules"       JSONB NOT NULL DEFAULT '[]',
  "sitemap_url" TEXT,
  "version"     INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "robots_policies_tenant_key_key" ON "seo"."robots_policies" ("tenant_id", "key");

-- ---------------------------------------------------------------------------
-- components — ComponentDefinition (schema-driven rendering contract)
-- ---------------------------------------------------------------------------
CREATE TABLE "components"."component_definitions" (
  "id"             UUID PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "schema"         JSONB NOT NULL DEFAULT '[]',
  "contract"       JSONB NOT NULL DEFAULT '{}',
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "source"         TEXT NOT NULL DEFAULT 'core',
  "status"         TEXT NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "component_definitions_tenant_key_key" ON "components"."component_definitions" ("tenant_id", "key");
CREATE INDEX "component_definitions_tenant_status_idx" ON "components"."component_definitions" ("tenant_id", "status");
CREATE INDEX "component_definitions_tenant_category_idx" ON "components"."component_definitions" ("tenant_id", "category");

-- ---------------------------------------------------------------------------
-- theme — Theme (appearance, seeded from @platform/design tokens)
-- ---------------------------------------------------------------------------
CREATE TABLE "theme"."themes" (
  "id"                UUID PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "key"               TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "mode"              TEXT NOT NULL,
  "base_theme_ref"    TEXT,
  "variables"         JSONB NOT NULL DEFAULT '{}',
  "published_version" INTEGER,
  "source"            TEXT NOT NULL DEFAULT 'core',
  "status"            TEXT NOT NULL,
  "versions"          JSONB NOT NULL DEFAULT '[]',
  "version"           INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "themes_tenant_key_key" ON "theme"."themes" ("tenant_id", "key");
CREATE INDEX "themes_tenant_status_idx" ON "theme"."themes" ("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- experience — Experience (layout tree + version history)
-- ---------------------------------------------------------------------------
CREATE TABLE "experience"."experiences" (
  "id"                UUID PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "key"               TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "experience_type"   TEXT NOT NULL,
  "theme_ref"         TEXT,
  "canvas"            JSONB NOT NULL DEFAULT '{}',
  "status"            TEXT NOT NULL,
  "scheduled_at"      TIMESTAMP(3),
  "published_version" INTEGER,
  "source"            TEXT NOT NULL DEFAULT 'manual',
  "metadata"          JSONB NOT NULL DEFAULT '{}',
  "versions"          JSONB NOT NULL DEFAULT '[]',
  "version"           INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "experiences_tenant_key_key" ON "experience"."experiences" ("tenant_id", "key");
CREATE INDEX "experiences_tenant_status_idx" ON "experience"."experiences" ("tenant_id", "status");
CREATE INDEX "experiences_tenant_type_idx" ON "experience"."experiences" ("tenant_id", "experience_type");

-- ---------------------------------------------------------------------------
-- pages — Page + PageTemplate (routing)
-- ---------------------------------------------------------------------------
CREATE TABLE "pages"."pages" (
  "id"             UUID PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "path"           TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "experience_ref" TEXT,
  "seo_ref"        TEXT,
  "theme_ref"      TEXT,
  "locale_ref"     TEXT,
  "template_ref"   TEXT,
  "status"         TEXT NOT NULL,
  "source"         TEXT NOT NULL DEFAULT 'manual',
  "version"        INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "pages_tenant_key_key" ON "pages"."pages" ("tenant_id", "key");
CREATE UNIQUE INDEX "pages_tenant_path_locale_key" ON "pages"."pages" ("tenant_id", "path", "locale_ref");
CREATE INDEX "pages_tenant_status_idx" ON "pages"."pages" ("tenant_id", "status");
CREATE INDEX "pages_tenant_kind_idx" ON "pages"."pages" ("tenant_id", "kind");

CREATE TABLE "pages"."page_templates" (
  "id"             UUID PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "experience_ref" TEXT,
  "status"         TEXT NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "page_templates_tenant_key_key" ON "pages"."page_templates" ("tenant_id", "key");
