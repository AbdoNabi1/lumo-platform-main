-- Order operations Part 2 — the order's staff note, its tags and the staff timeline (comments and
-- annotation activity). Written by hand, NOT applied by the agent; the owner deploys it from Railway's
-- Console BEFORE the release that reads it, after 20261018000000_order_archive. Additive only, no
-- backfill. None of it belongs to the Order aggregate: OrderMapper never writes these columns or
-- tables, so a note, tag or comment never bumps "version" (no conflict with a payment webhook).
ALTER TABLE "orders"."orders" ADD COLUMN "note" TEXT;

-- tag is the spelling as typed (trimmed, inner spaces collapsed); tag_key is lower(tag), the identity
-- used for dedupe, filtering and suggestions.
CREATE TABLE "orders"."order_tags" (
  "tenant_id"  TEXT NOT NULL,
  "order_id"   UUID NOT NULL,
  "tag"        TEXT NOT NULL,
  "tag_key"    TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_tags_pkey" PRIMARY KEY ("order_id", "tag_key")
);
CREATE INDEX "order_tags_tenant_id_tag_key_idx" ON "orders"."order_tags"("tenant_id", "tag_key");
-- The list's tag filter is a Prisma relation filter (EXISTS over order_tags). Prisma models a relation
-- only with its foreign key, and CI's `migrate diff` fails on a relation without one. Orders are never
-- deleted, so RESTRICT (as on order_items and order_events) never fires.
ALTER TABLE "orders"."order_tags" ADD CONSTRAINT "order_tags_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders"."order_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_tags";
CREATE POLICY tenant_isolation ON "orders"."order_tags" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- One table for staff comments and annotation activity ("Ahmed archived this order"). author_name is
-- snapshotted at write time; a deleted comment keeps its row (deleted_at) for the audit trail.
CREATE TABLE "orders"."order_timeline_entries" (
  "id"          UUID NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "order_id"    UUID NOT NULL,
  "kind"        TEXT NOT NULL,
  "author_ref"  TEXT,
  "author_name" TEXT,
  "body"        TEXT,
  "data"        JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL,
  "edited_at"   TIMESTAMP(3),
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "order_timeline_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_timeline_entries_kind_check" CHECK ("kind" IN ('comment','archived','unarchived','note_changed','tags_added','tags_removed','created_from_draft'))
);
CREATE INDEX "order_timeline_entries_order_id_created_at_idx" ON "orders"."order_timeline_entries"("order_id", "created_at");
ALTER TABLE "orders"."order_timeline_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_timeline_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_timeline_entries";
CREATE POLICY tenant_isolation ON "orders"."order_timeline_entries" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
