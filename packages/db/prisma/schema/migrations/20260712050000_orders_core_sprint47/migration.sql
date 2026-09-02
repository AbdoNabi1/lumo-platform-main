-- AlterTable
ALTER TABLE "orders"."orders"
    ADD COLUMN "checkout_ref" TEXT,
    ADD COLUMN "payment_ref" TEXT,
    ADD COLUMN "fulfillment_ref" TEXT,
    ADD COLUMN "billing_address" JSONB,
    ADD COLUMN "totals" JSONB;

-- No foreign keys added: checkout_ref/payment_ref/fulfillment_ref are bare references, consistent
-- with this schema's existing customer_ref/product_ref convention.
