-- Plan 2A — the variant is what is sold. Written by hand, NOT applied by the agent; the owner deploys
-- it from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`)
-- WITH or BEFORE the release that writes variant lines.
--
-- ADDITIVE: nullable columns only, so every existing cart/order line (no variant) stays valid and is
-- read exactly as before. The cart line uniqueness widens from (cart, product) to
-- (cart, product, variant) so two sizes of one product can be two lines; NULLS NOT DISTINCT keeps
-- legacy (variant-less) lines unique per product, exactly as the old index did. Postgres ≥ 15.

ALTER TABLE "cart"."cart_items"
  ADD COLUMN "variant_ref"   TEXT,
  ADD COLUMN "sku"           TEXT,
  ADD COLUMN "title"         TEXT,
  ADD COLUMN "variant_title" TEXT;

DROP INDEX IF EXISTS "cart"."cart_items_cart_id_product_ref_key";
CREATE UNIQUE INDEX "cart_items_cart_id_product_ref_variant_ref_key"
  ON "cart"."cart_items" ("cart_id", "product_ref", "variant_ref") NULLS NOT DISTINCT;

ALTER TABLE "orders"."order_items"
  ADD COLUMN "variant_ref"   TEXT,
  ADD COLUMN "sku"           TEXT,
  ADD COLUMN "variant_title" TEXT;

COMMENT ON COLUMN "cart"."cart_items"."variant_ref" IS
  'Plan 2A: the catalog variant this line sells; NULL on lines written before variants were tracked.';
COMMENT ON COLUMN "orders"."order_items"."variant_ref" IS
  'Plan 2A: snapshot of the variant sold; NULL on orders placed before variants were tracked.';
