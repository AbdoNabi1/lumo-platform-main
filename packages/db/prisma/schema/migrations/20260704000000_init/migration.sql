-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cart";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "checkout";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "media";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "orders";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "payments";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "pricing";

-- CreateTable
CREATE TABLE "cart"."carts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart"."cart_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_ref" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_amount_minor" INTEGER NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "publish_state" TEXT NOT NULL,
    "media_refs" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "price_amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "media_ref" TEXT,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."categories" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout"."checkout_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cart_ref" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "order_ref" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."customers" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."addresses" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."consent_records" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."inventory_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_ref" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."reservations" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media"."assets" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."orders" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_items" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "product_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price_amount_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_events" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_shipping_addresses" (
    "order_id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,

    CONSTRAINT "order_shipping_addresses_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "payments"."payment_intents" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."charges" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intent_id" UUID NOT NULL,
    "psp_token" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."refunds" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "intent_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."outbox" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "headers" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "tenant_id" TEXT,
    "producer" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."inbox_processed_events" (
    "consumer_group" TEXT NOT NULL,
    "message_id" UUID NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_processed_events_pkey" PRIMARY KEY ("consumer_group","message_id")
);

-- CreateTable
CREATE TABLE "platform"."dead_letters" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "consumer_group" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "value" BYTEA NOT NULL,
    "headers" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "failed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."audit_events" (
    "id" UUID NOT NULL,
    "principal_id" TEXT NOT NULL,
    "principal_kind" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "tenant_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing"."price_lists" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing"."prices" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_ref" TEXT NOT NULL,
    "price_list_ref" UUID,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carts_tenant_id_customer_ref_status_idx" ON "cart"."carts"("tenant_id", "customer_ref", "status");

-- CreateIndex
CREATE INDEX "carts_tenant_id_status_updated_at_idx" ON "cart"."carts"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_product_ref_key" ON "cart"."cart_items"("cart_id", "product_ref");

-- CreateIndex
CREATE INDEX "products_tenant_id_publish_state_idx" ON "catalog"."products"("tenant_id", "publish_state");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "catalog"."products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_slug_key" ON "catalog"."products"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "catalog"."product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "catalog"."product_variants"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_slug_key" ON "catalog"."categories"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "checkout_sessions_tenant_id_cart_ref_idx" ON "checkout"."checkout_sessions"("tenant_id", "cart_ref");

-- CreateIndex
CREATE INDEX "checkout_sessions_tenant_id_state_idx" ON "checkout"."checkout_sessions"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "identity"."customers"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "addresses_customer_id_idx" ON "identity"."addresses"("customer_id");

-- CreateIndex
CREATE INDEX "consent_records_customer_id_scope_occurred_at_idx" ON "identity"."consent_records"("customer_id", "scope", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_product_ref_warehouse_id_key" ON "inventory"."inventory_items"("tenant_id", "product_ref", "warehouse_id");

-- CreateIndex
CREATE INDEX "reservations_item_id_idx" ON "inventory"."reservations"("item_id");

-- CreateIndex
CREATE INDEX "reservations_tenant_id_reference_idx" ON "inventory"."reservations"("tenant_id", "reference");

-- CreateIndex
CREATE INDEX "assets_tenant_id_status_idx" ON "media"."assets"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenant_id_storage_key_key" ON "media"."assets"("tenant_id", "storage_key");

-- CreateIndex
CREATE INDEX "orders_tenant_id_customer_ref_created_at_idx" ON "orders"."orders"("tenant_id", "customer_ref", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_order_number_key" ON "orders"."orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "orders"."order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_occurred_at_idx" ON "orders"."order_events"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_intents_tenant_id_order_ref_idx" ON "payments"."payment_intents"("tenant_id", "order_ref");

-- CreateIndex
CREATE INDEX "payment_intents_tenant_id_status_idx" ON "payments"."payment_intents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "charges_intent_id_idx" ON "payments"."charges"("intent_id");

-- CreateIndex
CREATE INDEX "refunds_intent_id_idx" ON "payments"."refunds"("intent_id");

-- CreateIndex
CREATE INDEX "outbox_status_created_at_idx" ON "platform"."outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_created_at_idx" ON "platform"."outbox"("created_at");

-- CreateIndex
CREATE INDEX "inbox_processed_events_processed_at_idx" ON "platform"."inbox_processed_events"("processed_at");

-- CreateIndex
CREATE INDEX "dead_letters_consumer_group_failed_at_idx" ON "platform"."dead_letters"("consumer_group", "failed_at");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "platform"."audit_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_principal_id_occurred_at_idx" ON "platform"."audit_events"("principal_id", "occurred_at");

-- CreateIndex
CREATE INDEX "price_lists_tenant_id_status_idx" ON "pricing"."price_lists"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_tenant_id_name_key" ON "pricing"."price_lists"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "prices_tenant_id_product_ref_idx" ON "pricing"."prices"("tenant_id", "product_ref");

-- CreateIndex
CREATE INDEX "prices_tenant_id_price_list_ref_idx" ON "pricing"."prices"("tenant_id", "price_list_ref");

-- AddForeignKey
ALTER TABLE "cart"."cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "cart"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."addresses" ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "identity"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."consent_records" ADD CONSTRAINT "consent_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "identity"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."reservations" ADD CONSTRAINT "reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory"."inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"."order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments"."charges" ADD CONSTRAINT "charges_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payments"."payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments"."refunds" ADD CONSTRAINT "refunds_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "payments"."payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

