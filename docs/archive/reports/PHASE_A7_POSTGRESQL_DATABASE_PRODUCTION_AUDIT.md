# Phase A.7 — PostgreSQL Database Production & Security Audit

Scope: the PostgreSQL/Prisma persistence layer underneath the financial invariants closed by
Phases A.1–A.6 (guest/authenticated cart price tampering, checkout total tampering, payment-intent
amount tampering, refund amount verification, refund execution wiring, refund concurrency race,
refund idempotency, direct refund HTTP idempotency). This audit does not reopen those findings; it
asks whether PostgreSQL itself can safely carry them into production.

**Environment constraint, stated up front:** this sandbox has no reachable PostgreSQL (`prisma
migrate status` → `P1001: Can't reach database server at localhost:5432`; consistent with prior
phases' notes that Docker Desktop/WSL2 are broken here). Every finding below is evidence from
static analysis (schema, migrations, repository/use-case code, tests, CI config, infra manifests,
docs) plus the read-only Prisma commands that don't require a live connection (`prisma validate`,
`prisma format --check`). Nothing here claims live-database verification; where the audit brief
asked for it, this report says so explicitly.

---

## 1. Executive Summary

The audit found and fixed **one CRITICAL defect**: `packages/db/prisma/schema/payments.prisma`
declares `Refund.status` as a required field (`status String @default("completed")`), but **no
migration in the repository's history ever created that column** — the init migration
(`20260704000000_init`) creates `payments.refunds` with only
`(id, tenant_id, intent_id, amount_minor, occurred_at)`, and the only later migration touching that
table (`20260811000000_phase_a5_refund_idempotency`) adds `idempotency_key`, not `status`. Deployed
via the documented production path (`prisma migrate deploy`, exactly what
`.github/workflows/db-integration.yml` runs), the generated Prisma Client would attempt to write
`status` on every refund — `PrismaPaymentIntentRepository.save`'s `refund.upsert(...,
update: { status: refund.status })` — and Postgres would reject it with `column "status" does not
exist`. This would have silently broken the Phase A.4 refund-concurrency settlement mechanism (the
`pending → completed|failed` transition A.3–A.6 depend on) in any environment that actually runs
migrations, and no test in the repository would have caught it: `services/payments` has no
`DATABASE_URL_TEST`-gated repository test (unlike `services/orders`).

**Fix applied** (this session): one additive forward migration
(`20260811010000_payments_refund_status_column`, `ADD COLUMN "status" TEXT NOT NULL DEFAULT
'completed'`, matching the schema exactly) plus a new regression test package for `packages/db`
(previously had no test runner wired — `"test": "echo \"no tests yet\""`). The regression test
statically replays every migration's DDL against the `payments` schema's required Prisma columns;
it fails without the fix (proven by temporarily removing the migration and re-running) and passes
with it. Full repo gates re-run green after the fix.

Beyond that one proven, fixed defect, the audit surfaced several **structural risks that are
flagged but intentionally not fixed**, per the audit's own instructions (Task 8: "flag... do NOT
automatically attempt distributed transactions"; Task 13: don't add indexes without demonstrated
need; "do NOT add database constraints" without a proven integrity gap) and per the constraint that
changes require a _demonstrated_ defect, not a structural possibility. These are documented in
§24 and the readiness matrix in §22.

**Verdict: CONDITIONALLY PRODUCTION READY** (see §26). The one proven CRITICAL defect is fixed. No
other CRITICAL/HIGH finding is a _proven_ exploit — the remaining HIGH items are either
environmental (no live Postgres available to validate the concurrency mechanisms against real
Postgres, though a CI job that would do so already exists), or structural risks flagged for
follow-up (Capture's long-transaction pattern, RLS deferral) that mirror gaps the team has already
tracked and, in the RLS case, explicitly planned.

---

## 2. PostgreSQL Hosting Model

- **Local/dev**: `infrastructure/docker/docker-compose.yml` — `postgres:16-alpine`,
  `wal_level=logical`, `max_wal_senders=8`, `max_replication_slots=8`, `shared_buffers=256MB`,
  `max_connections=200`, port 5432 exposed, `POSTGRES_USER=lumo`/`POSTGRES_PASSWORD=lumo` (file
  header: "LOCAL DEVELOPMENT ONLY"). `archive_mode` explicitly off ("production turns it on with a
  WAL archive target").
- **CI**: `.github/workflows/db-integration.yml` runs a real `postgres:16` service container,
  applies `prisma migrate deploy`, runs a `prisma migrate diff --exit-code` drift gate, then runs
  every `DATABASE_URL_TEST`-gated integration suite. This is a real, working live-DB gate — it just
  can't be exercised in this offline sandbox.
- **Kubernetes**: `infrastructure/k8s/` (namespace, API/worker/scheduler/collector/storefront
  deployments, autoscaling, network policy, ingress, Debezium) references `DATABASE_URL` via a
  `secret.example.yaml` **template** (`postgresql://USER:PASSWORD@postgres.data.svc.cluster.local:5432/lumo`)
  but contains **no Postgres StatefulSet/Deployment/operator manifest** — Postgres is treated as an
  external dependency, not something this repo provisions.
- **Terraform/Helm**: no `.tf` or `helm/` files exist anywhere in the repo. `docs/architecture/15-scalability-and-deployment.md`
  states production uses "Kubernetes (EKS), provisioned by Terraform" and `docs/architecture/26-infrastructure-topology.md`
  mentions "Any Postgres (RDS/Cloud SQL/self-managed)" / "CloudNativePG or RDS" — all prose, no
  matching infrastructure-as-code in the repo.
- **Railway**: `infrastructure/railway/` holds `runtime-api.railway.json`/`storefront.railway.json`,
  an alternate PaaS deploy target, not examined for DB specifics beyond noting it exists.

**Conclusion (per the audit's own required phrasing): production PostgreSQL hosting (actual cloud
provider, instance class, HA topology) is UNKNOWN — NOT REPRESENTED IN REPOSITORY EVIDENCE.** Only
local docker-compose (dev) and CI's ephemeral service container are concretely configured;
production is described in prose only.

---

## 3. Database Architecture

One PostgreSQL **schema per bounded context** (39 schemas — `main.prisma`'s `datasource.schemas`
array — plus `platform` for cross-cutting messaging/audit), confirmed live by `prisma migrate
status`'s own schema-enumeration output. This is a genuine DB-level enforcement of bounded-context
separation, beyond what Prisma's datamodel alone would give.

Cross-domain references are **deliberately not Prisma `@relation`s** — every reference across a
bounded-context boundary is a bare `String` column with an explicit "never an FK" comment,
documented as an architectural decision (D-002, `main.prisma:13-15`). Only relations _inside_ one
aggregate (e.g. `Order → OrderItem`, `PaymentIntent → Refund`) are enforced FKs. This is a
consistent, intentional pattern, not an oversight — see §7 for the specific chain.

