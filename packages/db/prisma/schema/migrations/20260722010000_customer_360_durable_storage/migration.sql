-- Phase 9 Operational Hardening — Customer 360 durable storage (Workstream 1).
--
-- ## Scope note: this is wider than "the new persistence layer"
--
-- `customer-360.prisma` (Identity/Profile/Session/Computed-Attribute/Segment Engines, Phases
-- 6.1-6.5) and all 13 Prisma adapters in `services/customer-360/src/infrastructure/` have existed
-- since those phases, and `"customer_360"` has been listed in the datasource `schemas` array since
-- then too — but no migration was ever generated. `wireCustomer360` unconditionally built the
-- in-memory adapters (see the Phase 6.1 audit, `CUSTOMER360_ARCHITECTURE_AUDIT.md` §13.1), so the
-- gap was invisible until this hardening pass wired the Prisma slice into `wireCustomer360` and
-- discovered the schema had never been migrated at all. This migration lands the whole context —
-- all five engines' tables — in one shot, the same reasoning `20260719120000_tracking_platform_p5_m6`
-- recorded for the same situation in the `tracking` schema.
--
-- Generated OFFLINE (no DB host in this environment — see MIGRATIONS.md §1) via:
--   prisma migrate diff --from-schema-datamodel <copy of prisma/schema, minus customer-360.prisma,
--     minus "customer_360" from datasource.schemas[]> --to-schema-datamodel prisma/schema --script
--
-- ## Invariants (MIGRATIONS.md §2) and where this deliberately differs
--
-- - `tenant_id` on every row, and every unique/index is tenant-led (ADR-0008). Held throughout.
-- - **No `version` optimistic-locking column on the three append-only ledger tables**
--   (`identity_links`, `identity_decisions`, `session_transitions`) — there is no UPDATE path to
--   guard; `IdentityGraphStore.appendEdge`/`IdentityDecisionStore.record`/`JourneyStore.record` are
--   insert-only by port contract. The five upsertable-cache tables (`customer_profile_cache`,
--   `customer_session_cache`, `computed_attribute_cache`, `segment_memberships`, plus the two
--   definition tables) DO carry `version`, used as an app-level optimistic-concurrency /
--   compare-and-swap column by their Prisma adapters (`PrismaAttributeStore`/`PrismaSegmentStore`/
--   `PrismaSegmentDefinitionRegistry`'s `updateMany` + `count === 0` ⇒ `ConcurrencyError` idiom,
--   ADR-0060/D-042) — not a Prisma-native optimistic-lock feature, just a plain integer column.
-- - **No cross-context foreign key** — Customer 360 owns no source data (it reuses
--   `@platform/tracking`'s identity-graph domain type and Identity's own event stream), so every
--   reference here is a plain text column, never a FK (D-002). The one FK-shaped relationship this
--   schema has (cache ↔ its own history/snapshot ledger) is deliberately NOT a real foreign key
--   either — each pair is looked up by `(tenant_id, identifier)`, not joined, matching every other
--   cache/ledger pair already established in this schema file's own doc comments.
--
-- Expand-only, per the zero-downtime rule (doc 15 §2.4): everything here is a create, nothing
-- existing is altered or dropped, so it is safe to apply before the new app version serves traffic.
--
-- NOT verified against a live Postgres — no Docker daemon in this environment (same constraint
-- every sprint since 2.2.5 has recorded). The first Docker-host session must run
-- `prisma migrate deploy` against a fresh Postgres and reconcile any drift, per MIGRATIONS.md §1.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "customer_360";

