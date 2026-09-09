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

- [ ] **T11.1 — Register the finance consumers.**
      Register `PaymentsCapturedConsumer` and `RefundsIssuedConsumer` with the `ConsumerSupervisor`
      in `apps/runtime/src/worker.ts`, following the exact pattern
      `buildOrdersPaidConsumerRuntimes` establishes at `worker.ts:63` (verified in this session:
      the call site exists, imports `buildOrdersPaidConsumerRuntimes` from
      `./consumers/orders-paid.consumers`, and registers it in a `for` loop over
      `supervisor.register(...)`). Same consumer-group convention, same processed-event store, same
      dead-letter store as that existing registration.

- [ ] **T11.2 — Update the boot guard's message, deliberately, as the record of the gap closing.**
      `apps/runtime/src/api.ts` defines `assertProductionIntegrationPortsConfigured` (function at
      `:203`), whose current message (verified at `:229`) reads
      `"unregistered: PaymentsCapturedConsumer and RefundsIssuedConsumer ..."`.
      `apps/runtime/src/composition.test.ts` (around `:315`) asserts on that exact text and will
      fail once T11.1 lands — that failure is expected and correct. Update the guard's message and
      the test's assertion together, in the same commit as T11.1, so the diff reads as "gap closed"
      rather than "test broken."

- [ ] **T11.3 — Backfill.**
      Write an idempotent, re-runnable backfill for fee/contra entries missed since payment capture
      went live (i.e. for every already-captured payment and already-issued refund with no
      corresponding finance entry). Idempotent means: running it twice produces the same ledger
      state as running it once. A backfill that double-posts is worse than the gap it closes — test
      that explicitly (run it twice in a test, assert entry counts are unchanged the second time).

- [ ] **T11.4 — Float to Decimal migration.**
      Per the decision above: `Decimal(19,4)` for `licensing.prisma:79` (`UsageCounter.amount`),
      `licensing.prisma:95` (`Credit.amount`), `pricing.prisma:66` (`PricingRule.value`);
      `Decimal(18,8)` for `finance.prisma:133` (`ExchangeRate.rate`). Each of these lives in its own
      schema file under `packages/db/prisma/schema/` with its own `@@schema(...)` annotation —
      edit each file directly, keep its `@@schema` line, never edit a merged/generated copy.
      Route the application layer for each field through `packages/domain/src/shared/
  value-objects/money.ts`'s `Money` type so domain and persistence stop disagreeing.
      Write one Prisma migration covering all four columns, with explicit, documented rounding for
      existing rows (state the rounding rule — e.g. round-half-up to the column's declared
      precision — in the migration file's own comment, not only in a commit message).
      Test: a value round-trips through write and read unchanged; incrementing `UsageCounter.amount`
      by a fractional value one thousand times produces an exact total (this is the worst case
      named in the finding — drift compounds under repeated increment).

- [ ] **T11.5 — Prove the CDC path in staging, without removing the relay.**
      In a staging environment with CDC as the publication path and the relay disabled: verify
      every outbox row reaches Kafka exactly once, `confirmed_flush_lsn` advances
      (`apps/runtime/src/scheduler.ts:216` already tracks it), and connector restart neither
      duplicates nor drops. Explicitly test connector-down-and-recovering, slot-lag-growing, and
      Kafka-unavailable. **If no staging environment is reachable from this session, do not
      simulate one and do not claim this task done** — write the exact reproduction steps and the
      staging access this task needs into `docs/plans/BLOCKERS.md`, leave the task unchecked, and
      continue to T11.6. This is the one task in this WP that a local-only session may not be able
      to close.

- [ ] **T11.6 — Settlement invariant regression suite.**
      These lock the money-path behaviour before `WP-10`'s tenancy refactor (which touches
      repository construction broadly) has a chance to silently change it: - Duplicate webhook delivery → one settlement. - Duplicate captured event → one paid order, one paid event. - Concurrent settlement of the same order → one transition; the loser observes the terminal
      state rather than erroring ambiguously. - Retry after partial failure → no double posting. - Refund after capture → one contra entry.
      Wire all five into `pnpm --filter <name> run test` for the owning package(s) and confirm they
      run under the repo-wide `pnpm -r --workspace-concurrency=4 run test` per
      `../UNIFIED-ROADMAP.md` §3.

## Definition of done

- [ ] A captured payment posts exactly one fee entry; a refund posts exactly one contra entry;
      replaying either changes nothing.
- [ ] The backfill is idempotent under repeat execution (proven by a test running it twice).
- [ ] No financial column is a `Float`; existing rows are migrated with documented rounding; one
      thousand fractional increments to a usage counter produce an exact total.
- [ ] T11.5 either demonstrates exactly-once CDC delivery across a connector restart with written
      evidence, or is left unchecked with a `BLOCKERS.md` entry explaining what staging access it
      needs — never silently skipped.
- [ ] All five settlement-invariant scenarios pass.
- [ ] `docs/architecture/23-platform-gap-register.md` and `docs/KNOWN_GAPS.md` gain an entry for
      each of F-06 (narrowed: CDC proven or not), F-07 (closed), F-11 (closed), cross-referenced to
      this file, in the same table shape `WP-0`'s T0.4 established.
- [ ] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch` (schema files live
      under `packages/db`, a `packages/*` path).

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
