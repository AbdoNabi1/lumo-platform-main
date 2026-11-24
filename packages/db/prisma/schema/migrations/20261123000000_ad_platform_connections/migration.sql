-- Lead Site Part D1 — ad platform connections: one row per shop and platform (Meta, TikTok, Snap, GA4,
-- Google Ads). Written by hand, NOT applied by the agent; the owner deploys it before the release that
-- reads this table. Additive and expand-only (MIGRATIONS.md §1): one new table in the existing `tracking`
-- schema, nothing existing is altered, no backfill. Tenant-scoped with its OWN RLS policy, exactly as
-- 20261122000000_leads. No FKs to other schemas (bare-id refs, D-002). No grants: earlier migrations add none.
-- "sealed_secret" is the envelope-sealed vendor token (AD_PLATFORM_CREDENTIALS_KEK_REF); it is never
-- plaintext and Google Ads (browser tag only) never has one.
SET row_security = off;

CREATE TABLE "tracking"."ad_platform_connections" (
  "id"               UUID         NOT NULL,
  "tenant_id"        TEXT         NOT NULL,
  "platform"         TEXT         NOT NULL,
  "enabled"          BOOLEAN      NOT NULL DEFAULT false,
  "public_config"    JSONB,
  "sealed_secret"    TEXT,
  "secret_last4"     TEXT,
  "test_event_code"  TEXT,
  "version"          INTEGER      NOT NULL DEFAULT 1,
  "created_at"       TIMESTAMP(3) NOT NULL,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ad_platform_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_platform_connections_platform_check" CHECK ("platform" IN ('meta', 'tiktok', 'snap', 'ga4', 'google_ads')),
  CONSTRAINT "ad_platform_connections_google_ads_no_secret_check" CHECK ("sealed_secret" IS NULL OR "platform" <> 'google_ads')
);
CREATE UNIQUE INDEX "ad_platform_connections_tenant_id_platform_key" ON "tracking"."ad_platform_connections" ("tenant_id", "platform");
ALTER TABLE "tracking"."ad_platform_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."ad_platform_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."ad_platform_connections";
CREATE POLICY tenant_isolation ON "tracking"."ad_platform_connections" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

RESET row_security;
