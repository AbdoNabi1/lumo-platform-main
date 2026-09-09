-- WP-11 (F-07) — Float -> Decimal for four financial/rate columns.
--
-- Found: `licensing.usage_counters.amount`, `licensing.credits.amount`, `pricing.pricing_rules.
-- value` (all Decimal(19,4) below) and `finance.exchange_rates.rate` (Decimal(18,8) below) were
-- declared `Float` (Postgres `double precision`) — binary floating point cannot represent every
-- exact decimal fraction, and `usage_counters.amount`/`credits.amount` are both mutated
-- repeatedly over an aggregate's lifetime (`UsageCounter.recordUsage`, `Credit.consume`/`grant`),
-- so representation error compounds with every write. `pricing_rules.value` and
-- `exchange_rates.rate` are write-once/immutable respectively, so they carry no compounding
-- risk, but still store the ORIGINAL value with a binary-rounding artifact whenever the intended
-- decimal value has no exact binary representation (e.g. 12.5% as `double precision` is fine,
-- but plenty of common decimal rates and prices are not).
--
-- ROUNDING RULE FOR EXISTING ROWS (stated explicitly, per WP-11's own requirement):
-- Every column below is cast through `ROUND(<col>::numeric, <scale>)`, NOT a bare
-- `::numeric(p,s)` cast. Postgres's `ROUND(numeric, integer)` is documented to round
-- HALF AWAY FROM ZERO ("round half up", for every value here — all four columns hold only
-- non-negative business quantities, so "away from zero" and "up" coincide) at the exact
-- requested scale, in one explicit, auditable step — not left to whatever an implicit
-- `double precision -> numeric(p,s)` cast happens to do (which is a truncating narrowing
-- conversion, not independently documented to round the same way). Using `ROUND` explicitly
-- means the rounding behavior is stated here, not inferred from cast semantics.
--
-- Money's own value objects everywhere else in this codebase are integer minor units, so this
-- migration is the first and only place `Decimal` appears in this schema (WP-11's decision:
-- `Decimal(19,4)` for amounts, `Decimal(18,8)` for rates — a repository-specific choice for
-- these four columns; not applied to `packages/domain/src/shared/value-objects/money.ts`'s
-- `Money`, which stays integer-minor-unit for every other context. See
-- `docs/plans/BLOCKERS.md`'s WP-11 entry for why `Money` was not widened to wrap these fields —
-- none of the four have a paired currency column, so they are not `Money`-shaped values).
--
-- Expand-only, in place: no data is dropped, no table is renamed. Every existing row (this
-- schema has never run against a populated production database — see `MIGRATIONS.md` §1 — so in
-- practice there are no existing rows to round today) is rewritten through the same explicit
-- rounding rule a fresh row would get from the application layer going forward.

ALTER TABLE "licensing"."usage_counters"
  ALTER COLUMN "amount" TYPE numeric(19, 4) USING ROUND("amount"::numeric, 4);

ALTER TABLE "licensing"."credits"
  ALTER COLUMN "amount" TYPE numeric(19, 4) USING ROUND("amount"::numeric, 4);

ALTER TABLE "pricing"."pricing_rules"
  ALTER COLUMN "value" TYPE numeric(19, 4) USING ROUND("value"::numeric, 4);

ALTER TABLE "finance"."exchange_rates"
  ALTER COLUMN "rate" TYPE numeric(18, 8) USING ROUND("rate"::numeric, 8);
