# FINAL PRODUCTION READINESS AUDIT — Lumo Platform

**Auditor role:** Independent Principal Software Architect
**Repository:** `C:\Users\abdoh\Claude code\Git\lumo-platform`
**Branch / HEAD:** `main` @ `756bce3` — _feat(orders): gate admin markOrderPaid behind Payments verification (Purchase Saga)_
**Working tree:** clean (`git status --porcelain -uall` → 0 entries)
**Audit date:** 2026-08-04
**Scale audited:** 2,453 tracked files · 1,940 TypeScript files · 305 test files · 39 Prisma schema files · 194 markdown docs · 4 apps · 40 services · 36 packages
**Method:** direct source reading + repository-wide static analysis. Objective gates were _executed_, not assumed: `pnpm arch` and `pnpm test` were run against this working tree. Every finding below cites a file and line that was opened and read. Nothing is inferred from documentation claims — where a document and the code disagree, the code is reported and the document is listed as a documentation defect.

---

## Executive Summary

### Overall production readiness score: **31 / 100**

Lumo is two different codebases wearing one name.

**The inner codebase — domain, application layer, and shared kernel — is genuinely excellent.** The architecture fitness suite passes with **zero violations across 1,531 modules and 6,529 dependencies**. There are **zero `TODO`, `FIXME`, `HACK`, or `XXX` markers in 1,940 TypeScript files**. ~1,800 tests pass across 76 workspace tasks. Bounded contexts are cleanly separated, dependency inversion is real, the domain layer is provably pure, and several individual components (the HTTP request pipeline, the Kafka consumer runtime, the runtime config validator, the collector endpoint, Customer-360) are of a standard I would ship without modification.

**The outer codebase — the composition, deployment, and operational layer that turns that work into a running system — is not production-ready and, in several places, is not runnable at all.**

The three findings that decide this audit:

1. **35 of the 39 bounded contexts wired into the production API run entirely on in-memory repositories.** Every product, order, cart, payment intent, shipment, return, promotion, and notification exists only in the API process's heap and is destroyed on restart or rollout. The Prisma repositories for these contexts _exist and are exported_ — they are simply never constructed. (`apps/admin/src/composition.ts:283-321`)
2. **There is no container image for the runtime, and no workflow that builds one.** The only Dockerfile in the repository builds the storefront. `deploy.yml` and `release.yml` call three reusable workflows — `validate.yml`, `security.yml`, `build.yml` — that **do not exist on `main`**. Both workflows fail at parse time. The platform cannot be deployed by its own pipeline.
3. **The commerce money path has no entry point.** There is no PSP adapter (the only `implements PaymentProvider` is an in-memory stub whose `capture()` is a no-op), `verifyWebhook` has **zero call sites repository-wide**, and Payments' `RecordWebhook` use case is wired into composition but exposed through **no HTTP route**. A PSP cannot reach this platform, and this platform cannot charge a card.

The repository's own gap register agrees. `docs/KNOWN_GAPS.md` lists **G-41 — "First live boot"** as `blocked-on-operator`, and **G-39 — "api serves in-memory data"** as `open`, P1. **This system has never been started once.** Nothing in this audit contradicts that; everything in it corroborates it.

A well-engineered core that has never executed against real infrastructure is a prototype, not a product. The gap is closable — most of the missing pieces are _wiring_, not _implementation_ — but it is not closable before a deployment.

| Severity                     | Count |
| ---------------------------- | ----- |
| Critical (blocks production) | 9     |
| High (fix before production) | 10    |
| Medium (recommended)         | 11    |
| Low (optional)               | 6     |

---

## Critical Issues

### C-1 · 35 of 39 bounded contexts run on in-memory repositories in the production API

**Files:**

- `apps/admin/src/composition.ts:283-321` (the 39 `wireX(deps)` calls)
- `apps/admin/src/composition.ts:125-132` (the `prisma?` doc comment that admits it)
- `apps/runtime/src/api.ts:17-21`
- `services/payments/src/composition.ts:57-76` (representative)
- `services/catalog/src/composition.ts:47-58`

**Evidence.** `wireAdmin` composes 39 contexts. Grepping `prisma` across all 41 `services/*/src/composition.ts` files returns hits in exactly **four**: `customer-360`, `feature-registry`, `finance`, `security`. The two other hits (`catalog`, `orders`) are _prose in comments_, not code:

```
services/catalog/src/composition.ts:79:  * ... Proves the slice in-process; Prisma + a real
services/orders/src/composition.ts:45:  * ... production composition (`apps/runtime`) supplies a real, Prisma-backed
```

`PaymentsWiringDeps` (`services/payments/src/composition.ts:40-44`) declares only `serializer`, `idGenerator`, `clock` — there is no `prisma` field, so passing one is structurally impossible. `wirePayments` then constructs `new InMemoryPaymentIntentRepository(...)` and `new InMemoryUnitOfWork()` unconditionally (lines 68-69). The same shape holds for Catalog, Inventory, Orders, Cart, Checkout, Fulfillment, Shipping, Returns, Notifications, Promotions, Coupons, Loyalty, Wishlist, Reviews, Search, Recommendations, Reporting, Content, SEO, Theme, Components, Experience, Pages, Localization, Media, Tenancy, Licensing, Experimentation, Feature Flags, Automation, Identity, Pricing, Analytics, Platform Console.

The Prisma repositories for these contexts are **written and exported but never constructed**. Cross-referencing every `services/*/src/infrastructure/prisma-*.ts` file against its importers shows that for 32 of them the _only_ importer is the package barrel `src/index.ts` — a re-export with no consumer.

`apps/admin/src/composition.ts:125-132` states this plainly:

> _"The other 35 wired contexts have no Prisma composition branch of their own yet and are unaffected either way — this does not add one for them."_

**Production impact.** Catastrophic and silent. The API accepts writes, returns `201 Created`, emits events, and passes its own e2e tests — while persisting nothing. A rolling deploy (`maxUnavailable: 0, maxSurge: 1`, `infrastructure/k8s/20-deployment-api.yaml:16-18`) destroys all state. Worse, with `replicas: 2` (line 12), the two pods hold **divergent** heaps: a product created on pod A does not exist on pod B, so identical requests return different answers depending on load-balancer routing. Orders would be lost, inventory would be wrong, and payments would reference intents that no longer exist.

**Severity: CRITICAL.**

---

### C-2 · No container image exists for the runtime, and nothing builds one

**Files:**

- `infrastructure/docker/web.Dockerfile` (the only Dockerfile in the repository)
- `infrastructure/k8s/20-deployment-api.yaml:68` — `image: lumo-runtime:local`
- `infrastructure/k8s/21-deployment-worker.yaml`, `22-deployment-scheduler.yaml`
- `apps/runtime/package.json:12-22` (scripts block)

**Evidence.** A recursive filesystem search for `*ockerfile*` across the entire repository (excluding `node_modules`) returns exactly one result: `infrastructure/docker/web.Dockerfile`, whose final stage is `CMD ["node", "apps/storefront/server.js"]` — the Next.js storefront.

All three k8s Deployments reference `image: lumo-runtime:local`. No file in the repository produces that image.

`apps/runtime/package.json` has **no `build` script**. Its scripts are `start:api`/`start:worker`/`start:scheduler`, each `tsx src/*.ts`. Consequently `turbo run build` (the CI "Build" step, `.github/workflows/ci.yml:37-38`) compiles nothing for the runtime.

**Production impact.** The deployment path is non-functional end to end. `kubectl apply -k infrastructure/k8s` will produce three Deployments stuck in `ErrImagePull`/`ImagePullBackOff`. There is no artifact to promote, sign, scan, or roll back to.

**Severity: CRITICAL.**

---

### C-3 · `deploy.yml` and `release.yml` call three workflows that do not exist

**Files:**

- `.github/workflows/deploy.yml:32-33` — `uses: ./.github/workflows/validate.yml`
- `.github/workflows/release.yml:18-19` — `uses: ./.github/workflows/validate.yml`
- `.github/workflows/release.yml:21-22` — `uses: ./.github/workflows/security.yml`
- `.github/workflows/release.yml:24-29` — `uses: ./.github/workflows/build.yml`

**Evidence.** `git ls-files .github` returns exactly three files:

```
.github/workflows/ci.yml
.github/workflows/deploy.yml
.github/workflows/release.yml
```

`validate.yml`, `security.yml`, and `build.yml` are absent. They are not gitignored (`git check-ignore` exits 1 for them). They **did** exist — commit `de46df9` (_"chore(reference): preserve full working tree as a non-canonical reference checkpoint"_) contains `.github/actions/setup/action.yml`, `build.yml`, `db-integration.yml`, `ory-integration.yml`, `security.yml`, and `validate.yml` — but that commit is explicitly documented as a non-canonical snapshot, and none of those files were carried onto `main`.

