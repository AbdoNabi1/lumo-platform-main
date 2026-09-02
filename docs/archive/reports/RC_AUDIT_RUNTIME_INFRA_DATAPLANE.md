# Runtime / Infrastructure / Data-Plane Audit

**Scope:** Read-only static/code audit. No code edited. No containers started. No k8s manifests applied.
**Repo:** `C:\Users\abdoh\Claude code\Git\lumo-platform`
**HEAD at audit time:** `4346c81` (fix(storefront): deploy the storefront to production (M2-6))
**Working tree:** 4 untracked report files (`MEDIUM_REMEDIATION_PLAN.md`, `MEDIUM_VERIFICATION_REPORT.md`, `POST_CRITICAL_VERIFICATION_REPORT.md`, `V1_FINAL_VERIFICATION.md`); no tracked-file modifications.
**Tools used:** `Read`/`Grep` over source, `docker compose ... config --quiet` (syntax-only, no daemon contact required beyond the Docker CLI parser), `kubectl kustomize` (client-side manifest build, no cluster contacted).

---

## PART A — Runtime Wiring Audit

Composition root: `apps/runtime/src/composition.ts` (`buildRuntimeCore`), entrypoint guards split across `apps/runtime/src/api.ts` (HTTP-facing production adapters) and `apps/runtime/src/config.ts` (typed env schema, `superRefine` cross-field validation). Supporting tests: `apps/runtime/src/composition.test.ts`.

All guards share one shape: **local/dev (`APP_ENV=local`) stays permissive with a `logger.warn`; every other `APP_ENV` (`development`/`staging`/`production`) throws synchronously before the process finishes booting** (`startApi`/`buildRuntimeCore` reject before `app.listen()` / before any client connects). None of the guards below have a bypass flag, an env var that disables them, or a code path that skips them for a subset of routes — they gate the whole process at construction time.

### A.1 — Payment Provider adapter selection (V-1)

**Guard:** `apps/runtime/src/api.ts:24-38`, `assertProductionPaymentProviderConfigured`, called unconditionally from `startApi` at `api.ts:135`.

```ts
export function assertProductionPaymentProviderConfigured(appEnv: RuntimeConfig["APP_ENV"]): void {
  if (appEnv === "local") {
    logger.warn(...);
  } else {
    throw new Error(
      "api: no production PaymentProvider is configured. The in-memory stub provider " +
        "(verifyWebhook always returns true) must never accept POST /payments/webhook outside " +
        "APP_ENV=local (V-1). Wire a real PSP adapter into services/payments's wirePayments " +
        "before removing this guard.",
    );
  }
}
```

**Why sufficient:** `services/payments` wires `PaymentProvider` unconditionally to an in-memory stub whose `verifyWebhook()` always returns `true` — there is no real PSP adapter anywhere in the codebase yet. The guard checks only `appEnv`, not adapter identity (no real code path exists to check against, unlike A.5), so it is a blanket boot-time refusal for every non-local environment. **What it does NOT check:** it cannot detect "a real adapter was wired" because none exists — this is a pure environment gate, not an adapter-identity gate. It cannot be bypassed by config (no `PAYMENT_PROVIDER=x` switch exists to satisfy it); the only way past it is code that actually wires a real PSP.
**Test evidence:** `composition.test.ts:129-140` — `assertProductionPaymentProviderConfigured("production")` throws matching `/PaymentProvider/` and `/payments\/webhook/`; stays silent under `"local"`.

### A.2 — Payment webhook verification (M2-7, `PrismaPaymentVerificationAdapter`)

Two independent call sites, both wired to the **real** adapter unconditionally (not env-gated — there is no stub fallback here at all):

- **Admin/API path:** `api.ts:158-161` — `startApi` passes `new PrismaPaymentVerificationAdapter(runtime.prisma, runtime.config.TENANT_DEFAULT_ID)` into `createAdminHttpApi`'s `paymentVerification` dep.
- **Consumer/worker path (the M2-7 fix):** `composition.ts:262-274`, inside `buildPaymentCapturedRuntime` → `MarkOrderPaid` is constructed with:

```ts
paymentVerification: new PrismaPaymentVerificationAdapter(
  core.prisma,
  core.config.TENANT_DEFAULT_ID,
),
```

