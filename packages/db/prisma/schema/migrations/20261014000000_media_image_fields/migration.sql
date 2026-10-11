-- Plan 2C-3 — what an image is (type, size, dimensions) and how to describe it (alt). Written by
-- hand, NOT applied by the agent; the owner deploys it from Railway's Console BEFORE the release
-- that reads these columns. Nullable: assets registered before this plan have none.
ALTER TABLE "media"."media_assets" ADD COLUMN "content_type" TEXT;
ALTER TABLE "media"."media_assets" ADD COLUMN "byte_size" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "width" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "height" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "alt" TEXT;
