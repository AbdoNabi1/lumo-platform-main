-- Tracking P2-D9 — the lead tracking sweeper. Written by hand, NOT applied by the agent; the owner deploys it BEFORE the
-- release whose worker runs the sweeper. Additive and expand-only (MIGRATIONS.md §1): one new index and one new SELECT
-- policy on the existing "leads"."leads" table; no column, no backfill, nothing dropped or rewritten.
--
-- WHAT IT SERVES. A saved lead whose server tracking event could not be handed over stays `tracking_status = 'pending'`.
-- The worker's sweeper looks, every minute, for the pending leads older than two minutes (and marks the ones older than
-- seven days `failed`). It does so per tenant: (tenant_id, tracking_status, created_at) answers "this tenant's pending
-- leads, oldest first" from the index alone.
--
-- THE ONE CROSS-TENANT READ. The sweeper must first learn WHICH tenants have something pending, without a tenant being set.
-- A second policy, `tracking_sweep_read`, allows exactly that: SELECT only, only for rows still `pending`, and only while
-- the reading transaction sets `app.tracking_sweep = 'on'` (the repository does so for that one query and selects tenant
-- ids and nothing else). It is never open for an ordinary request, never for a settled lead, and grants no write: every
-- change the sweeper makes runs in the row's own tenant scope under the standard `tenant_isolation` policy.
--
-- ISOLATION. RLS ENABLE + FORCE and `tenant_isolation` (USING + WITH CHECK) already exist on this table
-- (20261203000000_leads); they are restated here so this file stands on its own and stays idempotent.
SET row_security = off;

CREATE INDEX "leads_tenant_id_tracking_status_created_at_idx" ON "leads"."leads" ("tenant_id", "tracking_status", "created_at");

ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads"."leads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_sweep_read ON "leads"."leads";
CREATE POLICY tracking_sweep_read ON "leads"."leads" FOR SELECT
  USING (current_setting('app.tracking_sweep', true) = 'on' AND tracking_status = 'pending');

RESET row_security;
