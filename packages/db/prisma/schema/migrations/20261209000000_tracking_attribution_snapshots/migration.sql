-- Tracking P2-D8 — the attribution snapshot of an order: what the visitor's browser carried when they placed it.
-- Written by hand, NOT applied by the agent; the owner deploys it BEFORE the release whose runtime reads or writes it.
-- Additive and expand-only (MIGRATIONS.md §1): one new table in the existing `tracking` schema; no backfill, no change
-- to any existing table.
--
-- WHAT THE TABLE HOLDS. One row per (tenant, subject kind, subject ref). `checkout` rows are written by the public
-- checkout `complete` route BEFORE the order is created (subject ref = the checkout session id, which is the order's
-- `checkout_ref`), so the server-side Purchase can name the visitor, their click ids (with the instant each was
-- captured: the vendor attribution window is judged from it), the browser ids (fbp, fbc, ttp, scid, ga), the visitor's
-- IP and user agent, the page and the UTM labels. `lead` is reserved for symmetry; leads keep `leads.attribution`.
-- FIRST WRITE WINS (the writer inserts with ON CONFLICT DO NOTHING): a retried or replayed `complete` never replaces
-- the first snapshot. No email, phone or name is stored here.
--
-- RETENTION (owner decision 2026-11-27). IP and user agent are set to NULL 90 days after `captured_at` and the row is
-- stamped `network_redacted_at` so it is never visited again; the whole row is removed 400 days after `captured_at`.
-- The worker's tracking retention pass does both. It finds WHICH tenants have work without a tenant being set under a
-- second, read-only policy that is open ONLY while the transaction sets `app.retention_scan = 'on'` (never for an
-- ordinary request); every change then runs in the row's own tenant scope.
--
-- ISOLATION. RLS ENABLE + FORCE with the standard `tenant_isolation` policy (USING + WITH CHECK). The tenant id leads
-- the primary key and every index (ADR-0008). No FKs (bare-id references, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tracking"."attribution_snapshots" (
  "tenant_id"           TEXT         NOT NULL,
  "subject_kind"        TEXT         NOT NULL
    CONSTRAINT "attribution_snapshots_subject_kind_check" CHECK ("subject_kind" IN ('checkout', 'lead')),
  "subject_ref"         TEXT         NOT NULL,
  "visitor_id"          TEXT,
  "session_id"          TEXT,
  "ip"                  TEXT,
  "user_agent"          TEXT,
  "page_url"            TEXT,
  "referrer"            TEXT,
  "cookies"             JSONB        NOT NULL DEFAULT '{}',
  "click_ids"           JSONB        NOT NULL DEFAULT '[]',
  "utm"                 JSONB        NOT NULL DEFAULT '{}',
  "captured_at"         TIMESTAMP(3) NOT NULL,
  "network_redacted_at" TIMESTAMP(3),
  CONSTRAINT "attribution_snapshots_pkey" PRIMARY KEY ("tenant_id", "subject_kind", "subject_ref")
);

CREATE INDEX "attribution_snapshots_tenant_id_captured_at_idx" ON "tracking"."attribution_snapshots" ("tenant_id", "captured_at");

ALTER TABLE "tracking"."attribution_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."attribution_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."attribution_snapshots";
CREATE POLICY tenant_isolation ON "tracking"."attribution_snapshots" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS retention_scan_read ON "tracking"."attribution_snapshots";
CREATE POLICY retention_scan_read ON "tracking"."attribution_snapshots" FOR SELECT
  USING (current_setting('app.retention_scan', true) = 'on');

RESET row_security;
