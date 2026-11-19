-- Project 4 Part 1 — Online Store identity: preferences, the password lock, the theme document
-- (draft + published + releases) and hashed preview tokens. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads these tables.
-- Additive and expand-only (MIGRATIONS.md §1): a new schema, five new tables, nothing existing is
-- altered, and there is no backfill (an absent row means the defaults, spec 1.2). Every table is
-- tenant-scoped and gets its OWN RLS policy explicitly, exactly as 20261013000000_store_shipping_taxes.
-- No FKs to other schemas (bare-id refs, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "online_store";

CREATE TABLE "online_store"."storefront_preferences" (
  "tenant_id"             TEXT         NOT NULL,
  "home_title"            JSONB        NOT NULL DEFAULT '{}',
  "home_meta_description" JSONB        NOT NULL DEFAULT '{}',
  "share_image_ref"       TEXT,
  "default_locale"        TEXT         NOT NULL DEFAULT 'ar',
  "version"               INTEGER      NOT NULL DEFAULT 0,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_preferences_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_preferences_default_locale_check" CHECK ("default_locale" IN ('ar', 'en'))
);
ALTER TABLE "online_store"."storefront_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_preferences";
CREATE POLICY tenant_isolation ON "online_store"."storefront_preferences" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_access" (
  "tenant_id"           TEXT         NOT NULL,
  "locked"              BOOLEAN      NOT NULL DEFAULT false,
  "password_hash"       TEXT,
  "password_updated_at" TIMESTAMP(3),
  "message"             JSONB        NOT NULL DEFAULT '{}',
  "access_version"      INTEGER      NOT NULL DEFAULT 1,
  "version"             INTEGER      NOT NULL DEFAULT 0,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_access_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_access_locked_needs_password_check" CHECK (NOT "locked" OR "password_hash" IS NOT NULL)
);
ALTER TABLE "online_store"."storefront_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_access";
CREATE POLICY tenant_isolation ON "online_store"."storefront_access" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_themes" (
  "tenant_id"                TEXT         NOT NULL,
  "draft"                    JSONB        NOT NULL,
  "draft_revision"           INTEGER      NOT NULL DEFAULT 1,
  "draft_saved_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published"                JSONB,
  "published_draft_revision" INTEGER,
  "release_number"           INTEGER      NOT NULL DEFAULT 0,
  "published_at"             TIMESTAMP(3),
  "published_by"             TEXT,
  "version"                  INTEGER      NOT NULL DEFAULT 0,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_themes_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "online_store"."storefront_themes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_themes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_themes";
CREATE POLICY tenant_isolation ON "online_store"."storefront_themes" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_theme_releases" (
  "id"             UUID         NOT NULL,
  "tenant_id"      TEXT         NOT NULL,
  "release_number" INTEGER      NOT NULL,
  "document"       JSONB        NOT NULL,
  "published_at"   TIMESTAMP(3) NOT NULL,
  "published_by"   TEXT         NOT NULL,
  CONSTRAINT "storefront_theme_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storefront_theme_releases_tenant_id_release_number_key" ON "online_store"."storefront_theme_releases" ("tenant_id", "release_number");
ALTER TABLE "online_store"."storefront_theme_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_theme_releases" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_theme_releases";
CREATE POLICY tenant_isolation ON "online_store"."storefront_theme_releases" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."preview_tokens" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "token_hash" TEXT         NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "online_store"."preview_tokens" ("token_hash");
CREATE INDEX "preview_tokens_tenant_id_expires_at_idx" ON "online_store"."preview_tokens" ("tenant_id", "expires_at");
ALTER TABLE "online_store"."preview_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."preview_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."preview_tokens";
CREATE POLICY tenant_isolation ON "online_store"."preview_tokens" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "online_store"."preview_tokens" IS
  'Project 4: staff preview links. Only SHA-256(token) is stored; tokens expire after 60 minutes.';

RESET row_security;
