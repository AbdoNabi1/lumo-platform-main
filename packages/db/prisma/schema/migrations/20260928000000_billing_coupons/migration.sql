-- WP-14 T14.3 (first half) — billing coupons and the invoice discount (D-072).
-- Written by hand and NOT applied by the agent that authored it: this repository's `.env` points at the
-- live database, so deploying is the operator's step. Deploy it WITH (or before) the application
-- release that reads `licensing.billing_coupons` / `licensing.invoices.discount_*`.
--
-- ORDERING AND INDEPENDENCE. This is purely ADDITIVE: one NEW table, and two NULLABLE columns on
-- `licensing.invoices` with no backfill and no constraint that any existing row can violate (both
-- columns are NULL on every row that exists today, which satisfies every CHECK below). It depends only
-- on the `licensing` schema and `licensing.invoices` existing, both of which pre-date every migration
-- pending at the time this was written, so it may be deployed independently of, and in any order
-- relative to, `20260923000000_wp13_merchant_payments`, `20260924000000_wp14_platform_plans`,
-- `20260924010000_open_payment_provider_registry`, `20260924020000_billing_payment_methods` and
-- `20260927000000_billing_payment_methods_invoice_ref` — none of the five touches `billing_coupons`, and
-- the only one that touches `invoices` (`wp14_platform_plans`, which converts `line_items`) adds and
-- reads no `discount_*` column. Its timestamp orders it after all five so a linear `migrate deploy`
-- applies it last.
--
-- ROLLING DEPLOY. Deploy the migration BEFORE the new application version starts writing a discount:
-- an OLD application instance reading an invoice that a NEW one discounted would ignore `discount_*` and
-- charge the undiscounted total. Coupons are only issued through the new release's platform-only
-- endpoint, so no discount can exist until the new release is serving; the safe order is
-- migration -> release, which is also what `migrate deploy` in a release pipeline does.
--
-- MONEY. Integer minor units only (D-063): `amount_minor` and `discount_minor` are INTEGER, never
-- NUMERIC/FLOAT. A percentage is `percent_basis_points` (1..10000), so no fraction is ever stored.
-- `credits.amount` / `usage_counters.amount` are NOT touched and stay Decimal(19,4): a credit is a
-- quantity of a pre-purchased metered resource, not money (G-74 (6), settled 2026-09-28).
--
-- WHOSE ROW. Morbeh's coupon, scoped to the PLATFORM tenant (`tenant_id`, the ADR-0014 scope) exactly
-- like `licensing.invoices`; `tenant_ref` is the merchant a coupon is ADDRESSED to (NULL = a bearer
-- coupon any merchant may present). RLS is ENABLED and FORCED with the same `tenant_isolation` policy
-- every tenant-scoped table carries, so a session scoped to a merchant's tenant matches zero rows.
-- Writes are reachable only through `LicensingController`'s platform-only guard.
--
-- REDEEM-ONCE, AT THE DATABASE. The application's guard is the optimistic lock on `version`
-- (`UPDATE ... WHERE id AND tenant_id AND version` touching 0 rows is a lost race). Two backstops sit
-- underneath it here: the CHECK that `redeemed` <=> a recorded invoice and time, and a partial UNIQUE
-- index making one invoice carry at most one redeemed coupon even if the application's lock were
-- bypassed. Prisma cannot express a partial unique index, so it exists only in this file.

