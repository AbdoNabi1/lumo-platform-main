# WP-11 — Financial integrity: decimal money, registered finance consumers, the CDC decision

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely, plus
> [`../UNIFIED-ROADMAP.md`](../UNIFIED-ROADMAP.md) §2 and §4a for how this WP relates to Phase 7.
> **Depends on:** nothing. Touches neither `composition.ts`, `admin-routes.ts`, nor
> `apps/storefront/src` — safe to run in parallel with almost anything in this roadmap.
> **Closes:** Morbeh F-06 (outbox publication model), F-07 (float financial columns), F-11
> (unregistered finance consumers).

## Why this exists

Two verified defects sit in the money path, found by a separate review of this repository that
Phase 7 did not cover (it audited product completeness, not financial correctness). Both were
independently re-verified in this session before this WP was written:

- **F-11 — dead consumers.** `services/finance/src/interfaces/finance-consumers.ts:77` defines
  `PaymentsCapturedConsumer`; `:100` defines `RefundsIssuedConsumer`. Neither is instantiated
  anywhere. Confirmed by `apps/runtime/src/composition.test.ts:318`, whose own assertion text reads
  `/PaymentsCapturedConsumer and RefundsIssuedConsumer[\s\S]*nothing instantiates them/`. Every
  captured payment and every issued refund today produces no fee entry and no contra entry.
- **F-07 — float money.** Four columns store financial amounts as `Float`, verified at the exact
  cited lines: `packages/db/prisma/schema/licensing.prisma:79` (`UsageCounter.amount`),
  `:95` (`Credit.amount`), `packages/db/prisma/schema/pricing.prisma:66` (`PricingRule.value`),
  `packages/db/prisma/schema/finance.prisma:133` (`ExchangeRate.rate`) — this contradicts the
  domain's own `Money` value object at `packages/domain/src/shared/value-objects/money.ts`, which
  assumes exact decimal arithmetic.
- **F-06 — two live outbox publication paths.** `packages/messaging/src/outbox/outbox-relay.ts`
  (a polling relay) and `infrastructure/docker/debezium/outbox-connector.json` (a CDC connector)
  both exist, configured, against the same table. Two live publishers of one table is a
  double-publish risk waiting for the day both are enabled at once.

## Decisions, already made

1. **Money becomes `Decimal`, not minor-unit integers.** `Decimal(19,4)` for amounts,
   `Decimal(18,8)` for rates. Prisma supports `Decimal` natively; the existing `Money` value object
   wraps it with minimal change. This is a repository-specific choice — note that `WP-3`
   (ClickHouse) independently and correctly uses minor-unit integers for _tracking event_ money,
   which is a different system with different constraints (no native decimal type in ClickHouse,
   and tracking values are estimates, not the ledger of record). The two do not need to agree; do
   not "fix" one to match the other.
2. **Debezium CDC is the intended production model for the outbox, but this WP only proves it — it
   does not remove the polling relay.** The connector is already configured and the scheduler
   already tracks `confirmed_flush_lsn` (`apps/runtime/src/scheduler.ts:216`), so CDC is the path
   with existing investment. Relay removal is a separate, explicitly approved task, later.

## Tasks

- [x] **T11.1 — Register the finance consumers.**
      Registered via a new `apps/runtime/src/consumers/finance-settlement.consumers.ts`
      (`buildFinanceSettlementConsumerRuntimes`), wired into `worker.ts` in a `for` loop right
      after `buildOrdersPaidConsumerRuntimes`'s, same consumer-group/processed-event/dead-letter
      envelope (`buildProcessedConsumer`). One deviation from a literal read of this task, found by
      tracing the actual code rather than assumed: `PaymentsCapturedConsumer`/`RefundsIssuedConsumer`
      call `journals.append(journal)` with no `tx`, which `PrismaJournalRepository.append` rejects
      outright (ADR-0003) — the exact non-atomic-append hazard `FinanceOrdersPaidConsumer` already
      exists to fix for `OrdersPaidConsumer`. Registering the bare classes directly would have
      thrown on every real payment/refund in production. Fixed the same way: two new atomic
      wrapper classes (`FinancePaymentsCapturedConsumer`/`FinanceRefundsIssuedConsumer`) implement
      `handleAtomic`, wrapping `journals` in a fresh `TxBoundJournalRepository` (exported from
      `orders-paid.consumers.ts`) per call, and both get a `unitOfWork` — a ledger append is not
      idempotent by itself. Both consumer classes exported from `@platform/finance`'s barrel
      (they were not before). Tests: `finance-settlement.consumers.test.ts`.

