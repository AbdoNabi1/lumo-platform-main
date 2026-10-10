-- Plan 3C — store settings, shipping zones and rates, taxes, and the address province. Written by
-- hand, NOT applied by the agent; the owner deploys it from Railway's Console BEFORE the release
-- that reads these tables. Additive, expand-only (MIGRATIONS.md §1). Every new table is tenant-scoped,
-- so each gets its OWN RLS policy explicitly (the loop-based 20260823000000_rls_tenant_isolation
-- migration only covers tables that existed when it ran, G-63). No grants: earlier migrations add none.
SET row_security = off;

CREATE TABLE "tenancy"."store_settings" (
  "tenant_id"     TEXT NOT NULL,
  "store_name"    TEXT NOT NULL DEFAULT '',
  "contact_email" TEXT,
  "currency"      CHAR(3) NOT NULL DEFAULT 'EGP',
  "timezone"      TEXT NOT NULL DEFAULT 'Africa/Cairo',
  "weight_unit"   TEXT NOT NULL DEFAULT 'kg',
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_settings_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "store_settings_weight_unit_check" CHECK ("weight_unit" IN ('kg', 'g', 'lb', 'oz'))
);
ALTER TABLE "tenancy"."store_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenancy"."store_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenancy"."store_settings";
CREATE POLICY tenant_isolation ON "tenancy"."store_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- One row per shop that has products: its most used variant currency (the store currency until
-- now was only implied by its products).
INSERT INTO "tenancy"."store_settings" ("tenant_id", "currency")
SELECT DISTINCT ON ("tenant_id") "tenant_id", "currency"
FROM (
  SELECT "tenant_id", "currency", COUNT(*) AS n
  FROM "catalog"."product_variants"
  WHERE length("currency") = 3
  GROUP BY "tenant_id", "currency"
) AS c
ORDER BY "tenant_id", n DESC
ON CONFLICT ("tenant_id") DO NOTHING;

CREATE TABLE "shipping"."shipping_zones" (
  "id"         UUID NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "profile"    TEXT NOT NULL DEFAULT 'general',
  "name"       TEXT NOT NULL,
  "countries"  JSONB NOT NULL DEFAULT '[]',
  "position"   INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipping_zones_tenant_id_profile_idx" ON "shipping"."shipping_zones" ("tenant_id", "profile");
ALTER TABLE "shipping"."shipping_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping"."shipping_zones" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shipping"."shipping_zones";
CREATE POLICY tenant_isolation ON "shipping"."shipping_zones" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "shipping"."shipping_rates" (
  "id"             UUID NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "zone_id"        UUID NOT NULL,
  "name"           TEXT NOT NULL,
  "price_minor"    INTEGER NOT NULL,
  "condition_type" TEXT NOT NULL DEFAULT 'none',
  "condition_min"  BIGINT,
  "condition_max"  BIGINT,
  "description"    TEXT,
  "position"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipping_rates_zone_id_fkey" FOREIGN KEY ("zone_id")
    REFERENCES "shipping"."shipping_zones" ("id") ON DELETE CASCADE,
  CONSTRAINT "shipping_rates_condition_type_check" CHECK ("condition_type" IN ('none', 'order_price', 'weight'))
);
CREATE INDEX "shipping_rates_tenant_id_zone_id_idx" ON "shipping"."shipping_rates" ("tenant_id", "zone_id");
ALTER TABLE "shipping"."shipping_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping"."shipping_rates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shipping"."shipping_rates";
CREATE POLICY tenant_isolation ON "shipping"."shipping_rates" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "finance"."tax_settings" (
  "tenant_id"              TEXT NOT NULL,
  "prices_include_tax"     BOOLEAN NOT NULL DEFAULT true,
  "charge_tax_on_shipping" BOOLEAN NOT NULL DEFAULT false,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "finance"."tax_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance"."tax_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "finance"."tax_settings";
CREATE POLICY tenant_isolation ON "finance"."tax_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "finance"."tax_regions" (
  "id"                UUID NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "country_code"      CHAR(2) NOT NULL,
  "rate_basis_points" INTEGER NOT NULL,
  "provinces"         JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "tax_regions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_regions_tenant_id_country_code_key" UNIQUE ("tenant_id", "country_code"),
  CONSTRAINT "tax_regions_rate_check" CHECK ("rate_basis_points" BETWEEN 0 AND 10000)
);
ALTER TABLE "finance"."tax_regions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance"."tax_regions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "finance"."tax_regions";
CREATE POLICY tenant_isolation ON "finance"."tax_regions" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "province" TEXT;

RESET row_security;
