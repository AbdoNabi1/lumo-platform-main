# Phase A.13 — PostgreSQL Production Hardening & Readiness Closure

**Baseline:** uncommitted working tree on top of `1b4ff76` (feat(payments): real Stripe PSP integration, C2-2). Continues [A.12](PHASE_A12_POSTGRESQL_CAPACITY_LOAD_VALIDATION_REPORT.md). No commits made (per constraints).

---

## 1. Executive Summary

A.12 could not run a real PostgreSQL load test (WSL2 fails at the OS level with `Wsl/Service/E_UNEXPECTED`, unchanged in this environment) and instead identified two implementation defects and several production-readiness gaps to close before attempting A.14. This phase closed both confirmed defects, found and closed **one additional, more severe instance of the same connection-pool-wiring defect** in the code path A.12 did not audit (the actual production runtime entrypoint, `apps/runtime`), fixed the one payments-boundary long-transaction anti-pattern that remained (`CreatePaymentIntentLifecycle`), found and closed a residual gap in the outbox prune job's crash-safety, and completed a full repository-level audit of TLS, roles, RLS, financial-table constraints, migration safety, drift protection, backup/PITR, connection saturation, query/index readiness, N+1 patterns, and failure modes. One new **confirmed-live** cross-service long-transaction defect was found (Returns → Payments, nested transaction wrapping a real PSP call) and is flagged for a follow-up phase, not fixed here (out of this phase's explicit Task 5 scope, which named `CreatePaymentIntentLifecycle` only).

All available quality gates are green (typecheck 78/78, lint 78/78, test 78/78 — 100% pass, `pnpm arch` 0 violations across 1565 modules, `prisma validate` clean). `prisma migrate status` remains environment-blocked (`P1001`, no reachable PostgreSQL) — the same WSL2/Docker blocker every prior phase from A.9 onward has hit. No real PostgreSQL load test was run; none of the numbers in this report are fabricated benchmark results.

**Verdict: CONDITIONALLY PRODUCTION READY** (see §25).

---

## 2. A.12 Findings Revisited

| A.12 finding                                                                | Status after this phase                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection-pool env vars validated but not wired into `PrismaClient`        | **Fixed** for the `@platform/config/server` path (§3) — **and** a second, more severe instance of the same defect found and fixed in `apps/runtime` (the actual production entrypoint), which A.12 did not trace this deep (§3, §19). |
| `CreatePaymentIntentLifecycle` holds a transaction open during the PSP call | **Fixed** (§5, §6).                                                                                                                                                                                                                   |
| `platform.outbox` unbounded growth (prune mechanism)                        | **Re-verified, found partially already fixed since A.12** by an earlier phase (C2-3) that this report did not previously know about; the residual gap (no fail-safe if the CDC replication slot is missing/dead) is now fixed (§8).   |
| TLS not configured                                                          | Confirmed absent from the repo; documented as infrastructure-delegated, unverified (§10).                                                                                                                                             |
| Application DB role not least-privilege                                     | Confirmed: `lumo_app` role is created but never granted or used; every environment in the repo runs as the same broad role (§11).                                                                                                     |
| RLS not enabled                                                             | Confirmed deferred, and now traced to an explicit ADR decision (ADR-0008) that documents it as a planned second layer, not yet built (§12).                                                                                           |
| Backup/PITR/WAL not operationally verified                                  | Confirmed: real `pg_dump`/`pg_restore` scripts exist but nothing in the repo (no CronJob) invokes them; PITR remains config/documentation only (§16).                                                                                 |
| Real PostgreSQL load testing outstanding                                    | Still outstanding — same WSL2 blocker (§19, §23).                                                                                                                                                                                     |

---

## 3. Connection Pool Configuration

**Task 1 finding — two independent instances of the same defect.**

### 3a. `packages/db/src/client.ts` (used by every per-service composition root)

Before this phase, `createPrismaClient` (`packages/db/src/client.ts`) accepted a fully-populated `DatabaseConfig` (`poolMax`, `connectTimeoutMs`, `statementTimeoutMs` — all validated by `packages/config/src/server/env.ts`'s `DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS`/`DATABASE_STATEMENT_TIMEOUT_MS`, confirmed present in `.env.example`) but only ever passed `config.url` to `new PrismaClient({ datasourceUrl: config.url, ... })` — every other field was silently discarded. Every one of the ~39 per-service `composition.ts` files that build a `Database` via `@platform/config/server` + `createPrismaClient` was affected.

**Fix:** added `buildDatasourceUrl(config)` (`packages/db/src/client.ts`), which applies `connection_limit` and `connect_timeout` onto the datasource URL — Prisma ORM v6's own documented query-string parameters for pool size and connect timeout (confirmed against Prisma's docs: `connection_limit`, `pool_timeout`, `connect_timeout`, `max_idle_connection_lifetime`, `max_connection_lifetime` are the v6 datasource-URL knobs; v7 driver-adapter config is not applicable — this repo pins `@prisma/client@^6.5.0`/`prisma@^6.5.0`). An explicit param already present on the URL wins (deployment override). Tests: [`packages/db/src/client.test.ts`](packages/db/src/client.test.ts) (5 tests — applies configured values, applies schema defaults, does not override an explicit param, leaves the rest of the URL untouched, does not invent a `statement_timeout` param).

