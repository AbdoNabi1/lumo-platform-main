-- Order operations Part 1 — Shopify's reversible "Archive" on an order. Written by hand, NOT applied by
-- the agent; the owner deploys it from Railway's Console BEFORE the release that reads it. Additive and
-- nullable: NULL = not archived, so existing orders need no backfill. The column sits outside the
-- Order aggregate (OrderMapper never writes it), so archiving never bumps "version".
ALTER TABLE "orders"."orders" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "orders_tenant_id_archived_at_idx" ON "orders"."orders"("tenant_id", "archived_at");