`release.yml:80-83` also consumes `needs.build.outputs.digest`, an output of the missing `build.yml`.

**Production impact.** Tagging `v1.0.0` produces an immediate workflow-parse failure. The entire H-5 supply-chain chain — cosign keyless signing (`release.yml:56-71`), Trivy scanning of the target digest (`deploy.yml:35-46`), and signature verification before rollout (`deploy.yml:48-63`) — is unreachable. `deploy.yml` cannot even reach its `scan` job. The only workflow that runs is `ci.yml`, which does not build or push an image.

**Severity: CRITICAL.**

---

### C-4 · 36 of 129 Prisma-schema tables have no `CREATE TABLE` in any migration

**Files:**

- `packages/db/prisma/schema/*.prisma` (39 schema files, 129 `@@map`-ed tables)
- `packages/db/prisma/schema/migrations/` (21 migrations, 93 distinct `CREATE TABLE`)

**Evidence.** Extracting every `@@schema(...)` + `@@map(...)` pair from the schema folder yields 129 fully-qualified tables. Extracting every `CREATE TABLE ["IF NOT EXISTS"] "schema"."table"` from all migration SQL yields 93. The set difference is **36 tables declared in the schema with no migration that creates them**:

```
automation.automation_workflows      licensing.merchant_capabilities   reporting.dashboards
components.component_definitions     licensing.merchant_feature_overrides  reporting.report_definitions
content.content_blocks               licensing.plans                   reviews.reviews
coupons.coupons                      licensing.subscriptions           search.search_indexes
experience.experiences               licensing.usage_counters          seo.redirects
experiment.experiments               localization.locales              seo.robots_policies
feature_flags.feature_flags          localization.translation_sets     seo.seo_profiles
licensing.credits                    loyalty.loyalty_accounts          seo.sitemaps
licensing.invoices                   media.folders                     tenancy.tenants
media.media_assets                   pages.pages                       tenancy.workspaces
promotions.promotions                pages.templates                   theme.themes
recommendations.recommendation_models  reporting.analytics_reports     wishlist.wishlists
```

**Production impact.** `prisma migrate deploy` against a fresh production database produces a schema that does not match `schema.prisma`, while `_prisma_migrations` reports "up to date". The generated Prisma Client exposes `prisma.promotion`, `prisma.wishlist`, `prisma.tenant`, etc.; every call fails at runtime with _relation does not exist_. Today this is latent only because those 36 contexts run in-memory (C-1) — meaning **C-1 and C-4 mask each other, and fixing C-1 alone would immediately convert this into a hard runtime failure.** It also means the next `prisma migrate dev` will try to author 36 tables in one unreviewed migration.

**Severity: CRITICAL.**

---

### C-5 · Payments cannot take money: no PSP adapter, no signature verification, no webhook ingress

**Files:**

- `services/payments/src/infrastructure/in-memory-port-adapters.ts:14-36`
- `packages/contracts/src/payment-provider.ts:29`
- `services/payments/src/composition.ts:71`
- `apps/admin/src/interfaces/payments.admin-controller.ts:14`

**Evidence — no real PSP.** `git grep -l "implements PaymentProvider"` returns exactly one file: `services/payments/src/infrastructure/in-memory-port-adapters.ts`. There is no Stripe, Adyen, Braintree, or PayPal adapter anywhere in the repository. The single implementation is:

```ts
async createIntent(request: PaymentIntentRequest): Promise<ProviderIntent> {
  this.counter += 1;
  return { providerIntentId: `psp-intent-${request.orderRef}-${this.counter}` };  // fabricated id
}
async capture(): Promise<void> {
  // Offline stub: no-op. Truth arrives via the webhook, per ADR-0012.
}
async verifyWebhook(): Promise<boolean> {
  return true;                                                    // unconditionally true
}
```

`wirePayments` constructs it unconditionally (`services/payments/src/composition.ts:71`) with no injection seam.

**Evidence — signature verification is never invoked.** `git grep -n "verifyWebhook("` across all `*.ts` returns exactly two lines: the interface declaration (`packages/contracts/src/payment-provider.ts:29`) and the stub implementation. **Zero call sites.** No code path in this repository verifies a PSP webhook signature.

**Evidence — no webhook ingress.** `RecordWebhook` is constructed at `services/payments/src/composition.ts:117` and reachable on `PaymentController.recordWebhook` (`services/payments/src/interfaces/payment.controller.ts:87`), but `apps/admin/src/http/payments-routes.ts` contains **no webhook route**. `apps/admin/src/interfaces/payments.admin-controller.ts:14` confirms: _"`advance` (generic) and `recordWebhook` are saga/PSP-internal, not [exposed]"_. By contrast Shipping and Fulfillment _do_ expose `POST /shipments/:id/webhook` — but behind `permission: "shipping:record_webhook"` (`apps/admin/src/http/shipping-routes.ts:105-113`), i.e. admin RBAC, which no carrier can satisfy.

**Production impact.** The system cannot charge a customer. `createIntent` returns a fabricated identifier that matches nothing at any acquirer; `capture()` silently succeeds without moving money; the platform then records the order as paid. Because ADR-0012 designates the webhook as the source of payment truth and no webhook can arrive, **payment truth can never be established**. If a real PSP adapter were dropped in tomorrow, the unauthenticated-webhook problem would still stand: with zero `verifyWebhook` call sites, any party who discovers the endpoint could forge a capture.

**Severity: CRITICAL.**

---

### C-6 · The purchase saga can never complete — zero `.signal()` call sites, Temporal worker never registered

**Files:**

- `packages/temporal/src/saga/purchase-saga.ts:59-60`, `99-101`
- `apps/runtime/src/worker.ts:11-16, 24`

**Evidence.** The saga blocks on an injected signal:

```ts
// purchase-saga.ts:59-60
/** Injected by the adapter: resolves when the capture webhook's event signals the saga. */
export type CaptureWait = () => Promise<"captured" | "failed" | "timeout">;

// purchase-saga.ts:99-100
// 4. Await capture TRUTH via signal (webhook → outbox event → signal; never a return value).
const capture = await awaitCapture();
```

`git grep -n "\.signal("` across all `*.ts` returns **no matches**. Nothing in the repository ever signals a workflow.

`apps/runtime/src/worker.ts:24` registers exactly one consumer — `buildPaymentCapturedRuntime(runtime)` — and its header comment (lines 12-16) states the Temporal worker is _"blocked honestly on"_ three unbuilt prerequisites. No Temporal worker is started in any entrypoint.

**Production impact.** The durable purchase workflow is unreachable. Combined with C-5 (no webhook can arrive to produce the signal in the first place), the checkout → payment → order path has no working implementation. This corroborates SAGA-2 in the repository's own `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md`, which I re-verified independently.

**Severity: CRITICAL.**

---

### C-7 · The tracking pipeline terminates at Kafka — `ingestTrackingEvent` has zero callers

**Files:**

- `packages/tracking/src/runtime/ingest-runtime.ts:202`
- `apps/collector/src/collector-endpoint.ts:108-116`
- `apps/runtime/src/worker.ts:24`

**Evidence.** The collector correctly publishes to `tracking.event.captured.v1`. `ingestTrackingEvent` is documented as the single entrance to the pipeline (`packages/tracking/src/index.ts:439-442`, and `packages/tracking/src/runtime/ingest-runtime.ts:197-198`: _"The only call to `receiveAndDeliver` in the platform is the one at the bottom of this function"_).

`git grep -n "ingestTrackingEvent"` returns only: the definition, the barrel export, three comments, and one test. **No production caller.** `git grep -n "TRACKING_CAPTURED_TOPIC"` returns only the producer side and the constant's own definition — **no consumer subscribes to the topic**. The runtime worker registers one consumer, and it is the Payments→Orders one.

**Production impact.** Every browser beacon is accepted (`202`), published to Kafka, and never consumed. Validation, normalization, enrichment, identity stitching, attribution, consent enforcement at delivery, and vendor delivery — the entire value of the tracking platform, roughly 48 source files and 234 passing tests — do not execute. Consent gating in particular is enforced inside the pipeline, so no consent decision is ever applied to an outbound vendor call. Kafka retention silently discards the backlog. The failure is invisible: dashboards show ingestion succeeding.

**Severity: CRITICAL.**

---

### C-8 · The outbox is written but never published, and the pruner can never prune

**Files:**

