-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "returns";

-- CreateTable
CREATE TABLE "returns"."return_requests" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "approval" JSONB NOT NULL DEFAULT '{}',
    "rma_number" TEXT,
    "inspections" JSONB NOT NULL DEFAULT '[]',
    "refund_decision" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns"."return_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "return_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reference" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns"."processed_callbacks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "callback_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_requests_tenant_id_order_ref_idx" ON "returns"."return_requests"("tenant_id", "order_ref");

-- CreateIndex
CREATE INDEX "return_requests_tenant_id_status_idx" ON "returns"."return_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "return_attempts_return_id_idx" ON "returns"."return_attempts"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_callbacks_tenant_id_source_callback_id_key" ON "returns"."processed_callbacks"("tenant_id", "source", "callback_id");

-- AddForeignKey
ALTER TABLE "returns"."return_attempts" ADD CONSTRAINT "return_attempts_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"."return_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
