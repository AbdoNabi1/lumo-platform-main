-- WP-14 (Morbeh F-16, T14.2 + Trap 3) — platform-global plans; integer minor-unit money in JSONB.
-- Written by hand and NOT applied by the agent that authored it: this repository's `.env` points at the
-- live database, so deploying is the operator's step.
--
-- LIVE STATE WHEN WRITTEN (2026-09-24, read-only counts through an RLS-bypassing role, so the counts are
-- real, not RLS-filtered): licensing.plans = 0, licensing.subscriptions = 0, licensing.invoices = 0.
-- Nothing below therefore touches a live row today. It is still written to be correct — and to refuse to
-- guess — on any database that DOES hold rows (a dev/staging copy, or the live one if it fills before
-- deploy).
--
-- ---------------------------------------------------------------------------------------------------
-- (1) licensing.plans becomes PLATFORM-GLOBAL.
--
-- A plan is defined once by Morbeh and sold to many merchants, so it belongs to no tenant. The table
-- therefore loses `tenant_id`, its unique index becomes (key) alone, and — DELIBERATELY — its
-- `tenant_isolation` RLS policy is dropped: a tenant-scoped policy would hide the catalogue from every
-- merchant's read scope (and there would be no tenant to scope it to). This is the one licensing table
-- that is not tenant-scoped, and what protects it INSTEAD of RLS is:
--   * writes are reachable only through `LicensingController`'s platform-only guard (`platformTenantId`,
--     ADR-0014 8f scope) — a merchant tenant holding a `licensing:*` permission is still refused (403);
--   * a published `versions[]` entry is an immutable, deep-frozen snapshot, and a `Subscription` pins a
--     version by id (`planVersionRef` = `<planId>-v<n>`), never the live plan;
--   * `plans` carries no merchant data at all.
--
-- MAPPING OF EXISTING TENANT-SCOPED ROWS (the plan's T14.2 text: no silent merge, no silent drop):
--   * EVERY existing row is kept, one platform plan per row, WITH ITS ID UNCHANGED — so every existing
--     subscription's `planVersionRef` (`<planId>-v<n>`) keeps resolving to exactly the version it pinned.
--     Nothing is merged, even when two tenants' rows look like "the same" plan (same key, similar
--     versions): deciding two rows are one plan is a business decision this migration has no evidence to
--     make, and merging would rewrite ids that subscriptions pin.
--   * The former tenant survives in `origin_tenant_id` (a RENAME of `tenant_id`, made nullable) —
--     provenance only, never a scope.
--   * Key collisions (the only real ambiguity: two tenants each had a plan keyed e.g. 'growth') are
--     resolved deterministically: within a key, the earliest-created row (ties: smallest id) keeps the
--     bare key; every other row's key becomes '<key>@<origin_tenant_id>'. The operator can rename or
--     retire those afterwards; nothing is lost. A NOTICE reports how many were disambiguated.
ALTER TABLE "licensing"."plans" RENAME COLUMN "tenant_id" TO "origin_tenant_id";
ALTER TABLE "licensing"."plans" ALTER COLUMN "origin_tenant_id" DROP NOT NULL;

DO $$
DECLARE
  disambiguated integer;
BEGIN
  WITH ranked AS (
    SELECT "id", row_number() OVER (PARTITION BY "key" ORDER BY "created_at", "id") AS rn
    FROM "licensing"."plans"
  )
  UPDATE "licensing"."plans" p
     SET "key" = p."key" || '@' || COALESCE(p."origin_tenant_id", p."id"::text)
    FROM ranked r
   WHERE p."id" = r."id" AND r.rn > 1;
  GET DIAGNOSTICS disambiguated = ROW_COUNT;
  RAISE NOTICE 'WP-14: % plan row(s) had a colliding key and were disambiguated as key@origin_tenant_id (none merged, none dropped)', disambiguated;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON "licensing"."plans";