- `apps/runtime/src/scheduler.ts:22-38`
- `packages/messaging/src/outbox/outbox-relay.ts:14-19`
- `services/security/src/composition.ts:310`
- `packages/db/prisma/schema/platform.prisma:10-27`

**Evidence.** In production, CDC is the intended drain — `OutboxRelay`'s own doc says so (_"In production Debezium (CDC) streams the outbox table directly, so this relay is not deployed"_). Debezium is configured (`infrastructure/docker/debezium/outbox-connector.json`, `infrastructure/k8s/70-debezium.yaml`) and its `table.include.list: platform.outbox` **correctly matches** the schema's `@@map("outbox") @@schema("platform")`. That part is right.

The problem is the status column. `markPublished` is called **only** by `OutboxRelay.drainOnce()` (`packages/messaging/src/outbox/outbox-relay.ts:32-35`), and `git grep -n "markPublished"` finds no other production caller. CDC never updates the row. So every row stays `status: 'pending'` forever.

The only scheduled job is:

```ts
// apps/runtime/src/scheduler.ts:31-33
const result = await core.prisma.outboxEntry.deleteMany({
  where: { status: "published", createdAt: { lt: cutoff } },
});
```

This predicate matches **zero rows, permanently**.

Separately, `services/security/src/composition.ts:310` claims _"the OutboxRelay runs in the worker entrypoint in production"_ — `apps/runtime/src/worker.ts` contains no relay. That comment is false.

Compounding this: the 35 in-memory contexts (C-1) use `new InMemoryOutboxStore()` (e.g. `services/payments/src/composition.ts:58`), so their events never reach `platform.outbox` at all and are therefore invisible to CDC regardless.

**Production impact.** Two distinct failures. (a) The `platform.outbox` table grows without bound — the sole retention mechanism is dead code; at commerce volume this exhausts disk and degrades every write touching that table. (b) 35 of 39 contexts publish integration events into a per-process heap that is discarded on restart — cross-context choreography is non-functional.

**Severity: CRITICAL.**

---

### C-9 · The platform has never been booted

**File:** `docs/KNOWN_GAPS.md`

**Evidence.** The repository's own gap register:

| ID   | Description                                                                                                           | Status                |
| ---- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| G-41 | **First live boot** — Docker Desktop needs one interactive GUI start … then runbook → migrate deploy → 9 gated suites | `blocked-on-operator` |
| G-39 | Production context composition behind the admin facade (Prisma-backed `wireX`) — _"api serves in-memory data"_        | `open`                |
| G-19 | OTel spans/metrics wiring                                                                                             | `seam`                |
| G-21 | Coverage gate (80%) + use-case test backfill                                                                          | `open`                |

Corroborated by execution: every `*.integration.test.ts` in the repository is gated on `process.env["DATABASE_URL_TEST"]` (9 files, verified individually), and 70 tests were reported **skipped** in the run I performed — 56 in `customer-360`, 6 in `security`, 3 in `orders`, plus Redis/Kafka/S3 suites. With `db-integration.yml` absent from `main` (C-3), **no integration test has ever executed in CI**, and no Prisma repository has ever been exercised against PostgreSQL in an automated gate.

**Production impact.** Every claim about runtime behaviour in this repository is unvalidated by execution. Migrations have never been applied. Debezium has never been registered. Kafka topics have never been created (`allowAutoTopicCreation: false`, `packages/kafka/src/consumer-runtime.ts:95` — topics must pre-exist via `bootstrap-topics.sh`, never run). Deploying to production would be the first boot ever attempted, in the worst possible environment.

**Severity: CRITICAL.**

---

## High Severity

### H-1 · Production audit trail is in-memory; the correct Prisma adapter exists and is simply not wired

**Files:** `apps/admin/src/http/server.ts:37` · `apps/admin/src/composition.ts:323` · `apps/admin/src/infrastructure/in-memory-audit-trail.ts:8-13` · `packages/db/src/audit/prisma-audit-trail.ts:12` · `apps/runtime/src/api.ts:31-47`

`AdminGuard.ensure` records **every** authorization decision, allow and deny (`apps/admin/src/interfaces/admin-guard.ts:28-34`). The sink resolves as `deps.auditTrail ?? new InMemoryAuditTrail()`. `apps/runtime/src/api.ts` never passes `auditTrail` — it passes `accessControl`, `prisma`, `tenantId`, and `paymentVerification`, but not the audit trail. Production therefore uses:

```ts
// in-memory-audit-trail.ts:8-13 — "append-only, never pruned"
private readonly entries: AuditEvent[] = [];
async record(event: AuditEvent): Promise<void> { this.entries.push(event); }
```

Meanwhile `PrismaAuditTrail` **exists**, is correct (INSERT-only, no update/delete path, ADR-0009-compliant), is exported from `packages/db/src/index.ts:11`, and its table `platform.audit_events` exists with proper indexes (`migrations/20260704000000_init/migration.sql:328,465,468`). `git grep -n "PrismaAuditTrail"` finds **only** the class and its re-export — **zero construction sites**.

**Impact.** (a) Compliance: the SOC2 CC7 / PCI DSS 10.x audit trail is lost on every restart. (b) Reliability: an unbounded in-process array, appended once per authorized request, is a guaranteed memory leak that will OOM the API pod under sustained traffic. The fix is one constructor call.

---

### H-2 · The entire zero-trust security runtime is dead code

**Files:** `apps/runtime/src/security/wire-security-runtime.ts:38, 90` · `apps/runtime/src/security/bootstrap-security.ts:46` · `apps/runtime/src/config.ts:101, 112` · `apps/runtime/src/api.ts` · `apps/runtime/src/worker.ts`

`wireSecurityRuntime`, `buildSecurityHttpGuard`, `bootstrapSecurity`, `SecurityConsumerRuntime`, the principal-provisioning consumers, `wireSecurityEdge`, `EdgeCache`, `wireEntitlement`, and `EntitlementMiddleware` all have **zero callers from any entrypoint**. `api.ts`, `worker.ts`, and `scheduler.ts` import only `./config` and `./composition`; `composition.ts` imports nothing from `./security` or `./entitlement`. The ~45 files under `apps/runtime/src/security/**` and `apps/runtime/src/entitlement/**` are unreachable.

The two config flags that gate this are validated by Zod with a well-designed cross-field rule (`config.ts:154-160`) and then **never read by any code** — `git grep` for `SECURITY_ZERO_TRUST_ENFORCEMENT` and `SECURITY_PRINCIPAL_PROVISIONING` returns only `config.ts` and its own test.

**Impact.** The P2.0 Security Platform (77 source files, 51 events, RBAC/ABAC/ReBAC/PBAC, risk engine, device trust, WORM audit) never participates in a production request. Authorization is `AdminGuard` → Keto only. Setting `SECURITY_ZERO_TRUST_ENFORCEMENT=on` in production would change nothing, which is more dangerous than it not existing — an operator would reasonably believe zero-trust enforcement is active.

---

### H-3 · MFA verification accepts the hardcoded code `123456`, with no injection seam

**Files:** `services/security/src/composition.ts:428-431` · `services/security/src/infrastructure/in-memory-auth-adapters.ts:130-142` · `services/security/src/composition.ts` (`SecurityWiringDeps`)

```ts
// composition.ts:428-431 — unconditional, in BOTH the Prisma and in-memory branches
const passwordProvider = new InMemoryPasswordAuthProvider();
const totpProvider = new InMemoryTotpMfaProvider();
const authProviders = new MapAuthenticationProviderResolver([passwordProvider]);
const mfaProviders = new MapMfaProviderResolver([totpProvider]);
```

```ts
// in-memory-auth-adapters.ts:130-141
export class InMemoryTotpMfaProvider implements MfaProviderPort {
  constructor(private readonly validCode = "123456") {}
  async verify(input: { secretRef: string | null; code: string }): Promise<boolean> {
    return input.code === this.validCode;
  }
}
```

Unlike `kms`, `crypto`, `threatIntel`, `identityDirectory`, `relationshipCheck`, `consentStore`, `identityProjection`, and `sessionRevocation` — all of which have `deps.X ??` override seams — `SecurityWiringDeps` declares **no** `mfaProviders`, `authProviders`, `deviceTrust`, `geoIp`, or `telemetry` field. There is no way to substitute a real provider without editing the composition root.

`wireSecurity` **is** reached in production: `apps/runtime/src/api.ts:41-42` passes `prisma`/`tenantId` through `createAdminHttpApi` → `wireAdmin` → `wireSecurity(deps)`, which takes the Prisma branch (`services/security/src/composition.ts:273`). So this stub is composed into the production graph today.

