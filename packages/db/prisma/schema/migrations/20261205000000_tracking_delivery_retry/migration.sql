-- Tracking P1-D2 — durable per-destination delivery retry. Written by hand, NOT applied by the agent; the
-- owner deploys it before the release whose worker reads this table. Additive and expand-only
-- (MIGRATIONS.md §1): one new table in the existing `tracking` schema, nothing existing is altered, no backfill.
--
-- WHY A TABLE. `tracking_event_records` is append-only on purpose (no update path), so "this destination
-- still has to be retried at <time>" cannot live on it. One row here per (tenant, event, destination) whose
-- vendor call failed in a way that may still succeed; the worker's sweeper claims due rows, re-delivers the
-- SAME event id, and settles the row `delivered` or `dead_lettered` (with a reason). The vendor window is
-- stored per row: `window_expires_at` = the event time + the vendor's accepted age (GA4 72 h; Meta, TikTok,
-- Snap 7 days minus 1 h). Past it, or on a permanent refusal, the row is dead-lettered, never sent.
--
-- Holds no payload and no identity: ids, counters, timestamps and a short error text (the same text the
-- event record's attempt list and `platform.dead_letters` already keep). Tenant-scoped with the standard
-- RLS policy, plus a read-only policy so the CROSS-TENANT due scan keeps working once the connection role
-- stops bypassing RLS (as `platform.outbox` already does); every write is made in the row's own tenant scope.
-- Tenant-led unique key (ADR-0008). No FKs (bare-id refs, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tracking"."delivery_retries" (
  "id"                 UUID         NOT NULL,
  "tenant_id"          TEXT         NOT NULL,
  "event_id"           TEXT         NOT NULL,
  "destination"        TEXT         NOT NULL,
  "platform"           TEXT         NOT NULL,
  "status"             TEXT         NOT NULL DEFAULT 'pending',
  "attempts"           INTEGER      NOT NULL DEFAULT 1,
  "event_timestamp"    TIMESTAMP(3) NOT NULL,
  "window_expires_at"  TIMESTAMP(3) NOT NULL,
  "next_retry_at"      TIMESTAMP(3) NOT NULL,
  "last_error"         TEXT,
  "dead_letter_reason" TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  "settled_at"         TIMESTAMP(3),
  CONSTRAINT "delivery_retries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_retries_status_check" CHECK ("status" IN ('pending', 'delivered', 'dead_lettered'))
);
CREATE UNIQUE INDEX "delivery_retries_tenant_id_event_id_destination_key" ON "tracking"."delivery_retries" ("tenant_id", "event_id", "destination");
CREATE INDEX "delivery_retries_status_next_retry_at_idx" ON "tracking"."delivery_retries" ("status", "next_retry_at");
ALTER TABLE "tracking"."delivery_retries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."delivery_retries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."delivery_retries";
CREATE POLICY tenant_isolation ON "tracking"."delivery_retries" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS due_scan_read ON "tracking"."delivery_retries";
CREATE POLICY due_scan_read ON "tracking"."delivery_retries" FOR SELECT
  USING (true);

RESET row_security;
