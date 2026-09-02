-- AlterTable: Product gains the Commerce Sprint 1 publishing/brand/category/option/seo fields
ALTER TABLE "catalog"."products"
    ADD COLUMN "scheduled_at" TIMESTAMP(3),
    ADD COLUMN "brand_id" UUID,
    ADD COLUMN "category_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "options" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "seo" JSONB;

-- AlterTable: ProductVariant gains its option-matrix selection
ALTER TABLE "catalog"."product_variants"
    ADD COLUMN "selection" JSONB;

-- AlterTable: Category gains its parent reference
ALTER TABLE "catalog"."categories"
    ADD COLUMN "parent_id" UUID;

-- CreateTable
CREATE TABLE "catalog"."brands" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenant_id_slug_key" ON "catalog"."brands"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "products_tenant_id_brand_id_idx" ON "catalog"."products"("tenant_id", "brand_id");

-- CreateIndex
CREATE INDEX "categories_tenant_id_parent_id_idx" ON "catalog"."categories"("tenant_id", "parent_id");

-- No foreign keys added for brand_id/category_refs/parent_id: bare cross/self-reference ids (D-002),
-- same convention as the existing media_refs column.
