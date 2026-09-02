-- CreateTable
CREATE TABLE "catalog"."collections" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."collection_items" (
    "collection_id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collection_id", "product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collections_tenant_id_slug_key" ON "catalog"."collections"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "collection_items_collection_id_position_idx" ON "catalog"."collection_items"("collection_id", "position");

-- AddForeignKey (intra-aggregate only, per D-002 — collection_items.product_id stays a bare ref)
ALTER TABLE "catalog"."collection_items" ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: the real Sprint 7.0 migration (20260722000000_commerce_core_p7_0) also added `deleted_at`
-- to pricing.prices/pricing.tax_classes. That is out of C2's frozen scope (Pricing is a separate
-- milestone, C4, per PATCH_OWNERSHIP_MATRIX_V5.md Part C) and is intentionally NOT included here —
-- see C2_PRE_FLIGHT_REPORT.md S6/S7.4.
