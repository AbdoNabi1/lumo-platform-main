-- Sprint 5.1 (Commerce Growth Platform) -- NEW `promotions`, `coupons`, `loyalty`, `wishlist` schemas.
-- Additive & expand-only (doc 15 2.4): four new PostgreSQL schemas + one table each; no change to any existing
-- context. Ownership (arch 03): Pricing owns prices; Promotions only DETERMINE a discount; Coupons only
-- AUTHORIZE a promotion; Checkout applies; Orders snapshot. Loyalty points are NOT money (no payment capture);
-- rewards never modify orders. Wishlist stores product REFERENCES only (owns no product data). All composite
-- state is JSONB on the single row; cross-context refs are bare ids (no FKs, D-002). Generated offline; apply
-- with `prisma migrate deploy`.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "promotions";
CREATE SCHEMA IF NOT EXISTS "coupons";
CREATE SCHEMA IF NOT EXISTS "loyalty";
CREATE SCHEMA IF NOT EXISTS "wishlist";

-- CreateTable: promotions.promotions
CREATE TABLE "promotions"."promotions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "campaign" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "usage_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "promotions_tenant_id_status_idx" ON "promotions"."promotions"("tenant_id", "status");
CREATE INDEX "promotions_tenant_id_type_idx" ON "promotions"."promotions"("tenant_id", "type");

-- CreateTable: coupons.coupons
CREATE TABLE "coupons"."coupons" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "promotion_ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "customer_ref" TEXT,
    "usage_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "campaign_ref" TEXT,
    "status" TEXT NOT NULL,
    "redemptions" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_tenant_id_code_key" ON "coupons"."coupons"("tenant_id", "code");
CREATE INDEX "coupons_tenant_id_status_idx" ON "coupons"."coupons"("tenant_id", "status");
CREATE INDEX "coupons_tenant_id_promotion_ref_idx" ON "coupons"."coupons"("tenant_id", "promotion_ref");

-- CreateTable: loyalty.loyalty_accounts
CREATE TABLE "loyalty"."loyalty_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_earned" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transactions" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "loyalty_accounts_tenant_id_customer_ref_key" ON "loyalty"."loyalty_accounts"("tenant_id", "customer_ref");
CREATE INDEX "loyalty_accounts_tenant_id_status_idx" ON "loyalty"."loyalty_accounts"("tenant_id", "status");

-- CreateTable: wishlist.wishlists
CREATE TABLE "wishlist"."wishlists" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "share_token" TEXT,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wishlists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wishlists_tenant_id_customer_ref_idx" ON "wishlist"."wishlists"("tenant_id", "customer_ref");
CREATE INDEX "wishlists_tenant_id_status_idx" ON "wishlist"."wishlists"("tenant_id", "status");
