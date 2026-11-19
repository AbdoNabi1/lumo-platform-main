-- Order operations Part 4 — draft orders and the invoice link. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads it, after
-- 20261018000000_order_archive, 20261018010000_order_notes_tags_timeline and
-- 20261018020000_checkout_recovery_links (all still undeployed). Additive only, no backfill.

-- A draft a merchant builds for a phone/WhatsApp customer. JSON columns use {} / [] for "unset", like
-- the checkout snapshots. status, invoice_sent_at, completed_at, order_ref, deleted_at, checkout_ref
-- and checkout_version are written by guarded updates only, never by the versioned content save.
CREATE TABLE "orders"."draft_orders" (
  "id"               UUID NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "draft_number"     TEXT NOT NULL,
  "status"           TEXT NOT NULL,
  "currency"         TEXT NOT NULL,
  "customer_ref"     TEXT,
  "contact_email"    TEXT,
  "contact_phone"    TEXT,
  "shipping_address" JSONB NOT NULL DEFAULT '{}',
  "billing_address"  JSONB NOT NULL DEFAULT '{}',
  "lines"            JSONB NOT NULL DEFAULT '[]',
  "discount"         JSONB NOT NULL DEFAULT '{}',
  "shipping"         JSONB NOT NULL DEFAULT '{}',
  "note"             TEXT,
  "tags"             JSONB NOT NULL DEFAULT '[]',
  "checkout_ref"     TEXT,
  "checkout_version" INTEGER,
  "order_ref"        TEXT,
  "invoice_sent_at"  TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "deleted_at"       TIMESTAMP(3),
  "created_by"       TEXT NOT NULL,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "draft_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "draft_orders_status_check" CHECK ("status" IN ('open','invoice_sent','completed'))
);
CREATE UNIQUE INDEX "draft_orders_tenant_id_draft_number_key" ON "orders"."draft_orders"("tenant_id", "draft_number");
CREATE INDEX "draft_orders_tenant_id_status_idx" ON "orders"."draft_orders"("tenant_id", "status");
ALTER TABLE "orders"."draft_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."draft_orders" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."draft_orders";
CREATE POLICY tenant_isolation ON "orders"."draft_orders" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Draft numbers D1, D2, … share the shop's counter row with order numbers (one atomic upsert).
ALTER TABLE "orders"."order_number_counters" ADD COLUMN "last_draft_number" INTEGER NOT NULL DEFAULT 0;

-- A draft's checkout carries the merchant's fixed terms ({} = an ordinary checkout).
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "draft_terms" JSONB NOT NULL DEFAULT '{}';

-- A draft's invoice links (detail page; revocation on complete/delete).
CREATE INDEX "checkout_links_tenant_id_draft_order_ref_idx" ON "checkout"."checkout_links"("tenant_id", "draft_order_ref");