| Table                                                    | Domain    | Owner file       | Critical Data                                                       | Foreign Keys                                                            | Financial?         |
| -------------------------------------------------------- | --------- | ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| `Price` / `PriceList`                                    | Pricing   | pricing.prisma   | `amountMinor` Int, `currency`                                       | none (productRef bare)                                                  | Y                  |
| `TaxClass` / `PricingRule`                               | Pricing   | pricing.prisma   | rule `value` Float                                                  | none                                                                    | Y                  |
| `Cart` / `CartItem`                                      | Cart      | cart.prisma      | `unitPriceAmountMinor` Int                                          | `CartItem→Cart` Cascade (intra-aggregate)                               | Y                  |
| `CheckoutSession`                                        | Checkout  | checkout.prisma  | `currency`, `state`, `taxMinor`/`discountMinor` Int?, `totals` Json | none                                                                    | Y                  |
| `Order` / `OrderItem` / `OrderEvent`                     | Orders    | orders.prisma    | `currency`, `totals` Json?, item `unitPriceAmountMinor`             | `OrderItem/OrderEvent→Order` Restrict (intra-aggregate)                 | Y                  |
| `PaymentIntent` / `PaymentAttempt` / `Charge` / `Refund` | Payments  | payments.prisma  | `amountMinor` Int, `currency`, `status`, `idempotencyKey`           | `PaymentAttempt/Charge/Refund→PaymentIntent` Restrict (intra-aggregate) | Y                  |
| `ReturnRequest` / `ReturnAttempt`                        | Returns   | returns.prisma   | `items`/`refundDecision` Json                                       | `ReturnAttempt→ReturnRequest` Restrict                                  | Y (drives refunds) |
| `Journal` / `LedgerEntry`                                | Finance   | finance.prisma   | `amountMinor` Int, `currency`                                       | `LedgerEntry→Journal` Restrict                                          | Y                  |
| `Product` / `ProductVariant`                             | Catalog   | catalog.prisma   | variant `priceAmountMinor` Int                                      | `ProductVariant→Product` **Cascade**                                    | Y (variant only)   |
| `InventoryItem` / `Reservation` / `Warehouse`            | Inventory | inventory.prisma | quantities, not money                                               | `Reservation→InventoryItem` Cascade                                     | N                  |

No table was found to hold data outside its owning bounded context's schema — no cross-context
ownership violation identified.

---

## 4. Financial Data Model

Every monetary amount across all ten domain schemas inspected (`payments`, `orders`, `checkout`,
`cart`, `pricing`, `finance`, `catalog`) uses **`Int` minor units** — no `Decimal` or `Float` money
field exists anywhere. The only `Float` fields found are `PricingRule.value` (a rule coefficient,
not an amount) and `ExchangeRate.rate` (a ratio). This satisfies the audit's baseline requirement
(reject floating-point monetary storage) with no exceptions found.

