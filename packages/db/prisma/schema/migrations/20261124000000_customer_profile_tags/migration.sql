-- Customer profile and staff annotations. Written by hand, NOT applied by the agent;
-- the owner deploys it before the release that reads it. Additive only, no backfill.
-- Notes and tags do not belong to the customer aggregate and do not bump its version.
ALTER TABLE "identity"."customers" ADD COLUMN "phone" TEXT;
ALTER TABLE "identity"."customers" ADD COLUMN "language" TEXT;
ALTER TABLE "identity"."customers" ADD COLUMN "note" TEXT;
ALTER TABLE "identity"."customers" ADD CONSTRAINT "customers_language_check" CHECK ("language" IS NULL OR "language" IN ('en','ar'));

CREATE TABLE "identity"."customer_tags" (
  "tenant_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "tag" TEXT NOT NULL,
  "tag_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customer_id", "tag_key")
);
CREATE INDEX "customer_tags_tenant_id_tag_key_idx" ON "identity"."customer_tags"("tenant_id", "tag_key");
ALTER TABLE "identity"."customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "identity"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "identity"."customer_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."customer_tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity"."customer_tags";
CREATE POLICY tenant_isolation ON "identity"."customer_tags" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
