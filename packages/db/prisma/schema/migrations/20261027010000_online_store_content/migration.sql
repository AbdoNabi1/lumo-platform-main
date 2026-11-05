-- Project 4 Part 2 — Online Store content: navigation menus, store policies and page bodies.
-- Written by hand, NOT applied by the agent; the owner deploys it from Railway's Console BEFORE the
-- release that reads these tables. Additive and expand-only (MIGRATIONS.md §1): two new tables in
-- the existing "online_store" schema and four new columns on "pages"."pages" (all with defaults or
-- nullable), nothing is dropped or rewritten and there is no backfill (an absent menu row means the
-- virtual default menu, an absent policy row means "not set", an existing page has empty content).
-- Each new table is tenant-scoped and gets its OWN RLS policy explicitly, exactly as
-- 20261027000000_online_store_identity. "pages"."pages" already has its policy from the loop in the
-- reconstructed 20260823000000_rls_tenant_isolation (the table predates it); that file has never been
-- executed anywhere, so the policy is re-asserted here idempotently (DROP POLICY IF EXISTS first).
-- No FKs to other schemas (bare-id refs, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "online_store";

CREATE TABLE "online_store"."menus" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "handle"     TEXT         NOT NULL,
  "title"      TEXT         NOT NULL,
  "items"      JSONB        NOT NULL DEFAULT '[]',
  "version"    INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menus_handle_format_check" CHECK ("handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX "menus_tenant_id_handle_key" ON "online_store"."menus" ("tenant_id", "handle");
ALTER TABLE "online_store"."menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."menus" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."menus";
CREATE POLICY tenant_isolation ON "online_store"."menus" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."policies" (
  "tenant_id"  TEXT         NOT NULL,
  "type"       TEXT         NOT NULL,
  "body"       JSONB        NOT NULL DEFAULT '{}',
  "updated_by" TEXT,
  "version"    INTEGER      NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policies_pkey" PRIMARY KEY ("tenant_id", "type"),
  CONSTRAINT "policies_type_check" CHECK ("type" IN ('refund', 'shipping', 'privacy', 'terms', 'contact'))
);
ALTER TABLE "online_store"."policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."policies";
CREATE POLICY tenant_isolation ON "online_store"."policies" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "pages"."pages" ADD COLUMN "title"            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "body"             JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "meta_description" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "published_at"     TIMESTAMP(3);
-- Pages published before this column existed get their last update as the publish time.
UPDATE "pages"."pages" SET "published_at" = "updated_at"
  WHERE "status" = 'published' AND "published_at" IS NULL;
CREATE INDEX "pages_tenant_id_status_idx" ON "pages"."pages" ("tenant_id", "status");
ALTER TABLE "pages"."pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pages"."pages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pages"."pages";
CREATE POLICY tenant_isolation ON "pages"."pages" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
