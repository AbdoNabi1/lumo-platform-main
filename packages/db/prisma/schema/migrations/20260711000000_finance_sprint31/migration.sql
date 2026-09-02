-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "finance";

-- CreateTable
CREATE TABLE "finance"."journals" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "reversal_of_journal_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "journal_id" UUID NOT NULL,
    "source_ref" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "memo" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."accounts" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."cost_centers" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."expense_categories" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost_center_ref" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."expenses" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cost_center_ref" TEXT NOT NULL,
    "category_ref" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."budgets" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cost_center_ref" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "revisions" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."exchange_rates" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."fiscal_periods" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."tax_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."cogs_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_ref" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "currency" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cogs_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."financial_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "figures" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journals_tenant_id_source_ref_idx" ON "finance"."journals"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX "journals_tenant_id_posted_at_idx" ON "finance"."journals"("tenant_id", "posted_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_account_ref_idx" ON "finance"."ledger_entries"("tenant_id", "account_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_posted_at_idx" ON "finance"."ledger_entries"("tenant_id", "posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "finance"."accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_tenant_id_code_key" ON "finance"."cost_centers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "expense_categories_tenant_id_idx" ON "finance"."expense_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_incurred_at_idx" ON "finance"."expenses"("tenant_id", "incurred_at");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_cost_center_ref_idx" ON "finance"."expenses"("tenant_id", "cost_center_ref");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenant_id_cost_center_ref_period_key" ON "finance"."budgets"("tenant_id", "cost_center_ref", "period");

-- CreateIndex
CREATE INDEX "exchange_rates_tenant_id_base_currency_quote_currency_effe_idx" ON "finance"."exchange_rates"("tenant_id", "base_currency", "quote_currency", "effective_at");

-- CreateIndex
CREATE INDEX "fiscal_periods_tenant_id_start_date_end_date_idx" ON "finance"."fiscal_periods"("tenant_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_tenant_id_jurisdiction_key" ON "finance"."tax_profiles"("tenant_id", "jurisdiction");

-- CreateIndex
CREATE INDEX "cogs_snapshots_tenant_id_product_ref_effective_at_idx" ON "finance"."cogs_snapshots"("tenant_id", "product_ref", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "financial_snapshots_tenant_id_period_key" ON "finance"."financial_snapshots"("tenant_id", "period");

-- AddForeignKey
ALTER TABLE "finance"."ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "finance"."journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
