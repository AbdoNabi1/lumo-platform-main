-- Open payment-provider registry. Written by hand and NOT applied by the agent that authored it: this
-- repository's `.env` points at the live database, so deploying is the operator's step. Deploy it
-- together with the application release that reads `provider_settings` (the previous release reads the
-- `paymob_*` columns this migration drops), after `20260923000000_wp13_merchant_payments`.
--
-- WHY. A payment provider is now REGISTERED at composition time (key, declared capabilities, factory);
-- the payments domain reasons about capabilities and no longer names any provider. Two things in the
-- database still named one:
--
-- (1) `payments.payment_intents."provider"` carried CHECK ("provider" IN ('stripe','paymob','cod')).
--     An open registry cannot be enumerated in SQL, so the CHECK is DROPPED. The set of valid providers
--     is validated by the registry, at the boundary (create-intent, settings, webhook), not by the
--     database. The column stays TEXT NOT NULL, and every existing row — all 'stripe', 'paymob' or 'cod'
--     — is untouched and keeps reading: the reader checks only that a stored key is well-formed, never
--     that a provider by that name is currently registered.
--
-- (2) `payments.merchant_payment_settings` had a column PER PROVIDER (`paymob_region`,
--     `paymob_integration_id`, `paymob_credentials`), so a second provider meant a second set of
--     columns. They become ONE opaque per-provider object, `provider_settings`:
--       { "<provider key>": { "config": { ...non-secret routing data... }, "sealedCredentials": "<envelope>" } }
--     `sealedCredentials` is the SAME sealed envelope WP-13 stored, moved byte-for-byte: the sealing
--     (`@platform/secrets` envelope, bound to tenant + provider inside the payload) is unchanged, and
--     nothing here reads, decrypts or rewrites it. Only where config is SHAPED changes — a provider's
--     own package validates its own `config`, not this schema.
--
-- The data migration is written to be correct for rows that exist without anyone having counted them,
-- and to REFUSE (RAISE EXCEPTION, which rolls the whole migration back) rather than guess on a shape
-- it cannot map. Rows it maps: no Paymob configuration at all (all three columns NULL → `{}`), or a
-- complete one (all three set → a `paymob` entry). Rows it refuses: a partial Paymob configuration; a
-- region or integration id the old domain could never have written; empty credentials; Paymob enabled
-- with no credentials to back it. Any of those means a hand edit or drift the migration must not paper
-- over — an operator looks at the row first.

-- ROW LEVEL SECURITY. `merchant_payment_settings` has FORCE ROW LEVEL SECURITY keyed on
-- `app.tenant_id`, which no migration session sets — so under a role without BYPASSRLS every row is
-- silently invisible, every count below would read 0, the UPDATE would map nothing and the DROP COLUMN
-- would then destroy the Paymob columns of rows this migration never saw. `row_security = off` turns
-- that silent filtering into an ERROR (for a role that cannot bypass RLS), so the migration either sees
-- every row or aborts. It is reset at the end.
SET row_security = off;

-- (1) Free-form provider column.
ALTER TABLE "payments"."payment_intents" DROP CONSTRAINT IF EXISTS "payment_intents_provider_check";
COMMENT ON COLUMN "payments"."payment_intents"."provider" IS
  'The payment method the shopper selected. Free-form key of a provider registered at composition time; validated by the registry at the boundary, not by a CHECK.';

-- (2a) The generic shape. NOT NULL with a '{}' default so it is safe for every existing row and for a
-- release that has not started writing it yet.
ALTER TABLE "payments"."merchant_payment_settings"
  ADD COLUMN "provider_settings" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- (2b) Refuse, do not guess.
DO $$
DECLARE
  offending integer;
BEGIN
  -- A Paymob configuration is all-or-nothing (the domain wrote the three columns together).
  SELECT count(*) INTO offending
    FROM "payments"."merchant_payment_settings"
   WHERE ("paymob_region" IS NULL OR "paymob_integration_id" IS NULL OR "paymob_credentials" IS NULL)
     AND NOT ("paymob_region" IS NULL AND "paymob_integration_id" IS NULL AND "paymob_credentials" IS NULL);
  IF offending > 0 THEN
    RAISE EXCEPTION 'open_payment_provider_registry: % merchant_payment_settings row(s) hold a PARTIAL Paymob configuration (some but not all of paymob_region, paymob_integration_id, paymob_credentials). Refusing to guess; inspect and repair or clear them, then re-run.', offending;
  END IF;

  -- A complete configuration must be one the old domain could have written: a supported region, a
  -- positive integration id, non-empty sealed credentials.
  SELECT count(*) INTO offending
    FROM "payments"."merchant_payment_settings"
   WHERE "paymob_credentials" IS NOT NULL
     AND ("paymob_region" NOT IN ('egy', 'ksa', 'uae')
          OR "paymob_integration_id" <= 0
          OR length(btrim("paymob_credentials")) = 0);
  IF offending > 0 THEN
    RAISE EXCEPTION 'open_payment_provider_registry: % merchant_payment_settings row(s) hold a Paymob configuration the previous release could not have written (unsupported region, non-positive integration id, or empty credentials). Refusing to guess.', offending;
  END IF;

  -- Paymob could only be enabled once its credentials existed.
  SELECT count(*) INTO offending
    FROM "payments"."merchant_payment_settings"
   WHERE 'paymob' = ANY ("enabled_methods")
     AND "paymob_credentials" IS NULL;
  IF offending > 0 THEN
    RAISE EXCEPTION 'open_payment_provider_registry: % merchant_payment_settings row(s) enable Paymob without stored Paymob credentials. Refusing to guess.', offending;
  END IF;
END
$$;

-- (2c) Map. `integrationId` stays a JSON number; `sealedCredentials` is copied verbatim.
UPDATE "payments"."merchant_payment_settings"
   SET "provider_settings" = jsonb_build_object(
         'paymob',
         jsonb_build_object(
           'config', jsonb_build_object('region', "paymob_region", 'integrationId', "paymob_integration_id"),
           'sealedCredentials', "paymob_credentials"
         )
       )
 WHERE "paymob_credentials" IS NOT NULL;

-- (2d) Verify before anything is dropped: every mapped row round-trips exactly, and no row that had
-- Paymob credentials is left without them.
DO $$
DECLARE
  offending integer;
BEGIN
  SELECT count(*) INTO offending
    FROM "payments"."merchant_payment_settings"
   WHERE "paymob_credentials" IS NOT NULL
     AND ("provider_settings" -> 'paymob' ->> 'sealedCredentials' IS DISTINCT FROM "paymob_credentials"
          OR "provider_settings" -> 'paymob' -> 'config' ->> 'region' IS DISTINCT FROM "paymob_region"
          OR ("provider_settings" -> 'paymob' -> 'config' ->> 'integrationId')::integer IS DISTINCT FROM "paymob_integration_id");
  IF offending > 0 THEN
    RAISE EXCEPTION 'open_payment_provider_registry: % row(s) did not round-trip into provider_settings. Aborting before any column is dropped.', offending;
  END IF;
END
$$;

-- (2e) Contract: the per-provider columns are gone.
ALTER TABLE "payments"."merchant_payment_settings"
  DROP COLUMN "paymob_region",
  DROP COLUMN "paymob_integration_id",
  DROP COLUMN "paymob_credentials";

RESET row_security;

-- No new table: `merchant_payment_settings` already carries its own tenant_isolation policy
-- (20260923000000_wp13_merchant_payments), which is unaffected by a column change.