**`statementTimeoutMs` is intentionally NOT wired onto the URL** — Prisma ORM v6 has no documented datasource-URL parameter for PostgreSQL's `statement_timeout` (only the five params above). Inventing an unsupported parameter would silently do nothing. `DATABASE_STATEMENT_TIMEOUT_MS` remains validated and exposed on `DatabaseConfig`; enforcing it requires either a PostgreSQL-role-level `ALTER ROLE ... SET statement_timeout` or a PgBouncer/infrastructure-level setting. **Documented limitation, not fixed** — no safe application-level mechanism exists without inventing one.

### 3b. `apps/runtime/src/composition.ts` — the actual production entrypoint (found via independent audit, not part of A.12's scope)

`apps/runtime` (the process that actually runs in production — `api.ts`/`worker.ts`/`scheduler.ts`) does **not** use `@platform/config/server` at all; it validates its own flat config (`apps/runtime/src/config.ts`, "the ONLY place `process.env` is read"). That schema had **no** `DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS`/`DATABASE_STATEMENT_TIMEOUT_MS` fields — only `DATABASE_URL`. `buildRuntimeCore` (`apps/runtime/src/composition.ts:131-134`, before this fix) built the Prisma client as:

```ts
const prisma = createPrismaClient({
  url: config.DATABASE_URL,
  logQueries: false,
} as Parameters<typeof createPrismaClient>[0]);
```

An unsafe `as` cast supplied an object structurally missing `poolMax`/`connectTimeoutMs`. This was harmless before §3a's fix (nothing consumed those fields). **After** §3a's fix, this cast would have caused `buildDatasourceUrl` to serialize `connection_limit=undefined&connect_timeout=NaN` onto the real production datasource URL — a regression this phase caught and closed in the same pass, not introduced into a later phase.

**Fix:** added `DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS`/`DATABASE_STATEMENT_TIMEOUT_MS` to `apps/runtime/src/config.ts` (same field names/defaults/validation as `@platform/config/server`'s schema — 10 / 10,000ms / 30,000ms). Removed the unsafe cast in `apps/runtime/src/composition.ts`; the object literal now structurally satisfies `DatabaseConfig` with no cast, so a future field removal would be a compile error, not a silent gap. Added `DATABASE_POOL_MAX: "20"` to `infrastructure/k8s/10-config.yaml` — this realizes, for the entrypoint that actually runs in production, the production pool size this codebase already declared as its intent (`packages/config/src/server/config.ts`'s `ENVIRONMENT_PROFILES.production.DATABASE_POOL_MAX = "20"`), not an invented number. Connect/statement timeouts were left at schema defaults (no other part of the codebase documents a different production value). Tests: [`apps/runtime/src/composition.test.ts`](apps/runtime/src/composition.test.ts) (4 new tests — defaults, override, rejection of an invalid value); full `apps/runtime` test suite re-run green (174/174).

---

## 4. Transaction Timeout Configuration

**Task 3 finding.** `packages/db/src/transaction.ts`'s `runInTransaction` accepts `maxWaitMs`/`timeoutMs` and passes them straight to `prisma.$transaction(fn, { maxWait, timeout })`. Repo-wide search (all `.run(`/`$transaction(`/`withTransaction(` call sites across `packages/db`, every service's repositories, and the one direct `runInTransaction` caller in `services/security/src/composition.ts`) found **zero** callers that supply either option. Every interactive transaction in the codebase — all ~39 contexts' `PrismaUnitOfWork.run()` calls — relies on Prisma's built-in defaults: **5000ms transaction timeout, 2000ms maxWait**.

This is not itself a defect: a short, hard default is a reasonable financial-system discipline — it is, in fact, exactly what forced the reserve/PSP-call/settle pattern (A.4 Refund, A.8 Capture, and now §6 Create) to exist, since a raw PSP round-trip inside the transaction risked the 5s ceiling under real network latency. No evidence (no timeout-related test failure, no incident) justifies adding a new transaction-timeout configuration knob — doing so would be speculative engineering. **Documented, not changed.**

---

## 5. PSP Transaction Boundary Audit

