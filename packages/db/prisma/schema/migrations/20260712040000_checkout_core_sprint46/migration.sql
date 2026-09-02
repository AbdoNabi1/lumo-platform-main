-- AlterTable: customer_ref becomes nullable (guest checkout support), session_ref/currency added,
-- JSONB snapshot columns added ({} = unset, never null), tax_minor/discount_minor added.
ALTER TABLE "checkout"."checkout_sessions"
    ALTER COLUMN "customer_ref" DROP NOT NULL,
    ADD COLUMN "session_ref" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "billing_address" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "shipping_address" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "shipping_selection" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "payment_selection" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "tax_minor" INTEGER,
    ADD COLUMN "discount_minor" INTEGER,
    ADD COLUMN "totals" JSONB NOT NULL DEFAULT '{}';

-- Drop the temporary defaults once existing rows are backfilled (documented, not executed live --
-- Postgres unavailable on this host, same honest-gating status as every prior migration).
ALTER TABLE "checkout"."checkout_sessions" ALTER COLUMN "session_ref" DROP DEFAULT;
ALTER TABLE "checkout"."checkout_sessions" ALTER COLUMN "currency" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "checkout_sessions_tenant_id_session_ref_idx" ON "checkout"."checkout_sessions"("tenant_id", "session_ref");

-- No foreign keys added: all *_ref columns are bare references, consistent with this schema's
-- existing cart_ref/customer_ref/order_ref convention.
