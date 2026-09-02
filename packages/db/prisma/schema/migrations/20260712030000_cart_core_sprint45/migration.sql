-- AlterTable: customer_ref becomes nullable (guest cart support), session_ref added
ALTER TABLE "cart"."carts"
    ALTER COLUMN "customer_ref" DROP NOT NULL,
    ADD COLUMN "session_ref" TEXT NOT NULL DEFAULT '';

-- Drop the temporary default once existing rows are backfilled (documented, not executed live —
-- Postgres unavailable on this host, same honest-gating status as every prior migration).
ALTER TABLE "cart"."carts" ALTER COLUMN "session_ref" DROP DEFAULT;

-- AlterTable: cart item snapshots
ALTER TABLE "cart"."cart_items"
    ADD COLUMN "inventory_snapshot" JSONB,
    ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "carts_tenant_id_session_ref_idx" ON "cart"."carts"("tenant_id", "session_ref");

-- No foreign keys added: session_ref is a bare reference, consistent with this schema's existing
-- customer_ref/product_ref convention.