Full evidence table (repo-wide search across Payments/Checkout/Orders/Returns/Shipping/Fulfillment/Notifications/Security/Finance — see §6 for the complete table). Summary: `CreatePaymentIntentLifecycle` was the one remaining Payments-internal violator (Refund/Capture were already fixed in A.4/A.8). One cross-service violator was found live in production wiring (Returns → Payments); a long tail of latent violators exist in services whose external ports are still in-memory stubs (Checkout tax/shipping/promotion validation, Shipping carrier calls, Notifications provider sends, Orders/Fulfillment payment/inventory/shipping ports) — inert today, but the transaction-hold-open shape is already baked into the code and will start mattering the moment each port gets a real adapter.

---

## 6. CreatePaymentIntent Remediation

**Task 5.** Confirmed: `CreatePaymentIntentLifecycle.execute()` (`services/payments/src/application/payment-lifecycle.use-cases.ts`) called `this.deps.paymentProvider.createIntent(...)` (a real PSP network call) _inside_ `this.deps.unitOfWork.run(async (tx) => {...})` — the exact long-transaction anti-pattern A.4/A.8 already fixed for Refund/Capture, never applied here.

**Fix** — split into the same reserve → PSP-call → settle-on-failure shape:

1. `reserve()` persists the domain intent at its initial `created` status in its own committed transaction, before the PSP is ever called.
2. The PSP call happens with no transaction open.
3. On PSP failure, `settleFailure()` moves the now-dangling `created` reservation to its terminal `cancelled` state (`created → cancelled` is a legal transition in `payment-status.ts`; `created` has no direct `→ failed` transition) rather than leaving an ambiguous row with no PSP counterpart, then rethrows the original error unchanged — the same shape `RefundPaymentLifecycle` already uses.

Unlike Capture/Refund, `create` mints a fresh `UniqueEntityId` per call — there is no caller-supplied id to race on, so no `withConcurrencyRetry` was needed; the reservation exists purely to move the PSP call outside the transaction. `providerIntentId`/`clientHandle` are returned to the caller unchanged — they were never persisted to a domain-row column, so nothing about the success path's return value changed.

**Tests:** [`services/payments/src/create-intent-transaction-boundary.test.ts`](services/payments/src/create-intent-transaction-boundary.test.ts) (5 tests) — proves the PSP call happens with `openCount === 0`, proves the reservation is durably persisted before the PSP call resolves, proves a PSP failure leaves the reservation `cancelled` (not stuck ambiguously) and rethrows, proves a retry after failure succeeds independently, proves two concurrent creates never race. Full `services/payments` suite re-run green (81/81, up from 76).

---

## 7. Outbox Growth Analysis

**Task 7.** The A.13 brief's premise (inherited from the still-open `docs/investigations/C-08-outbox-never-published-or-pruned.md`) was that the prune job filters on `status: "published"`, which production (CDC) never sets, so it matches zero rows forever. **Re-verification found this was already fixed by an intervening phase (labeled `C2-3` in code comments) that this report did not previously have visibility into**: `apps/runtime/src/scheduler.ts`'s `outbox-prune` job now deletes by `createdAt` age alone (not `status`), with a `logger.warn` when some past-retention rows are still `status: "pending"` (surfaced, not silently masked) — matching the C-08 investigation's own recommended remediation almost exactly, except for one piece: C-08's proposal also included a **fail-safe gate** on the Debezium replication slot's `confirmed_flush_lsn`, which was not implemented.

**Residual gap found:** the existing (and _deliberately tested_, see `scheduler.test.ts`'s "Still prunes — the warning is a signal, not a skip") behavior warns about still-pending rows but deletes them anyway. That is an accepted, documented tradeoff for the _normal_ case (bounded CDC lag within the 7-day retention window). It provides **no protection against the catastrophic case**: a replication slot that was never provisioned, or was dropped, or has never confirmed a single flush — in that state the warning's own signal (`stillPending` count) never fires meaningfully (nothing to compare against), and the job would keep deleting rows nobody has _ever_ confirmed left the database.

---

## 8. Outbox Remediation

**Task 8.** Added a fail-safe gate to `apps/runtime/src/scheduler.ts`'s `outbox-prune` job: before deleting, it queries `pg_replication_slots` for `slot_name = 'lumo_outbox'` (the slot name Debezium's own connector config uses, confirmed matching `infrastructure/docker/debezium/outbox-connector.json`). If the slot is missing or has never confirmed a flush (`confirmed_flush_lsn IS NULL`), the job logs a warning and **returns without deleting anything** — "better to grow than to delete an event nobody has confirmed streaming," per the codebase's own C-08 investigation.