Same file, same pattern: `geoIp = new InMemoryGeoIp()` (empty lookup table → the risk engine receives no Tor/VPN/reputation/geo signals), `deviceTrust = new InMemoryDeviceTrust(deps.trustedDevices ?? [])` (no device is ever trusted), `telemetry = new InMemorySecurityTelemetry()` (so `OtelSecurityTelemetry`, which exists at `apps/runtime/src/security/security-telemetry-otel.ts:15`, can never be injected).

**Impact.** Authentication bypass if any MFA path becomes reachable. Mitigated _today_ only because H-2 means the Security guard is not the enforcement point — i.e. this is guarded by an accident, not a control. Fixing H-2 without fixing H-3 turns this into a Critical.

---

### H-4 · Every SLO rule, alert, and dashboard queries metrics the runtime never emits

**Files:** `packages/http/src/server.ts:347-358` · `infrastructure/docker/prometheus/rules/slo.recording.rules.yml` · `infrastructure/docker/prometheus/rules/alerts.rules.yml` · `apps/runtime/src/composition.ts:203-217`

The `/metrics` endpoint emits exactly three process gauges:

```ts
// packages/http/src/server.ts:349-355
"# TYPE process_uptime_seconds gauge",           `process_uptime_seconds ${...}`,
"# TYPE process_resident_memory_bytes gauge",    `process_resident_memory_bytes ${memory.rss}`,
"# TYPE nodejs_heap_used_bytes gauge",           `nodejs_heap_used_bytes ${memory.heapUsed}`,
```

`slo.recording.rules.yml` opens with:

> _"SLIs are derived ONLY from metrics the runtime actually exposes (see `apps/runtime/src/metrics.ts`)"_

**`apps/runtime/src/metrics.ts` does not exist.** `git ls-files` for `metrics.ts` returns only `packages/entitlement/`, `packages/kafka/`, and `packages/observability/`. The rules depend on `http_requests_total`, `http_request_duration_ms_sum`, `runtime_ready`, and `messaging_messages_{processed,failed,dead_lettered}_total` — **none of which is emitted anywhere**. `alerts.rules.yml` additionally uses `runtime_dependency_up`, and its own header asserts _"Every alert references a metric the platform actually exposes"_ — false.

The messaging metrics are structurally absent too: `KafkaConsumerRuntime` defaults to `noopMetrics` when `deps.metrics` is omitted (`packages/kafka/src/consumer-runtime.ts:73`), and `buildPaymentCapturedRuntime` (`apps/runtime/src/composition.ts:203-217`) does not pass `metrics`.

**Impact.** Worse than no monitoring — _actively misleading_ monitoring. The availability SLI is `1 - (errors / clamp_min(requests, 1))`; with no series at all this evaluates to **`1`, i.e. "perfectly available"**, permanently. `ApiErrorBudgetFastBurn`, `ApiErrorBudgetSlowBurn`, and `ApiLatencyBudgetBreached` can never fire. Grafana would show a healthy platform during a total outage. `RuntimeNotReady` and `DependencyDown` also never fire (no `runtime_ready`/`runtime_dependency_up`). Only `up{job="lumo-runtime"} == 0` — scrape failure — retains any signal.

---

### H-5 · Retry back-off sleeps in-process on a shared consumer, head-of-line blocking the main topic

**Files:** `packages/kafka/src/consumer-runtime.ts:98-101, 120-124` · `packages/kafka/src/retry-schedule.ts:13-15`

One consumer subscribes to both topics, with no concurrency configured:

```ts
// consumer-runtime.ts:98-101
await consumer.subscribe({ topics: [this.topic, `${this.topic}.retry`], fromBeginning: false });
await consumer.run({ eachMessage: (payload) => this.handleMessage(payload) });
```

and then sleeps inside `eachMessage`:

```ts
// consumer-runtime.ts:121-124
if (retry !== null) {
  const wait = retry.dueAtMs - this.deps.clock.now().getTime();
  if (wait > 0) await this.sleep(wait);
}
```

with `DEFAULT_RETRY_SCHEDULE = [5s, 30s, 2m, 10m, 1h]` (`retry-schedule.ts:13-15`).

`consumer.run` is called without `partitionsConsumedConcurrently`, whose kafkajs default is `1` — so a single `eachMessage` invocation blocks the whole consumer, both topics included.

This directly contradicts the class's own contract, stated twice: _"deliberately replacing `EventConsumer`'s in-process sleep loop, which must never reach a consumer group (ADR-0005 note, G-9: sleeping in `eachMessage` head-of-line blocks the partition)"_ (lines 47-50) and _"The main topic never blocks"_ (line 55). The design intent is correct; the implementation reintroduces exactly the defect it names.

**Impact.** One message on its 5th retry stalls **all** payment-captured processing for a full hour. Kafka will also evict the consumer from its group once `maxPollInterval` is exceeded, triggering a rebalance loop. This is a self-inflicted outage of the only working cross-context flow.

---

### H-6 · Production runs uncompiled TypeScript through `tsx`

**Files:** `infrastructure/k8s/20-deployment-api.yaml:71` · `21-deployment-worker.yaml` · `22-deployment-scheduler.yaml` · `apps/runtime/package.json:12-22, 44`

```yaml
args: ["node", "--import", "tsx", "src/api.ts"]
```

`tsx` is a **devDependency** (`apps/runtime/package.json:44`). `apps/runtime` has no `build` script, so `turbo run build` produces no artifact for it and the CI "Build" step never type-compiles the code that will run.

**Impact.** Type-stripping at runtime with no emitted, verified artifact. Startup cost is high enough that the manifest needs a 90-second startup probe (`failureThreshold: 30 × periodSeconds: 3`) to survive it. A pruned production install (`--prod`) omits `tsx` entirely and the container will not start. `readOnlyRootFilesystem: true` additionally forces the tsx cache into an `emptyDir` at `/tmp`, so every pod pays full transpile cost on every restart.

---

### H-7 · Collector readiness is unconditionally healthy; the collector has no image, manifest, or CI

**Files:** `apps/collector/src/main.ts:67` · `apps/collector/src/server.ts:41-44` · `infrastructure/k8s/kustomization.yaml`

```ts
const health = new HealthRegistry(); // main.ts:67 — no .register() call anywhere
```

`/readyz` runs that empty registry and returns 200 (`server.ts:41-44`). By contrast the runtime registers Postgres and Redis probes (`apps/runtime/src/composition.ts:121-128`).

`infrastructure/k8s/kustomization.yaml` lists namespace, config, api, worker, scheduler, services, autoscaling, networkpolicy, ingress, debezium — **no collector Deployment or Service**. There is no collector image (C-2 applies) and no CI job for it.

**Impact.** The collector reports ready even with Kafka unreachable, so Kubernetes routes beacon traffic to a pod that answers `503 PUBLISH_FAILED` to every request. And because it is not in the kustomization at all, the collector is not deployed by the deployment pipeline — the tracking ingress does not exist in the target cluster. (The endpoint logic itself is excellent — see Positive Findings.)

---

### H-8 · Payment verification is optional and unwired on the event-driven path

**Files:** `services/orders/src/application/mark-order-paid.use-case.ts:35, 60-72` · `apps/runtime/src/composition.ts:196-201` · `apps/runtime/src/api.ts:43-46`

```ts
readonly paymentVerification?: PaymentVerificationPort;   // optional
...
if (this.deps.paymentVerification !== undefined) { /* verify */ }   // skipped when unwired
```

The admin HTTP path wires the real adapter (`api.ts:43-46`). The Kafka consumer path does not:

```ts
// apps/runtime/src/composition.ts:196-201
const markOrderPaid = new MarkOrderPaid({ orders, unitOfWork, idGenerator, clock });
```

The same call omits `metrics` and `unitOfWork` on the `KafkaConsumerRuntime` (lines 203-217), so the atomic idempotency path — which `packages/kafka/src/consumer-runtime.ts:58-63` documents as the one that closes the concurrent-duplicate window — is **off**. The consumer runs the weaker handle-then-record ordering.

**Impact.** An optional security control is a control that will eventually be omitted; this instance already has been. Combined with C-5, "payment truth" has no enforcement on the path that is actually registered in production. There is also no reconciliation job comparing `payment_intents` against orders, so a divergence is undetectable.

---

### H-9 · No integration test has ever run in CI; the entire persistence layer is untested

**Files:** 9 `*.integration.test.ts` files · `.github/workflows/ci.yml` · `packages/db/package.json:16`

Every integration suite is gated on `process.env["DATABASE_URL_TEST"]`:

```
services/customer-360/src/infrastructure/prisma-{session,segment,profile,identity,attribute}-stores.integration.test.ts
services/orders/src/infrastructure/prisma-order-repository.integration.test.ts
services/security/src/infrastructure/prisma-{repositories,identity-projection,consent-projection}.integration.test.ts
```