-- CreateTable
CREATE TABLE "customer_360"."identity_links" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_type" TEXT NOT NULL,
    "from_value" TEXT NOT NULL,
    "to_type" TEXT NOT NULL,
    "to_value" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."identity_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_value" TEXT NOT NULL,
    "related_type" TEXT NOT NULL,
    "related_value" TEXT NOT NULL,
    "retracted_from_type" TEXT,
    "retracted_from_value" TEXT,
    "retracted_to_type" TEXT,
    "retracted_to_value" TEXT,
    "retracted_confidence" TEXT,
    "retracted_observed_at" TIMESTAMP(3),
    "retracted_source" TEXT,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."customer_profile_cache" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profile_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."profile_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."customer_session_cache" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "device_id" TEXT,
    "journey_id" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "page_count" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_session_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."session_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "device_id" TEXT,
    "journey_id" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "last_activity_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "page_count" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "session_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."session_transitions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "from_session_id" TEXT,
    "to_session_id" TEXT,
    "reason" TEXT,
    "actor" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."computed_attribute_cache" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computed_attribute_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."computed_attribute_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "attributes" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "computed_attribute_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."computed_attribute_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rule_set" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "computed_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."segment_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL,
    "rule_set" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."segment_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3),
    "exited_at" TIMESTAMP(3),
    "definition_id" TEXT NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "matched_rule_ids" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_360"."segment_history" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "identifier_value" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3),
    "exited_at" TIMESTAMP(3),
    "definition_id" TEXT NOT NULL,
    "definition_version" INTEGER NOT NULL,
    "matched_rule_ids" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "segment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_links_tenant_id_from_type_from_value_idx" ON "customer_360"."identity_links"("tenant_id", "from_type", "from_value");

-- CreateIndex
CREATE INDEX "identity_links_tenant_id_to_type_to_value_idx" ON "customer_360"."identity_links"("tenant_id", "to_type", "to_value");

-- CreateIndex
CREATE INDEX "identity_decisions_tenant_id_subject_type_subject_value_idx" ON "customer_360"."identity_decisions"("tenant_id", "subject_type", "subject_value");

-- CreateIndex
CREATE INDEX "identity_decisions_tenant_id_related_type_related_value_idx" ON "customer_360"."identity_decisions"("tenant_id", "related_type", "related_value");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_cache_tenant_id_identifier_type_identifier_key" ON "customer_360"."customer_profile_cache"("tenant_id", "identifier_type", "identifier_value");

-- CreateIndex
CREATE INDEX "profile_snapshots_tenant_id_identifier_type_identifier_valu_idx" ON "customer_360"."profile_snapshots"("tenant_id", "identifier_type", "identifier_value", "captured_at");

-- CreateIndex
CREATE INDEX "customer_session_cache_tenant_id_visitor_id_status_idx" ON "customer_360"."customer_session_cache"("tenant_id", "visitor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_session_cache_tenant_id_session_id_key" ON "customer_360"."customer_session_cache"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "session_snapshots_tenant_id_session_id_captured_at_idx" ON "customer_360"."session_snapshots"("tenant_id", "session_id", "captured_at");

-- CreateIndex
CREATE INDEX "session_transitions_tenant_id_visitor_id_occurred_at_idx" ON "customer_360"."session_transitions"("tenant_id", "visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "session_transitions_tenant_id_from_session_id_idx" ON "customer_360"."session_transitions"("tenant_id", "from_session_id");

-- CreateIndex
CREATE INDEX "session_transitions_tenant_id_to_session_id_idx" ON "customer_360"."session_transitions"("tenant_id", "to_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "computed_attribute_cache_tenant_id_identifier_type_identifi_key" ON "customer_360"."computed_attribute_cache"("tenant_id", "identifier_type", "identifier_value");

-- CreateIndex
CREATE INDEX "computed_attribute_snapshots_tenant_id_identifier_type_iden_idx" ON "customer_360"."computed_attribute_snapshots"("tenant_id", "identifier_type", "identifier_value", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "computed_attribute_definitions_tenant_id_definition_id_key" ON "customer_360"."computed_attribute_definitions"("tenant_id", "definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "segment_definitions_tenant_id_segment_id_key" ON "customer_360"."segment_definitions"("tenant_id", "segment_id");

-- CreateIndex
CREATE INDEX "segment_memberships_tenant_id_segment_id_status_idx" ON "customer_360"."segment_memberships"("tenant_id", "segment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "segment_memberships_tenant_id_identifier_type_identifier_va_key" ON "customer_360"."segment_memberships"("tenant_id", "identifier_type", "identifier_value", "segment_id");

-- CreateIndex
CREATE INDEX "segment_history_tenant_id_identifier_type_identifier_value__idx" ON "customer_360"."segment_history"("tenant_id", "identifier_type", "identifier_value", "segment_id", "captured_at");
