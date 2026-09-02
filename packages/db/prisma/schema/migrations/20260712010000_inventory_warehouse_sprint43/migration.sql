-- CreateTable
CREATE TABLE "inventory"."warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "inventory"."warehouses"("tenant_id", "code");

-- No foreign keys: Warehouse is a lean registry entry only (ADR-0013 scope); InventoryItem
-- continues to reference warehouses by bare `warehouse_id`, never an FK.