This does **not** change the existing, deliberately-tested normal-case behavior (still prunes past-retention rows even when some are individually `pending`, when the slot is healthy) — it only adds strictly more conservative behavior for the one case the existing test suite never covered. It does not attempt per-row LSN-precision proof of delivery (no LSN is stored per row; adding one would be a new capability this phase's constraints exclude — "DO NOT introduce a new outbox replacement," "no speculative engineering"). This is a coarse, not per-row-precise, safety net, and is reported as such — not oversold as an airtight guarantee.

**Tests:** 3 new tests in [`apps/runtime/src/scheduler.test.ts`](apps/runtime/src/scheduler.test.ts) (slot missing → skip; slot present but `confirmed_flush_lsn` null → skip; slot healthy → prunes normally), plus the 3 pre-existing tests updated to mock a healthy slot by default and re-verified still passing (still prunes by age, still warns without skipping, still silent when nothing is stuck). 6/6 green.

**Task 9 (index audit):** `platform.outbox`'s two indexes (`@@index([status, createdAt])`, `@@index([createdAt])`) already exactly match the actual query predicates: `fetchPending` (`status: "pending"`, order by `createdAt`) and the prune job's `count`/`deleteMany` (`status/createdAt`, `createdAt`). **No index change needed** — confirmed by direct comparison of predicate to index definition, not assumed.

Also re-verified the C-08 investigation's secondary claim ("35 of 39 contexts do not write to `platform.outbox`, only 4 do") — **stale**. Spot-checked `services/checkout/src/composition.ts` and `services/payments/src/composition.ts`: both correctly construct `new PrismaOutboxStore(deps.prisma)` in their production (`deps.prisma` present) branch and `new InMemoryOutboxStore()` only in the no-Prisma (dev/test) branch. A repo-wide grep shows this dual-branch pattern in 79 files (`PrismaOutboxStore`/`InMemoryOutboxStore` both referenced). This sub-finding of C-08 has been remediated since it was written; the investigation doc itself is now stale on this specific point and should be updated or archived by a future phase (out of this phase's scope to edit).

---

## 9. PostgreSQL Security

See §10-§12.

## 10. TLS

**Task 10/11.** No `sslmode`/TLS parameter exists anywhere in the repo's `DATABASE_URL` values: `.env.example`, `infrastructure/docker/docker-compose*.yml`, `infrastructure/k8s/secret.example.yaml` all use plain `postgresql://user:pass@host:port/db` with no TLS param. `packages/config/src/server/env.ts`'s `DatabaseConfig` has no `ssl`/`sslmode` field. `buildDatasourceUrl` (§3a) would preserve an `sslmode` param if one were ever present (it only sets `connection_limit`/`connect_timeout` when absent, and never strips other params) — so nothing in this phase's fix makes TLS harder to add later, but nothing adds it either. `infrastructure/k8s/50-networkpolicy.yaml`'s egress allow is L3/L4 port-only and says nothing about in-transit encryption.

