# FINAL PRODUCTION READINESS AUDIT — v2 (Definitive)

**Type:** Verification sprint. **No code was changed.**
**Repository:** `C:\Users\abdoh\Claude code\Git\lumo-platform`
**Branch / HEAD:** `main` @ `aee3269` — _docs(runtime): record analytics/platform-console as C-01 blocked, not converted_
**Audit date:** 2026-08-05
**Predecessor:** `FINAL_PRODUCTION_READINESS_AUDIT.md` (2026-08-04, `main` @ `756bce3`, score 31/100)

**Method.** Direct source reading plus repository-wide static analysis. All four objective gates were
_executed_ against this tree, not assumed. Two claims were re-derived programmatically rather than
accepted from milestone reports (schema/migration parity; per-context persistence wiring). One
critical finding was proven by _executing_ the shipped configuration through the real config loader.
Every finding below cites a file and line that was opened and read. Where a document and the code
disagree, the code is reported.

---

## Executive Summary

### Overall production readiness score: **55 / 100** (was 31)

The remediation milestones did what they claimed. That is the headline, and it is verified, not
taken on trust:

- **Persistence is real.** Independently enumerated across all 40 `services/*`: **37 contexts have a
  `deps.prisma !== undefined` composition branch that constructs Prisma repositories.** The three
  without one are `analytics`, `platform-console` (both disclosed in
  `RUNTIME_COMPOSITION_BLOCKER_REPORT.md`) and `example` (a scaffold, not a production context). The
  wiring is genuinely threaded end to end: `apps/runtime/src/api.ts:42-43` → `createAdminHttpApi` →
  `wireAdmin(deps)` (`apps/admin/src/http/server.ts:41`) → all 39 `wireX(deps)` calls
  (`apps/admin/src/composition.ts:283-321`). **C-01 is closed.**
- **Schema/migration parity is complete.** Extracting every `model`/`@@map`/`@@schema` from the 40
  `.prisma` files and every `CREATE TABLE` from the 31 migrations: **132 schema tables, 132 created
  tables, zero unreachable.** The two apparent mismatches (`media.folders`, `pages.templates`) are
  `ALTER TABLE ... RENAME` operations in
  `20260804000000_sprint5x_schema_reconciliation/migration.sql:24,42`. **C-04 is closed.**
- **Build and CI/CD exist.** `infrastructure/docker/runtime.Dockerfile`, all six workflows,
  `.github/actions/setup`, cosign verification, and correct image pinning
  (`deploy.yml`: `kustomize edit set image lumo-runtime:local=<digest>`). **C-02 and C-03 are closed.**
- **The inner codebase remains excellent.** Zero architecture violations across **1,531 modules and
  6,672 dependencies**. Zero `TODO`/`FIXME`/`HACK`/`XXX` in the entire TypeScript surface. Zero
  skipped, `.only`, or disabled tests. Zero `@ts-ignore`/`@ts-expect-error`. All 76 workspace tasks
  pass lint, typecheck, and test.

**What has not changed is the thing that decides this audit: the platform still cannot run.**

Three findings carry the verdict, and the first is new — it did not exist in v1 because the
deployment layer it lives in did not exist yet:

1. **The runtime cannot boot with the configuration this repository ships.** `10-config.yaml` sets
   `APP_ENV: "production"`, which makes `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL` and `KRATOS_ADMIN_URL`
   mandatory (`apps/runtime/src/config.ts:164-172`). None of the three appears in the ConfigMap, the
   Secret template, or any `env:` block. Loading the exact shipped environment through
   `loadRuntimeConfig()` produces `Invalid runtime configuration: KETO_WRITE_URL is required...` —
   **executed and reproduced during this audit.** All three Deployments crash-loop on `kubectl apply -k`.
2. **The money path still has no entry point.** The only `implements PaymentProvider` is an in-memory
   stub whose `capture()` is a no-op and whose `verifyWebhook()` returns `true` unconditionally.
   `verifyWebhook` has **zero call sites**. There is no webhook route. No string matching `stripe`,
   `adyen`, or any PSP name exists in the repository. **C-05 is unchanged from v1.**
3. **MFA verification accepts the literal string `123456`** for every enrollment, on a live
   production HTTP route (`POST /security/mfa/enrollments/:enrollmentId/verify`), with no injection
   seam to replace the provider. **H-03 is unchanged from v1 and is now reachable**, because the
   Security context is wired into the production admin graph.

The gap between v1 and v2 is real and large: the platform moved from "a prototype that has never
executed" to "a correctly-persisted, correctly-built system that is three environment variables away
from starting." That is meaningful progress. It is still not production.

| Severity                     | Count | v1  |
| ---------------------------- | ----- | --- |
| Critical (blocks production) | 6     | 9   |
| High (fix before production) | 9     | 10  |
| Medium (recommended)         | 7     | 11  |
| Low (optional)               | 4     | 6   |

### Gate results (executed 2026-08-05)

| Gate             | Command          | Result                                                       |
| ---------------- | ---------------- | ------------------------------------------------------------ |
| Typecheck        | `pnpm typecheck` | ✅ **76 successful, 76 total**                               |
| Lint             | `pnpm lint`      | ✅ **exit 0**                                                |
| Test             | `pnpm test`      | ✅ **76 successful, 76 total**                               |
| Architecture     | `pnpm arch`      | ✅ **no dependency violations (1,531 modules, 6,672 deps)**  |
| Dependency audit | `pnpm audit`     | ❌ **32 vulnerabilities — 1 critical, 18 high, 13 moderate** |

All four required gates pass. The fifth is not a required gate today, which is itself a finding (H2-8).

---

## Architecture Status — **PASS**

Nothing here needs to change, and nothing in this audit recommends changing it.

- `pnpm arch` reports **zero violations across 1,531 modules and 6,672 dependencies**. Layering,
  bounded-context isolation, and dependency inversion hold under mechanical verification.
- Forbidden imports: none. Cross-context coupling is consistently expressed through ports
  (`PaymentVerificationPort`, `ObjectStoragePort`, `CartPort`, …) rather than direct package imports —
  e.g. `PrismaPaymentVerificationAdapter` (`apps/runtime/src/composition.ts:172-188`) reads the
  `payment_intents` table directly rather than importing `@platform/payments`, preserving the
  Orders/Payments decoupling at code level.
