-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "fulfillment";

-- CreateTable
CREATE TABLE "fulfillment"."fulfillment_orders" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "carrier_reference" JSONB NOT NULL DEFAULT '{}',
    "tracking_number" TEXT,
    "packages" JSONB NOT NULL DEFAULT '[]',
    "delivered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."fulfillment_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fulfillment_order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reference" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment"."processed_carrier_webhooks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "webhook_event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_carrier_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fulfillment_orders_tenant_id_order_ref_idx" ON "fulfillment"."fulfillment_orders"("tenant_id", "order_ref");

-- CreateIndex
CREATE INDEX "fulfillment_orders_tenant_id_status_idx" ON "fulfillment"."fulfillment_orders"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "fulfillment_attempts_fulfillment_order_id_idx" ON "fulfillment"."fulfillment_attempts"("fulfillment_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_carrier_webhooks_tenant_id_carrier_webhook_event_key" ON "fulfillment"."processed_carrier_webhooks"("tenant_id", "carrier", "webhook_event_id");

-- AddForeignKey
ALTER TABLE "fulfillment"."fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_fulfillment_order_id_fkey" FOREIGN KEY ("fulfillment_order_id") REFERENCES "fulfillment"."fulfillment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