`currency` is a free-text `String` everywhere (not a bounded DB enum) — validity is domain-enforced,
not DB-enforced; a currency typo is not rejected at the schema level. Every `status`/`state` field
on a financial aggregate (`PaymentIntent.status`, `Refund.status`, `CheckoutSession.state`) is
likewise free-text, with a documented, **deliberately deferred** plan to add
`CHECK (status IN (...))` constraints once a live Postgres host is available for testing
(`packages/db/prisma/MIGRATIONS.md §3`, and the `Refund` model's own doc comment). This audit did
not add those CHECK constraints — see §24, F-A7-12 — because the team has already scoped and
documented the deferral, and adding untested CHECK constraints without a live database to validate
against would risk a worse outcome than the current state.

`version Int @default(0)` (optimistic-locking column, ADR/`main.prisma:9-10` convention) is present
on every aggregate root that needs it — PaymentIntent, Order, CheckoutSession, Cart, Price,
PriceList, TaxClass, PricingRule, ReturnRequest, InventoryItem, and others — and correctly absent
from append-only child rows (Refund, Charge, PaymentAttempt, OrderItem, OrderEvent, LedgerEntry),
which is the expected pattern for rows that are never independently updated.

---

## 5. Financial Invariants

| Invariant                                     | Domain          |                                                                                      App enforced |                                                                                                                                                                                                                                      DB enforced | Risk                                                                                                                                                                                                |
| --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------: | -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refund amount ≤ remaining refundable          | Payments        |                       Yes (`PaymentIntent.remaining()`, checked inside the version-locked `save`) |                                                                                                                                                                            No — no `capturedAmount`/`remainingRefundable` column or CHECK exists | Low — app-layer check is inside the same optimistic-locked write path proven correct under concurrency (§9); a DB-level backstop would be defense-in-depth, not currently justified as a proven gap |
| No duplicate refund idempotency key           | Payments        |             Yes (in-memory scan of already-loaded `refunds` inside `PaymentIntent.requestRefund`) | Yes, but not the enforcement path — `@@unique([intentId, idempotencyKey])` exists and is proven-safe-to-apply, but the repository write (`refund.upsert` keyed by PK, not by the unique pair) never triggers it, and no code catches its `P2002` | Medium — see §24 F-A7-04                                                                                                                                                                            |
| Refund → valid PaymentIntent                  | Payments        |                                                                                               Yes |                                                                                                                                                                                                      **Yes** — enforced FK, `onDelete: Restrict` | None                                                                                                                                                                                                |
| Payment/Refund status transitions constrained | Payments        |                                                                        Yes (domain state machine) |                                                                                                                                                                                                   No — free-text column, CHECK deferred (see §4) | Low-Medium, documented team deferral                                                                                                                                                                |
| Order total/currency consistent with Checkout | Orders/Checkout | Presumed app-layer (not independently re-verified this session; out of this audit's proven scope) |                                                                                                                                                                                             No — `Order.checkoutRef` is a bare unenforced string | Not proven either way; flagged for awareness, not a new finding this phase                                                                                                                          |

---

## 6. Foreign Key Audit

| Relation                 | Present?                                   | Evidence                                                                                |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `Refund → PaymentIntent` | **Yes**, enforced FK, `onDelete: Restrict` | `payments.prisma:102`                                                                   |
| `Charge → PaymentIntent` | **Yes**, enforced FK, `onDelete: Restrict` | `payments.prisma:74`                                                                    |
| `PaymentIntent ↔ Order`  | **No** — bare `String` both directions     | `PaymentIntent.orderRef` (`payments.prisma:8`), `Order.paymentRef` (`orders.prisma:12`) |
| `Order → Checkout`       | **No** — bare `String`                     | `Order.checkoutRef` (`orders.prisma:11`)                                                |
| `CartItem → Product`     | **No** — bare `String`                     | `cart.prisma:30`                                                                        |
| `Price → Product`        | **No** — bare `String`                     | `pricing.prisma:24`                                                                     |

All six are **intentional**, per the D-002 architecture decision (§3) — cross-bounded-context
references are never FKs in this codebase, by design, to keep contexts independently deployable and
avoid distributed-schema coupling. This audit did not add cross-context FKs (the brief explicitly
says not to), and did not find evidence this pattern has caused an actual integrity incident —
referential integrity across the Pricing→Cart→Checkout→Orders→Payments→Refunds chain rests entirely
on application code, which is a known, accepted architectural tradeoff rather than a new defect.

---

## 7. Idempotency Audit

**DB-level constraint**: `@@unique([intentId, idempotencyKey])` on `Refund`
(`payments.prisma:104`), backed by a real migration (`20260811000000_phase_a5_refund_idempotency`:
`CREATE UNIQUE INDEX refunds_intent_id_idempotency_key_key ON "payments"."refunds"("intent_id",
"idempotency_key")`). Same pattern on `PaymentIntent.idempotencyKey`
(`@@unique([tenantId, idempotencyKey])`, from `20260726000000_sprint_a0_preconditions`).

**Actual enforcement path**: not this constraint. `PaymentIntent.requestRefund`
(`services/payments/src/domain/payment-intent.ts:277-298`) scans the intent's already-loaded
`refunds` array for a matching `idempotencyKey` and returns the existing reservation if found
(`isNew: false`) instead of minting a new row; `save()` only persists when `isNew === true`.
Concurrent races are resolved by `PrismaPaymentIntentRepository.save`'s `version`-column CAS
(`updateMany({ where: { id, tenantId, version } })`, throws `ConcurrencyError` on `count === 0`),
with the loser retried via `withConcurrencyRetry` (max 5 attempts) — on retry it re-reads the
now-current row and sees the winner's committed refund, converging on one logical refund. The
repository's actual `refund.upsert()` call is keyed by the refund's own PK, not by
`(intentId, idempotencyKey)`, and no code anywhere catches Prisma's `P2002` unique-violation error
for this constraint.

**Conclusion**: the double-PSP-call class of bug (Phase A.3's original finding, closed by Phase A.4)
is closed **for every current production caller** — Returns always supplies
`` `${returnId}:refund` ``, and the direct HTTP route (Phase A.6) fails closed with 422 if
`Idempotency-Key` is missing. The closure mechanism is the version-locked retry-and-resume loop, not
the DB unique index — the DB constraint is a real, correctly-applied defensive backstop, but it is
currently unexercised: if the application-level dedup were ever bypassed, the DB constraint would
still block a literal duplicate row, but that failure would surface as an unhandled Prisma error, not
a graceful domain rejection. See §24 F-A7-04.

**Without an idempotency key** (`RefundPaymentLifecycleInput.idempotencyKey` is optional): a caller
that omits it still gets the pre-A.5 behavior — a fresh reservation and a fresh PSP call on every
retry. This is proven by an existing, still-passing test
(`services/payments/src/refund-idempotency.test.ts:169-195`, "two retries... get TWO different PSP
idempotency keys and TWO PSP calls"). Both current production callers always supply a key, so this
is not a live gap today, but it is a landmine for any future caller that doesn't.

---

## 8. Concurrency Audit

**Optimistic locking** is applied consistently across every aggregate that needs it — identical
pattern in `PrismaPaymentIntentRepository`, `PrismaOrderRepository`, `PrismaCartRepository`,
`PrismaInventoryItemRepository`: `updateMany({ where: { id, tenantId, version } })` +
`count === 0` → thrown `ConcurrencyError`. This uses `updateMany` specifically so a lost race
surfaces as a handled domain error rather than Prisma's own `P2025` — verified consistent, never
silently ignored, across all four repositories read.

`Refund` itself has no independent `version` column — its status transitions ride on the owning
`PaymentIntent`'s version bump. In practice this is safe because `settle()` is itself wrapped in
`withConcurrencyRetry`, but it means a refund-row-level race (two concurrent `settle()` calls for
the _same_ reservation) is not independently version-guarded — only observed as a theoretical gap,
not a proven one.

**Test evidence — the honest gap**: every concurrency/idempotency test found in the repository uses
an in-memory fake (`PostgresLikePaymentIntentRepository`, a `Map`-backed reimplementation of
Postgres's `UPDATE ... WHERE id = ? AND version = ?` semantics), not a real PostgreSQL connection —
`services/payments/src/refund-concurrency.test.ts`, `refund-idempotency.test.ts`,
`apps/admin/src/http/direct-refund-idempotency.e2e.test.ts`. These are faithful, well-constructed
fakes (they explicitly document reproducing the CAS contract), and per this audit's own instruction
("use ... a faithful transactional fake only when PostgreSQL is unavailable"), that's the strongest
alternative available in this sandbox. But **no test in the repository proves the
`refunds_intent_id_idempotency_key_key` unique constraint or any `version`-column CAS update against
real, concurrent PostgreSQL connections.** The one DB-gated integration test found
(`services/orders/src/infrastructure/prisma-order-repository.integration.test.ts`, correctly gated
on `DATABASE_URL_TEST`, never faked) is a round-trip persistence test, not a concurrency test. This
is a genuine coverage gap, not a proven defect — flagged as F-A7-03, not fixed (no live Postgres
available to add a real one in this session; CI already has the infrastructure to run one if such a
test were added there).

**Isolation level**: unspecified everywhere (no `isolationLevel` option on any `$transaction` call,
no `SET TRANSACTION ISOLATION LEVEL`, no Postgres config override) — defaults to READ COMMITTED.
This is not a problem for the version-column CAS pattern specifically: it's correct by construction
under READ COMMITTED (the `WHERE version = ?` re-check happens at write time, not read time), so it
doesn't depend on snapshot or serializable isolation to be sound.

---

## 9. Transaction Boundary Audit

`packages/db/src/transaction.ts` wraps `prisma.$transaction(fn, { maxWait, timeout })` — no caller
observed passes explicit `maxWait`/`timeout` overrides, so every transaction uses Prisma's defaults
(2000ms wait, 5000ms timeout).

**Refund (already fixed, Phase A.4)**: `RefundPaymentLifecycle.execute()` deliberately splits into
three steps — `reserve()` (own transaction), the real PSP call (**outside** any open transaction),
`settle()` (own transaction) — explicitly documented as closing the "pre-existing long-transaction
anti-pattern." This is the correct shape.

**Capture (not fixed, same anti-pattern still present)**: `CapturePaymentLifecycle.execute()`
(`services/payments/src/application/payment-lifecycle.use-cases.ts:223-268`) runs the real PSP call
(`paymentProvider.capture(...)`), then `intent.save()`, then a best-effort notification, then a
best-effort finance-ledger call — **all inside one open `unitOfWork.run()` transaction**. Unlike
Refund, no doc comment here indicates this was deliberately fixed or accepted; the Refund doc
comment explicitly contrasts itself against this exact pattern. If the PSP call succeeds but a
later statement in the same transaction throws (or the transaction simply times out on a slow PSP
response), Postgres rolls back the whole transaction — including the capture status write — while
the PSP has already captured funds for real. This is the same _class_ of bug A3-02 was for Refund,
now on the Capture path. **Flagged, not fixed** — per this audit's Task 8 instruction to flag this
exact pattern rather than automatically attempt a fix, and because replicating the Refund fix here
is a real behavioral change to the Capture flow that needs live-Postgres/PSP-fake integration
testing this sandbox cannot provide. See F-A7-02 in §24.

**Cross-service nesting (Returns → Payments)**: `DecideResolution.execute()`
(`services/returns/src/application/return-lifecycle.use-cases.ts:379-438`) holds its own open
transaction across a call into `PrismaPaymentsPortAdapter.requestRefund`, which itself runs
Payments' full three-phase reserve/PSP-call/settle sequence (its own separate transactions) before
Returns' outer transaction can commit. On failure inside that nested call, Returns' transaction rolls
back — but Payments' own inner transactions may have already committed independently, and the PSP
may have already been called for real. No compensating action for this specific cross-context
inconsistency was found. Flagged, not fixed, for the same reasons as Capture.

---

## 10. Isolation Level

Covered in §8 — unspecified everywhere, defaults to READ COMMITTED, consistent with (does not
undermine) the version-column CAS pattern the codebase relies on.

---

## 11. Migration Audit

All 33 migrations (`20260704000000_init` → `20260811000000_phase_a5_refund_idempotency`) were read
in full, plus the new `20260811010000_payments_refund_status_column` added this session (34 total).
No `DROP TABLE`, `ALTER COLUMN ... TYPE`, or enum-value change was found anywhere. No migration ever
uses `CREATE INDEX CONCURRENTLY` — structural, since `migrate deploy` runs each migration inside a
transaction and `CONCURRENTLY` cannot run inside one; this only matters where an index targets a
table that already has rows in production.

| Migration                                                          | Classification             | Reason                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260726000000_sprint_a0_preconditions`                           | **production-risky**       | Non-concurrent `CREATE UNIQUE INDEX` on existing `inventory.reservations` (author's own comment mandates a manual pre-migration duplicate audit "or it will fail") and on existing `payments.payment_intents` — both take a write lock on live financial tables during index build. Column adds themselves are safe (nullable, all-NULL backfill). |
| `20260804000000_sprint5x_schema_reconciliation`                    | **destructive**            | `DROP COLUMN` ×3 and `SET NOT NULL` with no in-migration backfill on `media.folders`/`pages.templates`. Author's comment claims these tables were never deployed to any real database — plausible but not independently verifiable without a live DB. Non-financial tables; does not affect the Pricing→Refunds chain.                             |
| `20260811000000_phase_a5_refund_idempotency`                       | **production-risky**       | Non-concurrent `CREATE UNIQUE INDEX` on existing `payments.refunds` — same lock-risk pattern as above; the column add itself is safe (nullable).                                                                                                                                                                                                   |
| `20260811010000_payments_refund_status_column` (new, this session) | safe                       | Single `ADD COLUMN ... NOT NULL DEFAULT 'completed'` — Postgres 11+ applies a non-volatile default as a metadata-only operation, no table rewrite, no lock beyond a brief catalog update.                                                                                                                                                          |
| All other 30 migrations                                            | safe / potentially-locking | The remainder are either pure `CREATE SCHEMA`/`CREATE TABLE` into previously-empty schemas (safe — the large majority), or nullable `ADD COLUMN`/non-unique-index additions on existing tables (potentially-locking but low-risk, standard expand-phase DDL). None found destructive or irreversible beyond the one flagged above.                 |

None of the production-risky items were fixed — non-`CONCURRENTLY` unique index creation on tables
that (per every migration's own "generated offline, never run against a live Postgres" disclaimer,
and the CI job's from-scratch-per-run nature) have near-zero row counts at the point these migrations
would actually first apply in any real environment. Retrofitting `CONCURRENTLY` into already-written,
potentially-already-applied migration files would violate the "never edit an applied migration"
rule in the team's own `MIGRATIONS.md §1` — the correct fix, if this becomes a real production
concern, is a forward-only follow-up migration, which is out of this audit's demonstrated-defect
scope today.

---

## 12. Migration Drift

`prisma validate` (with a dummy `DATABASE_URL`, no live connection required): **schemas are valid**.
`prisma migrate diff --from-migrations ... --to-schema-datamodel ...` requires a shadow database —
confirmed by direct attempt (`Error: You must pass the --shadow-database-url if you want to diff a
migrations directory.`) — so the tool-level drift check cannot run in this sandbox; this is exactly
the gap `.github/workflows/db-integration.yml`'s "Migration drift" step exists to close in CI.

**Manual drift check across the five financial domains** (payments, orders, checkout, cart,
pricing): only one drift found — **`payments.refunds.status`**, covered in §1 and fixed this
session. Orders, Checkout, Cart, and Pricing were traced field-by-field against their migration
history with no discrepancy found (every `payments.prisma` field for `PaymentIntent` also checked
clean).

A new static regression test (§24, "Fixes Applied") now catches this specific class of drift for
every model in the `payments` schema without needing a live shadow database — it's a genuine,
if narrower, substitute for the tool-level check while this sandbox has no Postgres.

---

## 13. Index Audit

Every financial lookup path has _some_ covering index except the ones flagged below. Representative
coverage: `PaymentIntent` — `@@unique([tenantId, idempotencyKey])`, `@@index([tenantId, orderRef])`,
`@@index([tenantId, status])`; `Refund` — `@@unique([intentId, idempotencyKey])`,
`@@index([intentId])`; `Order` — `@@unique([tenantId, orderNumber])`,
`@@index([tenantId, customerRef, createdAt])`; `Cart`/`CheckoutSession`/`Price` — all have
tenant-led composite indexes on their primary lookup dimensions.

**Flagged, not fixed** (no missing index was added — no query-usage evidence in this audit proves
these are hot paths, and the brief explicitly says not to add an index on naming/intuition alone):
`Order.checkoutRef`, `Order.paymentRef`, `CheckoutSession.orderRef` (cross-context join keys with no
index), `PaymentIntent.pspReference`, `Refund.status`, `Price.effectiveFrom`/`effectiveTo`
(date-ranged price resolution). If a future audit demonstrates these are actually queried as
predicates in a hot path (application code was not exhaustively traced for this in this pass), add
a targeted index then.

---

## 14. Query Performance (N+1 Audit)

Application-layer use cases in `checkout`, `cart`, `orders`, `payments`, `returns`, `pricing` were
searched for loops containing an awaited repository call. **No structurally clear N+1 pattern was
found** — every per-item loop over order/cart/return lines does pure in-memory domain-object
construction/validation; every actual repository/port call is either a single call outside the loop
or an explicitly batched call taking the full item array (e.g. `AcceptItems`'s
`inventoryPort.restock(restockItems)`). No change made — nothing to fix.

---

## 15. Connection Pooling

`packages/db/src/client.ts` passes only `datasourceUrl` and `log` to `new PrismaClient(...)` — no
SSL options, no explicit pool parameters. The file's own doc comment claims pooling is "sized via
the URL's `connection_limit`" and that production fronts Postgres with PgBouncer — **neither is
actually wired**: no code appends `connection_limit` to the DATABASE_URL, and no PgBouncer service
exists in `docker-compose.yml` or `infrastructure/k8s/`. `DATABASE_POOL_MAX` is defined and
environment-profiled (`packages/config`: dev 5, test 2, staging 10, production 20) but **never
consumed** by the client — Prisma's default internal pool formula (`num_physical_cpus * 2 + 1`)
applies instead. This is a doc/code discrepancy (F-A7-09, §24), not fixed this session — wiring it
correctly needs a decision on whether to use `connection_limit` in the URL or a real PgBouncer
deployment, which is a production-topology decision this audit isn't positioned to make
unilaterally.

Replica counts _are_ defined for Kubernetes (`runtime-api`: 2–10 via HPA; `worker`: 2–6), but since
the documented pool size isn't actually applied, `replicas × pool size` can't be computed from
config that's honored — flagged as an input gap rather than computed with a misleading number.

---

## 16. Database Security

- `.env` mirrors `.env.example`'s dev placeholder (`lumo:lumo@localhost:5432/lumo`) and is **not
  git-tracked**. No production credential found committed anywhere.
- **No SSL/TLS config for the Postgres connection** anywhere — code, env schema, compose, or k8s.
  `docs/architecture/14-security.md` asserts "TLS 1.2+ everywhere... at rest (DB...)" as a
  requirement, but nothing in the repo configures it for the DB connection specifically.
- **Role separation exists but is unused**: `infrastructure/docker/postgres/init/01-roles-and-cdc.sql`
  defines `lumo_app` (intended least-privilege application role — "DML on business schemas, no
  DDL") alongside `lumo` (superuser, intended migration-only role). Its own comment says grants for
  `lumo_app` are "wired per-schema after the first migration" — **they never were**: `lumo_app` has
  zero GRANT statements anywhere in the repo, and every environment found (local `.env`,
  `docker-compose.runtime.yml`, CI's `db-integration.yml`) connects the application as `lumo`, the
  superuser. Not fixed this session (F-A7-08, §24) — granting `lumo_app` real privileges and
  flipping the connection string is a security-relevant infrastructure change this audit can't
  validate without a live database, and shipping untested GRANT statements risks breaking every
  environment worse than the current (working, if over-privileged) state.

---

## 17. SQL Injection

Every `$queryRaw`/`$executeRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` call in the repo was located
and read. **No exploitable injection found.** The only production `Unsafe`-variant use is a
hardcoded-literal health-check probe (`apps/runtime/src/composition.ts`,
`prisma.$queryRawUnsafe("SELECT 1")`) — no user input reaches it; flagged as an unnecessary API
choice (F-A7-15, cosmetic) but not a vulnerability. A test file
(`services/security/.../prisma-repositories.integration.test.ts`) uses `$executeRawUnsafe` with
correctly parameterized `$1`/`$2` placeholders — safe. No fix needed.

---

## 18. Delete/Cascade Safety

Every `onDelete: Cascade` found in the schema is intra-aggregate and non-financial-history:
`Product → ProductVariant` (does touch a price field, `priceAmountMinor`, but is a variant of the
same product, not a separate financial-history record), `Collection → CollectionItem`,
`Cart → CartItem`, `Customer → Address`, `Customer → ConsentRecord`, `InventoryItem → Reservation`.
**Every genuinely financial-history child table** — `OrderItem`, `OrderEvent`, `PaymentAttempt`,
`Charge`, `Refund`, `LedgerEntry` — uses `onDelete: Restrict`, correctly preventing a parent delete
from silently taking financial records with it. No dangerous cascade found; no fix needed. Note also
that `Order.customerRef`/`PaymentIntent`'s reach back to a customer are bare unenforced strings
(§6), so deleting a `Customer` row has **no FK cascade path** into financial records at all — by
design.

---

## 19. Auditability

`PaymentIntent`, `Refund`, `Order` all carry `createdAt`/`updatedAt`/`version`; `Order` derives its
status entirely from the append-only `OrderEvent` history (never a column); `Refund`'s settlement
history rides on the append-only `PaymentAttempt` log. Neither `Refund` nor `PaymentAttempt` has a
dedicated business "reason" or "actor" column. **"Why was this refund made?" is reconstructable
only indirectly**: for Returns-originated refunds, via the `idempotencyKey` convention
(`` `${returnId}:refund` ``) joined back to `ReturnRequest.items[].reason`/`refundDecision`; for any
other caller (including the direct admin HTTP route), there is no reason field at all — only
whatever idempotency-key string the caller chose to send. Separately, `platform.audit_events`
(`PrismaAuditTrail`) records actor/permission/decision/timestamp for every guarded admin action,
which answers "who did it and were they authorized," not "why." This is a real gap for financial
forensics but not a correctness/integrity defect — flagged (F-A7-16), not fixed, since adding a
`reason` column and threading it through every refund call site is a scope expansion beyond this
audit's demonstrated-defect mandate.

---

## 20. Backup / Restore

- `packages/db/src/backup.ts` is config-only (`resolveBackupPlan` maps `BackupConfig` →
  `BackupPlan`, hardcoded `strategy: "pitr+base"`) — explicitly documented as not executing backups
  itself.
- **Real execution scripts exist** outside the app: `scripts/ops/backup-postgres.sh` (`pg_dump
--format=custom`, SHA-256 checksum, optional S3 upload, retention pruning) and
  `scripts/ops/restore-postgres.sh` (`pg_restore` with `CONFIRM=yes` guard and checksum
  verification; PITR mode prints a manual runbook rather than executing it).
- **RPO/RTO documented**: `docs/operations/BACKUP_AND_RECOVERY.md` — Postgres RPO ≤ 5 min / RTO ≤ 30
  min via "WAL archiving + PITR, nightly base backup." `docs/architecture/15-scalability-and-deployment.md`
  separately states a tighter multi-region figure (RPO ≤ 1 min / RTO ≤ 5 min for
  orders/payments) for a _different_ scenario (regional failover, not backup restore) — the two
  documents are consistent in scope, not contradictory, once read as covering different failure
  modes.
- **WAL archiving/PITR is not enabled anywhere represented in the repo** — `docker-compose.yml`'s
  own comment confirms `archive_mode` stays off locally and is asserted only as a manual production
  toggle. The documented 5-minute RPO **depends on** WAL archiving being turned on in whatever
  actually runs production Postgres — which, per §2, is not represented in this repo at all. This
  is a real dependency gap between the documented RPO and what's provably configured, but it is an
  operational/infrastructure gap outside this repo's code, not a defect this audit can fix.
- No evidence of restore-drill automation (a scheduled CI job exercising `restore-postgres.sh`) was
  found — quarterly drills are a stated process requirement in the ops docs, not automated tooling.

---

## 21. Disaster Recovery

Covered by §20 — the mechanism (base `pg_dump` + optional S3 upload) exists and is real, but full
PITR (the thing the documented 5-minute RPO actually requires) is asserted only as a production-only
manual toggle with no in-repo evidence it's ever been turned on anywhere. **UNKNOWN — NOT
REPRESENTED IN REPOSITORY EVIDENCE** whether any real environment has ever had WAL archiving active.

---

## 22. Encryption

- **At rest**: no KMS/EBS/volume-encryption config anywhere (compose, k8s, or elsewhere) — the
  Postgres data volume is a plain unencrypted-by-config named Docker volume locally, and no
  Terraform/infra-as-code exists to configure it for a real deployment. UNKNOWN for production.
- **In transit**: no TLS/`sslmode` config for the DB connection anywhere (§16) — UNKNOWN/not
  configured.
- **No raw PSP secrets or card data in Postgres**: confirmed — `payments.prisma`'s file header
  states card data never touches these tables; `Charge.pspToken`/`PaymentIntent.pspReference` are
  tokenized references only. `security.prisma`'s credential/MFA models store fingerprints/KMS
  references, never raw secret material.
- **`EnvelopeCipher`** (`packages/secrets/src/envelope.ts`) exists as a real crypto-primitive
  interface/port (`KeyAliasRegistry` + envelope wrap/unwrap), but it delegates all actual
  cryptography to an injected `KeyWrapCipher` — **no concrete KMS/Vault/HSM-backed implementation of
  that interface exists in the repo**, and no call site of `EnvelopeCipher` was found within
  `packages/db`. The capability is architecturally prepared but not wired to encrypt any actual
  Prisma field. Not a defect to fix (nothing currently claims field-level encryption is active), but
  worth stating plainly: no application-level encryption of Postgres columns is actually happening
  today.

---

## 23. Production Readiness Matrix

| Area                  | Status                      | Evidence | Risk                                                                                          | Action                                                                     |
| --------------------- | --------------------------- | -------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| PostgreSQL hosting    | ⚠ Unknown                   | §2       | Prod topology not in repo                                                                     | None (outside repo scope)                                                  |
| Schema integrity      | ✅ Fixed                    | §1, §12  | Refund.status drift — was CRITICAL                                                            | **Fixed this session**                                                     |
| Financial invariants  | ✅ Strong                   | §5       | Int minor units everywhere, no float money                                                    | None needed                                                                |
| Foreign keys          | ✅ By design                | §6       | Cross-context FKs intentionally absent (D-002)                                                | None (architectural decision, not a gap)                                   |
| Idempotency           | ⚠ Partial                   | §7       | DB constraint is defensive, not primary; app-layer mechanism proven correct                   | Flagged (F-A7-04)                                                          |
| Concurrency           | ⚠ Unverified live           | §8       | Proven only against a faithful in-memory fake, never real Postgres                            | Flagged (F-A7-03)                                                          |
| Transactions          | ⚠ Partial                   | §9       | Refund fixed (A.4); Capture and Returns→Payments nesting still hold external calls open       | Flagged (F-A7-02), not fixed                                               |
| Isolation             | ✅ Adequate                 | §8, §10  | READ COMMITTED, sound for the CAS pattern used                                                | None needed                                                                |
| Migrations            | ⚠ Minor risk                | §11      | Non-concurrent unique-index creation on 3 migrations; 1 destructive (non-financial) migration | Flagged, not retrofitted (would violate "never edit an applied migration") |
| Indexes               | ✅ Adequate                 | §13      | Core lookups covered; a few cross-context join keys unindexed, unproven as hot                | Flagged only                                                               |
| Connection pool       | ⚠ Misconfigured             | §15      | Documented pool size never actually applied to the Prisma client                              | Flagged (F-A7-09)                                                          |
| Security              | ⚠ Gaps                      | §16      | No TLS; least-privilege role defined but unused, superuser used everywhere                    | Flagged (F-A7-08)                                                          |
| SQL injection         | ✅ Clean                    | §17      | No exploitable raw SQL found                                                                  | None needed                                                                |
| Cascade/delete safety | ✅ Clean                    | §18      | All financial-history children use Restrict, not Cascade                                      | None needed                                                                |
| Auditability          | ⚠ Partial                   | §19      | Timestamps/version/event-log strong; no refund "reason" field                                 | Flagged (F-A7-16)                                                          |
| Backups               | ✅ Real, ⚠ PITR unconfirmed | §20      | Real pg_dump scripts + documented RPO/RTO; WAL archiving never provably enabled               | Flagged, outside repo                                                      |
| Disaster recovery     | ⚠ Unknown                   | §21      | Depends on unconfirmed PITR                                                                   | Flagged, outside repo                                                      |
| Encryption            | ⚠ Unknown                   | §22      | No TLS/at-rest config; EnvelopeCipher unwired                                                 | Flagged, outside repo                                                      |

---

## 24. Findings

### F-A7-01 — CRITICAL — `payments.refunds.status` schema/migration drift (FIXED)

- **Affected component / table**: `packages/db/prisma/schema/payments.prisma` (`Refund` model) /
  `payments.refunds`.
- **Failure scenario**: `prisma migrate deploy` against any real Postgres (the documented
  production/CI path) never creates a `status` column on `payments.refunds`. The first refund
  write (`PrismaPaymentIntentRepository.save` → `client.refund.upsert(..., update: { status:
refund.status } })`) fails with Postgres error `column "status" does not exist`, breaking the
  entire Phase A.3/A.4 refund-settlement mechanism in production.
- **Evidence**: `packages/db/prisma/schema/migrations/20260704000000_init/migration.sql:276-284`
  (creates `refunds` with only `id, tenant_id, intent_id, amount_minor, occurred_at`); repo-wide
  grep confirms no other migration ever adds a `status` column to this table; `payments.prisma:93`
  declares `status String @default("completed")` as required.
- **Business impact**: total refund-write failure in any environment that runs migrations as
  documented; silently undermines every closed Phase A.3–A.6 finding, since none of them can
  execute against a real database with this drift present.
- **Root cause**: the `status` field/doc-comment was added to the Prisma schema alongside the
  Phase A.4 refund-concurrency remediation, but the corresponding migration was never written; no
  DB-gated integration test exists for `services/payments` to have caught it (unlike `orders`).
- **Fix**: new additive migration `20260811010000_payments_refund_status_column` —
  `ALTER TABLE "payments"."refunds" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';`,
  matching the schema exactly, safe as a metadata-only default (Postgres 11+).
- **Regression test**: `packages/db/src/schema-migration-consistency.test.ts` (new) — statically
  replays every migration's DDL for the `payments` schema and asserts every required Prisma column
  exists; proven to fail without the fix (column missing) and pass with it.
- **Residual risk**: low. The deferred `CHECK (status IN ('pending','completed','failed'))`
  constraint remains intentionally unimplemented (team's own documented plan, MIGRATIONS.md §3) —
  status validity still relies on domain code, unchanged from before this fix.

### F-A7-02 — HIGH — Capture holds the PSP call inside an open Postgres transaction

- **Affected component**: `CapturePaymentLifecycle.execute()`,
  `services/payments/src/application/payment-lifecycle.use-cases.ts:223-268`.
- **Failure scenario**: the real PSP `capture()` call, the domain `save()`, a best-effort
  notification, and a best-effort finance-ledger call all execute inside one open
  `unitOfWork.run()` transaction. If anything after the PSP call throws, or the transaction exceeds
  Prisma's default 5000ms timeout, Postgres rolls back the capture-status write while the PSP has
  already captured funds for real — DB and PSP state diverge.
- **Evidence**: code read directly (line range above); contrast with `RefundPaymentLifecycle`'s doc
  comment (`payment-lifecycle.use-cases.ts:291-306`), which explicitly describes fixing this exact
  pattern for Refund under Phase A.4/"closing A3-02," with no equivalent fix or acknowledgment for
  Capture.
- **Business impact**: a real, if currently unproven, risk of a payment being captured at the PSP
  while Postgres shows it as not captured — a future retry (believing capture never happened) could
  double-capture at the PSP.
- **Status**: **flagged, not fixed.** Per this audit's Task 8 instruction ("flag... do NOT
  automatically attempt distributed transactions") and because replicating the Refund fix here is a
  behavioral change that needs live-Postgres/PSP-integration testing unavailable in this sandbox.
  Recommend a follow-up phase mirroring the A.4 three-phase pattern (reserve → PSP call outside any
  transaction → settle), with regression tests run against a real or faithfully-fake Postgres.

### F-A7-03 — HIGH — Concurrency guarantees proven only against an in-memory fake, never real Postgres

- **Affected component**: `services/payments/src/refund-concurrency.test.ts`,
  `refund-idempotency.test.ts`, `direct-refund-idempotency.e2e.test.ts`.
- **Evidence**: all three use `PostgresLikePaymentIntentRepository`, a hand-written in-memory
  reimplementation of Postgres's version-CAS semantics — confirmed by direct read. The one
  DB-gated integration test in the repo (`services/orders`) doesn't cover a concurrency scenario.
  `.github/workflows/db-integration.yml` provides real infrastructure (a live `postgres:16` service
  container) to run such a test in CI, but no such test exists yet.
- **Business impact**: none proven — the fake is faithful and the logic it models is sound by
  construction under READ COMMITTED (§8, §10). This is a coverage gap, not a demonstrated defect.
- **Status**: flagged, not fixed — no live Postgres available in this sandbox to author and run a
  genuine concurrent-connection test; recommend adding one to the existing `db-integration.yml` CI
  job as a follow-up, where live Postgres is actually available.

### F-A7-04 — MEDIUM — Refund idempotency's DB unique constraint is unexercised defense-in-depth

- **Affected component**: `payments.prisma:104` (`@@unique([intentId, idempotencyKey])`),
  `services/payments/src/infrastructure/prisma-payment-intent-repository.ts` (`refund.upsert`).
- **Evidence**: the repository's `upsert` is keyed by the refund's own PK, not by
  `(intentId, idempotencyKey)`; no code path catches Prisma's `P2002` for this constraint.
- **Business impact**: low today (the app-layer version-CAS + in-memory scan mechanism is proven
  correct, §7); if that mechanism were ever bypassed by a future code change, the DB constraint
  would still prevent a literal duplicate row, but the failure mode would be an unhandled exception
  rather than a graceful rejection.
- **Status**: flagged, not fixed — the constraint itself is correct and already in place; adding a
  `P2002` catch here without a concrete case that reaches it would be speculative code for an
  unproven path.

### F-A7-05 — MEDIUM — Row-Level Security not implemented; tenant isolation is app-layer only

- **Affected component**: every business table across all 39 schemas.
- **Evidence**: `packages/db/prisma/MIGRATIONS.md §3` explicitly defers RLS ("lands with the first
  repository sprint"); `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` confirms RLS was
  never enabled. Tenant scoping today relies entirely on every repository consistently applying
  `WHERE tenantId = ?` (ADR-0008) — confirmed as a consistent convention in every repository read
  in this audit, but not backed by a DB-level policy as a defense-in-depth layer.
- **Status**: flagged, not fixed — this is a large, cross-cutting change (per-table `ENABLE ROW
LEVEL SECURITY` + policy across dozens of tables) that the team has already scoped and explicitly
  deferred in its own documentation; implementing it now would exceed this audit's minimal-fix
  mandate and cannot be validated without a live Postgres.

### F-A7-06 — MEDIUM — Non-`CONCURRENTLY` unique index creation on live financial tables

- **Affected migrations**: `20260726000000_sprint_a0_preconditions` (`payment_intents`,
  `inventory.reservations`), `20260811000000_phase_a5_refund_idempotency` (`refunds`).
- **Evidence**: §11.
- **Status**: flagged, not retrofitted — editing an already-written/possibly-applied migration
  violates the team's own "never edit an applied migration" rule; a forward-only follow-up
  migration would be the correct fix if this proves to matter at actual production table sizes.

### F-A7-07 — MEDIUM — Destructive DDL in `20260804000000_sprint5x_schema_reconciliation`

- **Affected tables**: `media.folders`, `pages.templates` (non-financial).
- **Evidence**: §11. `DROP COLUMN` ×3 and `SET NOT NULL` without in-migration backfill.
- **Status**: flagged, not fixed — outside the financial-invariant chain this audit is scoped to
  protect; the author's claim that these tables were never live-deployed is plausible but not
  independently verifiable without a live database.

### F-A7-08 — MEDIUM — Least-privilege DB role defined but never used

- **Evidence**: §16.
- **Status**: flagged, not fixed — granting `lumo_app` real privileges and repointing every
  environment's `DATABASE_URL` is a security-relevant change this audit cannot validate without a
  live database; shipping untested GRANT statements risks a worse outcome (broken app) than the
  current over-privileged-but-working state.

### F-A7-09 — MEDIUM — Documented connection-pool sizing is never applied

- **Evidence**: §15.
- **Status**: flagged, not fixed — deciding between an appended `connection_limit` and a real
  PgBouncer deployment is a production-topology decision outside this audit's mandate.

### F-A7-10 — MEDIUM — No TLS configured for the Postgres connection anywhere in-repo

- **Evidence**: §16, §22.
- **Status**: flagged — UNKNOWN/not represented for production; local/CI is plaintext by design
  (ephemeral, non-sensitive dev credentials).

### F-A7-11 — LOW/INFORMATIONAL — Cross-context references are unenforced by FK

- **Status**: not a defect — confirmed intentional (D-002), documented in §6.

### F-A7-12 — LOW — No CHECK constraints on financial status enums

- **Status**: not fixed — team's own documented, intentional deferral (§4).

### F-A7-13 — LOW — A few cross-context lookup keys have no index

- **Evidence**: §13.
- **Status**: flagged only — no query-usage evidence proves these are hot paths.

### F-A7-14 — INFORMATIONAL — `prisma format --check` reports unformatted files

- **Status**: cosmetic, not fixed (out of scope; no functional effect).

### F-A7-15 — INFORMATIONAL — Unnecessary `$queryRawUnsafe` for a hardcoded health-check literal

- **Evidence**: `apps/runtime/src/composition.ts` — `prisma.$queryRawUnsafe("SELECT 1")`.
- **Status**: flagged only — no injection risk (no interpolation), just an avoidable API choice.

### F-A7-16 — LOW — No dedicated refund "reason"/"actor" column

- **Evidence**: §19.
- **Status**: flagged, not fixed — scope expansion beyond this audit's demonstrated-defect mandate.

### F-A7-17 — INFORMATIONAL — Documented backup RPO depends on WAL archiving never provably enabled

- **Evidence**: §20–21.
- **Status**: flagged — outside this repository's code (an operational/infrastructure toggle).

### F-A7-18 — INFORMATIONAL — Encryption at rest/in transit unconfigured; `EnvelopeCipher` unwired

- **Evidence**: §22.
- **Status**: flagged — no current claim of active field-level encryption to contradict; noted for
  completeness.

---

## 25. Remediation Summary

| Finding                                       | Severity | Status                                                |
| --------------------------------------------- | -------- | ----------------------------------------------------- |
| F-A7-01 Refund.status drift                   | CRITICAL | **Fixed** (migration + regression test, this session) |
| F-A7-02 Capture long-transaction pattern      | HIGH     | Flagged, not fixed                                    |
| F-A7-03 No live-Postgres concurrency proof    | HIGH     | Flagged, not fixed (environment constraint)           |
| F-A7-04 Idempotency DB constraint unexercised | MEDIUM   | Flagged, not fixed                                    |
| F-A7-05 RLS not implemented                   | MEDIUM   | Flagged, not fixed (team's own deferred plan)         |
| F-A7-06 Non-concurrent index creation         | MEDIUM   | Flagged, not fixed                                    |
| F-A7-07 Destructive non-financial DDL         | MEDIUM   | Flagged, not fixed                                    |
| F-A7-08 Unused least-privilege role           | MEDIUM   | Flagged, not fixed                                    |
| F-A7-09 Pool size not applied                 | MEDIUM   | Flagged, not fixed                                    |
| F-A7-10 No DB connection TLS                  | MEDIUM   | Flagged, not fixed                                    |
| F-A7-11 Unenforced cross-context FKs          | LOW/INFO | Not a defect (by design)                              |
| F-A7-12 No status CHECK constraints           | LOW      | Flagged, not fixed (team's own deferred plan)         |
| F-A7-13 Missing cross-context indexes         | LOW      | Flagged only                                          |
| F-A7-14 Unformatted Prisma files              | INFO     | Cosmetic                                              |
| F-A7-15 Unnecessary `$queryRawUnsafe`         | INFO     | Flagged only                                          |
| F-A7-16 No refund reason/actor field          | LOW      | Flagged, not fixed                                    |
| F-A7-17 PITR not provably enabled             | INFO     | Flagged, outside repo                                 |
| F-A7-18 Encryption unconfigured/unwired       | INFO     | Flagged, outside repo                                 |

**Files changed this session**:

- `packages/db/prisma/schema/migrations/20260811010000_payments_refund_status_column/migration.sql` (new)
- `packages/db/src/schema-migration-consistency.test.ts` (new — 5 tests)
- `packages/db/vitest.config.ts` (new)
- `packages/db/package.json` (wired `vitest`; `test` script now `vitest run` instead of the prior no-op)

**Tests added**: 5, all in `packages/db/src/schema-migration-consistency.test.ts`. Pre-fix: 1/5
failed (`refunds.status` missing — the exploit proof, reproduced by temporarily removing the new
migration and re-running). Post-fix: 5/5 pass.

---

## 26. Quality Gates & Production Readiness Verdict

```
pnpm typecheck   78/78 successful
pnpm lint        78/78 successful
pnpm test        78/78 successful (includes the 5 new packages/db tests)
pnpm arch        0 dependency violations (1564 modules, 6787 dependencies cruised)
pnpm governance  Not available in this checkout.
pnpm dup         Not available in this checkout.
prisma validate  The schemas at prisma\schema are valid 🚀
prisma migrate status / migrate diff   P1001 — no reachable Postgres in this sandbox (expected, documented)
```

**Final Verdict: CONDITIONALLY PRODUCTION READY.**

The one CRITICAL, _proven_ database defect found by this audit (`payments.refunds.status`
schema/migration drift, which would have broken every refund write in any environment that runs
migrations as documented) is fixed, tested, and verified by an exploit-first regression test. No
other finding in this audit rises to a _proven_ CRITICAL or HIGH database-integrity defect —
the remaining HIGH items (F-A7-02, F-A7-03) are a flagged structural risk and an environmental
verification gap, not demonstrated exploits, and every MEDIUM/LOW item is either an intentional,
documented architectural decision (cross-context FKs, RLS/CHECK deferral) or a genuine but
non-blocking operational gap (TLS, connection pooling, backup/PITR confirmation) that sits outside
what this repository's code can prove or fix on its own. This does not reopen any Phase A.1–A.6
finding — the refund-concurrency and idempotency mechanisms those phases built are corroborated
intact at the code level; what this audit adds is the caveat that they have never been exercised
against a real PostgreSQL instance, which is an environmental constraint of this sandbox, not a
flaw newly discovered in the mechanisms themselves.