- Duplicate logic: the `wireX` compositions share a `buildController(...)` helper across both
  persistence branches so use-case wiring is written once (representative:
  `services/wishlist/src/composition.ts:57-74`). No duplicated engine, no second consumer stack —
  tracking ingest reuses `KafkaConsumerRuntime`, the Postgres inbox, retry topics and the DLQ.
- Dead code at the module level is low but not zero — see L2-1.

**No change is required in this area.**

---

## Runtime Status — **FAIL** (cannot boot as configured)

### Boot and fail-fast behaviour — correct by design

The runtime's fail-closed discipline is genuinely good and should be preserved:

- `apps/runtime/src/composition.ts:105-109` — composition throws without `AUTH_ISSUER_URL` +
  `AUTH_JWKS_URL`; there is no fake identity provider.
- `apps/runtime/src/composition.ts:131-135` — missing `KETO_READ_URL` outside `APP_ENV=local` throws;
  authorization never falls open.
- `apps/runtime/src/config.ts:175-182` — `SECURITY_ZERO_TRUST_ENFORCEMENT` cannot be enabled without
  `SECURITY_PRINCIPAL_PROVISIONING`, because enforcement fails closed against an unprovisioned store.
- `apps/runtime/src/composition.ts:273` — `loadTrackingRegistry` throws on an empty registry rather
  than starting a runtime that would accept events and forward them nowhere.
- `apps/collector/src/main.ts:22-28,63-65` — required env is read at boot, and the Kafka producer
  connects at boot so an unreachable broker fails the deploy instead of surfacing as a 503.

### Entrypoints, health, readiness, metrics

| Surface       | API                                  | Worker                   | Scheduler                |
| ------------- | ------------------------------------ | ------------------------ | ------------------------ |
| Entrypoint    | `api.ts:29`                          | `worker.ts:24`           | `scheduler.ts:65`        |
| `/healthz`    | ✅ `packages/http/src/server.ts:356` | ✅ `health-server.ts:25` | ✅ `health-server.ts:25` |
| `/readyz`     | ✅ `server.ts:357`                   | ✅ `health-server.ts:30` | ✅ `health-server.ts:30` |
| `/metrics`    | ⚠️ partial (`server.ts:361`)         | ✅ `health-server.ts:46` | ✅ `health-server.ts:46` |
| Graceful stop | ✅ SIGINT/SIGTERM `api.ts:52-59`     | ✅ `worker.ts:51-59`     | ✅ `scheduler.ts:75-83`  |

Dependency wiring is a true single composition root: Prisma/Redis/Kafka clients are lazy, so building
the graph is side-effect-free and testable without Docker (`composition.ts:85-163`). `RuntimeMetrics`
is one instance per process, shared by the Kafka runtime, the HTTP transport and readiness reporting.

The `/metrics` asymmetry is a real gap — see H2-7.

### Findings

**C2-1 · The shipped Kubernetes configuration cannot start the runtime — CRITICAL**

- `infrastructure/k8s/10-config.yaml:13` — `APP_ENV: "production"`
- `apps/runtime/src/config.ts:164-172` — superRefine requires `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`,
  `KRATOS_ADMIN_URL` unless `APP_ENV=local`
- `infrastructure/k8s/secret.example.yaml:6-12,22-24` — Secret carries "ONLY the two credentialed
  URLs" (`DATABASE_URL`, `REDIS_URL`)
- `infrastructure/k8s/20-deployment-api.yaml:75-80` (and `21-*:74-79`, `22-*:53-58`) — env comes
  **only** from `envFrom`; no `env:` block anywhere

Repository-wide, `KETO_WRITE_URL`/`KRATOS_PUBLIC_URL`/`KRATOS_ADMIN_URL` appear in exactly one place
outside `config.ts`: `.github/workflows/ory-integration.yml`, as test-only `*_TEST` variables.

**Verification performed.** `loadRuntimeConfig()` was executed with an environment constructed
literally from `10-config.yaml` + `secret.example.yaml`:

```
RESULT: BOOT FAILURE
Error: Invalid runtime configuration: KETO_WRITE_URL: KETO_WRITE_URL is required unless APP_ENV=local
(Ory identity binding, H-2).; KRATOS_PUBLIC_URL: ...; KRATOS_ADMIN_URL: ...
```

**Impact.** `kubectl apply -k infrastructure/k8s` yields three Deployments in `CrashLoopBackOff`.
Because `loadRuntimeConfig()` runs at module scope in every entrypoint, the failure precedes the
health server, so `/healthz` never answers and the startup probe (`failureThreshold: 30`,
`periodSeconds: 3`) expires after ~90s per pod. Nothing in CI catches it: no workflow renders or
applies the manifests.

**Recommended action.** Add the three keys to `lumo-runtime-config` (they are non-credentialed
service URLs, exactly like `KETO_READ_URL` which is already there), or document them in
`secret.example.yaml` if the deployment targets an authenticated Ory. Then add a manifest-render
smoke check to `validate.yml` that loads `loadRuntimeConfig()` against the rendered ConfigMap so this
class of drift cannot recur.

**C2-6 · Repositories are pinned to one tenant at boot while HTTP resolves a tenant per request — CRITICAL (latent)**

- `apps/runtime/src/api.ts:43` — `tenantId: runtime.config.TENANT_DEFAULT_ID`, passed once
- `apps/admin/src/http/server.ts:41` — `wireAdmin(deps)` is called **once**, at server construction
- `apps/admin/src/http/server.ts:53` — `tenantResolvers: [headerTenantResolver]` resolves a tenant
  **per request**
- `packages/http/src/server.ts:104-106` — the pipeline is documented "tenant-resolution-first
  (ADR-0008; no application code runs tenant-less)"
- `apps/runtime/src/config.ts:34` — `TENANT_MODE: z.enum(["single","multi"])` — **zero consumers
  repository-wide**

Every Prisma repository receives its `tenantId` at composition time and scopes all queries to it.
Route handlers pass only the principal (representative:
`apps/admin/src/http/security-sessions-routes.ts:233`), so the resolved request tenant never reaches
persistence.