**Decision (Task 11):** TLS is entirely infrastructure-delegated today — not enforced by the application, and not verifiable as enforced by any infrastructure evidence in this repo (Railway-managed Postgres's TLS posture is external to this repo; no k8s manifest asserts a TLS-terminating proxy in front of the in-cluster path). This is **not** something to fix by guessing at a `sslmode` value with no deployment topology to justify it — "DO NOT implement TLS remediation without understanding the deployment environment" is an explicit constraint. **Documented as an open infrastructure requirement**, not fixed.

## 11. Database Roles

**Task 12/13.** `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` creates a `lumo_app` role explicitly intended as the least-privilege runtime role ("DML on business schemas, no DDL") — but only `CREATE ROLE lumo_app LOGIN PASSWORD 'lumo_app';` exists; no `GRANT`/`REVOKE` follows it anywhere in the repo (confirmed by grep across every `.sql` file). `packages/db/prisma/MIGRATIONS.md` §3 explicitly defers the grants to future hand-written SQL. Every `DATABASE_URL` visible in the repo (local docker-compose, CI, the k8s secret template) connects as `lumo`, the migration/superuser role — for both migrations _and_ runtime traffic, everywhere, including CI.

**Decision (Task 13):** the repository does not prove a least-privilege deployment; `lumo_app` exists but is unused and ungranted. Fabricating `GRANT` statements now, with no verified production schema/permission model to validate them against, and no evidence any environment actually uses `lumo_app`, would risk breaking migrations or runtime writes with no way to test the change (no live Postgres in this environment). **Documented as a required production infrastructure action, not fixed** — matches the task's explicit instruction ("If the repository cannot prove the deployment role model: do not fabricate grants").

## 12. RLS Decision

**Task 14.** Tenant isolation today is 100% application-level: every `PaymentIntent` repository query is manually scoped (`where: { id, tenantId: this.deps.tenantId }`, confirmed in `prisma-payment-intent-repository.ts`'s `findById`/`findByIdempotencyKey`/`findByPspReference`), and `tenantId`/`tenant_id` appears on essentially every business model across the schema (682 occurrences across 72 files). Postgres RLS (`ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`) does not exist anywhere in the migration history (confirmed by grep — zero hits). This is not an oversight: **ADR-0008** ("Tenancy Architecture") §Decision explicitly commits to "Postgres RLS as a second enforcement layer once real persistence lands," and §Follow-ups lists "RLS policies with the Prisma sprint" as future work — a decision already made and recorded, not yet executed.

**Decision:** RLS remains deferred, per the existing ADR-0008 commitment. Not enabled in this phase — "DO NOT blindly enable RLS" is an explicit constraint, and doing so now (with no live database to test against, and a schema-per-context Postgres layout to reason about) would be exactly the kind of unverified schema change this phase must avoid. The gap this leaves: a single missed `where tenantId` clause in any future repository has no DB-level backstop today. **Documented, not fixed** — matches the ADR's own stated sequencing.

## 13. Financial Constraints

**Task 15.** `packages/db/prisma/schema/payments.prisma` + the `init` migration confirm DB-level protection exists for: `NOT NULL` on every core column, FK `charges`/`refunds` → `payment_intents` (`ON DELETE RESTRICT`), `@@unique([tenantId, idempotencyKey])` on `PaymentIntent`, `@@unique([intentId, idempotencyKey])` on `Refund` (Phase A.5's dedupe), `@@unique([tenantId, provider, eventId])` on `ProcessedWebhook`.

**Not DB-enforced** (TypeScript-only): `status` is a plain `TEXT` column on `PaymentIntent`/`Refund` — the 12-state transition table (`payment-status.ts`) is enforced only in application code, with an explicit schema comment acknowledging this ("domain-enforced, see `PaymentStatusValue`"). `amount_minor` has no `CHECK (amount_minor >= 0)` anywhere in any migration. `psp_reference` has only a **non-unique** performance index (`20260811020000_payments_psp_reference_index`), not a unique constraint — duplicate PSP references are not rejected at the DB layer (only idempotency-key uniqueness, which is optional/nullable, prevents duplicate refund attempts).

Per the task's own instruction ("do not duplicate complex domain rules in SQL without evidence the database must enforce them"), the full transition table is correctly left out of SQL. The narrower gaps (non-negative-amount CHECK, PSP-reference uniqueness) are real defense-in-depth opportunities but have no reproducible defect or failing test behind them in this repo today — no incident, no test proving a negative amount or duplicate PSP reference was ever actually written. **Documented as a recommended hardening item for a future phase, not spec­ulatively added here.**

## 14. Migration Safety

**Task 16.** No `DROP TABLE`/`DROP COLUMN` touches any payments/refunds/charges/outbox table in the migration history (the only `DROP COLUMN` in the whole migrations directory is on unrelated `media.folders`/`pages.templates` tables). Every `NOT NULL` addition on an existing table (`payment_method JSONB NOT NULL DEFAULT '{}'`, `status TEXT NOT NULL DEFAULT 'completed'`) ships with a `DEFAULT`, which is a metadata-only, non-blocking operation on modern Postgres.

**Real, evidence-backed risk:** every index build across all 34 migrations — including `20260811020000_payments_psp_reference_index`'s `CREATE INDEX` on `payment_intents(tenant_id, psp_reference)`, explicitly on the webhook-ingress hot path — uses plain, non-`CONCURRENTLY` `DDL`. Acceptable pre-launch on empty tables; a genuine writer-lock risk the first time any of these tables are re-indexed at production volume. Prisma's transactional migration wrapper cannot run `CREATE INDEX CONCURRENTLY` (it must run outside a transaction) — this is a tooling gap, not something this phase's migrations caused, and fixing it (a `prisma migrate diff`-generated custom migration bypassing the transaction wrapper) is future-migration-authoring practice, not a change to make retroactively to already-applied migrations. **Documented as a required practice for the next index-adding migration on a populated `payment_intents`/`refunds` table.**

## 15. Schema Drift Protection

**Task 17.** `packages/db/src/schema-migration-consistency.test.ts` (read in full) statically parses migration SQL for `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN` and asserts a hand-maintained list of required columns for exactly 5 payments-schema tables were created by _some_ migration — a targeted regression test for the exact class of bug A.7 found (a schema field with no corresponding migration), explicitly built to work offline since the real drift gate (`prisma migrate diff --exit-code` in `.github/workflows/db-integration.yml`) needs a live shadow database this sandbox doesn't have.

**Confirmed gap:** this test only inspects columns — it does not check indexes, unique constraints, or FKs, so it would **not** have caught the A.11 index-drift bug (`payment_intents_tenant_id_psp_reference_idx` declared in the schema before its migration existed) had that recurred. It is scoped only to the `payments` schema; the other 38 bounded-context schemas have no equivalent offline check. No change made this phase (extending it to index-level checks or to other schemas is additive work, not a proven defect — the CI-only `migrate diff --exit-code` job is the actual comprehensive gate for those cases). **Documented as a coverage gap, not expanded** — out of the "smallest possible fix" mandate without a specific reproduced drift incident to fix against.

## 16. Backup / PITR / WAL

**Task 18/19.** Real, executable scripts exist: `scripts/ops/backup-postgres.sh` (`pg_dump --format=custom`, `pg_restore --list` integrity check, SHA256 checksum, optional S3 upload, local retention pruning) and `scripts/ops/restore-postgres.sh` (`pg_restore --clean --if-exists`, gated behind `CONFIRM=yes`; a `--pitr` mode that **prints an operator runbook rather than executing WAL replay**). `docs/operations/BACKUP_AND_RECOVERY.md` documents an RPO ≤5min/RTO ≤30min target via "WAL archiving + PITR, nightly base backup."

**Repository evidence vs. reality:** `archive_mode` is off in every Postgres config visible in the repo (`infrastructure/docker/docker-compose.yml`'s Postgres `command:` only sets logical-replication params for CDC, not WAL archiving); `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` explicitly labels PITR settings "prepared-but-disabled... DO NOT enable locally." **No k8s `CronJob` exists anywhere in `infrastructure/k8s/`** to actually invoke `backup-postgres.sh` on a schedule, despite `BACKUP_ENABLED` defaulting to `"true"` in the production config profile — that flag currently has no wired consumer.

**Verdict:** backup _tooling_ exists (dump/restore, not PITR); backup _automation_ does not (nothing schedules it). PITR/WAL is documentation and configuration intent only. This matches — and does not overclaim beyond — what `packages/db/src/backup.ts`'s own comment already states: "execution is operated outside the application." **Nothing fabricated; the gap between documented RPO/RTO targets and actually-scheduled automation is the concrete finding for operations to close before launch.**

## 17. Query & Index Readiness

**Task 20/21.** Every hot-path query checked has a matching, correctly-ordered index: `findById` (PK), `findByPspReference` (`@@index([tenantId, pspReference])`, added explicitly in A.10 for this lookup), `findByIdempotencyKey` (`@@unique([tenantId, idempotencyKey])`), outbox `fetchPending` (`@@index([status, createdAt])`), webhook correlation (`ProcessedWebhook`'s `@@unique([tenantId, provider, eventId])`). Tenant filtering is consistently the **leading** index column across the schema, not an afterthought. **No missing-index finding.**

**Task 22 (N+1 audit):** searched loop constructs across Payments/Orders/Checkout/Returns application layers — all loops over input items build in-memory domain objects only, no per-iteration DB calls. One genuine minor finding: `PrismaPaymentIntentRepository.save`'s refund-row write (`for (const refund of refunds) { await client.refund.upsert(...) }`) is one `upsert` per refund row rather than a single batched write — bounded by refund count per intent (typically small), not urgent, **documented, not changed** (no evidence of it being a real bottleneck, and batching Prisma `upsert` requires per-row conflict targets Prisma doesn't support as a single batched call without restructuring the write — not a "smallest possible fix"). Positive finding: `PrismaOrderRepository.list()` explicitly batches its shipping-address lookup via `findMany({ where: { orderId: { in: [...] } } })` with an in-code comment confirming this was a deliberate anti-N+1 design choice.

**Connection saturation formula (Task 20), using only repo-confirmed values:**

- `api` deployment: `replicas: 2` (HPA min 2 / max 10, `infrastructure/k8s/40-autoscaling.yaml`)
- `worker` deployment: `replicas: 2` (HPA min 2 / max 6, capped at Kafka's 6 partitions)
- `scheduler` deployment: `replicas: 1` (explicitly singleton, no HPA)
- `debezium-connect`: `replicas: 1`, connects via a replication slot, not the Prisma pool — separate, ~1-connection budget
- `collector`/`storefront` deployments do not mount the DB secret — they do not connect to Postgres directly

`Total DB connections = replicas × pool_max + background/admin headroom`

- Baseline: `(2 + 2 + 1) × 20 = 100` (using the now-correctly-wired production `DATABASE_POOL_MAX=20`, §3b)
- At HPA max: `(10 + 6 + 1) × 20 = 340`
- Plus Debezium's ~1 connection.

No `pg_hba.conf`/`max_connections` value exists anywhere in this repo to compare against — that is a PostgreSQL server-side setting owned by infrastructure (managed Postgres or a hand-provisioned instance), not application config. **This formula, and whether 340 connections fits the actual `max_connections` of the target PostgreSQL instance, is the concrete input A.14 needs from whoever provisions that instance** — not something this repo can determine on its own.

## 18. Failure Modes

**Task 23.** `withConcurrencyRetry` (`payment-lifecycle.use-cases.ts`) retries **only** `instanceof ConcurrencyError` (the app-level optimistic-lock signal from a zero-row `updateMany`); any other error — including a raw Prisma error — is rethrown immediately on first occurrence, confirmed by reading the function. Repo-wide grep for Prisma's connection-loss (`P1001`), pool-timeout (`P2024`), and write-conflict (`P2034`) error codes returns **zero hits in application/infrastructure source** (only in prior audit-report markdown documenting _this sandbox's own_ `P1001` when checking `migrate status`, e.g. §21). **There is no retry handling anywhere in the codebase for genuine Postgres-level failures** — connection loss, pool exhaustion, serialization/write-conflict, or migration-lock contention simply propagate to the caller as a failed request.

Per the task's own instruction ("Retries must only exist where operations are demonstrably safe/idempotent"), adding blanket retries around `P1001`/`P2024`/`P2034` without evidence of which specific call sites are safely idempotent under retry would be speculative and risk double-executing a non-idempotent write. **Documented as a gap, not fixed** — a future phase should retry-wrap specifically the read-only/idempotent-by-construction paths (e.g. `findById`), not blanket-wrap every Prisma call.

## 19. A.14 Load-Test Readiness

Unchanged from A.12: WSL2 fails at the OS level (`Wsl/Service/E_UNEXPECTED`) in this environment; Docker was not independently re-verified this phase (no new evidence either way — not re-tested since the blocker is at the WSL2/OS layer, upstream of Docker). No real PostgreSQL instance was reachable at any point in this phase (`prisma migrate status` failed with `P1001` against `localhost:5432`, confirming the blocker is still live). **A.14 remains blocked on the same environment issue**; this phase's job was to make sure nothing code/configuration-level would need to change once a real instance is available, which is now true for every item in §20 marked "Fixed."

## 20. Production Readiness Matrix

| Area                       | Status                            | Evidence | Risk                                                                                          | Fixed?             | Required Before A.14?                                                                                     |
| -------------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| Pool configuration         | Fixed (2 instances)               | §3a, §3b | Was: pool/timeout config silently ignored everywhere, worst in the actual prod entrypoint     | **Yes**            | No — closed                                                                                               |
| Transaction timeouts       | Documented                        | §4       | Low — 5s/2s Prisma default is a reasonable, unconfigured-by-design ceiling                    | N/A                | No                                                                                                        |
| PSP transaction boundaries | Partially fixed                   | §5, §6   | CreatePaymentIntent closed; Returns→Payments confirmed live, flagged not fixed (out of scope) | Partial            | **Yes for Returns→Payments — flagged for a follow-up phase before real load testing exercises that path** |
| Outbox growth              | Fixed (residual gap)              | §7, §8   | Was: no fail-safe against a dead replication slot                                             | **Yes**            | No — closed                                                                                               |
| TLS                        | Documented, unverified            | §10      | Unknown — infra-delegated                                                                     | No                 | Operator must verify before launch                                                                        |
| DB roles                   | Documented, unverified            | §11      | Medium — same role for migration+runtime everywhere visible                                   | No                 | Operator must provision least-privilege role                                                              |
| RLS                        | Documented, deferred per ADR-0008 | §12      | Low today (app-level scoping consistently applied); no DB backstop                            | No (by design/ADR) | No — deferred by existing decision                                                                        |
| Financial constraints      | Documented gaps                   | §13      | Low-medium — status/amount/PSP-ref rely on app layer only                                     | No                 | Recommended, not blocking                                                                                 |
| Migrations                 | Safe so far, tooling gap flagged  | §14      | Medium for the _next_ index migration on a populated table                                    | No                 | Practice change for future migrations                                                                     |
| Schema drift               | Partial coverage                  | §15      | Low-medium — columns only, payments-schema only                                               | No                 | Recommended, not blocking                                                                                 |
| Indexes                    | Confirmed sufficient              | §17      | None found                                                                                    | N/A                | No                                                                                                        |
| Backup/PITR                | Tooling exists, unscheduled       | §16      | High — no automation actually runs                                                            | No                 | **Yes — operator must wire a CronJob/scheduler before launch**                                            |
| Query performance          | No N+1 found (1 minor loop)       | §17      | Low                                                                                           | No                 | No                                                                                                        |
| Failure handling           | Gap confirmed                     | §18      | Medium — no retry for connection loss/pool exhaustion/serialization failure                   | No                 | Recommended, not blocking                                                                                 |

## 21. Fixed Issues

1. `packages/db/src/client.ts` — `buildDatasourceUrl` wires `DATABASE_POOL_MAX`/`DATABASE_CONNECT_TIMEOUT_MS` onto the Prisma datasource URL for every `@platform/config/server`-based composition root. Tests: `packages/db/src/client.test.ts`.
2. `packages/config/src/server/config.test.ts` — added invalid-value rejection tests (pool max ≤0, non-numeric connect timeout, negative statement timeout).
3. `apps/runtime/src/config.ts` + `apps/runtime/src/composition.ts` — added the same three DB fields to the real production entrypoint's config schema and removed the unsafe cast that had silently omitted them. Tests: `apps/runtime/src/composition.test.ts`.
4. `infrastructure/k8s/10-config.yaml` — added `DATABASE_POOL_MAX: "20"` to realize the codebase's already-declared production intent for the entrypoint that actually deploys.
5. `services/payments/src/application/payment-lifecycle.use-cases.ts` — `CreatePaymentIntentLifecycle` split into reserve/PSP-call/settle-on-failure; PSP call no longer holds a transaction open. Tests: `services/payments/src/create-intent-transaction-boundary.test.ts`.
6. `apps/runtime/src/scheduler.ts` — outbox-prune job gated on the CDC replication slot's `confirmed_flush_lsn`; skips pruning entirely if the slot is missing or has never confirmed a flush. Tests: `apps/runtime/src/scheduler.test.ts`.

## 22. Intentionally Deferred Issues

- `DATABASE_STATEMENT_TIMEOUT_MS` remains unwired into Prisma — no v6 datasource-URL parameter exists; requires a PostgreSQL-role-level or PgBouncer-level setting (§3a).
- TLS enforcement — infrastructure-delegated, not app-enforced; no deployment topology evidence to design against (§10).
- Least-privilege DB role (`lumo_app`) — created but ungranted/unused everywhere visible; requires an infrastructure action, grants cannot be safely fabricated without a verifiable target environment (§11).
- RLS — deferred per ADR-0008's own stated sequencing, not this phase's call to make (§12).
- Non-negative-amount / PSP-reference-uniqueness DB constraints — real hardening opportunities, no reproducible defect behind them today (§13).
- `CREATE INDEX CONCURRENTLY` practice for future payments-table index migrations — a process change for the next migration author, not something to retroactively apply (§14).
- Schema-drift test coverage (indexes/constraints, non-payments schemas) — a real gap, but expanding it is additive work without a reproduced incident driving it (§15).
- Backup automation (CronJob) — tooling exists, scheduling does not; this is an infrastructure deployment action, not an application code change (§16).
- Retry handling for Postgres connection-loss/pool-exhaustion/serialization-failure error codes — no evidence of which call sites are safely retry-idempotent; blanket retry would be speculative (§18).
- **Returns → Payments nested-transaction/live-PSP-call defect** — confirmed live in production wiring, same class of bug as §6, but outside this phase's Task 5 scope (named `CreatePaymentIntentLifecycle` only). Flagged as a follow-up task (see below), not fixed here.

## 23. Environment Blockers

- WSL2 fails at the OS level (`Wsl/Service/E_UNEXPECTED`) — unchanged from A.9-A.12. No real PostgreSQL instance was reachable at any point in this phase.
- `prisma migrate status` fails with `P1001: Can't reach database server at localhost:5432` — confirms the blocker is still live; not a code defect.
- Full-monorepo `turbo run typecheck`/`test` intermittently crash with Node/V8 OOM (`exit code 134`) at default concurrency on this Windows sandbox — resolved by lowering `--concurrency`; not related to any change in this phase (crashes occurred in packages untouched by this phase, e.g. `@platform/media`, `@platform/shipping`, before a lower-concurrency re-run passed cleanly). Documented so a future phase doesn't mistake it for a real failure.

## 24. Remaining Risks

Ranked by severity:

1. **Returns → Payments live nested-transaction/PSP call** (§5, §22) — the highest-severity unfixed finding from this phase; confirmed wired in production (`apps/runtime/src/api.ts`), not latent.
2. **Backup automation absent** (§16) — tooling exists but nothing schedules it; a real operational gap before launch.
3. **DB role / TLS unverified** (§10, §11) — both are infrastructure-side unknowns this repository cannot resolve on its own.
4. **No retry for genuine Postgres failures** (§18) — acceptable for now (fail-fast is safer than blind retry) but worth closing with evidence-backed, narrowly-scoped retries in a future phase.
5. Everything else in §22 is lower-severity hardening, explicitly not blocking.

## 25. Final Verdict

### CONDITIONALLY PRODUCTION READY

Code/configuration-level database hardening for this phase's explicit scope is sound: both confirmed connection-pool wiring defects are closed (including the more severe one found in the actual production entrypoint), the one remaining Payments-internal long-transaction anti-pattern is closed, and the outbox growth mechanism now has a real fail-safe. All available quality gates are green. Real PostgreSQL operational verification (load test, backup/restore drill, TLS/role verification against an actual deployment topology) remains outstanding — entirely for infrastructure/environment reasons (WSL2/Docker blocker, no deployed cluster to inspect), not for lack of code readiness. The one newly-found live defect (Returns → Payments, §5/§22) is flagged, not silently left off this report, and a follow-up task has been raised for it — it does not change this phase's own verdict on what it was scoped to fix, but it is a real, confirmed production risk that should be closed before A.14 exercises the refund path under load.