Adapter implementation (`composition.ts:221-237`):

```ts
async hasCapturedPayment(orderId: string, paymentRef: string): Promise<boolean> {
  const row = await this.prisma.paymentIntent.findFirst({
    where: { id: paymentRef, orderRef: orderId, tenantId: this.tenantId, status: "captured" },
    select: { id: true },
  });
  return row !== null;
}
```

**Why sufficient:** this is a real, tenant-scoped, status-scoped read against the same `payment_intents` table `PrismaPaymentIntentRepository` writes — not a stub. It requires an exact match on `id` AND `orderRef` AND `tenantId` AND `status === "captured"`; a payment captured for a different order, a different tenant, or not yet captured all correctly fail. Both `MarkOrderPaid` call sites (admin action and the event-driven consumer) are wired to this same adapter, so the M2-7 gap ("consumer path omitted the verification gate the admin path already had") is closed on both paths, not just one. **What it does NOT check:** it trusts the `payment_intents` table's own write path — if a bug elsewhere in Payments wrote a `captured` row without an actual PSP capture having occurred, this adapter would (correctly, structurally) treat it as valid; it verifies against the domain's system of record, not against the PSP a second time.
**Test evidence:** `composition.test.ts:183-251` — 5 cases: accepts a genuine match; rejects no-row, mismatched-order, mismatched-tenant, and non-captured-status. `composition.test.ts:83-89` confirms the consumer runtime is built with the correct topic/consumer group.

### A.3 — MFA provider (C2-4)

**Guard:** inlined in `startApi`, `api.ts:120-133`:

```ts
if (config.APP_ENV === "local") {
  logger.warn("MFA is permissive: no production mfaProviders configured, APP_ENV=local");
} else {
  throw new Error(
    "api: no production MfaProviderResolver is configured. The in-memory reference TOTP " +
      "provider (hardcoded validCode) must never answer MFA challenges outside APP_ENV=local " +
      "(C2-4). Pass mfaProviders in createAdminHttpApi's deps once a real provider exists.",
  );
}
```

**Why sufficient:** Security's default MFA provider (`services/security/src/infrastructure/in-memory-auth-adapters.ts`) verifies every challenge against one hardcoded code — not proof of possession. This guard runs before `createAdminHttpApi` is even constructed (`api.ts:135` guards execute before line 145's `createAdminHttpApi` call), so a production boot cannot reach a listening state with the hardcoded-code provider live. **What it does NOT check:** same shape as A.1 — env-only, because no real provider is wired anywhere yet; it cannot distinguish "a real provider is configured" from "none is," it can only refuse every non-local boot.
**Test evidence:** `composition.test.ts:119-127` — `startApi(prodConfig, core)` (APP_ENV=production, Keto configured) rejects with `/MfaProviderResolver/`, proven to reject "before touching the network" (no listener is ever opened).

### A.4 — Licensing billing (financeLedger / payments adapter, M2-3)

**Guard:** `api.ts:53-67`, `assertProductionLicensingBillingConfigured`, called at `api.ts:136`.

```ts
export function assertProductionLicensingBillingConfigured(appEnv: RuntimeConfig["APP_ENV"]): void {
  if (appEnv === "local") {
    logger.warn(...);
  } else {
    throw new Error(
      "api: no production Licensing payments/financeLedger adapter is configured. The in-memory " +
        "stubs (collect() always succeeds, postSettlement() is a no-op) must never back billing " +
        "outside APP_ENV=local (M2-3). Pass payments/financeLedger in createAdminHttpApi's deps " +
        "once real adapters exist.",
    );
  }
}
```

**Why sufficient:** `services/licensing` wires `PaymentsPort`/`FinanceLedgerPort` unconditionally to `InMemoryPaymentsAdapter`/`InMemoryFinanceLedgerAdapter` — `collect()` always "succeeds" and `postSettlement()` is a no-op, meaning a merchant could hold an active paid subscription while zero money is ever actually collected or posted to Finance. Same env-only shape as A.1/A.3 (no real adapter exists yet to check identity against). Blocks boot outside local unconditionally.
**Test evidence:** `composition.test.ts:142-151` — throws `/Licensing/` and `/payments\/financeLedger/` in production; silent in local.

