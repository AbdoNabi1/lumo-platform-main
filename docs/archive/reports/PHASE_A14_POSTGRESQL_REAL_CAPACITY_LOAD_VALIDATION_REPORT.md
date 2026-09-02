# Phase A.14 — PostgreSQL Real Load, Concurrency & Capacity Validation Report

**Date:** 2026-08-12
**Scope:** Determine whether the real PostgreSQL deployment can sustain expected production workload, per the Phase A.14 brief (Tasks 1–25).
**Status:** Environment-blocked for all live-database tasks. Offline/static analysis completed for everything derivable without a live connection.

---

## 1. Executive Summary

A live PostgreSQL instance could not be brought up in this environment despite two remediation attempts (stale-socket deletion, full OS reboot) plus a third mitigation attempt (disabling Docker Desktop's AI/Inference feature). The blocker is a Docker Desktop 4.79.0 backend crash rooted in filesystem-level corruption of a Unix-domain-socket reparse point, unrelated to WSL2 (which is itself healthy) and unrelated to this repository's code or configuration. **No PostgreSQL load, concurrency, or capacity measurement in Tasks 3–10, 12, 15–20, and the live-DB portions of 21–22 could be performed. No numbers are fabricated for any of them — they are marked NOT MEASURED — ENVIRONMENT-BLOCKED.**

What _was_ accomplished, entirely offline:

- **Definitive root-cause diagnosis** of the environment blocker (Task 1), with more precision than Phases A.12/A.13 achieved, including an OS reboot as a falsification test.
- **Full quality-gate suite green**: typecheck 78/78, lint 78/78, test 78/78, `pnpm arch` 0 violations (1565 modules, 6788 dependencies), `prisma validate` clean. `prisma migrate status` correctly fails `P1001` (expected — no live DB).
- **Static schema baseline** (Task 2): full table/index/FK/constraint inventory for payments, refunds, outbox, customer/session, and audit tables, migration history reconciliation, and schema-derived (not measured) row-size structural estimates.
- **A new class of finding**: the PSP/HTTP-call-inside-open-transaction anti-pattern that Phases A.8/A.12/A.13/A.13.1 closed for Payments and Returns is **still open in 9 other call sites** across Licensing, Shipping, Fulfillment, Orders, Search, and Notifications (Task 11).
- One N+1 query pattern in Finance's journal repository (Task 13).
- Reconfirmation that TLS is unenforced at the connection-string layer and RLS remains absent repo-wide (Task 23), and that the "least-privilege" DB role created in init SQL is dead configuration — the app connects as superuser in every documented environment.

**Verdict: NOT PRODUCTION READY** — not because of any newly discovered defect that makes the system unsafe, but because the brief's own success criteria are unmet: _"real PostgreSQL load is measured OR the environmental blocker is conclusively proven."_ The blocker is conclusively proven, but that alone cannot upgrade to CONDITIONALLY PRODUCTION READY when 9 new un-remediated transaction-boundary violations were found in the process — see §26 for the full reasoning and the distinction from prior phases' verdicts.

---

## 2. Environment

**Root cause (definitively diagnosed, with falsification evidence):**

Docker Desktop 4.79.0's backend (`com.docker.backend.exe`) crashes on every launch attempt with:

```
starting services: initializing Inference manager: listening on unix://C:/Users/abdoh/AppData/Local/Docker/run/dockerInference:
remove C:/Users/abdoh/AppData/Local/Docker/run/dockerInference: The file cannot be accessed by the system.
(listener: The filename, directory name, or volume label syntax is incorrect.)
```

This is a stale AF_UNIX socket reparse point (`Attributes: Archive, ReparsePoint`, 0 bytes, last written 2026-07-08 — over a month old) that Docker's "Inference manager" (Docker Model Runner / Docker AI feature) tries to unlink and rebind on every startup, and fails.

**Distinguishing this from Phase A.12's blocker:** A.12 found WSL2 itself catastrophically broken (`wsl -d Ubuntu-24.04` returned `Wsl/Service/E_UNEXPECTED`, distros stuck `Stopped`). That is **not** the case here — `wsl -d Ubuntu-24.04 -- echo test` succeeds cleanly, and `wsl --status` reports normally. This phase's blocker is narrower and lower in the stack: a corrupted reparse point on the NTFS volume that Docker Desktop's backend cannot recover from, independent of WSL2's health.

**Remediation attempts made (all failed, in order):**

1. `Remove-Item -Force` on the socket file → `IOException: The file cannot be accessed by the system.`
2. `cmd /c del /f /a` → identical error.
3. `[System.IO.File]::Delete()` (.NET direct API, bypassing PowerShell) → identical error.
4. `cmd /c rmdir` (treating the reparse point as a directory junction) → identical error.
5. `icacls` (ACL inspection, no content access needed) → identical error — confirms this is not a permissions or open-handle issue; the filesystem driver itself rejects all operations on this reparse point.
6. **Full Windows reboot** (user-initiated, ~49 minutes before retest) → Docker Desktop relaunched, crashed with the **exact same error, same file, same timestamp-of-creation** (2026-07-08) — the file survived the reboot untouched. This rules out a session-scoped kernel handle as the cause; the corruption is persisted at the filesystem/reparse-point-metadata level.
7. Disabling `EnableDockerAI` in `%APPDATA%\Docker\settings-store.json` (hypothesis: skip Inference-manager init entirely) → identical crash; the setting change was reverted afterward since it had no effect.

No further remediation was attempted (full Docker Desktop uninstall/reinstall, manual reparse-point manipulation via `DeviceIoControl`, or registry-level intervention) — these are more invasive to the host system and the user chose to finalize this phase as environment-blocked rather than pursue them further.

**Configured (not measured) topology**, per `infrastructure/docker/docker-compose.yml`:

| Setting                                                      | Configured value                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Image                                                        | `postgres:16-alpine`                                                                           |
| Host/port                                                    | `localhost:5432`                                                                               |
| Database                                                     | `lumo`                                                                                         |
| User                                                         | `lumo` (superuser role — see §20)                                                              |
| `wal_level`                                                  | `logical` (CDC-ready)                                                                          |
| `max_wal_senders`                                            | 8                                                                                              |
| `max_replication_slots`                                      | 8                                                                                              |
| `shared_buffers`                                             | 256MB                                                                                          |
| `max_connections`                                            | 200                                                                                            |
| Container memory limit                                       | 1g                                                                                             |
| `work_mem` / `effective_cache_size` / `maintenance_work_mem` | not set — Postgres defaults apply (unmeasured, not overridden anywhere in compose or init SQL) |

**Host machine** (this development sandbox, not a production reference): Intel Core i7-8850H, 6 cores / 12 logical processors, 15.8 GB RAM, ~160 GB used / ~10.4 GB free on the C: volume. This is a laptop-class dev machine and its numbers should **not** inform any production capacity conclusion even if the DB had been reachable.

---

## 3. PostgreSQL Version

Configured: **16 (alpine)**. Not verified against a running `SELECT version()` — no live connection. No version drift risk identified in migration files (no version-specific SQL syntax beyond standard PG 12+ features observed).

---

## 4. Hardware/Resources

Not measurable — no live instance. See host specs in §2; container resource _limits_ (not actual usage) are documented in the compose file table above. `work_mem`, `effective_cache_size`, `maintenance_work_mem`, `max_connections` runtime values could not be queried via `SHOW`.

---

## 5. Schema Baseline

Full static baseline performed by reading `.prisma` schema files and `.sql` migration files directly — no live `\dt`/`\di` catalog queries possible.

**Table inventory (payments/refunds domain, `packages/db/prisma/schema/payments.prisma`):**

| Table                | Key columns                                                                                                                                                                        | Notes                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `payment_intents`    | id(UUID), tenant_id, order_ref, amount_minor, currency, status, idempotency_key?, psp_reference?, payment_method(JSONB), authorized_amount_minor?, version, created_at, updated_at |                                         |
| `payment_attempts`   | id, tenant_id, intent_id, kind, outcome, reference?, occurred_at                                                                                                                   | FK→payment_intents `ON DELETE RESTRICT` |
| `processed_webhooks` | id, tenant_id, provider, event_id, received_at                                                                                                                                     |                                         |
| `charges`            | id, tenant_id, intent_id, psp_token, amount_minor, occurred_at                                                                                                                     | FK→payment_intents `ON DELETE RESTRICT` |
| `refunds`            | id, tenant_id, intent_id, amount_minor, status(default `completed`), occurred_at, idempotency_key?                                                                                 | FK→payment_intents `ON DELETE RESTRICT` |

**Outbox/webhook (`platform.prisma`):** `outbox` (id, topic, key, content_type, payload BYTEA, headers JSONB, status, tenant_id?, producer?, created_at, published_at?), `inbox_processed_events` (composite PK: consumer_group+message_id), `dead_letters`, `audit_events`.

**Customer/session (`identity.prisma`, `customer-360.prisma`):** `customers` (soft-delete via `deleted_at`), `addresses`, `consent_records`; `customer_session_cache`, `session_snapshots` (append-only), `session_transitions`, plus identity-graph and computed-attribute/segment tables. **By explicit design, `customer_360` tables carry zero foreign keys** (documented in-migration: "Customer 360 owns no source data").

**Audit (`security.prisma`):** `audit_records` — a WORM (write-once-read-many) ledger with `prev_hash`/`hash`/`signature` chaining, no `version`/`updated_at` columns by design, DB-trigger-enforced immutability (per migration `20260718000000_security_platform_p2_0`).

**Indexes:** every business table above carries tenant-scoped composite indexes (e.g., `payment_intents[tenant_id, idempotency_key]` unique, `[tenant_id, status]`, `[tenant_id, psp_reference]`; `refunds[intent_id, idempotency_key]` unique). Full list with file:line citations retained in the audit trail; omitted here for brevity.

**Schema drift check:** two historical drift instances were found, **both already self-documented and resolved by their own remediation migrations**:

1. `refunds.status` existed in the Prisma schema before any migration created the column (closed by `20260811010000_payments_refund_status_column`).
2. `payment_intents[tenant_id, psp_reference]` index was declared in schema but never migrated (closed by `20260811020000_payments_psp_reference_index`).

No further undocumented drift found across the six domains scoped for this check (payments, refunds, outbox, customer/profile, session/journey, audit).

**Schema-derived row-size estimates** (explicitly labeled structural, not measured):

| Table                    | Fixed-column subtotal | Variable fields                                                 | Total (excl. variable)   |
| ------------------------ | --------------------- | --------------------------------------------------------------- | ------------------------ |
| `payment_intents`        | 159 B                 | `payment_method` JSONB — unmeasured                             | ≈184 B + JSONB           |
| `refunds`                | 97 B                  | —                                                               | ≈121 B                   |
| `outbox`                 | 144 B                 | `payload` BYTEA + `headers` JSONB — unmeasured, likely dominant | ≈169 B + payload/headers |
| `customer_session_cache` | 264 B                 | —                                                               | ≈290 B                   |

These feed §14's growth discussion but cannot substitute for measured `pg_relation_size()` output.

---

## 6. Data Volume

**NOT MEASURED — ENVIRONMENT-BLOCKED.** No synthetic data was generated and no insertion throughput was benchmarked. Generating "realistic production-like data" per the brief's Task 3 requires a live database to insert into; doing this against nothing would only produce fabricated numbers, which the brief explicitly forbids.

---

## 7. Connection Pool

**Code-level verification only** (no live pool behavior measurable):

- `packages/db/src/client.ts` `buildDatasourceUrl()` wires `connection_limit` and `connect_timeout` onto the Prisma datasource URL from `DatabaseConfig.poolMax`/`connectTimeoutMs` (Prisma v6 native URL params). Confirmed present and unchanged from Phase A.13's fix.
- `apps/runtime/src/config.ts` defines `DATABASE_POOL_MAX` (default 10, validated positive int) and wires it through `composition.ts` into the real Prisma client construction — confirmed intact, not reverted since A.13.
- No `statement_timeout` equivalent exists as a Prisma v6 URL param (documented limitation, unchanged since A.13).
- **Actual pool behavior under 10/25/50/100/250/500 concurrent requests, saturation point, and error behavior — NOT MEASURED, requires a live database.**

---

## 8. Throughput

**NOT MEASURED — ENVIRONMENT-BLOCKED.**

## 9. p50/p95/p99 Latency

**NOT MEASURED — ENVIRONMENT-BLOCKED.**

## 10. Lock Contention

**NOT MEASURED — ENVIRONMENT-BLOCKED.** `pg_stat_activity`/`pg_locks` require a live connection.

---

## 11. Transaction Duration

**Code-level static audit performed** (cannot measure actual wall-clock transaction duration without a live DB, but the brief's specific concern — "confirm external HTTP calls are NOT executed while holding DB transactions" — is fully answerable by source inspection).

**Previously-fixed call sites re-verified intact:**

- `services/payments/src/application/payment-lifecycle.use-cases.ts` — `CreatePaymentIntentLifecycle`, `CapturePaymentLifecycle`, `RefundPaymentLifecycle` all still split the PSP call outside `unitOfWork.run` (reserve → PSP call → settle pattern from A.8/A.13).
- `services/returns/src/application/return-lifecycle.use-cases.ts` `DecideResolution` → `PaymentsPort.requestRefund` still calls out **after** the commit, per A.13.1's fix.

**NEW violations found — the same anti-pattern, not previously flagged:**

| #   | File:line                                                                            | What executes inside the open transaction                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `services/licensing/src/application/billing.use-cases.ts:104`                        | `CollectInvoice.execute` — PSP `payments.collect()` call + `financeLedger.postSettlement()`                                                                                                                                                                  |
| 2   | `services/shipping/src/application/shipment-lifecycle.use-cases.ts:104`              | `CreateLabel.execute` — carrier `createLabel()` HTTP call                                                                                                                                                                                                    |
| 3   | `services/shipping/src/application/shipment-lifecycle.use-cases.ts:162`              | `VoidLabel.execute` — carrier `voidLabel()` HTTP call                                                                                                                                                                                                        |
| 4   | `services/fulfillment/src/application/create-shipment.use-case.ts:42`                | `CreateShipment.execute` — `shippingProvider.createShipment()` carrier call                                                                                                                                                                                  |
| 5   | `services/fulfillment/src/application/request-reservation.use-case.ts:51`            | `RequestReservation.execute` — cross-context `inventoryPort.reserve()` call                                                                                                                                                                                  |
| 6   | `services/orders/src/application/order-lifecycle.use-cases.ts:104`                   | `RequestPaymentCapture.execute` — `paymentPort.requestCapture()`                                                                                                                                                                                             |
| 7   | `services/orders/src/application/order-lifecycle.use-cases.ts:153-154`               | `RequestFulfillment.execute` — **two** sequential cross-context calls (`inventoryPort.requestReservation()`, `shippingPort.requestShipment()`) in one open transaction                                                                                       |
| 8   | `services/search/src/application/search.use-cases.ts:131,171`                        | `UpsertDocument`/`DeleteDocument` — external search-index provider calls                                                                                                                                                                                     |
| 9   | `services/notifications/src/application/notification-lifecycle.use-cases.ts:128-190` | `SendNotification.execute` — the entire channel-dispatch (email/SMS/push/webhook provider `.send()`) runs inside the transaction; the most load-sensitive instance, since every notification send holds a DB transaction open for a real external round trip |

**Checked and clean:** `services/security/src/application/mfa.use-cases.ts` (`EnrollMfa`/`VerifyMfaEnrollment` both call the provider before opening the transaction).

**Not exhaustively re-verified:** `services/security/*` beyond MFA, and `services/finance/*` command handlers — grepped with no PSP/HTTP call sites found inside their transaction callbacks, but not walked line-by-line to the same depth as the table above.

---

## 12. Query Performance

**NOT MEASURED — ENVIRONMENT-BLOCKED.** No `pg_stat_statements`, `EXPLAIN ANALYZE`, or buffer-read data available without a live instance.

---

## 13. N+1 Verification

**Code-level static audit.** One violation found:

- `services/finance/src/infrastructure/prisma-finance-repositories.ts:88-91` — `PrismaJournalRepository.findBySourceRef` issues one `db.ledgerEntry.findMany(...)` **per journal row** inside a `for` loop, instead of a single batched `findMany({ where: { journalId: { in: [...] } } })`.

Payments, Returns, Notifications, and Customer-360 repositories were checked and found clean (single-row lookups, not looped). Two write-side per-child upsert loops exist (Catalog variant upsert, Payments refund upsert on save) — these are aggregate-child persistence patterns, not the read-side N+1 anti-pattern, and are noted but not flagged as violations.

---

## 14. Index Effectiveness

**NOT MEASURED — ENVIRONMENT-BLOCKED** (hit rate, unused-index detection, and sequential-scan counts all require live `pg_stat_user_indexes`/`pg_stat_user_tables`). The index _declarations_ themselves are enumerated in §5 and appear reasonable by inspection (every high-cardinality lookup path — tenant+status, tenant+idempotency-key, tenant+psp-reference — has a matching composite index), but "reasonable by inspection" is not evidence of measured effectiveness and is not represented as such.

---

## 15. Table Growth Projection

**Cannot be computed** — the brief requires "daily row growth" derived from real traffic, which does not exist in this environment (no production traffic data, no load-test-generated data). What _is_ available — schema-derived structural row-size estimates (§5) — is a necessary but not sufficient input; without a measured or assumed insertion rate, no daily/monthly/yearly projection can be produced without fabricating the growth-rate assumption. This task is marked **NOT COMPUTABLE — ENVIRONMENT-BLOCKED**, not merely "not measured," since even a projection methodology needs a rate input this environment cannot supply.

---

## 16. Vacuum / Analyze

**NOT MEASURED — ENVIRONMENT-BLOCKED.**

## 17. Storage Performance

**NOT MEASURED — ENVIRONMENT-BLOCKED.**

## 18. WAL / Replication

**Not measured live.** Configuration-only: `wal_level=logical`, `max_wal_senders=8`, `max_replication_slots=8` are set in `docker-compose.yml`'s postgres command (§2), consistent with the CDC/Debezium architecture. `archive_mode` is confirmed **off** in the compose file (unchanged since A.12/A.13's finding) — no WAL archiving configured for this local/dev topology. Whether these values differ in an actual production IaC target could not be verified — no such IaC files were found in this repository (production deployment config is out of this repo's scope, consistent with prior phases' findings).

## 19. Backup / Restore

**NOT PERFORMED — ENVIRONMENT-BLOCKED.** No live instance to back up.

## 20. Failure Testing

**NOT PERFORMED — ENVIRONMENT-BLOCKED.**

---

## 21. Financial Invariants

**Cannot be verified under real load** — no live database. However, the invariants the brief lists (captured ≤ authorized, refunds ≤ captured, failed refunds don't consume capacity, duplicate refund/capture idempotency, webhook replay safety) **do have existing regression-test coverage** at the application/domain layer, confirmed present in the working tree:

- `services/payments/src/refund-concurrency.test.ts`
- `services/payments/src/capture-concurrency.test.ts`
- `services/payments/src/capture-crash-recovery.test.ts`
- `services/payments/src/refund-idempotency.test.ts`
- `services/payments/src/create-intent-transaction-boundary.test.ts`

All pass as part of the green 78/78 test-gate run (§ Quality Gates below). These tests exercise the invariants against the application's transaction/concurrency-control logic (optimistic locking via `version`, idempotency-key uniqueness constraints) using Prisma's in-memory/mocked test harness — they are **real regression tests of real logic**, but they are not a substitute for the brief's Task 6/7 real-PostgreSQL concurrent-load scenarios (700+700, 500+500, etc.), which require actual row-level locking and MVCC behavior that only a live instance can exhibit. Those specific numbered scenarios were **NOT MEASURED — ENVIRONMENT-BLOCKED.**

## 22. Data Integrity

**NOT MEASURED — ENVIRONMENT-BLOCKED** (orphaned-FK/duplicate-key/invalid-status-combination checks require querying live data; none exists).

---

## 23. Security

Code/config-level review only (no live-instance checks: TLS handshake, actual role grants in effect, RLS enforcement at runtime):

1. **TLS: unenforced.** `packages/db/src/client.ts`'s `buildDatasourceUrl()` sets only `connection_limit`/`connect_timeout` — `sslmode` is never read, set, or enforced anywhere in the URL builder or its callers. Repo-wide search for `sslmode` found zero matches. Unchanged since A.7's original finding.
2. **Least-privilege role: configured but unused.** `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` creates a `lumo_app` role intended for production use, but its own comment states grants are "wired per-schema after the first migration" — no such `GRANT` statements exist anywhere in the migration set. Every connection string documented in the repo (`.env.example`, `docker-compose.runtime.yml`, CI workflows, integration test headers) connects as `lumo` — the Postgres superuser role. **The least-privilege groundwork is dead configuration.**
3. **Credential handling: clean.** `DATABASE_URL` is read only from env vars (`packages/config/src/server/env.ts`, `apps/runtime/src/config.ts`); `.env*` is gitignored; no hardcoded production secret found. One dev-only fallback default exists in `apps/runtime/src/seed.ts:74` (`?? "postgresql://lumo:lumo@localhost:5432/lumo"`), matching the already-documented local-dev credential — not a new leak.
4. **RLS: absent, confirmed zero.** No `ROW LEVEL SECURITY` statement in any migration. The init SQL itself documents this as deliberately deferred ("RLS: per-business-table tenant policies land as migration #2 (ADR-0008 §3)") and still not landed. Unchanged since A.7/A.12.
5. **Connection-string exposure: clean.** No logging call sites found that would print the datasource URL; Prisma's query logger (gated by `config.logQueries`) logs query text, not the connection string.

---

## 24. Capacity Model

**Cannot be derived.** The brief requires the Green/Yellow/Red-zone thresholds to come from actual measurements ("These thresholds must be derived from actual measurements, not arbitrary assumptions") — with zero live measurements available, producing any numeric capacity model here would violate the brief's own anti-fabrication rule. Configured _ceilings_ (not measured capacity) are documented in §2 (`max_connections=200`, `shared_buffers=256MB`, container memory limit 1g) — these describe what the compose file permits, not what the system can safely sustain.

---

## 25. Bottlenecks

None identified empirically (no load was run). The one theoretical, evidence-adjacent risk worth naming: `platform.outbox.payload` (BYTEA) and `headers` (JSONB) are unbounded variable-length columns on a high-write table with only two indexes (`[status, created_at]`, `[created_at]`) — if event payloads grow large or outbox write volume is high, this table is a structurally plausible first bottleneck under load, consistent with why Phase A.13 already hardened its prune job. This is a structural observation from the schema, not a measured bottleneck.

---

## 26. Fixes Applied

**None.** This phase found new findings (§11, §13) but did not modify any source file — consistent with this sprint's isolation scope (capacity/load _validation_, not remediation) and consistent with the established precedent from Phase A.13 (`services/returns` nested-tx defect: found, flagged, fixed in a dedicated follow-up sprint A.13.1, not fixed inline).

## Fixes Rejected / Deferred (with rationale)

| Finding                                                            | Why deferred                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9 new PSP/HTTP-call-inside-transaction violations (§11, items 1–9) | Genuine defects of a known, previously-remediated class, but fixing 9 call sites across 6 services each needs its own regression test per this project's "every bug fix requires a regression test" rule — a scope far beyond a single capacity-audit phase. Recommended as a dedicated remediation sprint, mirroring how A.13.1 handled the Returns instance of the same pattern.                                     |
| Finance journal N+1 (§13)                                          | Single, narrow, low-risk fix — but still out of this phase's stated scope (measurement, not optimization) and the brief explicitly says "fix only demonstrated N+1 issues" in a context that assumes live-query evidence; this one was found by static reading, not by observing an actual N+1 query storm, so a regression test proving the _measured_ query-count reduction isn't possible without a live DB either. |
| TLS enforcement, live DB role wiring, RLS                          | All three are known, multi-phase-old, structural gaps (A.7 origin) explicitly out of this phase's "DO NOT introduce security architecture changes unless explicitly required by an actual finding" constraint — none of today's findings are new enough in kind to justify overriding that constraint here.                                                                                                            |

---

## 27. Remaining Risks

1. **The 9 new transaction-boundary violations are a real production risk independent of this phase's environment blocker** — under real load, each holds a Postgres row/table lock open for the duration of an external network call (PSP, carrier, search index, or notification provider), which is exactly the failure mode A.8/A.12/A.13 fixed for Payments/Returns. This is the most actionable finding in this report.
2. Real PostgreSQL capacity, concurrency, lock-contention, and failure-recovery behavior remain completely unvalidated — every conclusion in this report about "production readiness" for load-bearing concerns is necessarily provisional.
3. TLS/RLS/least-privilege-role gaps persist unresolved across five phases (A.7 → A.14).
4. The Finance journal N+1 (§13) will degrade linearly with per-journal ledger-entry count once real data exists.
5. Outbox's unbounded `payload`/`headers` columns (§25) are a plausible, unverified growth/bottleneck risk.

---

## 28. Production Readiness Verdict

Answering the brief's explicit questions (Task 25):

| Question                                                           | Answer                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Can PostgreSQL safely support the expected production data volume? | **Unknown — not measured.**                                                                                                                                                          |
| Can it support expected concurrency?                               | **Unknown — not measured.**                                                                                                                                                          |
| Can it survive burst traffic?                                      | **Unknown — not measured.**                                                                                                                                                          |
| Can it maintain financial correctness under contention?            | **Partially evidenced** — application-layer regression tests (§21) cover the logic; real-PostgreSQL-lock-level contention scenarios (Task 6/7's specific 700+700 etc.) were not run. |
| Can it recover from failures?                                      | **Unknown — not measured** (capture crash-recovery logic is regression-tested per A.9; live-instance restart/network-interruption behavior was not tested here).                     |
| Can it be backed up and restored within an acceptable window?      | **Unknown — not measured.**                                                                                                                                                          |
| Are connection pools correctly controlled?                         | **Yes, by code** (§7) — config wiring confirmed correct; actual saturation behavior unmeasured.                                                                                      |
| Are the largest queries indexed?                                   | **By inspection, yes** for the six audited domains (§5); not measured.                                                                                                               |
| Is table growth bounded?                                           | **Unknown** — no growth-rate data exists to bound anything against (§15).                                                                                                            |
| Is outbox growth bounded?                                          | **Partially** — Phase A.13's fail-safe prune-job gate is in place (code-confirmed unchanged), but its actual effectiveness under real write volume is unmeasured.                    |
| Is WAL/backup/replication actually operational?                    | **No — `archive_mode` is off**, matching every prior phase's finding; never verified operational in this repo.                                                                       |

### Final Verdict: **NOT PRODUCTION READY**

This is a change from A.12/A.13's "CONDITIONALLY PRODUCTION READY." The distinction is deliberate: those phases' code-only findings were closed or had a clear closure path, and no new defects of the same severity class remained open at the time each was written. This phase found **9 new, unremediated instances of the exact anti-pattern that repeated hardening work in this sprint has been closing one bounded-context at a time** — Payments and Returns are provably safe; Licensing, Shipping, Fulfillment, Orders, Search, and Notifications are provably not, by the same standard. Combined with the fact that **zero real PostgreSQL load, concurrency, or failure-recovery evidence exists for any context**, "conditionally ready" would overstate the actual evidence. A "NOT PRODUCTION READY" verdict reflects both the unmeasured load-bearing risk (environment-blocked, not the codebase's fault) and the newly surfaced, in-scope-to-fix defect (the codebase's fault, now known).

**Path to re-attempt:** (1) resolve the Docker Desktop environment blocker — via a clean uninstall/reinstall of Docker Desktop, since reboot and settings changes did not clear the corrupted socket reparse point — then re-run Tasks 3–22 for real; (2) run a dedicated remediation sprint for the 9 transaction-boundary violations found in §11, each with its own regression test, mirroring A.13.1's precedent for the Returns instance of this same defect class.

---

## Quality Gates (all green, offline-capable)

| Gate                                                     | Result                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm typecheck` (`turbo run typecheck --concurrency=2`) | ✅ 78/78 tasks                                                                           |
| `pnpm lint` (`turbo run lint --concurrency=2`)           | ✅ 78/78 tasks (81 packages in scope)                                                    |
| `pnpm test` (`turbo run test --concurrency=2`)           | ✅ 78/78 tasks, all suites passing incl. payments concurrency/idempotency/crash-recovery |
| `pnpm arch` (dependency-cruiser)                         | ✅ 0 violations, 1565 modules, 6788 dependencies                                         |
| `prisma validate`                                        | ✅ clean (`packages/db/prisma/schema`)                                                   |
| `prisma migrate status`                                  | ❌ `P1001` — expected, no live DB reachable                                              |
| `pnpm governance` / `pnpm dup`                           | N/A — scripts do not exist in this checkout (unchanged since A.12)                       |

No changes were committed, per this sprint's standing isolation discipline.