CREATE TABLE "licensing"."billing_coupons" (
  "id"                   UUID         NOT NULL,
  "tenant_id"            TEXT         NOT NULL,
  "tenant_ref"           TEXT,
  "code"                 TEXT         NOT NULL,
  "kind"                 TEXT         NOT NULL,
  "percent_basis_points" INTEGER,
  "amount_minor"         INTEGER,
  "currency"             TEXT,
  "expires_at"           TIMESTAMP(3) NOT NULL,
  "status"               TEXT         NOT NULL,
  "redeemed_invoice_ref" TEXT,
  "redeemed_at"          TIMESTAMP(3),
  "revoked_reason"       TEXT,
  "version"              INTEGER      NOT NULL DEFAULT 0,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_coupons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_coupons_status_check"
    CHECK ("status" IN ('issued', 'redeemed', 'expired', 'revoked')),
  CONSTRAINT "billing_coupons_kind_shape_check"
    CHECK (
      ("kind" = 'percentage'
        AND "percent_basis_points" BETWEEN 1 AND 10000
        AND "amount_minor" IS NULL AND "currency" IS NULL)
      OR
      ("kind" = 'fixed'
        AND "amount_minor" >= 1
        AND "currency" ~ '^[A-Z]{3}$'
        AND "percent_basis_points" IS NULL)
    ),
  -- `redeemed` <=> the redemption is recorded; the two redemption columns are set or unset together.
  CONSTRAINT "billing_coupons_redeemed_check"
    CHECK (("status" = 'redeemed') = ("redeemed_invoice_ref" IS NOT NULL)
           AND ("redeemed_invoice_ref" IS NULL) = ("redeemed_at" IS NULL)),
  CONSTRAINT "billing_coupons_revoked_check"
    CHECK (("status" = 'revoked') = ("revoked_reason" IS NOT NULL))
);

CREATE UNIQUE INDEX "billing_coupons_tenant_id_code_key"
  ON "licensing"."billing_coupons" ("tenant_id", "code");

CREATE INDEX "billing_coupons_tenant_id_tenant_ref_status_idx"
  ON "licensing"."billing_coupons" ("tenant_id", "tenant_ref", "status");

-- One invoice carries at most one redeemed coupon (the database's backstop for "one discount").
CREATE UNIQUE INDEX "billing_coupons_one_redemption_per_invoice"
  ON "licensing"."billing_coupons" ("tenant_id", "redeemed_invoice_ref")
  WHERE "redeemed_invoice_ref" IS NOT NULL;

ALTER TABLE "licensing"."billing_coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "licensing"."billing_coupons" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "licensing"."billing_coupons";
CREATE POLICY tenant_isolation ON "licensing"."billing_coupons" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "licensing"."billing_coupons" IS
  'Morbeh-issued billing coupon (T14.3, D-072). Platform-tenant scoped, RLS forced. Redeemed once, onto a DRAFT invoice; version is the optimistic lock that makes redemption once-only.';
COMMENT ON COLUMN "licensing"."billing_coupons"."tenant_ref" IS
  'The merchant this coupon is addressed to; NULL = a bearer coupon any merchant may present.';
COMMENT ON COLUMN "licensing"."billing_coupons"."amount_minor" IS
  'Fixed-amount coupons only: INTEGER minor units of currency. Never a decimal (D-063).';

-- The invoice's ONE discount, beside (never inside) the line items: Money is non-negative, so a
-- discount is not a negative line. total = sum(line_items.amountMinor) - discount_minor.
ALTER TABLE "licensing"."invoices"
  ADD COLUMN "discount_minor"      INTEGER,
  ADD COLUMN "discount_coupon_ref" TEXT;

ALTER TABLE "licensing"."invoices"
  ADD CONSTRAINT "invoices_discount_both_or_neither_check"
    CHECK (("discount_minor" IS NULL) = ("discount_coupon_ref" IS NULL)),
  ADD CONSTRAINT "invoices_discount_non_negative_check"
    CHECK ("discount_minor" IS NULL OR "discount_minor" >= 0);

COMMENT ON COLUMN "licensing"."invoices"."discount_minor" IS
  'Coupon discount in INTEGER minor units of currency; NULL = none. Applied only while the invoice is a draft (D-072).';
COMMENT ON COLUMN "licensing"."invoices"."discount_coupon_ref" IS
  'The billing_coupons.id that produced discount_minor.';
