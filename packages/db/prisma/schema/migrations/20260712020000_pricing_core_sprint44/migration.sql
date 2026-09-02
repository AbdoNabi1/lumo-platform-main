-- AlterTable
ALTER TABLE "pricing"."prices"
    ADD COLUMN "compare_at_minor" INTEGER,
    ADD COLUMN "cost_minor" INTEGER,
    ADD COLUMN "effective_from" TIMESTAMP(3),
    ADD COLUMN "effective_to" TIMESTAMP(3),
    ADD COLUMN "tax_class_ref" UUID,
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
    ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pricing"."tax_classes" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tax_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing"."pricing_rules" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_classes_tenant_id_code_key" ON "pricing"."tax_classes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "pricing_rules_tenant_id_priority_idx" ON "pricing"."pricing_rules"("tenant_id", "priority");

-- No foreign keys: tax_class_ref on prices is a bare reference to tax_classes, not an FK
-- (consistent with this schema's product_ref/price_list_ref convention).
