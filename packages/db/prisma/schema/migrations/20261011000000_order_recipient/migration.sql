-- Plan 3A — who receives the order, and how to reach them. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console
-- (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release whose
-- Prisma schema reads these columns. Nullable: orders placed before this plan have none.
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "recipient_name" TEXT;
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "phone" TEXT;
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "line2" TEXT;
