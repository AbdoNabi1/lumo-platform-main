-- Plan 2C-1 — Shopify product data. Written by hand, NOT applied by the agent; the owner deploys it
-- from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH
-- or BEFORE the release that reads these columns.
--
-- ADDITIVE: nullable columns, or NOT NULL with a default that equals today's behaviour (no tags;
-- every variant physical and taxable), so all 13 live products load and sell exactly as before.

ALTER TABLE "catalog"."products"
  ADD COLUMN "description"  TEXT,
  ADD COLUMN "product_type" TEXT,
  ADD COLUMN "tags"         TEXT[] DEFAULT ARRAY[]::TEXT[]; -- nullable like media_refs: what Prisma emits for String[]

ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "compare_at_amount_minor" INTEGER,
  ADD COLUMN "cost_amount_minor"       INTEGER,
  ADD COLUMN "barcode"                 TEXT,
  ADD COLUMN "weight_grams"            INTEGER,
  ADD COLUMN "requires_shipping"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "taxable"                 BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "catalog"."product_variants"."cost_amount_minor" IS
  'Plan 2C-1: cost per item, staff-only (margin). Never exposed on a public route.';