`ci.yml` provisions no services and sets no `DATABASE_URL_TEST`. `db-integration.yml` and `ory-integration.yml` exist only in the non-canonical reference commit (C-3). My run reported **70 skipped tests**. `packages/db` itself has `"test": "echo \"no tests yet\""`.

**Impact.** Prisma mappers, transaction semantics, optimistic-locking version checks, tenant scoping, unique-constraint behaviour, and outbox atomicity have never been verified against PostgreSQL. The four contexts that _do_ use Prisma in production (C-1) are exactly the ones whose persistence is unproven.

---

### H-10 · OpenTelemetry is never started by any entrypoint

**Files:** `apps/runtime/src/telemetry.ts:14` · `apps/runtime/src/{api,worker,scheduler}.ts`

`startRuntimeTelemetry(config, role)` is well written and correctly no-ops when disabled. It has **no callers** — none of the three entrypoints imports `./telemetry`. `OTEL_TRACES_ENABLED` / `OTEL_METRICS_ENABLED` default to `false` and are read only inside the function nothing calls.

**Impact.** No distributed traces. The OTel Collector, Tempo, and Loki configs under `infrastructure/docker/` receive nothing from the runtime. Combined with H-4, production has neither metrics nor traces — only structured request logs from `packages/http/src/server.ts:118-128`.

---

## Medium Severity

| ID   | Finding                                                                              | Evidence                                                                                                                                                                                                               | Impact                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1  | `RATE_LIMIT_PER_MINUTE` validated but never used; the limit is hardcoded             | `apps/runtime/src/config.ts:37` defines it; `git grep` finds no reader outside `config.ts` + its test. `apps/admin/src/http/server.ts:48` hardcodes `{ limit: 300, windowMs: 60_000 }`                                 | Rate limit cannot be tuned per environment without a code change; operators will set the variable and see no effect                                                                               |
| M-2  | No coverage measurement or threshold anywhere                                        | No `coverage` key in any `vitest.config.ts`; no `--coverage` in any script; no `thresholds` config. `docs/KNOWN_GAPS.md` G-21 open                                                                                     | The mandated 80% bar is unenforced and unmeasured; regressions in untested paths are invisible                                                                                                    |
| M-3  | A `/testing`-namespace serializer is used in the production composition root         | `apps/runtime/src/composition.ts:11,87` — `InMemoryEventSerializer` from `@platform/domain-events/testing`                                                                                                             | Works today (JSON envelope), but a test-namespace import in the production graph is the exact pattern that stops being obviously wrong later; it also means no schema registry / Avro path exists |
| M-4  | Swagger UI and `/metrics` are unauthenticated                                        | `packages/http/src/server.ts:162-163` registers `/docs` + `/openapi.json` unconditionally; `:347` registers `/metrics` with no guard                                                                                   | 352 admin routes with full schemas are enumerable by anyone who can reach the service; `/metrics` leaks process memory/uptime. Depends on ingress posture                                         |
| M-5  | Finance runs in-memory security, forecast, and read models even in its Prisma branch | `services/finance/src/composition.ts:190-192` — constructed _before_ the `if (deps.prisma !== undefined)` at line 194                                                                                                  | Financial read models (trial balance, income statement inputs) are heap-only and lost on restart, despite Finance being one of the four "production-persisted" contexts                           |
| M-6  | `wireAnalytics()` accepts no dependencies at all                                     | `services/analytics/src/composition.ts:21` — `export function wireAnalytics(): WiredAnalytics`; called as `wireAnalytics()` at `apps/admin/src/composition.ts:291`                                                     | Analytics has no persistence seam whatsoever. `ClickhouseAnalyticsReadStore` and `ClickhouseReadModelStore` exist but are never constructed — `@platform/clickhouse` is dead in the runtime       |
| M-7  | Storefront calls a public route that does not exist                                  | `apps/storefront/src/lib/runtime-api.ts` → `/api/v1/public/collections`; `apps/admin/src/http/public-catalog-routes.ts:28-70` defines only products, categories, prices, inventory (deliberately, per its lines 22-26) | Permanent 404 on every render, swallowed to `null` by `fetchList`'s catch — a silent dead call plus a wasted request per page load                                                                |
| M-8  | Architecture fitness checks skip `apps/`                                             | `package.json:20` — `depcruise packages services --config …`                                                                                                                                                           | `apps/admin` (which imports all 40 services) and `apps/runtime` are outside the only automated boundary enforcement. All findings about dead subtrees in `apps/runtime` sit in this blind spot    |
| M-9  | Carrier webhooks require admin RBAC                                                  | `apps/admin/src/http/shipping-routes.ts:105-113`, `fulfillment-routes.ts:79-88` — `permission: "*:record_webhook"`, no `public: true`                                                                                  | No real carrier can authenticate as an admin principal; carrier tracking callbacks cannot be delivered                                                                                            |
| M-10 | CI dependency audit is non-blocking                                                  | `.github/workflows/ci.yml:46-49` — `continue-on-error: true` on `pnpm audit --audit-level high`                                                                                                                        | High-severity advisories cannot fail the build. `docs/KNOWN_GAPS.md` G-31 tracks 8 open advisories                                                                                                |
| M-11 | 8 workspaces have no tests, including the persistence package                        | `@platform/db`, `@platform/contracts`, `@platform/repository`, `@platform/observability`, `@platform/clickhouse`, `@platform/design`, `@platform/ui`, `storefront` — all `"test": "echo \"no tests yet\""`             | `@platform/db` owns the outbox store, processed-event store, dead-letter store, transaction helper, and audit trail — the highest-consequence infrastructure in the repository, with zero tests   |

---

## Low Severity

| ID  | Finding                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-1 | 12 ADRs are cited as authority but do not exist                          | `docs/architecture/adr/` contains 0001–0013 only. Referenced across code and docs: **0018, 0020, 0023, 0024, 0027, 0029, 0031, 0032, 0053, 0055, 0059, 0060**. **136 TypeScript files** cite at least one missing ADR (e.g. `apps/runtime/src/security/edge-zero-trust.ts` ×3, `apps/admin/src/composition.ts` ×2, all six `security-*.admin-controller.ts`). ADR-0023 (Security), ADR-0024 (Finance), ADR-0031 (session federation), ADR-0032 (tracking) are load-bearing and absent |
| L-2 | `docs/PROJECT_STATE.md` is ~5 weeks stale and materially wrong           | Header: _"As of 2026-06-29… Phase 1 COMPLETE (9 of 9 business contexts)"_. The repository contains 40 services and work through Sprint A1                                                                                                                                                                                                                                                                                                                                             |
| L-3 | The storefront is a smoke screen, not a storefront                       | `apps/storefront/src/app/page.tsx:11-13` — _"Foundation smoke-screen (Sprint 0.1) — NOT a business page"_. One page, one layout, one fetch helper. No PDP, cart, checkout, or account surface                                                                                                                                                                                                                                                                                         |
| L-4 | `AdminGuard` is constructed twice per API instance                       | `apps/admin/src/http/server.ts:35-39` and `apps/admin/src/composition.ts:324`. Both receive the same `accessControl`, so behaviour matches — but the two guards write to two different `InMemoryAuditTrail` instances (H-1)                                                                                                                                                                                                                                                           |
| L-5 | MFA recovery codes hashed with unsalted SHA-256                          | `services/security/src/application/mfa.use-cases.ts:138` → `NodeCrypto.hash` (`in-memory-auth-adapters.ts:33-35`). Defensible for high-entropy codes; below the bar for credential material                                                                                                                                                                                                                                                                                           |
| L-6 | Two operational config files assert claims their own contents contradict | `slo.recording.rules.yml` cites a non-existent `apps/runtime/src/metrics.ts`; `alerts.rules.yml` header claims _"Every alert references a metric the platform actually exposes"_ (H-4). `services/security/src/composition.ts:310` claims the relay runs in the worker (C-8)                                                                                                                                                                                                          |

---

## Architecture Findings

**Production-ready.** This is the strongest dimension of the codebase and I found no violation of it.

