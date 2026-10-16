-- Plan 2B-1 — stock per variant. Written by hand, NOT applied by the agent; the owner deploys it from
-- Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the
-- release whose Prisma schema reads these columns.
--
-- ROW LEVEL SECURITY: `inventory_items` has FORCE RLS keyed on `app.tenant_id`, which no migration
-- session sets — under a role without BYPASSRLS the backfill UPDATE would silently match nothing.
-- `row_security = off` turns that into an ERROR instead (same as 20260924010000).
SET row_security = off;

-- (1) The variant a stock row belongs to. NULL = a legacy product-level row.
ALTER TABLE "inventory"."inventory_items" ADD COLUMN "variant_ref" TEXT;

-- (2) Backfill: a product with exactly ONE variant — its stock is that variant's stock. Every live
-- product has one variant, so every live row is assigned. Products with several variants keep their
-- legacy row NULL (the application reads it only while it is that product's only row).
UPDATE "inventory"."inventory_items" AS i
SET "variant_ref" = v.only_variant
FROM (
  SELECT "tenant_id", "product_id"::text AS product_ref, MIN("id"::text) AS only_variant
  FROM "catalog"."product_variants"
  GROUP BY "tenant_id", "product_id"
  HAVING COUNT(*) = 1
) AS v
WHERE i."tenant_id" = v."tenant_id"
  AND i."product_ref" = v.product_ref
  AND i."variant_ref" IS NULL;

-- (3) The natural key widens from (tenant, product, warehouse) to (tenant, product, variant,
-- warehouse); NULLS NOT DISTINCT keeps one legacy row per product and warehouse, as before.
DROP INDEX IF EXISTS "inventory"."inventory_items_tenant_id_product_ref_warehouse_id_key";
CREATE UNIQUE INDEX "inventory_items_tenant_id_product_ref_variant_ref_warehouse_id_key"
  ON "inventory"."inventory_items" ("tenant_id", "product_ref", "variant_ref", "warehouse_id")
  NULLS NOT DISTINCT;

-- (4) Shopify's two inventory switches on the variant; defaults equal today's behaviour.
ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "tracks_inventory" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inventory_policy" TEXT    NOT NULL DEFAULT 'deny';

RESET row_security;