ALTER TABLE "licensing"."plans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "licensing"."plans" DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS "licensing"."plans_tenant_id_key_key";
CREATE UNIQUE INDEX "plans_key_key" ON "licensing"."plans" ("key");

-- ---------------------------------------------------------------------------------------------------
-- (2) Money unit convention: integer MINOR units, everywhere (Trap 3).
--
-- `Invoice.total` summed `lineItems[].amount` (a JS number, unit unrecorded) with float `+`; the column
-- is JSONB, so WP-11's Float -> Decimal column migration never reached it. The convention is now the
-- repository's existing one — an integer count of the currency's minor units (`payments.amountMinor`,
-- the shared-kernel `Money`): line items are `{ description, amountMinor }`, plan pricing is
-- `{ basePriceMinor, currency, ... }`.
--
-- (2a) PLAN VERSIONS' pricing. Each `versions[].spec.pricing` gets `basePriceMinor` and `currency`.
--   The legacy `basePrice` never recorded its unit or its currency, and a migration must not invent
--   either. So: `basePrice` is MOVED to `legacyBasePrice` (kept, unaltered), `basePriceMinor` is set to
--   ROUND(basePrice) — half away from zero, Postgres `round(numeric)` — only so the field is a valid
--   integer, and `currency` is set to 'XXX' (ISO 4217 "no currency"). `BillSubscriptionRenewal` REFUSES
--   a 'XXX' version, so a migrated version can entitle but can never charge anything until Morbeh
--   publishes a NEW version with a real price and currency and re-pins the subscription. No money can
--   move on a guess. Already-converted specs (those with `basePriceMinor`) are untouched.
UPDATE "licensing"."plans" p
   SET "versions" = COALESCE((
     SELECT jsonb_agg(
       CASE
         WHEN v #> '{spec,pricing}' IS NULL OR (v #> '{spec,pricing}') ? 'basePriceMinor' THEN v
         ELSE jsonb_set(
           v,
           '{spec,pricing}',
           ((v #> '{spec,pricing}') - 'basePrice')
             || jsonb_build_object(
                  'legacyBasePrice', v #> '{spec,pricing,basePrice}',
                  'basePriceMinor', round(COALESCE((v #>> '{spec,pricing,basePrice}')::numeric, 0))::bigint,
                  'currency', 'XXX'
                )
         )
       END
       ORDER BY ord)
     FROM jsonb_array_elements(p."versions") WITH ORDINALITY AS t(v, ord)
   ), '[]'::jsonb)
 WHERE EXISTS (
   SELECT 1 FROM jsonb_array_elements(p."versions") e
   WHERE e #> '{spec,pricing}' IS NOT NULL AND NOT ((e #> '{spec,pricing}') ? 'basePriceMinor')
 );

-- (2b) INVOICES' line items. A legacy line `{ description, amount }` carries a number whose unit was
--   never recorded: 2900 could be 29.00 in minor units or 2,900 in major. There is no evidence in the
--   data to choose, and an invoice is what gets charged — so this migration REFUSES to convert: it
--   aborts, naming the count, if any invoice holds a line without `amountMinor`. Zero rows today; a
--   database that does hold such rows needs an operator-supplied rule (e.g. "all `amount` were major
--   units, scale by the currency exponent, round half away from zero") applied deliberately, not a
--   guess baked in here. `InvoiceMapper` likewise refuses to read such a row as money.
DO $$
DECLARE
  legacy_invoices integer;
BEGIN
  SELECT count(*) INTO legacy_invoices
    FROM "licensing"."invoices" i
   WHERE EXISTS (
     SELECT 1 FROM jsonb_array_elements(i."line_items") e WHERE NOT (e ? 'amountMinor')
   );
  IF legacy_invoices > 0 THEN
    RAISE EXCEPTION 'WP-14: % invoice(s) hold line items without amountMinor (pre-convention `amount`, unit unrecorded). Refusing to guess a unit for money. Apply an operator-approved conversion first (see this migration''s comment 2b).', legacy_invoices;
  END IF;
END $$;