**Impact.** In single-tenant operation (today's default, and what `10-config.yaml:25` configures)
behaviour is correct. The moment a second tenant is onboarded, an authenticated caller sending
`x-tenant-id: tenant-b` reads and writes `tenant-a`'s rows: total cross-tenant data exposure. The
platform ships a Tenancy bounded context, versioned SaaS plans, and per-tenant licensing — the
architecture advertises multi-tenancy that the runtime does not implement.

**Recommended action.** Do not attempt per-request re-composition. Either (a) make the runtime's
single-tenancy explicit and fail closed — reject any request whose resolved tenant ≠
`TENANT_DEFAULT_ID` when `TENANT_MODE=single`, and refuse to boot when `TENANT_MODE=multi` — or
(b) thread the resolved tenant into the repositories as a call-scoped parameter. (a) is a guardrail
and small; (b) is a design change and should go through an ADR.

---

## Persistence Status — **PASS (with an unverified-at-runtime caveat)**

### Verified durable: 37 of 39 production contexts

Enumerated mechanically over every `services/*/src/**/*composition.ts`:

| Result                                                | Count | Contexts                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma branch **and** constructs Prisma repos         | 37    | automation, cart, catalog, checkout, components, content, coupons, customer-360, experience, experimentation, feature-flags, feature-registry, finance, fulfillment, identity, inventory, licensing, localization, loyalty, media, notifications, orders, pages, payments, pricing, promotions, recommendations, reporting, returns, reviews, search, security, seo, shipping, tenancy, theme, wishlist |
| No Prisma branch — **disclosed**                      | 2     | analytics, platform-console                                                                                                                                                                                                                                                                                                                                                                             |
| No Prisma branch — scaffold, not a production context | 1     | example                                                                                                                                                                                                                                                                                                                                                                                                 |

The P1.5 claim is accurate. In-memory repositories are no longer on the production path for those 37:
each `wireX` returns from the Prisma branch before the in-memory graph is constructed (representative:
`services/wishlist/src/composition.ts:81-107` vs `109-143`).

**UnitOfWork.** `PrismaUnitOfWork` is constructed in every Prisma branch and passed to every use case.
**Outbox.** `PrismaOutboxStore.append` **requires** the caller's transaction client and throws without
one (`packages/db/src/messaging/prisma-outbox-store.ts:19-28`) — the dual-write bug is structurally
excluded, which is the correct and rather elegant enforcement of ADR-0003.
**Transactions.** `KafkaConsumerRuntime.handleAtomic` commits the domain write and the inbox marker in
one transaction (`packages/kafka/src/consumer-runtime.ts:179-204`).
**Schema parity.** 132/132 tables have a `CREATE TABLE` (see Executive Summary).

### Findings

**C2-3 · Outbox rows are never marked published; the pruner deletes nothing — CRITICAL**

- `apps/runtime/src/scheduler.ts:32-34` — `deleteMany({ where: { status: "published", createdAt: { lt: cutoff } } })`
- `packages/db/src/messaging/prisma-outbox-store.ts:65-70` — `markPublished` sets `status: "published"`
- `packages/messaging/src/outbox/outbox-relay.ts:34` — the **only** caller of `markPublished`
- `new OutboxRelay(...)` appears in 36 service compositions — in every case **inside the in-memory
  branch only** (representative: `services/wishlist/src/composition.ts:132-136`, after the Prisma
  branch has already returned at line 106)
- Prisma branches return `drainOutbox: async () => 0` (e.g. `services/payments/src/composition.ts:159`)
- `infrastructure/docker/debezium/outbox-connector.json` — CDC streams `platform.outbox`; Debezium
  does not, and cannot, update the source row's `status`

**Impact.** On the production (Prisma + CDC) path no code path ever transitions an outbox row from
`pending` to `published`. The hourly pruner's predicate therefore matches **zero rows forever**, and
`platform.outbox` grows without bound — every domain event ever emitted, retained permanently, on the
primary transactional database. This is a slow, silent disk-exhaustion path that ends in a write
outage across all 37 contexts. `OUTBOX_RETENTION_DAYS` is configured (`10-config.yaml:26`) and has no
effect.

**Recommended action.** With CDC as the publisher, "published" means "streamed by Debezium", which the
application cannot observe directly. Two evidence-consistent options: prune on `createdAt` age alone
with a retention window safely longer than the maximum acceptable CDC lag (and alert on Debezium lag),
or have the connector's downstream ack path mark rows. The first is smaller and matches the
`@@index([createdAt])` already declared for pruning (`platform.prisma:24`). Add an outbox-depth gauge
either way — the current design has no signal at all for this failure.

**C2-5 · No migration is ever applied to a deployment target — CRITICAL**

- `.github/workflows/db-integration.yml:60` — `prisma migrate deploy` runs against an **ephemeral CI
  Postgres** only
- `.github/workflows/deploy.yml:60-71` — the deploy job configures kubectl, pins the image, applies
  manifests, waits for rollout. **No migration step.**
- `infrastructure/k8s/` — no `Job` and no `initContainer` runs migrations; the only `Job` is Debezium
  connector registration (`70-debezium.yaml:120`)

**Impact.** A deploy ships code whose tables may not exist in the target database. With C-04 now
closed, the 132 tables are correctly _defined_ — they are simply never _created_ in any environment by
the pipeline. First production rollout fails at the first query with `relation does not exist`, across
every context simultaneously.

**Recommended action.** Add a pre-rollout migration step. A Kubernetes `Job` running
`prisma migrate deploy` from the same image, gated before `kubectl apply`, is the smallest change
consistent with the existing design; `deploy.yml` already has the kubeconfig and the pinned digest.

**H2-9 · 33 of 37 durable contexts have never executed against a real database — HIGH**

Prisma repository implementation files: **~57 across 37 contexts**. Files gated on `DATABASE_URL_TEST`
(the honest gate that runs in `db-integration.yml`): **9, covering 3 contexts** — customer-360, orders,
security.

**Impact.** The 33 P1.5 conversions are type-checked but never executed. Type checking cannot catch a
wrong column mapping, a JSON-shape mismatch, a missing index causing a full scan, or a
`@@unique` violation under concurrency — and several repositories bridge JSON columns with
`as unknown as` casts that erase exactly the type information that would otherwise protect them (e.g.
`services/checkout/src/infrastructure/prisma-checkout-session-repository.ts:72-77`,
`services/catalog/src/infrastructure/prisma-catalog-repositories.ts:97-98`). The confidence these
conversions currently carry is compile-time confidence, presented as durability.

**Recommended action.** This is the highest-value verification work remaining. Extend
`db-integration.yml` with round-trip integration suites for the highest-risk contexts first — orders,
payments, inventory, catalog, cart, checkout — following the existing
`prisma-order-repository.integration.test.ts` pattern. It requires no new infrastructure; the workflow
and the Postgres service already exist.

**M2-5 · Analytics and Platform Console are non-durable — MEDIUM (disclosed, accepted)**

`services/analytics/src/composition.ts:21` and `services/platform-console/src/composition.ts:15` take
zero dependencies. Both are documented in `RUNTIME_COMPOSITION_BLOCKER_REPORT.md` with a correct
rationale: `SemanticRegistry` is an in-process catalog and `PlatformKpisProjection` is a read-model
with no aggregate. Neither has a Prisma implementation to wire. **The decision not to invent one was
right.** The residual risk is that Platform Console KPIs reset to zero on every restart and every
rollout, silently. That should be stated in the operations runbook rather than fixed by inventing a
persistence shape.

---

## Tracking Status — **FAIL** (inert in production)

The tracking pipeline is well-built. Its ingest handler is one of the better pieces of code in the
repository: permanent refusals are dead-lettered directly and acked while transient refusals throw
back to the retry schedule (`apps/runtime/src/tracking/tracking-ingest.ts:150-177`), the registry
snapshot is pinned per event so a hot reload cannot change definitions mid-event (lines 88-103), and
the topic constants are re-exported from `@platform/tracking` rather than restated so publisher and
consumer cannot drift (lines 41-49).

It cannot run as configured.

**H2-5 · The tracking topic is never created, and ingest is disabled with no way to enable it — HIGH**

- `infrastructure/docker/redpanda/bootstrap-topics.sh` — creates 18 business topics with
  `.retry`/`.dlq` companions. **`tracking.event.captured.v1` is not among them.**
- `packages/kafka/src/consumer-runtime.ts:93-98` — `allowAutoTopicCreation: false`; the consumer
  subscribes to `[topic, topic.retry]`
- `apps/runtime/src/config.ts:46-49` — `TRACKING_INGEST_ENABLED` defaults to `off`
- `infrastructure/k8s/10-config.yaml` — **does not set `TRACKING_INGEST_ENABLED`** (nor
  `TRACKING_RULE_SET_KEY`, nor `TRACKING_REGISTRY_POLL_MS`)

**Impact.** Two compounding failures. With the shipped config the ingest consumer is never registered
(`worker.ts:36-37`), so the pipeline is inert — the exact silent-loss condition C-07 was opened to
remove, reintroduced by configuration rather than by code. If an operator sets the flag, the consumer
then fails to subscribe because the topic does not exist and auto-creation is correctly disabled.

**Recommended action.** Add `tracking.event.captured.v1` to `bootstrap-topics.sh` via
`with_companions` (retention appropriate to clickstream volume), and add the three `TRACKING_*` keys
to the ConfigMap. Sequence matters: topic first, registry seed second, flag last —
`loadTrackingRegistry` will refuse to start against an unseeded registry, which is correct.

**H2-6 · The collector is not deployable and its readiness probe cannot fail — HIGH**

- `apps/collector/src/main.ts:67` — `const health = new HealthRegistry();` with **no `health.register(...)`
  call anywhere in `apps/collector`**
- `infrastructure/docker/` — no collector Dockerfile; `web.Dockerfile` builds the storefront,
  `runtime.Dockerfile` builds api/worker/scheduler
- `infrastructure/k8s/` — no collector Deployment, Service, or Ingress
- `.github/workflows/build.yml:36-71` — builds exactly one image, the runtime

**Impact.** The collector is the browser-facing ingress for the entire tracking product: no image, no
manifest, no route. Even run manually, `/readyz` reports healthy unconditionally — a collector whose
Kafka producer has died still advertises readiness and accepts beacons it cannot publish.

**Recommended action.** Register the Kafka producer health check in the collector's `HealthRegistry`
(the `@platform/health` and `@platform/kafka` pieces both already exist), then add a collector stage
to `runtime.Dockerfile` or a sibling Dockerfile, plus Deployment/Service/Ingress manifests. Track as
one unit — a deployed collector with an always-healthy probe is worse than no collector.

### Retry, DLQ and registry (verified working)

Retry topics, DLQ topic + row, the Postgres inbox, and byte-verbatim replay preservation are all
correctly implemented and wired (`consumer-runtime.ts:206-260`, `composition.ts:283-322`). The
registry hot-reload watcher is wired and polls on a configurable interval (`composition.ts:275-281`).
See H2-4 for the retry mechanism's one real defect.

---

## Payments Status — **FAIL** (unchanged from v1)

**C2-2 · No PSP adapter, no webhook verification, no webhook ingress, non-durable webhook dedup — CRITICAL**

- `services/payments/src/infrastructure/in-memory-port-adapters.ts:14` — the **only**
  `implements PaymentProvider` in the repository
- lines 22-24 — `capture()` is a no-op
- lines 34-36 — `verifyWebhook()` returns `true` unconditionally
- `verifyWebhook` call sites repository-wide: **zero** (only the interface declaration at
  `packages/contracts/src/payment-provider.ts:29` and the stub above)
- No file, route, or string matching `stripe`, `adyen`, or any PSP name exists
- `apps/admin/src/http/payments-routes.ts` — no webhook route; `RecordWebhook` is composed
  (`services/payments/src/composition.ts:118-124`) and reachable through no HTTP path
- **`services/payments/src/composition.ts:72-76`** — `buildController` constructs
  `InMemoryPaymentProvider`, `InMemoryOrdersAdapter`, `InMemoryFinanceAdapter`,
  `InMemoryNotificationAdapter` and **`InMemoryProcessedWebhookStore`** — in **both** branches. The
  Prisma path calls the same `buildController` (line 158).

**Impact.** A PSP cannot reach this platform and this platform cannot charge a card. The additional
detail beyond v1: webhook idempotency is a process-local `Set` even on the durable path, so once a
webhook route does exist, a redelivered capture event after a pod restart — or delivered to the other
of two replicas — will be reprocessed. Financial double-processing is the failure mode.

`PaymentsWiringDeps` (lines 44-58) declares only `prisma`/`tenantId`; there is no seam through which
a real provider or a durable webhook store could be injected. The doc comment is candid about this
("`paymentProvider`/`ordersPort`/`financePort`/`notifications` stay in-memory in both branches").

**Recommended action.** In order: (1) add optional `paymentProvider` / `processedWebhooks` /
`ordersPort` / `financePort` / `notifications` fields to `PaymentsWiringDeps`, defaulting to today's
stubs so nothing changes for tests; (2) add a Prisma-backed `ProcessedWebhookStore` keyed
`(tenant, provider, event)` — the ports and the unique-constraint design already exist; (3) fail closed
at boot outside `local` when the provider is still the stub; (4) build the real PSP adapter and the
webhook route. Steps 1-3 are guardrails and small. Step 4 is genuine engineering work and is the
long pole for revenue.

### Payment verification and order completion — mostly correct

- **Admin path: verified.** `api.ts:44-47` passes a real `PrismaPaymentVerificationAdapter`, which
  requires a `captured` intent matching both id and order, tenant-scoped
  (`composition.ts:181-187`). `MarkOrderPaid` rejects unverified refs
  (`services/orders/src/application/mark-order-paid.use-case.ts:60-72`). **H-08's admin half is closed.**
- **Consumer path: unverified by design.** `buildPaymentCapturedRuntime` constructs `MarkOrderPaid`
  without `paymentVerification` (`composition.ts:213-218`), and the field is optional (use-case line 35),
  so the check is skipped silently. This is defensible — the consumer's input _is_ Payments asserting
  a capture on `payments.payment_intent.captured.v1` — and `api.ts:24-27` states that rationale. Logged
  as M2-7 rather than a defect: the risk is that an optional field makes a future regression silent,
  not that today's behaviour is wrong.

**M2-1 · The purchase saga cannot complete — MEDIUM**

`.signal(` call sites repository-wide: **zero** (the only matches are
`TrackingRegistryStore.signal`, an unrelated method). `@platform/temporal` has **zero importers** in
any `.ts` file. Unchanged from v1 (C-06), and honestly disclosed in `worker.ts:17-22`. Downgraded from
Critical to Medium only because the money path (C2-2) blocks strictly earlier — a saga that cannot
complete is moot while no payment can be taken.

---

## Security Status — **FAIL**

### What is correct

Authentication and authorization on the live path are real and fail closed: `JwtVerifier` against a
mandatory JWKS issuer, `CachedAccessControl` over `KetoAccessControl`, and a hard throw rather than a
permissive fallback outside `local` (`composition.ts:105-135`). The HTTP pipeline enforces
authenticate → tenant → authorize → rate limit → validate → idempotency
(`packages/http/src/server.ts:104-106`). Every admin route declares an explicit permission. Secrets are
externalized: no hardcoded credential was found in any TypeScript source.

### Findings

**C2-4 · MFA accepts the hardcoded code `123456` on a live production route — CRITICAL**

- `services/security/src/infrastructure/in-memory-auth-adapters.ts:132` —
  `constructor(private readonly validCode = "123456")`
- lines 139-141 — `verify()` returns `input.code === this.validCode`
- `services/security/src/composition.ts:429-431` — `new InMemoryTotpMfaProvider()` and
  `new MapMfaProviderResolver([totpProvider])` are constructed **unconditionally, in both branches**,
  with **no `deps.X ?? default` seam** — unlike `kms`, `crypto`, `identityDirectory`, `consentStore`
  and `sessionRevocation`, which all have one (lines 405-427)
- `apps/admin/src/http/security-sessions-routes.ts:237-244` — `POST
/security/mfa/enrollments/:enrollmentId/verify` is a live route
- Reachability chain: `api.ts:31` → `createAdminHttpApi` → `wireAdmin` → `wireSecurity(deps)`
  (`apps/admin/src/composition.ts:303`)

**Impact.** Multi-factor authentication provides no proof of possession. Any principal holding
`security:verify_mfa_enrollment` can activate any pending enrollment by submitting `123456`. Because
the provider is constructed inside `wireSecurity` with no injection point, this cannot be fixed by
configuration or composition — it requires a code change. Any compliance attestation that claims MFA
is enforced is currently false.

Note the asymmetry: `InMemoryPasswordAuthProvider` (same file, lines 115-127) holds an empty account
map, so password authentication fails closed. The MFA stub is the one that fails **open**.

**Recommended action.** Add `mfaProviders?: MfaProviderResolver` (and `authProviders?`) to
`SecurityWiringDeps`, defaulting to today's reference adapters, then fail closed at boot when
`APP_ENV !== "local"` and the resolver is still the in-memory one. This is the same
`deps.X ?? default` pattern the file already uses five times. It must land **before** any zero-trust
enforcement is switched on (H2-3) — mounting the guard without it exposes this route to the full
authenticated surface.

**H2-3 · The entire zero-trust runtime, security provisioning and entitlement layer has zero production callers — HIGH**

Verified by repository-wide search excluding tests and docs:

| Symbol                            | Location                                                       | Non-test callers              |
| --------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| `buildSecurityHttpGuard`          | `apps/runtime/src/security/wire-security-runtime.ts:90`        | **0**                         |
| `bootstrapSecurity`               | `apps/runtime/src/security/bootstrap-security.ts:46`           | **0**                         |
| `wireEntitlement`                 | `apps/runtime/src/entitlement/wire-entitlement.ts:47`          | **0** (barrel re-export only) |
| security provisioning consumers   | `apps/runtime/src/security/security-provisioning.consumers.ts` | **0** (test imports only)     |
| `EntitlementInvalidationConsumer` | `apps/runtime/src/entitlement/`                                | **0**                         |
| `SECURITY_ZERO_TRUST_ENFORCEMENT` | `apps/runtime/src/config.ts:133`                               | **0** (validated, never read) |
| `SECURITY_PRINCIPAL_PROVISIONING` | `apps/runtime/src/config.ts:122`                               | **0** (validated, never read) |

`wireSecurityRuntime` is called only by `buildSecurityHttpGuard`, which nothing calls. Neither
`api.ts` nor `worker.ts` imports anything from `src/security/` or `src/entitlement/`.

**Impact.** The Security context is composed (through `wireAdmin`) and its admin API works, but the
runtime enforcement layer — `SecurityPermissionGuard`, `EvaluateAccess`, session federation, principal
provisioning, entitlement quota enforcement — is unreachable code. Two config flags are declared,
documented, cross-validated against each other, and read by nothing, which is worse than absent: an
operator who sets `SECURITY_ZERO_TRUST_ENFORCEMENT=on` gets a successful boot and no enforcement,
with no warning. Enforcement today is `AdminGuard` + Keto, which is genuine but is not the zero-trust
model the architecture documents describe.

**Recommended action.** Either wire it behind the flags that already exist (after C2-4 is fixed — the
sequencing constraint from the v1 investigation still holds), or make the dead flags fail loudly at
boot so the runtime never silently misrepresents its own posture. The second is three lines and should
land regardless of when the first is scheduled.

**H2-1 · The production audit trail is in-memory; the durable adapter exists and is unwired — HIGH**

- `apps/admin/src/http/server.ts:44` — `auditTrail: deps.auditTrail ?? new InMemoryAuditTrail()`
- `apps/admin/src/composition.ts:323` — same fallback
- `apps/runtime/src/api.ts:31-48` — **`auditTrail` is not among the fields passed**
- `packages/db/src/audit/prisma-audit-trail.ts:12` — `PrismaAuditTrail implements AuditTrail`,
  exported from `packages/db/src/index.ts:11`
- `packages/db/prisma/schema/platform.prisma:73` — the `platform.audit_events` table exists
- `infrastructure/docker/redpanda/bootstrap-topics.sh` — `platform.audit.entry_recorded.v1` exists with
  7-year retention

**Impact.** Every authorization decision on every admin action is recorded to a process-local,
append-only, never-pruned array (`apps/admin/src/infrastructure/in-memory-audit-trail.ts:4-8`). Two
consequences: the audit trail is destroyed on every restart and rollout, and it is an unbounded
in-process memory leak against a 512Mi container limit. The durable adapter, the table, and the
7-year-retention topic all exist. The wiring is one field in one object literal.

**Recommended action.** Pass `auditTrail: new PrismaAuditTrail(runtime.prisma, ...)` in `api.ts`.
This is the cheapest high-severity fix in the audit and has no contract impact.

---

## Infrastructure Status — **PARTIAL PASS**

### What is genuinely good

The Kubernetes manifests are of a high standard and should not be rewritten: `runAsNonRoot`,
`readOnlyRootFilesystem: true`, `capabilities: drop [ALL]`, `allowPrivilegeEscalation: false`,
`seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`, topology spread + pod
anti-affinity, PDBs, HPAs, NetworkPolicies, `maxUnavailable: 0` rollouts, `terminationGracePeriodSeconds:
30` with a `preStop` drain, and a startup probe protecting slow boots from liveness. The Dockerfile
uses `tini` as PID 1 for correct SIGTERM forwarding, a cacheable `pnpm fetch` layer, a non-root user,
and an image-level `HEALTHCHECK` on `/healthz` only (readiness correctly left to k8s).

CI/CD is complete and correctly ordered: `ci.yml` runs lint → typecheck → build → test → arch;
`deploy.yml` gates on validate + Trivy + **cosign signature verification** before applying, pins the
image by digest, waits for rollout, and rolls back on failure.

### Findings

**H2-7 · Prometheus cannot scrape the runtime, and the API omits half its metrics — HIGH**

- `infrastructure/docker/prometheus/prometheus.yml` — scrape jobs are `prometheus`, `otel-collector`,
  `redpanda`. **There is no `lumo-runtime` job.**
- `infrastructure/docker/prometheus/rules/alerts.rules.yml` — `RuntimeProcessDown`,
  `MessagingDeadLettering` and `RuntimeHighMemory` all select on `job="lumo-runtime"`
- `packages/http/src/server.ts:361-375` — the API's `/metrics` emits `process_uptime_seconds`,
  `process_resident_memory_bytes`, `nodejs_heap_used_bytes` and `renderHttp()` **only**
- `apps/runtime/src/metrics.ts:94-99` — `updateHealth()` populates `runtime_ready` and
  `runtime_dependency_up`; it is called **only** from `apps/runtime/src/health-server.ts:34`
  (worker/scheduler), never from the API's `/readyz`

**Impact.** In the compose observability stack, no runtime metric is collected at all — three of eight
alert rules can never fire. In Kubernetes, annotation-based discovery works but produces a `job` label
derived from service discovery, not the literal `lumo-runtime` the rules require. Independently,
`runtime_ready` and `runtime_dependency_up` are never emitted by the **API** — the tier that serves
customer traffic — so `RuntimeNotReady` and `DependencyDown` are blind to it.

**Recommended action.** Add a `lumo-runtime` scrape job (or relabel to that job name in the cluster
Prometheus), and call `metrics.updateHealth(report)` in the HTTP `/readyz` handler as
`health-server.ts` already does. Both are small and neither changes application behaviour.

**H2-2 · OpenTelemetry never starts, while the shipped config enables it — HIGH**

- `apps/runtime/src/telemetry.ts:14` — `startRuntimeTelemetry(config, role)`, **zero callers
  repository-wide**; `api.ts`/`worker.ts`/`scheduler.ts` do not import it
- `infrastructure/k8s/10-config.yaml:30-33` — `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_TRACES_ENABLED: "true"`, `OTEL_METRICS_ENABLED: "true"`
- `infrastructure/docker/prometheus/rules/alerts.rules.yml` — `ElevatedFailedLogins` and
  `AuthorizationLatencyHigh` query `failed_logins` and `authorization_latency_bucket`, correctly
  annotated "Requires the OTel pipeline"

**Impact.** No traces and no OTel metrics leave any process, so there is no distributed tracing across
the API → Kafka → worker path, the security dashboards have no data source, and both security alerts
are permanently silent. The configuration actively asserts telemetry is on, which makes the absence
harder to notice, not easier. `@platform/observability`'s `createTelemetry` returns a no-op when both
flags are false, so calling it is safe in every environment.

**Recommended action.** Three lines per entrypoint: start the SDK before composition, shut it down in
the existing `shutdown()` handler.

**H2-8 · The dependency-audit gate never fails, and its stated justification is inaccurate — HIGH**

- `.github/workflows/ci.yml:45-49` — `pnpm audit --audit-level high` with
  `continue-on-error: true`, justified as "known **dev-tooling** advisories
  (vitest/vite/esbuild/postcss/OTel, G-6b)"
- Executed at HEAD: **32 vulnerabilities — 1 critical, 18 high, 13 moderate**

The justification does not hold at HEAD. Several advisories are in **production runtime**
dependencies, not dev tooling:

| Package           | Severity | Advisory                                                 | Production surface        |
| ----------------- | -------- | -------------------------------------------------------- | ------------------------- |
| `@fastify/static` | high     | Route guard bypass via path traversal                    | Admin API transport       |
| `find-my-way`     | high     | DDoS with HTTP/2                                         | Fastify router (all APIs) |
| `next`            | high ×3  | SSRF in rewrites; SSRF in Server Actions; App Router DoS | Storefront                |
| `sharp`           | high     | Inherited libvips CVEs (4)                               | Storefront image pipeline |
| `vitest`          | critical | Arbitrary file read/execute via UI server                | Dev only (correctly)      |

**Impact.** A route-guard bypass in `@fastify/static` and a router DoS in `find-my-way` sit directly on
the authenticated admin API. The gate that exists to catch this is configured never to fail, behind a
comment that no longer describes the facts.

**Recommended action.** Upgrade the four production-facing packages, then flip `continue-on-error` to
`false` for `high` and above. If some dev-tooling advisories are genuinely unfixable today, allowlist
them explicitly by advisory ID rather than disabling the gate wholesale.

**H2-4 · Retry back-off sleeps in-process and head-of-line blocks the consumer — HIGH**

- `packages/kafka/src/consumer-runtime.ts:98` — one consumer subscribes to **both**
  `[this.topic, this.topic.retry]`
- lines 121-124 — on a retry message: `if (wait > 0) await this.sleep(wait)` inside `eachMessage`
- line 99-101 — `consumer.run({ eachMessage })` with no `partitionsConsumedConcurrently`, so kafkajs
  defaults to **1**
- `packages/kafka/src/retry-schedule.ts:14` — the final delay is `3_600_000` ms (1 hour)

**Impact.** The file's own doc comment states "segregated partition — main never blocks" and
"deliberately replacing `EventConsumer`'s in-process sleep loop, which must never reach a consumer
group". Both topics are served by the **same consumer with a single concurrency slot**, so sleeping in
`eachMessage` blocks everything that consumer serves, including the main topic. A single message on
its fifth attempt stalls all `payments.payment_intent.captured.v1` processing for up to an hour.
Orders stop being marked paid platform-wide.

**Recommended action.** Run the retry topic on a **separate consumer** (its own group, its own `run`
loop), or set `partitionsConsumedConcurrently` above 1 and bound the in-process wait to well under the
`max.poll.interval.ms` — an hour-long sleep will trigger a consumer-group rebalance regardless. The
first is the design the comment already describes and should be preferred.

**M2-6 · The storefront is built but not deployed — MEDIUM**

`infrastructure/docker/web.Dockerfile` builds it and `ci.yml:51-57` uploads the `.next` artifact, but
there is no storefront Deployment, Service or Ingress in `infrastructure/k8s/`, and `build.yml` pushes
only the runtime image. `apps/storefront/src/lib/runtime-api.ts:1` targets `http://localhost:3080` by
default. The customer-facing tier has no deployment path.

---

## Repository Health — **PASS**

This section is unusually clean and deserves to be recorded as such.

| Check                                                           | Result                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `TODO` / `FIXME` / `HACK` / `XXX`                               | **0** across all `.ts`/`.tsx`                                        |
| Skipped / disabled tests (`.skip`, `.todo`, `xit`, `xdescribe`) | **0**                                                                |
| Focused tests (`.only`)                                         | **0**                                                                |
| `@ts-ignore` / `@ts-expect-error`                               | **0**                                                                |
| `eslint-disable`                                                | **5**, all justified (1 logger `no-console`, 4 test instrumentation) |
| Placeholder implementations that throw                          | **4**, all explicit and fail-loud (see M2-2, M2-3)                   |

**M2-4 · Type checking is defeated at two runtime composition seams — MEDIUM**

`apps/runtime/src/composition.ts:268` and `apps/runtime/src/tracking/wire-tracking-runtime.ts:169` both
cast the Prisma client with `as never`:

```ts
const registryStore = new PrismaTrackingRegistryStore(core.prisma as never, core.idGenerator);
```

`as never` satisfies any parameter type, so a mismatch between the runtime's Prisma client and what
the tracking stores expect — a renamed model, a changed delegate — compiles cleanly and fails at
runtime. Given that tracking has no DB-backed integration test (H2-9), nothing else would catch it.
Widening the store's parameter type to the shared `Database` type would restore the check.

**M2-2 · Media object storage is a stub that reports every object as existing — MEDIUM**

`services/media/src/media-library.composition.ts:73` — `deps.objectStorage ?? new InMemoryObjectStorage()`,
and `wireAdmin` never passes one. `InMemoryObjectStorage.exists()` returns `true` unconditionally and
`getDownloadUrl()` returns `https://storage.local/<key>`
(`services/media/src/infrastructure/object-storage-adapters.ts:4-12`). The real adapter throws
"not wired in this environment yet" (lines 19-27). `@platform/storage` — a complete S3-compatible
client — has **zero importers** in any `.ts` file; the three `@platform/storage` mentions in
`services/media` are all in comments. Media assets are now durably tracked in Postgres while their
bytes have no store and their URLs do not resolve.

**M2-3 · Licensing billing never moves money — MEDIUM**

`services/licensing/src/composition.ts:122-123` — `new InMemoryPaymentsAdapter()` and
`new InMemoryFinanceLedgerAdapter()`, in both branches, feeding `CreateInvoice`/`IssueInvoice`/
`CollectInvoice`/`GrantCredit` (lines 167-172). SaaS subscription invoices transition to collected
without any payment being taken. The same class of gap as C2-2 and blocked behind it.

**L2-1 · Dead workspace packages** — `@platform/temporal` and `@platform/grpc` have **zero importers**
in any `.ts` file. `services/example` is a scaffold carried in the production workspace. All three are
harmless but they inflate the install graph and the audit surface.

**L2-2 · `TENANT_MODE` is dead configuration** — declared at `apps/runtime/src/config.ts:34`, read
nowhere. Covered under C2-6.

**L2-3 · 34 milestone reports at the repository root** — `P1_5_*_REPORT.md` ×33 plus several others.
They are accurate and useful; `docs/implementation/` is where the rest of the project keeps them.

**L2-4 · `apps/runtime` has no `build` script**, by documented design (`tsx` at runtime, H-06,
downgraded in v1). Noted for completeness, not as a defect.

---

## Remaining Risks

### Critical — blocks production

| ID   | Risk                                                                 | Evidence                                                                    |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| C2-1 | Runtime cannot boot with the shipped k8s configuration               | `10-config.yaml:13`; `config.ts:164-172`; **reproduced by execution**       |
| C2-2 | No PSP, no webhook verification, no webhook ingress, in-memory dedup | `in-memory-port-adapters.ts:14,22-36`; `payments/composition.ts:72-76`      |
| C2-3 | Outbox never marked published → unbounded growth on the primary DB   | `scheduler.ts:32-34`; `prisma-outbox-store.ts:65-70`; `outbox-relay.ts:34`  |
| C2-4 | MFA accepts hardcoded `123456` on a live route                       | `in-memory-auth-adapters.ts:132,139-141`; `security/composition.ts:429-431` |
| C2-5 | No migration is applied to any deployment target                     | `deploy.yml:60-71`; no `Job`/`initContainer` in `infrastructure/k8s/`       |
| C2-6 | Repositories pinned to one tenant while HTTP resolves per request    | `api.ts:43`; `admin/http/server.ts:41,53`; `config.ts:34`                   |

### High — fix before production

| ID   | Risk                                                         | Evidence                                                              |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| H2-1 | Audit trail is in-memory; durable adapter unwired            | `admin/http/server.ts:44`; `api.ts:31-48`; `prisma-audit-trail.ts:12` |
| H2-2 | OTel never starts while config enables it                    | `telemetry.ts:14` (0 callers); `10-config.yaml:30-33`                 |
| H2-3 | Zero-trust / provisioning / entitlement have 0 callers       | `wire-security-runtime.ts:90`; `config.ts:122,133`                    |
| H2-4 | Retry sleep head-of-line blocks the consumer up to 1h        | `consumer-runtime.ts:98,121-124`; `retry-schedule.ts:14`              |
| H2-5 | Tracking topic uncreated; ingest disabled with no config key | `bootstrap-topics.sh`; `config.ts:46-49`; `10-config.yaml`            |
| H2-6 | Collector undeployable; readiness cannot fail                | `collector/src/main.ts:67`; no Dockerfile/manifest                    |
| H2-7 | No `lumo-runtime` scrape job; API omits readiness metrics    | `prometheus.yml`; `packages/http/src/server.ts:361-375`               |
| H2-8 | 1 critical + 18 high advisories; audit gate never fails      | `ci.yml:45-49`; `pnpm audit` output                                   |
| H2-9 | 33 of 37 durable contexts never executed against Postgres    | 57 Prisma impls vs 9 integration tests / 3 contexts                   |

### Medium

M2-1 purchase saga cannot complete · M2-2 media object storage is a stub · M2-3 licensing billing takes
no money · M2-4 `as never` defeats type checking at two seams · M2-5 analytics/platform-console
non-durable (disclosed) · M2-6 storefront not deployed · M2-7 consumer-path payment verification
omitted (defensible; asymmetry undocumented at the wiring site).

### Low

L2-1 dead packages (`@platform/temporal`, `@platform/grpc`, `services/example`) · L2-2 `TENANT_MODE`
dead config · L2-3 34 reports at repo root · L2-4 no `build` script for `apps/runtime` (by design).

---

## Production Score

| Dimension                      | Weight | Score | Notes                                                               |
| ------------------------------ | ------ | ----- | ------------------------------------------------------------------- |
| Architecture & code quality    | 15%    | 95    | 0 violations / 1,531 modules; 0 markers; 0 skipped tests            |
| Persistence correctness        | 15%    | 85    | 37/39 verified durable; schema parity 132/132; UoW + outbox correct |
| Persistence verification depth | 10%    | 25    | 3 of 37 contexts ever executed against a database                   |
| Build, CI/CD & supply chain    | 10%    | 70    | Complete and signed; audit gate disabled; no migration step         |
| Runtime bootability            | 15%    | 0     | Cannot start with shipped configuration                             |
| Payments / revenue path        | 10%    | 10    | No PSP, no webhook ingress, non-durable dedup                       |
| Security posture               | 15%    | 30    | AuthN/AuthZ real; MFA bypass; enforcement layer unreachable         |
| Observability & operations     | 10%    | 35    | Metrics exist; not scraped, OTel never starts, audit trail volatile |

### **Overall: 55 / 100** (v1: 31 / 100)

---

## Production Verdict

> ### ❌ NOT APPROVED FOR PRODUCTION

**A change is required.** This audit does not conclude that everything is correct.

The verdict is not close, but the distance is much shorter than v1's. Lumo is no longer a system that
has never executed — it is a well-architected system whose deployment layer now exists and has never
been exercised. Of the six Critical findings, **four are wiring or configuration** (C2-1 three
environment variables, C2-3 one predicate, C2-5 one Job, C2-6 one guardrail), and two of the nine
High findings are literally single-line fixes (H2-1, H2-2). Only **C2-2 (PSP adapter and webhook
ingress)** is substantial engineering, and only **H2-9 (integration coverage for 33 contexts)** is
substantial verification.

**Sequencing that the evidence dictates:**

1. **C2-1 first.** Nothing else can be verified until the runtime starts. It is also the cheapest fix
   in this document.
2. **C2-5 with or immediately after C2-1** — a booting runtime against an unmigrated database fails
   just as hard, and the failure looks different enough to waste a day.
3. **C2-4 before H2-3.** Mounting zero-trust enforcement exposes the `123456` MFA route to the full
   authenticated surface. This constraint carried over from the v1 investigation and still holds.
4. **H2-1, H2-2, H2-7** next — they are 1-3 lines each, and without them steps 5-7 cannot be observed.
5. **C2-3, H2-4, C2-6** — correctness and guardrails.
6. **H2-9** — integration coverage, which is what converts the persistence work from compile-time
   confidence into evidence.
7. **C2-2** — the PSP adapter and webhook route. The long pole for revenue; everything above it is
   cheaper and should not wait on it.

**On the milestone claims.** Every verifiable claim made for P1.1 through P1.5 held up under
independent re-derivation. The 37/39 durable count is accurate. The 132/132 schema parity is accurate.
The blocker report's account of analytics and platform-console is accurate, and the decision to stop
rather than invent a persistence shape was the right call. The gap between what the milestones
delivered and what production requires is not a credibility gap — it is scope that was never claimed.

---

**Auditor note.** Per the brief, **no code was modified during this audit.** Every finding above cites
a file and line that was opened and read, and the two headline claims (schema parity, per-context
persistence) plus the boot failure were established by execution rather than inspection. Findings
carried forward from v1 were re-verified at this HEAD, not copied.
