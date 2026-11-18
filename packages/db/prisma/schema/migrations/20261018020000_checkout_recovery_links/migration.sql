-- Order operations Part 3 — abandoned checkouts and recovery links. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads it, after
-- 20261018000000_order_archive and 20261018010000_order_notes_tags_timeline (both still undeployed).
-- Additive only, no backfill.

-- recovered_from_ref: on a NEW session a recovery link created (the abandoned session's id).
-- recovered_order_ref: on the ORIGINAL session once the recovered checkout became an order.
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_from_ref" TEXT;
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_order_ref" TEXT;
-- The abandoned list reads open sessions of one shop that have been idle for an hour.
CREATE INDEX "checkout_sessions_tenant_id_state_updated_at_idx" ON "checkout"."checkout_sessions"("tenant_id", "state", "updated_at");

-- A link a shopper opens to resume a checkout (recovery) or to pay a draft (invoice, Part 4). Only the
-- hex SHA-256 of the token is stored: the token itself exists only in the link the merchant copied.
-- created_by is the staff principal id; result_checkout_ref is the session the last claim produced.
CREATE TABLE "checkout"."checkout_links" (
  "id"                  UUID NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "purpose"             TEXT NOT NULL,
  "token_hash"          TEXT NOT NULL,
  "checkout_session_id" UUID,
  "draft_order_ref"     TEXT,
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "revoked_at"          TIMESTAMP(3),
  "created_by"          TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_count"         INTEGER NOT NULL DEFAULT 0,
  "last_claimed_at"     TIMESTAMP(3),
  "result_checkout_ref" TEXT,
  CONSTRAINT "checkout_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_links_purpose_check" CHECK ("purpose" IN ('recovery','invoice')),
  CONSTRAINT "checkout_links_target_check" CHECK (
    ("purpose" = 'recovery' AND "checkout_session_id" IS NOT NULL) OR
    ("purpose" = 'invoice'  AND "draft_order_ref" IS NOT NULL))
);
CREATE UNIQUE INDEX "checkout_links_token_hash_key" ON "checkout"."checkout_links"("token_hash");
CREATE INDEX "checkout_links_tenant_id_checkout_session_id_idx" ON "checkout"."checkout_links"("tenant_id", "checkout_session_id");
ALTER TABLE "checkout"."checkout_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout"."checkout_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "checkout"."checkout_links";
CREATE POLICY tenant_isolation ON "checkout"."checkout_links" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