- **Fitness functions pass cleanly and are real.** I executed `pnpm arch`: `✔ no dependency violations found (1531 modules, 6529 dependencies cruised)`. The eight rules in `.dependency-cruiser.cjs` are not decorative — they enforce no-circular (with a deliberate type-only carve-out), no deep package imports, domain purity, application-layer isolation from messaging and infrastructure, `packages` never importing `apps`/`services`/`edge`, no cross-service internals, and the ADR-0028 Feature Registry freeze.
- **Bounded contexts are genuinely separated.** No service imports another service's internals. Cross-context needs go through ports (`services/orders/src/application/ports.ts:43`) with adapters supplied at the composition root — `PrismaPaymentVerificationAdapter` (`apps/runtime/src/composition.ts:155-171`) queries the `payment_intents` table directly rather than importing `@platform/payments`, keeping Orders and Payments code-decoupled.
- **Dependency inversion is consistently applied.** Every use case depends on interfaces; every infrastructure binding happens in a `wireX` function. This is what makes the in-memory problem (C-1) a _wiring_ defect rather than a _design_ defect — and therefore fixable.
- **Layering is enforced structurally, not by convention.** `packages/http`'s `PermissionGuard` is declared as a _structural twin_ of `AdminGuard` (`packages/http/src/server.ts:44-55`) specifically so packages need not import apps — a correct, deliberate solution.

**The defect is not in the architecture; it is that the composition roots do not honour it.** `apps/admin/src/composition.ts` is a 490-line function that instantiates 39 contexts, of which 35 have no production persistence seam. `apps/runtime/src/api.ts` threads `prisma` into a graph that mostly ignores it. And `apps/` is excluded from the fitness check (M-8), so the blind spot is exactly where the problems are.

One structural risk worth naming: `wireAdmin` composes all 39 contexts eagerly on every API boot, and `buildSecurityHttpGuard` (H-2) would compose Security a _second_ time if it were ever mounted — two independent Security graphs with separate registries and separate in-memory state.

---

## Security Findings

| #   | Finding                                                                         | Location                                                                                                            | Severity       |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| S-1 | Webhook signature verification has **zero call sites** repository-wide          | `packages/contracts/src/payment-provider.ts:29` (declared); `git grep "verifyWebhook("` → 2 hits, both declarations | Critical (C-5) |
| S-2 | Zero-trust enforcement is dead code; its config flags are never read            | `apps/runtime/src/security/wire-security-runtime.ts:90`; `apps/runtime/src/config.ts:101,112`                       | High (H-2)     |
| S-3 | MFA accepts hardcoded `123456`; no injection seam exists                        | `services/security/src/composition.ts:429`; `in-memory-auth-adapters.ts:132`                                        | High (H-3)     |
| S-4 | Audit trail is in-memory in production; the compliant adapter is unwired        | `apps/admin/src/http/server.ts:37`; `packages/db/src/audit/prisma-audit-trail.ts:12`                                | High (H-1)     |
| S-5 | Risk engine receives no geo/threat signals; no device is ever trusted           | `services/security/src/composition.ts:409,425` — empty `InMemoryGeoIp` / `InMemoryDeviceTrust`                      | Medium         |
| S-6 | OpenAPI spec for 352 admin routes served unauthenticated at `/docs`             | `packages/http/src/server.ts:162-163`                                                                               | Medium (M-4)   |
| S-7 | Carrier webhooks gated behind admin RBAC — unusable, and no alternative ingress | `apps/admin/src/http/shipping-routes.ts:108`                                                                        | Medium (M-9)   |
| S-8 | Unsalted SHA-256 for MFA recovery codes                                         | `services/security/src/application/mfa.use-cases.ts:138`                                                            | Low (L-5)      |

**Security controls that are genuinely production-grade and that I verified positively:**