### A.5 — Object Storage / Media (S3, M2-2)

This is the one guard that is **adapter-identity-based**, not just env-based, because a real code path exists (unlike A.1/A.3/A.4).

**Resolution logic** (`composition.ts:176-192`):

```ts
const objectStorage: ObjectStoragePort =
  config.S3_ENDPOINT !== undefined &&
  config.S3_ACCESS_KEY_ID !== undefined &&
  config.S3_SECRET_ACCESS_KEY !== undefined
    ? new StorageServiceObjectStorage(new S3StorageService(createS3Client({...}), config.S3_BUCKET_MEDIA))
    : new InMemoryObjectStorage();
```

**Guard** (`api.ts:81-96`), called at `api.ts:137`:

```ts
export function assertProductionObjectStorageConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  objectStorage: ObjectStoragePort,
): void {
  if (!(objectStorage instanceof InMemoryObjectStorage)) return;
  if (appEnv === "local") {
    logger.warn(...);
  } else {
    throw new Error(
      "api: no production object-storage adapter is configured for Media (M2-2). The in-memory " +
        "stub (exists() always true, getDownloadUrl() a URL template that never points at real " +
        "storage) must never back Media outside APP_ENV=local. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, " +
        "and S3_SECRET_ACCESS_KEY to configure the real MinIO/S3 adapter.",
    );
  }
}
```

