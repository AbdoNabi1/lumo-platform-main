-- P5 Universal Event & Tracking Platform (ADR-0032, M6/M6.6) — the `tracking` schema.
--
-- ## Scope note: this is wider than "the new registry table"
--
-- M6 added `tracking.prisma` and M6.6 added `TrackingRegistryEntry` to it, but no migration was ever
-- generated for either. `"tracking"` was listed in the datasource `schemas` array while no migration
-- had ever run `CREATE SCHEMA "tracking"`, so the schema and all three of its tables existed only in
-- the Prisma datamodel. A deploy would have started the ingest consumer against a database with no
-- tracking schema at all: `loadTrackingRegistry` would fail on the first read, and — worse, had it
-- not failed closed — every captured event would have been recorded nowhere. So this migration lands
-- the whole context, not a single table.
--
-- ## Invariants (MIGRATIONS.md §2) and where this deliberately differs
--
-- - `tenant_id` on every row, and every unique/index is tenant-led (ADR-0008). Held throughout.
-- - **No `version` optimistic-locking column.** The convention exists for aggregate roots that are
--   read-modify-written; none of these tables have an UPDATE path. `EventRecordWriterPort` exposes
--   `append`/`appendHistory` and deliberately no `update`, and registry definition versions are
--   immutable rows. An optimistic-locking column here would imply a concurrent-update story that
--   must never exist. Concurrency is resolved by the uniques below rejecting the second writer.
-- - **No cross-context foreign key.** The single FK is `tracking_event_revisions` →
--   `tracking_event_records`, which is inside one aggregate and inside one schema (D-002).
--
-- ## Why `ON DELETE RESTRICT` on the only foreign key
--
-- The default cascade would let deleting a record silently take its entire delivery history with it.
-- These rows are a system of record that replay depends on, not telemetry: `RESTRICT` turns an
-- attempted history deletion into an error a human sees rather than a gap nobody finds. The
-- `ON UPDATE CASCADE` is Prisma's default and is inert — `(tenant_id, event_id)` is never updated.
--
-- Expand-only, per the zero-downtime rule (doc 15 §2.4): everything here is a create, nothing
-- existing is altered or dropped, so it is safe to apply before the new app version serves traffic.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tracking";

-- CreateTable
CREATE TABLE "tracking"."tracking_registry_entries" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_registry_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking"."tracking_event_records" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "dedup_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "envelope" JSONB NOT NULL,
    "consent" JSONB NOT NULL,
    "identity" JSONB NOT NULL,
    "attribution" JSONB,
    "versions" JSONB NOT NULL,
    "hash_status" TEXT,
    "identity_confidence" DOUBLE PRECISION,
    "stage_history" JSONB NOT NULL DEFAULT '[]',
    "destination_history" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_event_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking"."tracking_event_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "revision_seq" INTEGER NOT NULL,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "destinations" JSONB NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_event_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracking_registry_entries_tenant_id_kind_status_idx" ON "tracking"."tracking_registry_entries"("tenant_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_registry_entries_tenant_id_kind_key_version_key" ON "tracking"."tracking_registry_entries"("tenant_id", "kind", "key", "version");

-- CreateIndex
CREATE INDEX "tracking_event_records_tenant_id_captured_at_idx" ON "tracking"."tracking_event_records"("tenant_id", "captured_at");

-- CreateIndex
CREATE INDEX "tracking_event_records_tenant_id_event_name_captured_at_idx" ON "tracking"."tracking_event_records"("tenant_id", "event_name", "captured_at");

-- CreateIndex
CREATE INDEX "tracking_event_records_tenant_id_state_idx" ON "tracking"."tracking_event_records"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "tracking_event_records_tenant_id_dedup_id_idx" ON "tracking"."tracking_event_records"("tenant_id", "dedup_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_event_records_tenant_id_event_id_key" ON "tracking"."tracking_event_records"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "tracking_event_revisions_tenant_id_event_id_idx" ON "tracking"."tracking_event_revisions"("tenant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_event_revisions_tenant_id_event_id_revision_seq_key" ON "tracking"."tracking_event_revisions"("tenant_id", "event_id", "revision_seq");

-- AddForeignKey
ALTER TABLE "tracking"."tracking_event_revisions" ADD CONSTRAINT "tracking_event_revisions_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "tracking"."tracking_event_records"("tenant_id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;
