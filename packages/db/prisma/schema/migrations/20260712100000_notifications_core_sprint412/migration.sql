-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "notifications";

-- CreateTable
CREATE TABLE "notifications"."notifications" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "recipient" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "channel_index" INTEGER NOT NULL DEFAULT 0,
    "template" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "policy" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "history" JSONB NOT NULL DEFAULT '[]',
    "delivered_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications"."processed_callbacks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "callback_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_idempotency_key_key" ON "notifications"."notifications"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_source_ref_idx" ON "notifications"."notifications"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_status_idx" ON "notifications"."notifications"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_processed_callbacks_tenant_id_provider_callback_key" ON "notifications"."processed_callbacks"("tenant_id", "provider", "callback_id");
