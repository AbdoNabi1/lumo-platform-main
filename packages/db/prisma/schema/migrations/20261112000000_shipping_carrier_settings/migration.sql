-- Project 5 Part 1 (local carriers). Written by hand, NOT applied by the agent; the owner deploys it
-- BEFORE the release that reads it. Additive only.
-- (1) shipping.merchant_carrier_settings: one row per merchant. `carrier_settings` holds only sealed
--     envelopes and non-secret config: { [key]: { config, sealedCredentials, webhook: {...} } }.
--     New tenant-scoped table, so it needs its OWN RLS policy (G-63).
-- (2) An index for webhook lookups by (tenant, carrier, tracking number).
CREATE TABLE "shipping"."merchant_carrier_settings" (
  "tenant_id" TEXT NOT NULL,
  "enabled_carriers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "carrier_settings" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "merchant_carrier_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "shipping"."merchant_carrier_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipping"."merchant_carrier_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "shipping"."merchant_carrier_settings";
CREATE POLICY tenant_isolation ON "shipping"."merchant_carrier_settings" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE INDEX "shipments_tenant_id_carrier_tracking_number_idx"
  ON "shipping"."shipments"("tenant_id", "carrier", "tracking_number");
