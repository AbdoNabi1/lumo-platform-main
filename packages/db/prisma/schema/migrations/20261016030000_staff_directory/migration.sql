-- Project 1 (merchant onboarding) — which store a staff email signs in to. Written by hand, NOT
-- applied by the agent; the owner deploys it before the release that reads it. Additive,
-- expand-only (MIGRATIONS.md §1). Platform-operator data like shop_domains: tenant_id is the
-- platform scope and shop_ref is the merchant's tenant. One store per email (unique email).
SET row_security = off;

CREATE TABLE "tenancy"."staff_directory" (
  "tenant_id"         TEXT NOT NULL,
  "email"             TEXT NOT NULL,
  "shop_ref"          TEXT NOT NULL,
  "owner_external_id" TEXT NOT NULL,
  "status"            TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_directory_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "staff_directory_status_check" CHECK ("status" IN ('pending', 'active')),
  CONSTRAINT "staff_directory_email_normalised_check" CHECK ("email" = lower(btrim("email")))
);
CREATE INDEX "staff_directory_shop_ref_idx" ON "tenancy"."staff_directory" ("shop_ref");
ALTER TABLE "tenancy"."staff_directory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenancy"."staff_directory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenancy"."staff_directory";
CREATE POLICY tenant_isolation ON "tenancy"."staff_directory" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
