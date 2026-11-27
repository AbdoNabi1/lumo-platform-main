-- Tracking P1-D4 / D10 — the TrackingProfile store. Written by hand, NOT applied by the agent; the owner deploys it
-- before the release whose runtime reads it. Additive and expand-only (MIGRATIONS.md §1): one new table in the
-- existing `tracking` schema, one new NULLABLE column + index on `tracking_event_records`, no backfill.
--
-- WHAT THE TABLE HOLDS. One row per (tenant, visitor cookie id) — the data a later server event (a Purchase days
-- after the click, a lead) needs and no longer has: HASHES of the person's email / phone / names (per platform
-- form: email_std / email_gads / email_ga4, phone_digits / phone_e164, fn, ln, ct, st, country, external_id),
-- advertising click ids with the time they were captured, the browser ids platforms ask for (fbp, fbc, ttp, scid,
-- GA client and session), the last IP / user agent / page, the last landing touch, lead and order ids. NEVER a raw
-- email, phone or name. Identity resolution folds several cookies of one person into one row; the absorbed
-- cookie ids stay as data-free TOMBSTONES (`merged_into` set, everything else empty) so they keep resolving.
--
-- RETENTION (owner decision 2026-11-27). An anonymous profile (customer_id NULL) is deleted once `expires_at`
-- (last seen + 400 days) has passed; a customer's profiles and tombstones are erased with the customer. The
-- worker does both (apps/runtime tracking retention). `network_redacted_at` on tracking_event_records marks a
-- record whose IP / user agent were nulled after 90 days, so the job never revisits it.
--
-- ISOLATION. RLS ENABLE + FORCE with the standard `tenant_isolation` policy. The retention job must find WHICH
-- tenants have expired profiles without a tenant being set; it does so under a second, read-only policy that is
-- open ONLY while the transaction sets `app.retention_scan = 'on'` (never for an ordinary request), and every
-- delete then runs in the row's own tenant scope. Tenant-led unique key and indexes (ADR-0008). No FKs (bare-id
-- references, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tracking"."tracking_profiles" (
  "id"                UUID         NOT NULL,
  "tenant_id"         TEXT         NOT NULL,
  "visitor_id"        TEXT         NOT NULL,
  "merged_into"       TEXT,
  "customer_id"       TEXT,
  "email_std"         TEXT,
  "email_gads"        TEXT,
  "email_ga4"         TEXT,
  "phone_digits"      TEXT,
  "phone_e164"        TEXT,
  "fn"                TEXT,
  "ln"                TEXT,
  "ct"                TEXT,
  "st"                TEXT,
  "country"           TEXT,
  "external_id"       TEXT,
  "click_ids"         JSONB        NOT NULL DEFAULT '{}',
  "fbp"               TEXT,
  "fbc"               TEXT,
  "fbc_captured_at"   TIMESTAMP(3),
  "ttp"               TEXT,
  "scid"              TEXT,
  "ga_client_id"      TEXT,
  "ga_session_id"     TEXT,
  "last_ip"           TEXT,
  "last_user_agent"   TEXT,
  "last_page_url"     TEXT,
  "last_seen_at"      TIMESTAMP(3) NOT NULL,
  "geo_country"       TEXT,
  "geo_region"        TEXT,
  "geo_city"          TEXT,
  "ai_source"         TEXT,
  "bot_score"         INTEGER,
  "fingerprint_id"    TEXT,
  "landing_touch"     JSONB,
  "lead_ids"          TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "order_ids"         TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version"           INTEGER      NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "expires_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tracking_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tracking_profiles_tenant_id_visitor_id_key" ON "tracking"."tracking_profiles" ("tenant_id", "visitor_id");
CREATE INDEX "tracking_profiles_tenant_id_customer_id_idx" ON "tracking"."tracking_profiles" ("tenant_id", "customer_id");
CREATE INDEX "tracking_profiles_tenant_id_email_std_idx" ON "tracking"."tracking_profiles" ("tenant_id", "email_std");
CREATE INDEX "tracking_profiles_tenant_id_phone_e164_idx" ON "tracking"."tracking_profiles" ("tenant_id", "phone_e164");
CREATE INDEX "tracking_profiles_tenant_id_merged_into_idx" ON "tracking"."tracking_profiles" ("tenant_id", "merged_into");
CREATE INDEX "tracking_profiles_tenant_id_expires_at_idx" ON "tracking"."tracking_profiles" ("tenant_id", "expires_at");

ALTER TABLE "tracking"."tracking_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."tracking_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."tracking_profiles";
CREATE POLICY tenant_isolation ON "tracking"."tracking_profiles" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS retention_scan_read ON "tracking"."tracking_profiles";
CREATE POLICY retention_scan_read ON "tracking"."tracking_profiles" FOR SELECT
  USING (current_setting('app.retention_scan', true) = 'on');

-- Tracking P1-D10: IP / user agent inside an event record are nulled after 90 days; this marks the records done.
ALTER TABLE "tracking"."tracking_event_records" ADD COLUMN "network_redacted_at" TIMESTAMP(3);
CREATE INDEX "tracking_event_records_redaction_scan_idx"
  ON "tracking"."tracking_event_records" ("tenant_id", "network_redacted_at", "captured_at");

RESET row_security;
