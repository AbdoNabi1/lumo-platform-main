-- Sprint 5.2 (Customer Experience Platform) -- NEW `reviews`, `search`, `recommendations` schemas.
-- Additive & expand-only (doc 15 2.4): three new PostgreSQL schemas + one table each; no change to any existing
-- context. Ownership: Catalog owns products; Reviews reference product/customer refs only and never modify
-- products (Orders decides the verified-purchase snapshot; moderation is replay-safe by actionId). Search owns
-- the ONE index projection's config only (ADR-0020) — documents are snapshots projected asynchronously through
-- the index provider port (OpenSearch/pgvector, deferred); Catalog is the source of truth. Recommendations owns
-- models + generated relationship SETS (bare product refs), never products. All composite state is JSONB;
-- cross-context refs are bare ids (no FKs, D-002). Generated offline; apply with `prisma migrate deploy`.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reviews";
CREATE SCHEMA IF NOT EXISTS "search";
CREATE SCHEMA IF NOT EXISTS "recommendations";

-- CreateTable: reviews.reviews
CREATE TABLE "reviews"."reviews" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_ref" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "verified_purchase" BOOLEAN NOT NULL DEFAULT false,
    "media" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "votes" JSONB NOT NULL DEFAULT '[]',
    "moderations" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reviews_tenant_id_product_ref_idx" ON "reviews"."reviews"("tenant_id", "product_ref");
CREATE INDEX "reviews_tenant_id_status_idx" ON "reviews"."reviews"("tenant_id", "status");

-- CreateTable: search.search_indexes
CREATE TABLE "search"."search_indexes" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "index_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "facet_fields" JSONB NOT NULL DEFAULT '[]',
    "sortable_fields" JSONB NOT NULL DEFAULT '[]',
    "synonyms" JSONB NOT NULL DEFAULT '[]',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "document_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_indexes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "search_indexes_tenant_id_index_key_key" ON "search"."search_indexes"("tenant_id", "index_key");
CREATE INDEX "search_indexes_tenant_id_status_idx" ON "search"."search_indexes"("tenant_id", "status");

-- CreateTable: recommendations.recommendation_models
CREATE TABLE "recommendations"."recommendation_models" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sets" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_models_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recommendation_models_tenant_id_model_key_key" ON "recommendations"."recommendation_models"("tenant_id", "model_key");
CREATE INDEX "recommendation_models_tenant_id_status_idx" ON "recommendations"."recommendation_models"("tenant_id", "status");
CREATE INDEX "recommendation_models_tenant_id_strategy_idx" ON "recommendations"."recommendation_models"("tenant_id", "strategy");
