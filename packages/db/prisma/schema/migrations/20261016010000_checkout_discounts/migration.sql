-- Phase 2 (Shopify-style discounts) — the codes a shopper entered and the discounts Promotions
-- decided for the session. Written by hand, NOT applied by the agent; the owner deploys it BEFORE
-- the release that reads it. Additive with a default: existing sessions read as having none.
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "discounts" JSONB NOT NULL DEFAULT '{}';
