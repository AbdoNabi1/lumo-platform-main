-- Sprint 5.3 (Platform Intelligence & Operations) -- NEW `reporting`, `feature_flags`, `experiment`, `automation`
-- schemas. Additive & expand-only (doc 15 2.4): four new PostgreSQL schemas + tables; no change to any existing
-- context. Ownership: Reporting is the report/dashboard layer OVER the semantic analytics engine (consumes
-- events only, references the metric/dimension catalog Analytics owns, D-064). Feature Flags is the production
-- source of truth behind the @platform/feature-flags contract (owns rollout/targeting/kill switch). Experiment
-- owns A/B analysis only (Feature Flags own rollout, referenced via feature_flag_ref). Automation orchestrates
-- only (owns no business entities; dispatches via ports/events; retry/dead-letter, replay-safe). All composite
-- state is JSONB; cross-context refs are bare ids (no FKs, D-002). Generated offline; apply with `prisma migrate deploy`.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reporting";
CREATE SCHEMA IF NOT EXISTS "feature_flags";
CREATE SCHEMA IF NOT EXISTS "experiment";
CREATE SCHEMA IF NOT EXISTS "automation";

-- CreateTable: reporting.report_definitions
CREATE TABLE "reporting"."report_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "dimensions" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "cron" TEXT,
    "status" TEXT NOT NULL,
    "runs" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "report_definitions_tenant_id_key_key" ON "reporting"."report_definitions"("tenant_id", "key");
CREATE INDEX "report_definitions_tenant_id_status_idx" ON "reporting"."report_definitions"("tenant_id", "status");

-- CreateTable: reporting.dashboards
CREATE TABLE "reporting"."dashboards" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tiles" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dashboards_tenant_id_key_key" ON "reporting"."dashboards"("tenant_id", "key");
CREATE INDEX "dashboards_tenant_id_status_idx" ON "reporting"."dashboards"("tenant_id", "status");

-- CreateTable: feature_flags.feature_flags
CREATE TABLE "feature_flags"."feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "environments" JSONB NOT NULL DEFAULT '[]',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "feature_flags_tenant_id_key_key" ON "feature_flags"."feature_flags"("tenant_id", "key");
CREATE INDEX "feature_flags_tenant_id_status_idx" ON "feature_flags"."feature_flags"("tenant_id", "status");

-- CreateTable: experiment.experiments
CREATE TABLE "experiment"."experiments" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "goal_ref" TEXT NOT NULL,
    "feature_flag_ref" TEXT,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "winner_variant" TEXT,
    "results" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "experiments_tenant_id_key_key" ON "experiment"."experiments"("tenant_id", "key");
CREATE INDEX "experiments_tenant_id_status_idx" ON "experiment"."experiments"("tenant_id", "status");

-- CreateTable: automation.automation_workflows
CREATE TABLE "automation"."automation_workflows" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL,
    "executions" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_workflows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "automation_workflows_tenant_id_key_key" ON "automation"."automation_workflows"("tenant_id", "key");
CREATE INDEX "automation_workflows_tenant_id_status_idx" ON "automation"."automation_workflows"("tenant_id", "status");
