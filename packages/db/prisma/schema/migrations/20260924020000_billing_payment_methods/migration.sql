-- G-74 (1) — the saved card Morbeh charges to renew a merchant's subscription (Paymob tokenization + MIT).
-- Written by hand and NOT applied by the agent that authored it: this repository's `.env` points at the
-- live database, so deploying is the operator's step. Deploy it with the application release that reads
-- `licensing.billing_payment_methods`; it depends on nothing but `20260924000000_wp14_platform_plans`
-- (the `licensing` schema already exists) and creates a NEW table, so it touches no existing row.
--
-- WHOSE ROW THIS IS. Morbeh's record about a CUSTOMER of the platform, so it is scoped to the PLATFORM
-- tenant — `tenant_id` is the platform tenant, exactly like `licensing.subscriptions` and
-- `licensing.invoices` — and NEVER to the merchant's own tenant. `tenant_ref` is the merchant being
-- billed. A merchant that could read, edit or delete the token that bills it would control whether it
-- gets billed, so no merchant-scoped session may ever see this table:
--   * RLS is ENABLED and FORCED with the same `tenant_isolation` policy every tenant-scoped table
--     carries (the predicate reads `app.tenant_id`, set per transaction by `PrismaUnitOfWork.run` /
--     `runReadScoped`, ADR-0014). A session scoped to a merchant's tenant therefore matches zero rows
--     — here, unlike `licensing.plans`, the table IS tenant-scoped and so DOES carry the policy.
--   * the writes are reachable only through `LicensingController`'s platform-only guard, and the
--     token-callback path pins the platform tenant scope regardless of what a caller names.
--
-- THE TOKEN. `sealed_token` holds the card token SEALED with the payments credential vault's envelope
-- (`@platform/secrets`, AES-256-GCM, bound to the payer `tenant_ref` inside the payload — a blob copied
-- to another merchant's row does not open). It is never plaintext, never returned by any read model,
-- and `BillingPaymentMethod` serialises display fields only (`masked_pan`, `card_subtype`).
--
-- ONE ACTIVE CARD PER MERCHANT. Prisma cannot express a partial unique index, so it exists only here;
-- the recording use case revokes the previous active row in the same transaction it activates the new
-- one, and this index is the database's backstop against two racing activations.
--
-- NO `row_security` note is needed (compare `20260924010000_open_payment_provider_registry`): that
-- migration reads and rewrites existing rows under FORCE RLS; this one only creates an empty table.

CREATE TABLE "licensing"."billing_payment_methods" (
  "id"                UUID         NOT NULL,
  "tenant_id"         TEXT         NOT NULL,
  "tenant_ref"        TEXT         NOT NULL,
  "provider"          TEXT         NOT NULL,
  "provider_order_id" TEXT         NOT NULL,
  "status"            TEXT         NOT NULL,
  "token_id"          TEXT,
  "sealed_token"      TEXT,
  "masked_pan"        TEXT,
  "card_subtype"      TEXT,
  "version"           INTEGER      NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_payment_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_payment_methods_status_check"
    CHECK ("status" IN ('pending', 'active', 'revoked')),
  -- An `active` row must actually hold a token; a `pending` one must not.
  CONSTRAINT "billing_payment_methods_active_has_token_check"
    CHECK (("status" = 'active') = ("sealed_token" IS NOT NULL AND "token_id" IS NOT NULL)
           OR "status" = 'revoked')
);

CREATE UNIQUE INDEX "billing_payment_methods_tenant_id_provider_provider_order_id_key"
  ON "licensing"."billing_payment_methods" ("tenant_id", "provider", "provider_order_id");

CREATE INDEX "billing_payment_methods_tenant_id_tenant_ref_status_idx"
  ON "licensing"."billing_payment_methods" ("tenant_id", "tenant_ref", "status");

CREATE UNIQUE INDEX "billing_payment_methods_one_active_per_merchant"
  ON "licensing"."billing_payment_methods" ("tenant_id", "tenant_ref")
  WHERE "status" = 'active';

ALTER TABLE "licensing"."billing_payment_methods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "licensing"."billing_payment_methods" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "licensing"."billing_payment_methods";
CREATE POLICY tenant_isolation ON "licensing"."billing_payment_methods" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "licensing"."billing_payment_methods" IS
  'Morbeh''s saved card for a merchant (renewal MIT). Platform-tenant scoped, RLS forced; never merchant-readable. sealed_token is an envelope, never plaintext.';
COMMENT ON COLUMN "licensing"."billing_payment_methods"."sealed_token" IS
  'Card token sealed with the payments credential vault envelope, bound to tenant_ref. NEVER plaintext.';
