-- Tracking P2-D1 — per-store tracking settings: the consent policy the server stamps on every event, and whether the
-- storefront shows its cookie notice.
-- Written by hand, NOT applied by the agent; the owner deploys it BEFORE the release whose runtime reads it.
-- Additive and expand-only (MIGRATIONS.md §1): one new table in the existing `tracking` schema; no backfill, no change
-- to any existing table.
--
-- WHAT THE TABLE HOLDS. At most one row per tenant, created on the first save. A tenant with NO row has today's
-- defaults — `notice_only` consent (the storefront shows a notice, the visitor is not asked, tracking runs) and the
-- cookie notice shown — so the release is safe for a store that never opens the settings page. `consent_policy` is
-- `notice_only` or `opt_in` (the fail-closed gate); `version` is the optimistic-lock counter the admin page sends back
-- as `expectedVersion` (first save creates version 1).
--
-- ISOLATION. RLS ENABLE + FORCE with the standard `tenant_isolation` policy (USING + WITH CHECK). The tenant id is the
-- primary key (tenant-led by construction). No FKs (bare-id references, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tracking"."store_tracking_settings" (
  "tenant_id"             TEXT         NOT NULL,
  "consent_policy"        TEXT         NOT NULL DEFAULT 'notice_only'
    CONSTRAINT "store_tracking_settings_consent_policy_check" CHECK ("consent_policy" IN ('notice_only', 'opt_in')),
  "cookie_notice_enabled" BOOLEAN      NOT NULL DEFAULT true,
  "version"               INTEGER      NOT NULL DEFAULT 1
    CONSTRAINT "store_tracking_settings_version_check" CHECK ("version" >= 1),
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_tracking_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tracking"."store_tracking_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."store_tracking_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."store_tracking_settings";
CREATE POLICY tenant_isolation ON "tracking"."store_tracking_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

RESET row_security;
