-- AlterTable
ALTER TABLE "payments"."payment_intents"
    ADD COLUMN "psp_reference" TEXT,
    ADD COLUMN "payment_method" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "authorized_amount_minor" INTEGER;

-- CreateTable
CREATE TABLE "payments"."payment_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intent_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reference" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."processed_webhooks" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_attempts_intent_id_idx" ON "payments"."payment_attempts"("intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhooks_tenant_id_provider_event_id_key" ON "payments"."processed_webhooks"("tenant_id", "provider", "event_id");

-- AddForeignKey
ALTER TABLE "payments"."payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payments"."payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
