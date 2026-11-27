ALTER TABLE "tenancy"."store_settings"
  ADD COLUMN "site_type" TEXT NOT NULL DEFAULT 'store',
  ADD COLUMN "site_type_settled_at" TIMESTAMP(3);
ALTER TABLE "tenancy"."store_settings"
  ADD CONSTRAINT "store_settings_site_type_check" CHECK ("site_type" IN ('store', 'lead_site'));
