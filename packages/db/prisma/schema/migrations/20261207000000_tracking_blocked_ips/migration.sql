-- Tracking P1-D9 — the per-store IP block list, plus the lookup index for the cookieless visitor id (P1-D8).
-- Written by hand, NOT applied by the agent; the owner deploys it before the release whose runtime reads it.
-- Additive and expand-only (MIGRATIONS.md §1): one new table in the existing `tracking` schema and one new index
-- on `tracking_profiles`; no backfill, no column change.
--
-- WHAT THE TABLE HOLDS. One row per (tenant, address range) a merchant asked us to ignore: their own office, a
-- staff phone ("exclude this device"), a known scraper. The runtime's collect route skips an ordinary event from a
-- listed address; it never skips an order or a lead, and an unreadable list blocks nothing (fail open). Entries are
-- manual — nothing ever inserts one automatically (Egyptian mobile carriers share one address between thousands of
-- real shoppers). `cidr` is stored in one canonical spelling (`203.0.113.7/32`), at least IPv4 /16 or IPv6 /32 wide,
-- so adding the same range twice is a unique-key no-op. At most 500 rows per tenant (enforced by the service).
--
-- ISOLATION. RLS ENABLE + FORCE with the standard `tenant_isolation` policy (USING + WITH CHECK). Tenant-led unique
-- key and index (ADR-0008). No FKs (bare-id references, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tracking"."blocked_ips" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "cidr"       TEXT         NOT NULL,
  "note"       TEXT,
  "created_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT,
  CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "blocked_ips_tenant_id_cidr_key" ON "tracking"."blocked_ips" ("tenant_id", "cidr");
CREATE INDEX "blocked_ips_tenant_id_created_at_idx" ON "tracking"."blocked_ips" ("tenant_id", "created_at");

ALTER TABLE "tracking"."blocked_ips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking"."blocked_ips" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking"."blocked_ips";
CREATE POLICY tenant_isolation ON "tracking"."blocked_ips" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Tracking P1-D8: the cookieless id is looked up (tenant, fingerprint) when an event carries no visitor cookie.
CREATE INDEX "tracking_profiles_tenant_id_fingerprint_id_idx"
  ON "tracking"."tracking_profiles" ("tenant_id", "fingerprint_id");

RESET row_security;