- [x] **T11.2 — Update the boot guard's message, deliberately, as the record of the gap closing.**
      `assertProductionIntegrationPortsConfigured`'s doc comment and thrown message both updated to
      state all three consumers (`OrdersPaidConsumer`, `PaymentsCapturedConsumer`,
      `RefundsIssuedConsumer`) are registered; `composition.test.ts`'s assertions updated to match
      (pin the new text, refuse the old "nothing instantiates them"/"registers exactly one
      consumer" phrasings), landed in the same change as T11.1.

- [x] **T11.3 — Backfill.**
      `apps/runtime/src/backfill/finance-settlement-backfill.ts` — a pure, injected-ports function
      (`PaymentSettlementSource` read port + Finance's `JournalRepository` + a `unitOfWork`), so it
      is unit-testable against seeded in-memory fixtures with no database
      (`finance-settlement-backfill.test.ts`, 6 tests: posts missing fee/contra entries, idempotent
      under a second run, skips an order whose fee already exists, posts only the missing refunds
      when an order has some-but-not-all of its contra entries, touches nothing when there is
      nothing to backfill). Idempotency strategy (stated once here, in full, in the file's own doc
      comment too): per order, count existing fee/refund-memo journals via
      `journals.findBySourceRef`, then post only the shortfall — refunds are matched by count after
      sorting chronologically, since `Journal.sourceRef` carries no unique constraint and
      pre-registration payments/refunds have no Kafka inbox marker to dedupe against.
      `PrismaPaymentSettlementSource` (the real Prisma-backed adapter, reading `payments.
    payment_intents`/`refunds` directly — that repository has no "list" method) and a runnable
      `apps/runtime/src/backfill-finance-settlement.ts` script exist but are **NOT exercised
      against a real database in this session** (no `DATABASE_URL_TEST` configured here) — said
      explicitly in both files' own doc comments, per this task's instruction to say so rather than
      claim it verified.

- [x] **T11.4 — Float to Decimal migration.**
      All four columns migrated exactly per the decision (`Decimal(19,4)`/`Decimal(18,8)`); see
      migration `packages/db/prisma/schema/migrations/20260909000000_wp11_float_to_decimal_money_
    columns/migration.sql` for the documented rounding rule (`ROUND(col::numeric, scale)`,
      explicitly round-half-away-from-zero per Postgres's own documentation for that function, not
      an implicit narrowing cast). **Deviation from this task's literal text, found by reading the
      actual schema before touching it:** none of the four columns route through `packages/domain/
    src/shared/value-objects/money.ts`'s `Money` — none of them HAVE a paired currency column
      (`UsageCounter`/`Credit`/`PricingRule` have none at all; `ExchangeRate` has two currency
      codes but they name a PAIR, not a single amount's denomination), and `UsageCounter.amount`
      is not even a currency amount (it is paired with a `unit` column like `"gb"`/`"api_calls"`).
      Money is currency+integer-minor-units by design; forcing any of these through it would either
      be a type error or a silent misuse. Instead: `UsageCounter`/`Credit` (the two fields actually
      mutated repeatedly over an aggregate's lifetime) got their own `decimal.js` `Decimal`
      accumulator internally, added as a direct dependency of `@platform/licensing`; `PricingRule.
    value`/`ExchangeRate.rate` (both write-once/immutable, no repeated-increment risk) just get a
      correct one-time `Number(prismaDecimal)` conversion at their mapper boundary. This
      deviation is a design note, not a defect, so it is recorded here rather than in
      `docs/plans/BLOCKERS.md`. Tests: `usage-counter.test.ts`/`credit.test.ts` (1000-fractional-increment exact
      total, mixed-sequence exactness, zero-remainder consumption, round-trip via the exact decimal
      string), `mappers.test.ts` (licensing), `finance.mappers.test.ts`, `pricing-registry.mappers.
    test.ts` (Prisma.Decimal-shaped round-trip for the other two).

- [ ] **T11.5 — Prove the CDC path in staging, without removing the relay.** **BLOCKED — no
      staging cluster reachable from this session, per this task's own instruction.** Both
      publication paths (`packages/messaging/src/outbox/outbox-relay.ts`, `infrastructure/docker/
    debezium/outbox-connector.json`) and the existing CDC health signals
      (`scheduler.ts`'s `outbox-prune` slot check, its `cdc-watchdog` job) were read in full. The
      exact verification procedure (8 numbered steps: provision, disable the relay, baseline the
      slot, happy path, connector-down-and-recovering, slot-lag-growing, Kafka-unavailable, record
      evidence) and the staging access it needs are written into `docs/plans/BLOCKERS.md`'s T11.5
      entry. Left unchecked, not simulated. F-06 stays open, narrowed to exactly this proof.

- [x] **T11.6 — Settlement invariant regression suite.**
      All five already have or now have a citable test: duplicate webhook delivery →
      `services/payments/src/capture-crash-recovery.test.ts` ("Task 12 — duplicate webhook
      delivery"); concurrent settlement / retry-after-partial-failure → the same file's "Task 11"/
      "Task 9" describe blocks (pre-existing, re-confirmed rather than duplicated); duplicate
      captured event → one paid order, one paid event → a new explicit test added to
      `services/orders/src/interfaces/payment-captured.consumer.test.ts` asserting BOTH the order
      status and the exact count of `orders.order.paid.v1` outbox entries after a redelivered
      capture (the pre-existing test only asserted status); refund after capture → one contra entry
      → a new end-to-end test in `finance-settlement.consumers.test.ts` chaining
      `FinancePaymentsCapturedConsumer` then `FinanceRefundsIssuedConsumer` on the same order and
      asserting exactly one fee entry and exactly one contra entry. All run under each package's
      own `pnpm --filter <name> run test` and the repo-wide gate.

## Definition of done

- [x] A captured payment posts exactly one fee entry; a refund posts exactly one contra entry;
      replaying either changes nothing. (At the system level — the Postgres inbox marker + atomic
      transaction the consumer runtime wraps every handler in, per ADR-0005. The bare consumer
      class alone is NOT self-idempotent — same as `FinanceOrdersPaidConsumer` before it — which is
      exactly why both get a `unitOfWork`; `finance-settlement.consumers.test.ts`'s "replaying...
      posts the fee entry twice at this layer" test pins that division of responsibility on
      purpose, so it is not mistaken for a regression later.)
- [x] The backfill is idempotent under repeat execution (proven by a test running it twice).
- [x] No financial column is a `Float`; existing rows are migrated with documented rounding; one
      thousand fractional increments to a usage counter produce an exact total.
- [ ] T11.5 either demonstrates exactly-once CDC delivery across a connector restart with written
      evidence, or is left unchecked with a `BLOCKERS.md` entry explaining what staging access it
      needs — never silently skipped. **Left unchecked, per its own instruction — see T11.5 above
      and `docs/plans/BLOCKERS.md`.**
- [x] All five settlement-invariant scenarios pass.
- [x] `docs/architecture/23-platform-gap-register.md` and `docs/KNOWN_GAPS.md` gain an entry for
      each of F-06 (narrowed: CDC proven or not), F-07 (closed), F-11 (closed), cross-referenced to
      this file, in the same table shape `WP-0`'s T0.4 established.
- [x] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch` (schema files live
      under `packages/db`, a `packages/*` path). `pnpm -r --workspace-concurrency=4 run typecheck`
      — clean, all workspaces. `pnpm -r --workspace-concurrency=4 --no-bail run test` — every
      package green, zero failures (not even either of the two documented concurrency-only flakes
      this run). `pnpm arch` — 0 violations, 3233 modules, 12170 dependencies cruised.

## Known traps

- **Do not delete `outbox-relay.ts` or disable it outside the staging proof in T11.5.** Removal is
  explicitly out of scope for this WP — it needs its own explicitly approved task per the decision
  above.
- **Do not rename the Debezium connector in `outbox-connector.json` as part of this work.**
  Renaming it creates a new connector with new replication-slot state, which can re-emit or skip
  events — that is a separate, higher-risk task and is called out again in `WP-12` (which touches
  infrastructure identifiers) precisely so nobody does it as a drive-by.
- **`packages/db/prisma/schema/` is 40-41 files, one Postgres schema each.** Editing a merged or
  regenerated copy instead of the owning file is the most common way this kind of change gets lost
  on the next `prisma generate`.
- **Do not let T11.5's staging requirement block T11.1–T11.4 and T11.6.** They are independently
  completable and independently valuable; sequence T11.5 last within this WP for exactly that
  reason.
