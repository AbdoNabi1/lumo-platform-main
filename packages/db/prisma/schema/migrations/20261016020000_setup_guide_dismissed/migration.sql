-- Project 1 (merchant onboarding) — when the merchant dismissed Home's setup guide. Written by hand,
-- NOT applied by the agent; the owner deploys it before the release that reads it. Additive,
-- expand-only (MIGRATIONS.md §1). The table already has its RLS policy.
ALTER TABLE "tenancy"."store_settings" ADD COLUMN "setup_guide_dismissed_at" TIMESTAMP(3);