- **Composition fails closed, by design and in code.** `apps/runtime/src/composition.ts:89-93` throws if `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` are unset — _"there is no fake identity provider"_. Lines 111-119 permit permissive authorization **only** when `APP_ENV === "local"`, and throw otherwise: _"KETO_READ_URL is required outside APP_ENV=local (authorization fails closed)"_.
- **`apps/runtime/src/config.ts` is the best file in the repository.** A Zod schema with a `superRefine` that (a) requires the full Ory triad outside `local`, (b) refuses `SECURITY_ZERO_TRUST_ENFORCEMENT` without `SECURITY_PRINCIPAL_PROVISIONING` because enforcement fails closed against an unprovisioned store, and (c) requires the complete credential set for whichever KMS/HSM/threat provider is selected — _"a half-configured provider fails closed at startup rather than silently degrading cryptography"_. This is exactly right.
- **Baseline security headers on every response**, with a correctly-scoped CSP applied only to the pure-JSON `/api/v*` surface and deliberately withheld from `/docs` and `/admin` (`packages/http/src/server.ts:409-417`) — a considered decision, documented in place.
- **No hardcoded secrets.** A repository-wide scan for credential patterns found none. `runtime-api.ts`'s comment records that a previously-hardcoded Hydra client secret was removed and the storefront de-privileged onto genuinely public routes.
- **Correct CORS reasoning in the collector.** `apps/collector/src/main.ts:47-52` refuses a `*` origin at boot because a wildcard cannot be combined with credentialed CORS and would silently break first-party cookies. `server.ts:91-94` echoes only allow-listed origins and sets `Vary: Origin`.
- **Deliberate `trustProxy` handling.** `apps/collector/src/server.ts:63-65` leaves Fastify's `trustProxy` off and resolves the client IP with an explicit trusted-hop count defaulting to `0`, _"because a wrong non-zero value makes the client IP attacker-controlled"_.
- **Kubernetes workloads are hardened.** `runAsNonRoot`, `runAsUser: 1000`, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities: drop: ["ALL"]`, `automountServiceAccountToken: false`, plus a NetworkPolicy (`infrastructure/k8s/50-networkpolicy.yaml`).
- **`kustomization.yaml` deliberately excludes `secret.example.yaml`** so a placeholder Secret can never be applied.
- **The supply-chain design is correct** — cosign keyless signing of the immutable digest, Trivy scan of the target digest, `cosign verify` with a `--certificate-identity-regexp` bound to this repository, GitHub Environments for per-env approval, and rollback on failure. It simply cannot execute (C-3).

---

## Performance Findings

| #   | Finding                                                                               | Location                                                                                         | Impact                                                                                                   |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| P-1 | Unbounded in-memory audit array, appended once per authorized request                 | `apps/admin/src/infrastructure/in-memory-audit-trail.ts:9-13` — _"never pruned"_                 | Guaranteed OOM under sustained traffic (H-1)                                                             |
| P-2 | All 35 in-memory contexts hold their full dataset in the API process heap             | `apps/admin/src/composition.ts:283-321`                                                          | Memory grows monotonically with catalog/order/cart volume; no eviction anywhere                          |
| P-3 | `platform.outbox` grows without bound — the pruner's predicate matches zero rows      | `apps/runtime/src/scheduler.ts:31-33`                                                            | Disk exhaustion; degrading write latency on every outbox-touching transaction (C-8)                      |
| P-4 | Up to 1 hour of in-process sleep inside `eachMessage` on a shared consumer            | `packages/kafka/src/consumer-runtime.ts:121-124`                                                 | Total consumer stall + rebalance loop (H-5)                                                              |
| P-5 | `wireAdmin` eagerly composes 39 contexts and ~352 route handlers on every boot        | `apps/admin/src/composition.ts:282-490`                                                          | Slow cold start — the manifest already needs a 90s startup-probe budget (`20-deployment-api.yaml:74-80`) |
| P-6 | Runtime transpiles TypeScript on every pod start, with the tsx cache on an `emptyDir` | `20-deployment-api.yaml:71`, `readOnlyRootFilesystem: true`                                      | Repeated full transpile cost on every restart and scale-out (H-6)                                        |
| P-7 | `deliveredEventTypes` flattens 36 contexts' arrays on every property read             | `apps/admin/src/composition.ts:480-482` — `get deliveredEventTypes()` calls `flatMap` per access | Minor; a test/demo surface, but it is a getter on a production object                                    |

**Verified clean.** I specifically searched for N+1 query patterns — `await this.prisma.*` inside `for (const …)` loops across every `services/*/src/infrastructure/prisma-*.ts` — and found **none**. `CheckAvailability` (`services/inventory/src/application/check-availability.use-case.ts:44-55`), which the repository's own remediation plan flags as CPI-6 "N+1", is in its current form a **single** `findByProductAndWarehouse` call. I could not reproduce that finding against this HEAD; it appears either fixed or to have referred to a caller-side loop.

**Sensible cost decisions I want to credit:** the rate limiter is a one-round-trip Lua `INCR`+`PEXPIRE`+`PTTL` script with the fixed-vs-sliding-window trade-off documented and priced (`packages/redis/src/rate-limiter.ts:11-19`); the outbox has the right indexes for its access patterns (`platform.prisma:23-24` — `[status, createdAt]` for relay/CDC ordering, `[createdAt]` for pruning); `perf/` contains k6 and node benchmarks, and `services/customer-360/src/application/computed-attributes.bench.ts` plus dedicated `*.stress.test.ts` and `*-memory.test.ts` suites show real performance discipline in that context.

---

## Reliability Findings

| #   | Finding                                                                                | Location                                                                                                                                                   | Impact                                                                                                                            |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | Retry back-off blocks the consumer, contradicting the class's own contract             | `packages/kafka/src/consumer-runtime.ts:98-101,121-124`                                                                                                    | Up to 1h stall of the only live consumer + rebalance loop (H-5)                                                                   |
| R-2 | Collector readiness never fails — empty `HealthRegistry`                               | `apps/collector/src/main.ts:67`                                                                                                                            | Traffic routed to a pod that 503s every beacon (H-7)                                                                              |
| R-3 | Atomic consumer idempotency is available but switched off in production                | `apps/runtime/src/composition.ts:203-217` omits `unitOfWork`; `packages/kafka/src/consumer-runtime.ts:58-63` documents why it matters                      | Concurrent redelivery can double-effect `MarkOrderPaid`                                                                           |
| R-4 | No circuit breaker on any outbound integration                                         | `git grep` for breaker/half-open patterns finds only `apps/runtime/src/security/resilience.ts` and `threat-resilience.ts` — both in the dead subtree (H-2) | A slow PSP/carrier/notification provider propagates latency with no isolation. `docs/KNOWN_GAPS.md` G-10 tracks this as `partial` |
| R-5 | `/readyz` is not flipped to unhealthy before drain begins                              | `apps/runtime/src/api.ts:51-58` — shutdown closes the app immediately                                                                                      | Slightly wider in-flight-request loss window than the 5s `preStop` sleep is designed to cover                                     |
| R-6 | Shutdown handlers have no timeout and never force-exit                                 | `apps/runtime/src/{api,worker,scheduler}.ts`                                                                                                               | A hung `app.close()` or `$disconnect()` waits for SIGKILL at 30s                                                                  |
| R-7 | Kafka topics must pre-exist (`allowAutoTopicCreation: false`) and nothing creates them | `packages/kafka/src/consumer-runtime.ts:95`; `infrastructure/docker/redpanda/bootstrap-topics.sh` is dev-only and not in the k8s path                      | First production boot fails to subscribe (compounds C-9)                                                                          |

**Production-ready reliability mechanisms** — these are correct and I want them recorded as such:

- The retry/DLQ **state machine** in `KafkaConsumerRuntime` is excellent: original bytes republished verbatim to `<topic>.retry` with attempt+due headers, a bounded 5-step schedule, DLQ publish **plus** a durable DLQ row, and always an ack so the partition advances. Only the sleep mechanism (R-1) undermines it.
- `handleAtomic` (`packages/kafka/src/consumer-runtime.ts:179-204`) commits the domain write and the processed-event marker in one transaction and correctly interprets `DuplicateProcessedEventError` as a benign concurrent redelivery. Genuinely subtle work, correctly done.
- Idempotency ordering is the _right_ one, and the reasoning is written down: fast `has` pre-check → handle → atomic `recordIfNew`, because _"recording BEFORE handling would lose a message that crashes between claim and handle"_.
- HTTP idempotency does claim → execute → snapshot → replay, and **releases the claim on failure** so a client's retry path is not poisoned (`packages/http/src/server.ts:300-332`).
- The scheduler is single-flight across instances via a Redis distributed lock keyed per job, and a job failure is logged and retried next tick rather than killing the loop (`apps/runtime/src/scheduler.ts:45-61`).
- The collector returns **503, not 202**, when the Kafka publish fails, with the reasoning recorded in place: _"Telling the browser 'accepted' when the event never reached the bus loses it permanently and invisibly"_ (`apps/collector/src/collector-endpoint.ts:117-139`). It still sets the first-party cookies so the retry does not fragment the session. This is exactly the right call.
- `chaos/` exists with real experiment definitions.

---

## Testing Findings

**Executed, not assumed.** `pnpm test` → **76 successful, 76 total**, exit 0.

| Metric                      | Value                                 |
| --------------------------- | ------------------------------------- |
| Test files                  | 305                                   |
| Tests passing               | ~1,800 across 68 reporting workspaces |
| Tests skipped               | 70 (all infrastructure-gated)         |
| Workspaces with zero tests  | 8                                     |
| Coverage measured           | **None**                              |
| Coverage threshold enforced | **None**                              |
| Integration tests run in CI | **Zero**                              |

**Findings.**

- **T-1 (High, = H-9).** All 9 `*.integration.test.ts` files gate on `DATABASE_URL_TEST`; CI provisions nothing; `db-integration.yml` is absent from `main`. The persistence layer has never been tested against PostgreSQL.
- **T-2 (Medium, = M-2).** No coverage configuration exists anywhere — no `coverage` key in any `vitest.config.ts`, no `--coverage` flag, no thresholds. The 80% bar is unmeasured. `docs/KNOWN_GAPS.md` G-21 concurs.
- **T-3 (Medium, = M-11).** `@platform/db` — outbox store, processed-event store, dead-letter store, transaction helper, audit trail — has zero tests. So do `@platform/contracts`, `@platform/repository`, `@platform/observability`, `@platform/clickhouse`, `@platform/design`, `@platform/ui`, and `storefront`.
- **T-4 (Medium).** No test asserts that production composition uses durable persistence. A single test asserting `wireX({prisma})` yields a Prisma-backed repository would have caught C-1 across 35 contexts. `apps/runtime/src/composition.test.ts` (107 runtime tests) exercises config and graph construction, not persistence identity.
- **T-5 (Medium).** No contract tests for events or APIs (`docs/KNOWN_GAPS.md` G-16, `open`), so producer/consumer schema drift is undetectable.
- **T-6 (Low).** 73 of 76 tasks were **cached** in my run. The suite is fast because Turbo skipped it, not because it is fast — worth knowing when reading CI timings.

**Genuinely strong test work.** `@platform/tracking` has 234 tests. `customer-360` has 336 passing with dedicated replay-safety (`rebuild-computed-attributes.replay-safety.test.ts`), stress (`attribute-dependency.stress.test.ts`, `recalculate-computed-attributes.stress.test.ts`), memory (`computed-attributes-memory.test.ts`) and benchmark suites — that is a level of rigour most production systems never reach. `@platform/security` has 99. The admin e2e suite exercises the real Fastify pipeline in-process, and I can see from its log output that it correctly asserts 401/403/422 boundary behaviour and the Sprint-A1 payment-gating rejection. `services/analytics/src/architecture.test.ts` shows architecture assertions written as tests.

---

## Documentation Findings

| #   | Finding                                                                                  | Evidence                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | 12 referenced ADRs do not exist; **136 TypeScript files** cite at least one              | `docs/architecture/adr/` holds 0001–0013. Missing: 0018, 0020, 0023, 0024, 0027, 0029, 0031, 0032, 0053, 0055, 0059, 0060. ADR-0023 (Security) is cited by every `security-*.admin-controller.ts`; ADR-0024 (Finance), ADR-0031 (session federation), ADR-0032 (tracking) are equally load-bearing |
| D-2 | `docs/PROJECT_STATE.md` is stale and materially wrong                                    | _"As of 2026-06-29 … Phase 1 COMPLETE (9 of 9 business contexts)"_ vs. 40 services at HEAD                                                                                                                                                                                                         |
| D-3 | Operational config files assert claims contradicted by their own repository              | `slo.recording.rules.yml` cites a non-existent `apps/runtime/src/metrics.ts`; `alerts.rules.yml` claims every alert references an exposed metric (H-4); `services/security/src/composition.ts:310` claims the relay runs in the worker (C-8)                                                       |
| D-4 | 26 architecture documents and 10 growth specs describe capabilities with no runtime path | e.g. `09-tracking-and-server-side-tracking.md` and `16/17` describe a pipeline that no consumer invokes (C-7); `13-observability.md` describes metrics that are not emitted (H-4)                                                                                                                  |
| D-5 | `README.md` and `docs/development/SETUP.md` cannot have been validated                   | G-41 (C-9) means the documented setup path has never been executed end to end                                                                                                                                                                                                                      |

**Documentation that is genuinely production-grade** — and unusually good:

- **In-code documentation is the best I have audited.** Comments explain _why_, name the alternative that was rejected, and cite the decision. Examples: _"Fastify's ajv is bypassed for parsing fidelity"_; _"a wildcard cannot be combined with credentialed CORS, and the first-party session cookies would silently stop flowing"_; _"Reusing that server would mean injecting a stub authenticator and a stub guard into a production composition root, which is precisely the kind of fake that stops being obviously a fake three months later"_.
- **`docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md` is exemplary honesty.** It re-verifies 55 prior audit findings line-by-line, records **48 CONFIRMED / 6 confirmed-with-refinement / 0 already-fixed / 0 false-positive**, corrects one of its own prior "verified clean" claims, and states plainly: _"Deployment readiness remains NO until Phase A closes."_ I independently re-verified SAGA-2, PAY-2, and PAY-3 against this HEAD and confirmed all three still hold. I could **not** reproduce CPI-6 (N+1 in `CheckAvailability`) — the current code issues a single query.
- **`docs/KNOWN_GAPS.md` accurately reports the project's own worst news**, including G-41 (never booted) and G-39 (in-memory data). A gap register that names the thing that would most embarrass the project is a sign of a healthy engineering culture.
- ADRs 0001–0013 that _do_ exist are substantive, and `docs/architecture/23-platform-gap-register.md` is maintained as the master ledger with the mirror-both-files discipline documented (D-051).

---

## Positive Findings — explicitly production-grade

These require no changes. I am listing them because an audit that only enumerates defects misrepresents the codebase.

1. **Architecture fitness enforcement.** `.dependency-cruiser.cjs` — 8 substantive rules, executed in CI, **passing with 0 violations over 1,531 modules / 6,529 dependencies**. Verified by execution.
2. **Zero technical-debt markers.** No `TODO`, `FIXME`, `HACK`, or `XXX` in 1,940 TypeScript files. I have not seen this before at this scale.
3. **`apps/runtime/src/config.ts`.** Fail-closed configuration validation with cross-field `superRefine` rules covering the Ory triad, the zero-trust ordering constraint, and complete-or-nothing credential sets per KMS/HSM/threat provider. Production-ready as written.
4. **`packages/http/src/server.ts`.** The full request pipeline — requestId/correlation → authenticate → tenant-resolution-first → authorize through a single injected policy engine → rate limit → zod validation → idempotency claim/replay → uniform error envelope — with security headers, `/healthz`, `/readyz`, and an OpenAPI spec generated from the same Zod schemas that enforce validation, so the spec cannot drift from the enforcement. The `sessionClaim` helper (lines 444-450) reading both `sid` and `session_id` is precisely the kind of cross-IdP detail that is normally found in production, not in review.
5. **`packages/kafka/src/consumer-runtime.ts`.** Retry-topic redelivery, bounded schedule, DLQ publish + durable row, atomic idempotency via `handleAtomic`, always-ack semantics. The design (excluding the sleep mechanism, H-5) is correct and the reasoning is documented in place.
6. **Outbox schema and CDC configuration are correctly aligned.** `platform.prisma:10-27` maps to `platform.outbox`; `outbox-connector.json:14-15` targets `platform.outbox`; column names (`id`, `key`, `payload`, `topic`) match the `EventRouter` transform configuration; indexes match the documented access patterns. Someone checked this properly.
7. **`apps/collector/src/collector-endpoint.ts`.** Transport-neutral by construction, reuses `envelope.eventId` as `messageId` so browser beacon retries dedupe end to end, returns 503 rather than a lying 202 on publish failure, and asserts at runtime that every refusal code is genuinely permanent before telling a browser not to retry.
8. **Composition fails closed on identity and authorization.** `apps/runtime/src/composition.ts:89-119` — no fake IdP, and no permissive authorization outside `APP_ENV=local`.
9. **Kubernetes manifests.** Zero-downtime rollout, topology spread across hosts and zones, pod anti-affinity, startup/liveness/readiness probes correctly differentiated, `preStop` drain, full pod-and-container security context, NetworkPolicy, HPA, and a kustomization that deliberately refuses to apply the example Secret.
10. **`services/customer-360`.** 336 passing tests including replay-safety, stress, memory-growth, and benchmark suites; a real attribute dependency graph with topological ordering and cycle detection; explainability; incremental recomputation; and the only context besides Security with substantial Prisma persistence actually wired.
11. **`packages/db/src/audit/prisma-audit-trail.ts`.** Append-only by contract with no update/delete path, and a documented decision to propagate write failures so an unauditable mutation is rejected. Correct — it only needs to be wired (H-1).
12. **`packages/redis/src/rate-limiter.ts`.** Single-round-trip atomic Lua counter with the fixed-vs-sliding-window trade-off explicitly priced and the replacement path named.
13. **Release and deploy pipeline design.** Cosign keyless signing of immutable digests, Trivy scanning of the deploy target, `cosign verify` bound to this repository's workflow identity, GitHub Environments for per-environment approval, concurrency guards that never interrupt an in-flight deploy, and automatic rollback. The design is right; only its dependencies are missing (C-3).
14. **`docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md` and `docs/KNOWN_GAPS.md`.** Honest, specific, self-critical, and — as I verified by independent re-check — accurate.

---

## Final Verdict

# **NOT READY**

### Justification — repository evidence only

The verdict does not rest on style, preference, or maturity judgement. It rests on four facts, each independently established above by reading source:

**1. The system cannot be deployed.** There is exactly one Dockerfile in the repository and it builds the storefront (C-2). All three k8s Deployments reference `lumo-runtime:local`, which nothing produces. `apps/runtime` has no `build` script. `deploy.yml` and `release.yml` call `validate.yml`, `security.yml`, and `build.yml` — none of which exists on `main`; both workflows fail at parse time (C-3). There is no path from this repository to a running production artifact.

**2. The system does not persist data.** 35 of the 39 bounded contexts wired into the production API construct in-memory repositories (C-1) — a fact `apps/admin/src/composition.ts:125-132` states in its own comment. Orders, payments, carts, inventory, and shipments would be destroyed by every restart and would diverge between the two configured replicas. Separately, 36 of 129 schema tables have no migration (C-4), so a fresh production database would not even have the tables those contexts would need if they were wired — and fixing C-1 without fixing C-4 converts a silent data-loss bug into an immediate runtime crash.

**3. The system cannot take money.** `git grep -l "implements PaymentProvider"` returns one file, and its `capture()` is an empty function while its `verifyWebhook()` returns `true` unconditionally (C-5). `git grep -n "verifyWebhook("` returns **zero call sites**. Payments' `RecordWebhook` is wired into composition but exposed through no HTTP route, so no PSP can reach it. `git grep -n "\.signal("` returns **no matches**, so the purchase saga blocks forever at `await awaitCapture()` (C-6). For an e-commerce platform, this alone is dispositive.

**4. The system has never run.** The repository's own gap register lists **G-41 "First live boot"** as `blocked-on-operator` (C-9). All 9 integration test suites are gated on `DATABASE_URL_TEST`; CI provisions no database and `db-integration.yml` is absent from `main`; 70 tests skipped in the run I executed (H-9). Migrations have never been applied, Debezium has never been registered, and Kafka topics — which must pre-exist, per `allowAutoTopicCreation: false` — have never been created. A production deploy would be this system's first execution, ever.

Two further facts make failure _silent_ rather than loud, which is why I will not soften this verdict to "READY AFTER HIGH-SEVERITY FIXES": events written to the outbox are never marked published and never pruned, so the retention job matches zero rows forever while the table grows without bound (C-8); and every SLO recording rule and alert queries metrics the runtime does not emit, so `sli:api_availability:ratio5m` evaluates to a constant `1` — **the dashboards would show a perfectly healthy platform during a total outage** (H-4). A system that fails invisibly is more dangerous than one that fails loudly.

### What this verdict is not

It is not a judgement on the engineering. The domain modelling, layering, port design, error handling, in-code documentation, and architectural discipline are of a high standard, and the fitness suite and test suite both pass under execution, not assertion. The remediation plan the team wrote about itself is more candid than most external audits.

**The gap is almost entirely composition, deployment, and operational wiring — not design.** `PrismaAuditTrail` exists and needs one constructor call. The Prisma repositories for all 35 in-memory contexts already exist and are exported. `startRuntimeTelemetry`, `wireSecurityRuntime`, and `buildSecurityHttpGuard` are written and need callers. The workflows that vanished from `main` exist verbatim in commit `de46df9`. That is a far better position to be in than the opposite — but the work is real, and it has to happen before, not after, a production deployment.

### Minimum bar to reach "READY AFTER HIGH-SEVERITY FIXES"

All nine Critical issues closed, and G-41 discharged: one successful boot against real PostgreSQL, Redis, and Kafka, with `prisma migrate deploy` applied, Debezium registered, topics created, and the full integration suite executed green in CI.

---

_Audit performed by direct source inspection at `main` @ `756bce3`. `pnpm arch` and `pnpm test` were executed against this working tree; all other findings cite files and line numbers that were opened and read. No finding is asserted on the strength of a document alone._
