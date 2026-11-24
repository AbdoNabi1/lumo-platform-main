-- Customer segments. Written by hand, NOT applied by the agent;
-- the owner deploys it before the release that reads it. Additive only, no backfill.
CREATE TABLE "identity"."customer_segments" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_segments_tenant_id_name_key_key" ON "identity"."customer_segments"("tenant_id", "name_key");
CREATE INDEX "customer_segments_tenant_id_created_at_idx" ON "identity"."customer_segments"("tenant_id", "created_at");
ALTER TABLE "identity"."customer_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."customer_segments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity"."customer_segments";
CREATE POLICY tenant_isolation ON "identity"."customer_segments" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