**Why sufficient:** the guard checks the _actual resolved instance_ (`instanceof InMemoryObjectStorage`), not just env vars — if the real `StorageServiceObjectStorage` is wired (S3 endpoint + both credentials present), the guard passes even outside local, because the gap it exists to close (`exists()` always `true`, `getDownloadUrl()` a template that never points at real storage) is genuinely closed at that point. If any one of the three S3 env vars is missing, the fallback silently is the in-memory stub, and this guard then fails closed outside local. **What it does NOT check:** it does not verify the S3 endpoint is _reachable_ or that the bucket exists — only that the code path chose the real adapter class over the stub. A misconfigured-but-present S3 endpoint (wrong bucket, unreachable network) would pass this guard and fail later at actual I/O time, not at boot.
**Test evidence:** `composition.test.ts:100-115` (resolves in-memory when unset, real adapter when S3 vars present) and `composition.test.ts:153-180` (guard throws for the stub outside local, stays silent for the stub in local, and does NOT throw outside local once the real adapter is resolved — proving it's adapter-identity-based, not appEnv-only).

### A.6 — Other startup guards found

**A.6.1 — Authorization backend (Keto), `composition.ts:144-162`:**

```ts
let accessControl: AccessControl;
if (config.KETO_READ_URL !== undefined) {
  accessControl = new CachedAccessControl(new KetoAccessControl({...}), redis.cache);
} else if (config.APP_ENV === "local") {
  accessControl = { authorize: async () => true };
  logger.warn("authorization is permissive: KETO_READ_URL unset and APP_ENV=local");
} else {
  throw new Error("KETO_READ_URL is required outside APP_ENV=local (authorization fails closed).");
}
```

Same shape: local-only permissive escape hatch (`authorize: async () => true`), fails closed everywhere else. **Note:** this guard lives inside `buildRuntimeCore` itself (`composition.ts`), so it fires even earlier than the `api.ts`-level guards — before health checks or any HTTP surface exists. Test evidence: `composition.test.ts:71-75` ("FAILS CLOSED outside local when Keto is not configured").

**A.6.2 — Authentication (JWKS issuer), `composition.ts:132-136`:** requires both `AUTH_JWKS_URL` and `AUTH_ISSUER_URL`; throws unconditionally (not even local-permissive — "there is no fake identity provider (D-048)") if either is undefined. This is stricter than every other guard: it has no local escape hatch at all. Test evidence: `composition.test.ts:65-69`.

**A.6.3 — `TENANT_MODE=multi`, `composition.ts:106-112`:** throws unconditionally (any env, including local) because every Prisma repository is pinned to one `tenantId` at construction (ADR-0008) with no per-request re-composition; enabling multi-tenant mode would either silently mis-scope requests or reject them all, neither of which is real multi-tenancy. Test evidence: `composition.test.ts:77-81`.

**A.6.4 — `config.ts` `superRefine` cross-field validation (schema-level, fires before `buildRuntimeCore` even runs):**

- `KETO_WRITE_URL`/`KRATOS_PUBLIC_URL`/`KRATOS_ADMIN_URL` required outside `local` (H-2/G-SEC-4 live identity binding) — `config.ts:178-186`.
- `SECURITY_ZERO_TRUST_ENFORCEMENT=on` is rejected unconditionally (`config.ts:203-212`) with an explicit message that `buildSecurityHttpGuard` is not mounted in any entrypoint — this is a deliberate "don't let the flag lie" guard, not a missing feature silently no-op'ing.
- `SECURITY_ZERO_TRUST_ENFORCEMENT` requires `SECURITY_PRINCIPAL_PROVISIONING=on` first (`config.ts:189-196`).
- Cloud KMS/HSM/threat-intel provider selections (`SECURITY_KMS_PROVIDER`, `SECURITY_HSM_PROVIDER`, `SECURITY_THREAT_PROVIDERS`) each require their full credential set present via `requireKeys()` (`config.ts:213-281`) — a half-configured provider fails config parsing entirely, before any composition code runs.
  Test evidence: `composition.test.ts:39-53` (`DATABASE_URL` missing rejects; `SECURITY_ZERO_TRUST_ENFORCEMENT=on` rejects with the exact "not supported yet" message).

**Worker entrypoint (`apps/runtime/src/worker.ts`) note:** the worker never calls the `api.ts` guards (MFA/PaymentProvider/Licensing/ObjectStorage) because it serves no HTTP surface and doesn't touch those subsystems directly — but it does call `buildRuntimeCore` (so A.6.1/A.6.2/A.6.3/A.6.4 all apply), and its own payment-verification wiring (`buildPaymentCapturedRuntime`, A.2) is unconditionally real, not gated — there is no stub to fail closed against on that path.

**Overall Part A assessment:** every production dependency named in scope has a real, tested, fail-closed guard. Four guards (Payment Provider, MFA, Licensing) are environment-only because no real production adapter exists in the codebase yet for those three subsystems — they correctly block production boot rather than pretend a nonexistent adapter is safe. One guard (Object Storage) is adapter-identity-based because the real adapter does exist and is conditionally wired. This is an honest, consistent pattern, not a false sense of security — the guards convert "nothing installed" into "boot refuses," never into "boots but trusts a stub."

---

## PART B — Infrastructure Audit

Directory: `infrastructure/` — `docker/` (Compose + Dockerfiles), `k8s/` (Kustomize manifests), `ory/` (Keto config).

### B.1 Inventory

| Category                     | Files                                                                                                                                                                                   | Present?                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Dockerfiles                  | `runtime.Dockerfile`, `web.Dockerfile`, `collector.Dockerfile`                                                                                                                          | Yes (3)                                                 |
| docker-compose               | `docker-compose.yml` (full local infra stack), `docker-compose.runtime.yml` (api/worker/scheduler overlay)                                                                              | Yes (2)                                                 |
| k8s Namespace/ServiceAccount | `00-namespace.yaml`                                                                                                                                                                     | Yes                                                     |
| k8s ConfigMap                | `10-config.yaml`, `25-collector-config.yaml`, `27-storefront-config.yaml`, `70-debezium.yaml` (embeds one)                                                                              | Yes (4 total)                                           |
| k8s Deployment               | `20-deployment-api.yaml`, `21-deployment-worker.yaml`, `22-deployment-scheduler.yaml`, `26-deployment-collector.yaml`, `28-deployment-storefront.yaml`, `70-debezium.yaml` (embeds one) | Yes (6 total)                                           |
| k8s Service                  | `30-services.yaml` + one embedded in `70-debezium.yaml`                                                                                                                                 | Yes (6 total)                                           |
| k8s Ingress                  | `60-ingress.yaml` (API, collector, storefront — 3 Ingress objects)                                                                                                                      | Yes (3)                                                 |
| k8s NetworkPolicy            | `50-networkpolicy.yaml`                                                                                                                                                                 | Yes (10 policies: default-deny-all + 9 explicit allows) |
| k8s HPA                      | `40-autoscaling.yaml`                                                                                                                                                                   | Yes (4: api, worker, collector, storefront)             |
| k8s PDB                      | `40-autoscaling.yaml` (co-located with HPA)                                                                                                                                             | Yes (5: api, worker, scheduler, collector, storefront)  |
| k8s Secret                   | `secret.example.yaml` — **template only**, deliberately excluded from `kustomization.yaml`                                                                                              | Yes, template                                           |
| k8s CDC                      | `70-debezium.yaml` (Connect Deployment + Service + registration Job)                                                                                                                    | Yes                                                     |
| Kustomize aggregator         | `kustomization.yaml`                                                                                                                                                                    | Yes                                                     |

### B.2 Verification classification

**Docker Compose — Static Verified.**

- `docker compose -f infrastructure/docker/docker-compose.yml config --quiet` → exit 0, no errors. Command executed; parses/resolves the full local stack (Postgres, Redis, ClickHouse, MinIO, Redpanda, Kafka Connect/Debezium, Apicurio, OTel Collector, Prometheus, Grafana, Loki, Tempo, Mailpit, pgAdmin, RedisInsight) without a running daemon.
- `docker compose -f docker-compose.runtime.yml config --quiet` **alone** fails (`service "scheduler" refers to undefined network data`) — but this is correct behavior, not a defect: `docker-compose.runtime.yml`'s own header comment and `infrastructure/docker/README.md` both document it as an _overlay_ meant to be combined with the base file, never run standalone.
- `docker compose -f docker-compose.yml -f docker-compose.runtime.yml config --quiet` → exit 0, confirming the documented combined invocation is syntactically valid.
- **Not Runtime Verified** — no container was started; Docker Desktop is known broken in this sandbox per prior session findings (`lumo-integration-verification-sprint` memory), and this task explicitly forbids starting containers regardless.

**Dockerfiles — Static Verified.**

- `runtime.Dockerfile`: multi-stage (`base`→`builder`→`runtime`), non-root `USER node`, `tini` as PID 1 (zombie reaping + SIGTERM forwarding), image-level `HEALTHCHECK` hitting `/healthz`, `NODE_ENV=production`, frozen-lockfile install. References real paths (`apps/runtime`, `pnpm-lock.yaml`) that exist in the repo.
- `web.Dockerfile`: separate `dev`/`builder`/`runner` stages, non-root `nextjs` user (uid 1001), Next.js standalone output copied correctly, `HEALTHCHECK` against `/`.
- `collector.Dockerfile`: present, not deep-read in this pass (out of the explicitly-scoped guard list but confirmed to exist).
- These are read-only textual checks; no `docker build` was executed (would require the daemon and is out of scope).

**Kubernetes manifests — Static Verified (strong).**

- `kubectl kustomize infrastructure/k8s` executed successfully (client-side build only, no cluster contacted) → exit 0, produced 41 resources with zero errors: 1 Namespace, 1 ServiceAccount, 4 ConfigMap, 6 Service, 6 Deployment, 5 PodDisruptionBudget, 4 HorizontalPodAutoscaler, 1 Job, 3 Ingress, 10 NetworkPolicy. This proves the entire manifest set is syntactically valid YAML, kustomize-resolvable, and internally consistent (label selectors, resource references) at the tool level.
- Spot-checked `20-deployment-api.yaml`: `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, startup/liveness/readiness probes against real paths (`/healthz`, `/readyz` — confirmed these routes exist in the runtime source via the guard code read in Part A), resource requests/limits set, topology spread + pod anti-affinity, `preStop` drain sleep matching the app's documented graceful-shutdown behavior.
- `50-networkpolicy.yaml`: default-deny-all base with explicit least-privilege allows; comments document two real gaps found and fixed during a prior verification sprint (missing Keto-write/Kratos ports, missing Debezium Connect ingress) — i.e., this file already carries evidence of a prior static cross-reference against `10-config.yaml`.
- `secret.example.yaml`: correctly excluded from `kustomization.yaml` (verified — not listed in `kustomization.yaml`'s `resources:`), so no placeholder secret is ever applied; documents real out-of-band provisioning commands.
- `70-debezium.yaml`: Connect Deployment/Service/registration Job wired to `lumo-cdc-secrets` (out-of-band, same convention), connector config is stated to be byte-identical to the Compose stack's `debezium/outbox-connector.json` (spot-checked: both use `io.debezium.transforms.outbox.EventRouter`, same table/publication/slot names).
- **Not Runtime Verified** — no `kubectl apply`, no live cluster, no pod was ever scheduled. `kubectl kustomize` proves manifest correctness, not runtime behavior (image availability, actual probe success, real Secret contents, DNS resolution of in-cluster service names like `redpanda.data.svc.cluster.local` are all **Not Verifiable** without a live cluster).

### B.3 Gaps/observations (not defects, but worth flagging for the RC report)

- `10-config.yaml`'s `AUTH_ISSUER_URL`/`AUTH_JWKS_URL`/Ory URLs are placeholder `*.lumo.example.com` domains — expected for a template ConfigMap, but confirms no live Ory (Hydra/Kratos/Keto) stack is deployed anywhere in this repo's infra layer; the runtime's fail-closed guards (Part A.6.1/A.6.2/A.6.4) are the only thing currently preventing a boot against these placeholders in a real cluster.
- `docker-compose.runtime.yml` itself documents (in its header comment) that its `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` are placeholders too, since no Ory stack runs in the Compose file either — local/parity Compose boots only because `APP_ENV=local` keeps the A.6.2 JWKS guard's _value_ present (satisfying the "not undefined" check) even though the endpoint is unreachable; an authenticated request would still fail at actual JWKS fetch time. This is disclosed in-file, not a hidden gap.

---

## PART C — Data-Plane Audit

### C.1 Kafka

Wired in `apps/runtime/src/composition.ts:123-126` (`createKafkaClient`, lazy connect). Consumer runtime (`KafkaConsumerRuntime`) used for both the payment-captured consumer (`buildPaymentCapturedRuntime`, `composition.ts:245-294`) and the tracking ingest consumer (`buildTrackingIngestRuntime`, `composition.ts:318-378`), each with its own consumer group, `PrismaProcessedEventStore` (Postgres inbox for idempotency), `DeadLetterPublisher` + `PrismaDeadLetterStore` (DLQ topic + row), and retry publisher. `ConsumerSupervisor` in `worker.ts` registers and starts both. **No known open defect** — this is the platform's most mature data-plane component per the codebase's own comments (payments consumer was the "first real cross-context flow").

### C.2 Outbox pattern

`OutboxWriter` + `PrismaOutboxStore` (`composition.ts:249-255`) — transactional write inside the same Postgres transaction as the domain write (ADR-0003), consumed downstream by CDC (C.3). This is the standard pattern used by every context's `wireX` composition per the codebase's repeated comments (e.g., `PrismaOrderRepository` takes an `outbox` dependency at construction).

### C.3 CDC (Debezium)

Two parallel definitions, confirmed identical in intent:

- Local: `infrastructure/docker/debezium/outbox-connector.json` + `register-connector.sh`.
- k8s: `infrastructure/k8s/70-debezium.yaml` — Connect Deployment + registration Job whose inline curl payload is documented as "byte-identical" to the Compose JSON (spot-checked matching `EventRouter` transform config, publication/slot names `lumo_outbox`).
- **Known prior finding, now closed:** `RUNTIME_COMPOSITION_BLOCKER_REPORT.md`/prior audit trail (per session memory `lumo-p2-0-1-runtime-activation`) identified CDC-on-k8s as a certification blocker (blocker D); `70-debezium.yaml` is the closure artifact. Confirmed present and internally consistent by this audit; **cannot be Runtime Verified** without a live cluster + broker (Not Verifiable here).

### C.4 Redis

Wired in `composition.ts:119-122` (`createRedis`) and consumed by `RedisRateLimiter`, `RedisIdempotencyKeyStore`, `RedisDistributedLock` (`composition.ts:205-207`), plus `redis.cache` backing `CachedAccessControl` (A.6.1) and the admin API's `responseCache`. Health-checked (`composition.ts:171`, `redis.healthCheck()`). **No known open defect.**

### C.5 ClickHouse

Present in the local Compose stack (`docker-compose.yml:31` volume `clickhouse-data`; service defined, confirmed via README's documented endpoint `http://localhost:8123`). A real adapter exists in code — `services/analytics/src/infrastructure/clickhouse-analytics-read-store.ts`, exported from `services/analytics/src/index.ts:38-39` (`ClickHouseAnalyticsReadStore`) — **but it is never imported or wired anywhere under `apps/runtime`** (confirmed: zero matches for `ClickHouse`/`clickhouse` in `apps/runtime`). This matches the session-memory note "ClickHouse/Analytics gated": the adapter exists but the runtime composition root never constructs it. `wireAnalytics()` (per `M2_5_REPORT.md`'s direct-source re-verification) takes zero parameters and builds only an in-memory `SemanticRegistry`. **Status: open gap, not a regression** — this is a documented, deliberate deferral (M2-5 disclosed it as accepted-risk / correctly-scoped-for-now, not a defect to fix), not a newly-discovered defect in this audit.

### C.6 MinIO / Object storage

Local Compose runs MinIO (`docker-compose.yml`, README documents `:9000`/`:9001`, creds `minioadmin`/`minioadmin`). Runtime-side: real adapter (`StorageServiceObjectStorage` wrapping `@platform/storage`'s S3-compatible client) is conditionally wired in `composition.ts:176-192` when `S3_ENDPOINT`+credentials are set (M2-2, see Part A.5) — MinIO is the S3-compatible target in local/parity. **Guard confirmed fail-closed** (Part A.5). No further open defect found for this component beyond what A.5 already covers.

### C.7 Analytics / Platform Console durability

Per `M2_5_REPORT.md` (closed, docs-only, commit `162536f`): both `services/analytics` (`wireAnalytics()`) and `services/platform-console` (`wirePlatformConsole()`) build fresh in-memory state on every process start with zero persistence dependency — by design, since neither context owns an aggregate to back a durable read-model with. This was **investigated and re-verified directly against current source** by the M2-5 remediation (not merely assumed from a prior audit), concluded "correct by design," and closed by adding an operator-facing disclosure to `docs/operations/OPERATIONS_GUIDE.md` ("Known non-durable state" section) — no code changed. **Status: closed, accepted-risk, documented.**

### C.8 Tracking (`packages/tracking`, `@platform/tracking`, ingest runtime)

This is the most complex data-plane finding, spanning three sequential reports:

1. **`K7_FINAL_RECONCILIATION_REPORT.md`** (earlier milestone, referenced but not re-read line-by-line in this pass): established that `main`'s `@platform/tracking` deliberately exports a narrower surface (48 of 87 source files) than a reference checkpoint, withholding `definitions/*`, `execution/*`, `inspector/timeline.ts`, `runtime/{replay-runtime,telemetry}.ts`, `browser/*` for lack of primary-source evidence.
2. **`TRACKING_COMPATIBILITY_REPORT.md`** (2026-08-04, investigation-only, no code changed): confirmed the ingest path (`tracking-ingest.ts` → `ingestTrackingEvent`) compiles clean against `main` **without any of the withheld files**, and recommended "Option A" — close the C-07 defect (nothing consumed the `tracking.event.captured.v1` topic) using only already-present symbols, authoring a writer-only record store and a 4-port-only registry in `apps/runtime` rather than restoring the withheld package files.
3. **Current state (confirmed by this audit's direct read of `apps/runtime/src/composition.ts` and `apps/runtime/src/tracking/*`):** Option A was implemented. `composition.ts:318-378` (`buildTrackingIngestRuntime`) wires a real `TrackingRegistryHandle`/`TrackingRegistryWatcher` (hot-reload), `wireTrackingRuntime()` (`apps/runtime/src/tracking/wire-tracking-runtime.ts`, confirmed present on disk), and a `KafkaConsumerRuntime` consumer registered in `worker.ts:34-41`, config-gated by `TRACKING_INGEST_ENABLED` (default off — the registry must be seeded first). `loadTrackingRegistry` throws on an empty registry rather than starting silently-lossy (`composition.ts:326-329` comment). This matches session memory's "M6 PRODUCTION FOUNDATION COMPLETE" note.
4. **Still deferred, not a regression:** replay, the inspector timeline, and the event/parameter definition registries remain unwired (`composition.ts:308-315` docstring explicitly states this), consistent with `TRACKING_COMPATIBILITY_REPORT.md`'s recommendation — the ingest path was the only thing investigation C-07 required, and it is the only thing wired.

**Status: the specific defect the compatibility report investigated (C-07, "nothing subscribes to the ingest topic") is CLOSED**, via the recommended minimal-scope option, evidenced directly in current composition/worker source — not merely claimed by a report.

### C.9 Purchase saga cross-context activity surface (M2-1 — related data-plane-adjacent finding)

Not explicitly in the Part C component list, but directly relevant to `RUNTIME_R2_INVESTIGATION_REPORT.md`, which this task asked to check: that report (status "nothing landed, fully reverted") found the purchase saga's Temporal activities (`purchase-saga-activities.ts`) reference named use-case exports (`ValidateCheckout`, `CapturePayment`, `CreateOrderFromCheckout`, etc.) that do not exist on the currently-committed shape of `@platform/checkout`/`@platform/payments`/`@platform/orders`/`@platform/notifications`/`@platform/fulfillment`/`@platform/finance` — a cross-package API-shape drift spanning 7 packages, not a small gap. Per `MEDIUM_VERIFICATION_REPORT.md:34-315` and session memory, this is tracked as **M2-1, VERIFIED, still OPEN** (the sole remaining item in the Medium register; everything else — M2-2 through M2-7 — is closed). **No Temporal worker is registered in `worker.ts`** (confirmed: `worker.ts` has no Temporal import — its own comment at lines 20-24 states the Temporal worker "joins this process when its activities become composable," explicitly honest about not being wired yet). This is consistent with — not contradicted by — the R2 investigation's finding.

---

## Summary Classification Table

| Item                                    | Classification                                            | Status                                                             |
| --------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Payment Provider guard (V-1)            | Code-verified, test-verified                              | Fail-closed, confirmed                                             |
| Payment webhook verification (M2-7)     | Code-verified, test-verified                              | Closed on both admin + consumer paths                              |
| MFA provider (C2-4)                     | Code-verified, test-verified                              | Fail-closed, confirmed                                             |
| Licensing billing (M2-3)                | Code-verified, test-verified                              | Fail-closed, confirmed                                             |
| Object Storage (M2-2)                   | Code-verified, test-verified                              | Fail-closed, adapter-identity-based                                |
| Keto authorization                      | Code-verified, test-verified                              | Fail-closed, confirmed                                             |
| JWKS/auth issuer                        | Code-verified, test-verified                              | Fail-closed, no local escape hatch                                 |
| TENANT_MODE=multi                       | Code-verified, test-verified                              | Rejected unconditionally                                           |
| SECURITY_ZERO_TRUST_ENFORCEMENT         | Code-verified, test-verified                              | Rejected unconditionally (guard not mounted)                       |
| Docker Compose (base + runtime overlay) | Static Verified                                           | Valid                                                              |
| Dockerfiles (runtime/web)               | Static Verified                                           | Valid, non-root, healthchecked                                     |
| k8s manifests (all kinds)               | Static Verified (kustomize build succeeded, 41 resources) | Valid                                                              |
| Runtime execution of any container/pod  | Not Verifiable                                            | Docker Desktop broken in sandbox; no cluster; out of scope         |
| Kafka / Outbox / DLQ                    | Code-verified                                             | No known open defect                                               |
| CDC (Debezium, local + k8s)             | Static Verified (config), Not Verifiable (live)           | Present, consistent                                                |
| Redis                                   | Code-verified                                             | No known open defect                                               |
| ClickHouse (Analytics)                  | Code-verified                                             | Adapter exists, NOT wired into runtime — open, deliberate deferral |
| MinIO / S3                              | Code-verified                                             | Wired conditionally, guarded (see M2-2)                            |
| Analytics / Platform Console durability | Code-verified                                             | Closed as accepted-risk, documented                                |
| Tracking ingest (C-07)                  | Code-verified                                             | Closed via minimal-scope Option A                                  |
| Tracking replay/inspector/definitions   | Code-verified                                             | Still deferred, not regressed                                      |
| Purchase saga (M2-1)                    | Code-verified (via prior investigation report)            | Still open, largest remaining gap                                  |
