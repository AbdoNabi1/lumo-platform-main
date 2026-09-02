-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shipping";

-- CreateTable
CREATE TABLE "shipping"."shipments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fulfillment_ref" TEXT NOT NULL,
    "packages" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "carrier" TEXT,
    "carrier_service" TEXT,
    "label" JSONB NOT NULL DEFAULT '{}',
    "tracking_number" TEXT,
    "tracking_events" JSONB NOT NULL DEFAULT '[]',
    "delivery_estimate" JSONB NOT NULL DEFAULT '{}',
    "delivered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."shipping_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shipment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reference" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping"."processed_webhooks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "webhook_event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tenant_id_idempotency_key_key" ON "shipping"."shipments"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "shipments_tenant_id_fulfillment_ref_idx" ON "shipping"."shipments"("tenant_id", "fulfillment_ref");

-- CreateIndex
CREATE INDEX "shipments_tenant_id_status_idx" ON "shipping"."shipments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "shipping_attempts_shipment_id_idx" ON "shipping"."shipping_attempts"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_processed_webhooks_tenant_id_carrier_webhook_event_key" ON "shipping"."processed_webhooks"("tenant_id", "carrier", "webhook_event_id");

-- AddForeignKey
ALTER TABLE "shipping"."shipping_attempts" ADD CONSTRAINT "shipping_attempts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipping"."shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
