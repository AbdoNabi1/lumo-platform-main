-- Phase 2 (Shopify-style discounts) — how a promotion reaches a cart and what it combines with.
-- Written by hand, NOT applied by the agent; the owner deploys it BEFORE the release that reads
-- these columns. Additive and nullable: existing rows keep working (NULL method = reachable only
-- through its coupon; class and combinations are derived in the mapper), so no backfill is needed.
ALTER TABLE "promotions"."promotions" ADD COLUMN "method" TEXT;
ALTER TABLE "promotions"."promotions" ADD COLUMN "discount_class" TEXT;
ALTER TABLE "promotions"."promotions" ADD COLUMN "combines_with" JSONB;
CREATE INDEX "promotions_tenant_id_method_status_idx" ON "promotions"."promotions"("tenant_id", "method", "status");
