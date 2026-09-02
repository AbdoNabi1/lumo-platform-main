-- Sprint 5.x schema reconciliation (P1.4, investigation C-04).
--
-- The Sprint 5.1-5.6 migrations were restored in this milestone after being dropped from `main`
-- during the history reconstruction. Three models in `prisma/schema/` were evolved AFTER those
-- migrations were authored, and the migration recording that evolution was never written:
--
--   media.MediaFolder  -> media.Folder            renamed; `key` dropped; `parent_ref` renamed
--   pages.PageTemplate -> pages.Template          renamed; `key`/`kind` dropped; uniqueness moved
--                                                 from (tenant_id, key) to (tenant_id, name);
--                                                 `experience_ref` tightened to NOT NULL
--   reporting.AnalyticsReport                     added; no migration ever created it
--
-- Written by hand rather than generated, for the same reason the initial migration was
-- (packages/db/prisma/MIGRATIONS.md S1): no database host is reachable in this environment. The
-- restored migrations are left byte-for-byte as they were authored -- this file is the additive
-- correction on top, per the repo's own rule: never edit an applied migration, always add a new one.
--
-- Safe on an empty database and on one that applied the restored migrations: every statement is a
-- rename/drop/add over tables that, per gap G-41, have never existed in any deployed database.

-- ---------------------------------------------------------------------------------------------
-- media: MediaFolder -> Folder
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "media"."media_folders" RENAME TO "folders";

-- `key` and its uniqueness are gone from the model; a folder is identified by id, and the domain
-- (services/media/src/domain/folder.ts) carries only name/parentFolderRef/status.
DROP INDEX IF EXISTS "media"."media_folders_tenant_key_key";
ALTER TABLE "media"."folders" DROP COLUMN "key";

ALTER TABLE "media"."folders" RENAME COLUMN "parent_ref" TO "parent_folder_ref";

-- Renamed to follow the table, and kept: the parent lookup is a real access path
-- (media-library.use-cases.ts passes `parentFolderRef` when listing a folder's children).
-- Declared in media.prisma as @@index([tenantId, parentFolderRef]) so schema and database agree.
ALTER INDEX "media"."media_folders_tenant_parent_idx"
  RENAME TO "folders_tenant_id_parent_folder_ref_idx";

-- ---------------------------------------------------------------------------------------------
-- pages: PageTemplate -> Template
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "pages"."page_templates" RENAME TO "templates";

DROP INDEX IF EXISTS "pages"."page_templates_tenant_key_key";
ALTER TABLE "pages"."templates" DROP COLUMN "key";
ALTER TABLE "pages"."templates" DROP COLUMN "kind";

-- The model declares `experienceRef String` (not optional): a template always belongs to an
-- experience. Safe to tighten -- the table has never held a row.
ALTER TABLE "pages"."templates" ALTER COLUMN "experience_ref" SET NOT NULL;

-- @@unique([tenantId, name]) replaces the dropped (tenant_id, key) uniqueness.
CREATE UNIQUE INDEX "templates_tenant_id_name_key" ON "pages"."templates" ("tenant_id", "name");

-- ---------------------------------------------------------------------------------------------
-- reporting: AnalyticsReport (new -- write-once run of a ReportDefinition)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "reporting"."analytics_reports" (
  "id"                    UUID PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "report_definition_ref" TEXT NOT NULL,
  "outcome"               TEXT NOT NULL,
  "result_data"           JSONB,
  "error_message"         TEXT,
  "generated_at"          TIMESTAMP(3) NOT NULL,
  "version"               INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "analytics_reports_tenant_id_report_definition_ref_idx"
  ON "reporting"."analytics_reports" ("tenant_id", "report_definition_ref");
