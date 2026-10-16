-- Plan 1A — shop domains (Shopify's `Domain`): the hostnames a shop is served on.
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH or BEFORE the
-- release that reads `tenancy.shop_domains`.
--
-- PURELY ADDITIVE: one new table, nothing existing is altered, so it is safe in any order relative
-- to every earlier migration.
--
-- WHOSE ROW. Platform-tenant scoped (`tenant_id`, the ADR-0014 8f scope the tenancy context is pinned
-- to), exactly like `tenancy.tenants`; `shop_ref` is the merchant tenant the hostname serves. RLS is
-- ENABLED and FORCED with the same `tenant_isolation` policy every tenant-scoped table carries.
--
-- INVARIANTS AT THE DATABASE. `hostname` is unique platform-wide (one name serves one shop); a shop
-- has at most one primary (partial unique index, which Prisma cannot express); a primary domain is
-- always verified, and `verified_at` is set exactly when `status` is verified.

CREATE TABLE "tenancy"."shop_domains" (
  "id"          UUID         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "shop_ref"    TEXT         NOT NULL,
  "hostname"    TEXT         NOT NULL,
  "kind"        TEXT         NOT NULL,
  "status"      TEXT         NOT NULL,
  "is_primary"  BOOLEAN      NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "version"     INTEGER      NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shop_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_domains_kind_check" CHECK ("kind" IN ('platform', 'custom')),
  CONSTRAINT "shop_domains_status_check" CHECK ("status" IN ('pending', 'verified')),
  CONSTRAINT "shop_domains_verified_at_check"
    CHECK (("status" = 'verified') = ("verified_at" IS NOT NULL)),
  CONSTRAINT "shop_domains_primary_is_verified_check"
    CHECK (NOT "is_primary" OR "status" = 'verified'),
  CONSTRAINT "shop_domains_hostname_lowercase_check" CHECK ("hostname" = lower("hostname"))
);

CREATE UNIQUE INDEX "shop_domains_hostname_key"
  ON "tenancy"."shop_domains" ("hostname");

CREATE INDEX "shop_domains_tenant_id_shop_ref_idx"
  ON "tenancy"."shop_domains" ("tenant_id", "shop_ref");

CREATE UNIQUE INDEX "shop_domains_one_primary_per_shop"
  ON "tenancy"."shop_domains" ("tenant_id", "shop_ref")
  WHERE "is_primary";

ALTER TABLE "tenancy"."shop_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenancy"."shop_domains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenancy"."shop_domains";
CREATE POLICY tenant_isolation ON "tenancy"."shop_domains" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "tenancy"."shop_domains" IS
  'Plan 1A: hostnames a shop is served on. Platform-tenant scoped, RLS forced. Only verified rows resolve.';
