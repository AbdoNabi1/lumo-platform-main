# RC Validation Report

**Sprint:** RC Validation — Release Candidate Verification
**Date:** 2026-08-07
**HEAD:** `1b4ff76e32b53647e11567f0a27166ac0e0554f2` — _feat(payments): real Stripe PSP integration, replacing dev-only payment adapters (C2-2)_
**Branch:** `main`
**Scope:** Verification only. No features added, no architecture changed, no public API or event contract touched, no refactoring performed.
**Commits produced by this sprint:** none (no fix was required that could be made within this sprint's constraints — see §10).

---

## 0. Executive Summary

All four quality gates pass on a forced, cache-disabled run: **77/77 tasks green across typecheck, lint, test, and arch**, with **1,740 tests across 310 test files** and **zero dependency violations**. Repository health is clean — no duplicate packages, no circular dependencies, no orphan source modules, lockfile in sync.

The platform nevertheless fails RC validation on two independent, empirically proven grounds:

1. **The API process cannot boot under the configuration this repository ships for production.** Executed, not inferred: running `apps/runtime`'s API entrypoint with the exact contents of `infrastructure/k8s/10-config.yaml` exits non-zero at a boot guard (§3.2).
2. **The end-to-end event flow this sprint was asked to validate does not exist past its second hop.** Of the nine legs in the requested chain, one is fully wired (§4).

These are not new defects. Each individual component was correctly built and correctly fail-closed. What this sprint establishes is that they are **not internally consistent with one another** — which is precisely the question an RC validation sprint exists to answer.

**Verdict: NOT READY** (§12).

---

## 1. Repository Health

| Check                       | Result                                 | Evidence                                                                                                               |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Workspace packages          | 80 (4 apps, 40 services, 39 packages¹) | `pnpm-workspace.yaml` globs enumerated                                                                                 |
| Duplicate package names     | **0**                                  | All 80 `package.json` `name` fields grouped; no group size > 1                                                         |
| Lockfile in sync            | **Yes**                                | `pnpm install --frozen-lockfile --lockfile-only` → exit 0, "Already up to date"; `pnpm-lock.yaml` unmodified afterward |
| Circular dependencies       | **0**                                  | `depcruise` `no-circular` rule, 1,536 modules / 6,687 dependencies                                                     |
| Circular deps incl. `apps/` | **0**                                  | Extended cruise: 1,787 modules / 7,517 dependencies, zero violations                                                   |
| Orphan source modules       | **0 real**                             | See §1.2                                                                                                               |
| Dead runtime packages       | **3**                                  | See §1.1                                                                                                               |
| Working tree                | Clean of source changes                | `git status --short` → 9 untracked root-level `.md` reports only                                                       |

¹ 80 workspace projects contain package manifests; `pnpm` reports 81 projects including the root.

### 1.1 Dead workspace packages (pre-existing, unchanged)

Three workspace packages have **zero importers** in any `.ts` file repository-wide:

| Package              | Location            | Status                                                                                                                                                                                          |
| -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@platform/temporal` | `packages/temporal` | Zero importers. Contains the purchase saga (`runPurchaseSaga`, `startPurchase`, `createPurchaseWorker`) — all three symbols are referenced only inside the package itself and in documentation. |
| `@platform/grpc`     | `packages/grpc`     | Zero importers.                                                                                                                                                                                 |
| `@platform/example`  | `services/example`  | Reference/walking-skeleton service, explicitly non-business.                                                                                                                                    |

This is finding **L2-1**, previously recorded in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md:683`. Re-verified this pass: **unchanged**. It is also the mechanism behind deferred finding M2-1 (§9).

### 1.2 Orphan-module check (no gate covers this today)

The `.dependency-cruiser.cjs` configuration defines **no `no-orphans` rule**, so orphan detection is not part of `pnpm arch`. An explicit ad-hoc cruise was run to close the gap. After excluding `.next/` build artifacts, two candidates surfaced, **both false positives**:

- `packages/prettier-config/index.mjs` — a config package resolved by Prettier's config loader, not by module import. Correct as-is.
- `apps/storefront/src/lib/runtime-api.ts` — imported at `apps/storefront/src/app/page.tsx:10` via the `@/lib/runtime-api` TypeScript path alias, which the ad-hoc cruise config did not resolve.

**No genuine orphan source modules exist.**

### 1.3 Architecture-gate coverage gap (informational)

`package.json`'s `arch` script cruises `packages services` — it does **not** include `apps/`. Re-running the same ruleset with `apps` added yields **zero violations** (1,787 modules / 7,517 dependencies), so the gap is currently benign: `apps/` complies with rules that are not enforced against it. Flagged for awareness only; widening the gate is a change and is therefore out of this sprint's scope.

---

## 2. Quality Gate Results

All gates run fresh with caching disabled (`turbo --force`; `Cached: 0 cached` confirmed in every log).

| Gate      | Command                       | Result            | Tasks                      | Wall time | Turbo time |
| --------- | ----------------------------- | ----------------- | -------------------------- | --------- | ---------- |
| Typecheck | `turbo run typecheck --force` | **PASS** (exit 0) | 77/77 successful, 0 cached | 140.82 s  | 2m19.552s  |
| Lint      | `turbo run lint --force`      | **PASS** (exit 0) | 77/77 successful, 0 cached | 71.98 s   | 1m10.662s  |
| Test      | `turbo run test --force`      | **PASS** (exit 0) | 77/77 successful, 0 cached | 140.97 s  | 2m19.72s   |
| Arch      | `pnpm run arch`               | **PASS** (exit 0) | 0 violations               | 14.71 s   | —          |

**Test detail:** 310 test files passed, 14 skipped (324 total). **1,740 tests passed, 78 skipped, 0 failed.** The string `failed` does not appear anywhere in the test log.

**Arch detail:** `✔ no dependency violations found (1536 modules, 6687 dependencies cruised)`.

**Warnings:** none emitted by any gate. (Log noise from PowerShell's `NativeCommandError` wrapper around `pnpm` stderr is a shell artifact, not a tool warning.)

### 2.1 What the 78 skipped tests are

Every skipped test is a **Docker-gated integration test**. All 14 files:

| File                                             | Tests |
| ------------------------------------------------ | ----- |
| `prisma-segment-stores.integration.test.ts`      | 22    |
| `prisma-attribute-stores.integration.test.ts`    | 10    |
| `prisma-identity-stores.integration.test.ts`     | 10    |
| `prisma-session-stores.integration.test.ts`      | 8     |
| `prisma-profile-stores.integration.test.ts`      | 6     |
| `prisma-repositories.integration.test.ts`        | 4     |
| `redis-adapters.integration.test.ts`             | 4     |
| `storage.integration.test.ts`                    | 4     |
| `prisma-order-repository.integration.test.ts`    | 3     |
| `s3-object-storage.integration.test.ts`          | 3     |
| `prisma-consent-projection.integration.test.ts`  | 1     |
| `prisma-identity-projection.integration.test.ts` | 1     |
| `kafka-runtime.integration.test.ts`              | 1     |
| `keto-relationships.integration.test.ts`         | 1     |

**Consequence for RC:** the green test gate proves domain, application, and transport correctness. It proves **nothing** about behaviour against real Postgres, Kafka, Keto, Redis, or S3 — every test that would do so is skipped. Docker Desktop is confirmed non-functional in this sandbox (consistent with prior sessions), and this sprint is read-only, so no attempt was made to work around it. This is an **evidence gap, honestly labelled**, not a failure.

---

## 3. Runtime Health

### 3.1 Boot guard inventory

Seven fail-closed guards were verified by direct source read. Their semantics differ in an important way:

| Guard                    | Location             | Shape                                                                | Behaviour outside `local`      |
| ------------------------ | -------------------- | -------------------------------------------------------------------- | ------------------------------ |
| JWT / JWKS               | `composition.ts:146` | Unconditional, **no local escape hatch**                             | Throws always if unset         |
| `TENANT_MODE=multi`      | `composition.ts:120` | Unconditional, every env                                             | Throws                         |
| Keto authorization       | `composition.ts:173` | Env-gated                                                            | Throws                         |
| Payment Provider (V-1)   | `api.ts:25`          | **Conditional** — returns early if a provider is resolved            | Throws only while unconfigured |
| Object Storage (M2-2)    | `api.ts:86`          | **Conditional** — returns early if adapter ≠ `InMemoryObjectStorage` | Throws only while unconfigured |
| MFA (C2-4)               | `api.ts:130`         | **Unconditional** — checks `APP_ENV` only                            | **Throws always**              |
| Licensing billing (M2-3) | `api.ts:58`          | **Unconditional** — checks `APP_ENV` only                            | **Throws always**              |

The last two accept no injected dependency that could satisfy them. `startApi` never passes `payments`/`financeLedger` to `createAdminHttpApi` (`api.ts:150-174`), and the guard would not consult them if it did.

This is correct, deliberate engineering: no real MFA provider and no real Licensing billing adapter exist, so refusing to boot is the right behaviour. It is documented as intentional in the source and pinned by tests — `api.v1-guard-regression.test.ts:8` states outright that "the MFA guard throws unconditionally outside `local`."

### 3.2 Empirical boot test — **FAIL**

A temporary probe was placed in `apps/runtime/src`, executed, and deleted in the same command (working tree confirmed clean afterward). It loaded the runtime with the **verbatim contents of `infrastructure/k8s/10-config.yaml`** plus the two Secret-supplied credentialed URLs, then invoked `startApi` — the exact call the k8s Deployment makes.

```
STEP 1 loadRuntimeConfig : OK — schema accepts 10-config.yaml verbatim
STEP 2 buildRuntimeCore  : OK — composition graph built
STEP 3 startApi          : THREW -> Error: api: no production MfaProviderResolver is configured.
                           The in-memory reference TOTP provider (hardcoded validCode) must never
                           answer MFA challenges outside APP_ENV=local (C2-4).
```

Process exit code: **7**.

**The deployment chain, each link verified:**

1. `infrastructure/k8s/20-deployment-api.yaml:71` → `args: ["node", "--import", "tsx", "src/api.ts"]`
2. `infrastructure/k8s/20-deployment-api.yaml:75` → `envFrom:` the `lumo-runtime-config` ConfigMap
3. `infrastructure/k8s/10-config.yaml:13` → `APP_ENV: "production"`
4. `apps/runtime/src/api.ts:130-138` → MFA guard throws
5. `apps/runtime/src/api.ts:189-193` → error caught, `process.exitCode = 1`

**Four independent guards** reject the shipped production configuration — not one:

| Guard                    | Why it rejects the shipped config                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| MFA (C2-4)               | Unconditional outside `local`; no provider exists to inject                                         |
| Licensing billing (M2-3) | Unconditional outside `local`; no adapter exists to inject                                          |
| Payment Provider (V-1)   | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` appear **nowhere** in `infrastructure/`               |
| Object Storage (M2-2)    | `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` appear **nowhere** in `infrastructure/` |

The last two are notable: C2-2 (real Stripe) and M2-2 (real S3/MinIO) both built genuine, conditional code paths that _can_ be satisfied — but neither remediation was ever represented in the deployment manifests. The capability exists in code and is unreachable from the shipped infrastructure.

**Operational consequence in a real cluster:** the `runtime-api` Deployment (`replicas: 2`, HPA `minReplicas: 2`) enters CrashLoopBackOff on every pod. The `readinessProbe` on `/readyz` never passes, so the `runtime-api` Service never acquires endpoints, and the `api.lumo.example.com` Ingress routes to nothing.

### 3.3 Other entrypoints

| Process      | Boots under shipped k8s config? | Notes                                                                                                                                                           |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`        | **No** — proven above           | Sole blocked process                                                                                                                                            |
| `worker`     | Yes                             | `worker.ts` has no fail-closed guards of its own                                                                                                                |
| `scheduler`  | Yes                             | Leader-elected singleton; PDB correctly uses `maxUnavailable: 1` rather than `minAvailable: 1`                                                                  |
| `collector`  | Yes                             | Refuses to boot on a wildcard CORS origin — a correct guard                                                                                                     |
| `storefront` | Yes                             | Degrades gracefully: `runtime-api.ts:65-77` swallows all fetch failures and returns `null`, so pages render fallbacks rather than erroring when the API is down |

The asymmetry matters: the worker will run and consume events while the API crash-loops. The storefront will serve pages that silently contain no catalog data.

---

## 4. Event Flow Validation — **FAIL**

### 4.1 Structural fact

`apps/runtime/src/worker.ts` is the **sole consumer host** in the repository (`ConsumerSupervisor` is instantiated nowhere else). It registers exactly three things:

| Registration                  | Line           | Gate                              | Shipped k8s state                              |
| ----------------------------- | -------------- | --------------------------------- | ---------------------------------------------- |
| `buildPaymentCapturedRuntime` | `worker.ts:34` | none — always on                  | **Active**                                     |
| Tracking ingest               | `worker.ts:41` | `TRACKING_INGEST_ENABLED`         | **Off** (`10-config.yaml:46` = `"false"`)      |
| Security provisioning         | `worker.ts:50` | `SECURITY_PRINCIPAL_PROVISIONING` | **Off** (absent from ConfigMap → defaults off) |

Any consumer not registered here is unreachable by construction.

### 4.2 Requested chain vs. reality

| #   | Leg                             | Status        | Evidence                                                                                                                                                                            |
| --- | ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Checkout → Payment              | **NOT WIRED** | Orchestration lives in `@platform/temporal`; `startPurchase`/`runPurchaseSaga`/`createPurchaseWorker` have zero callers outside the package. This is deferred finding M2-1.         |
| 2   | Payment → Webhook               | **WIRED**     | `payments-webhook-routes.ts` calls `verifyWebhook` directly (a webhook carries no admin Bearer token). Real Stripe HMAC verification (§6.3). Unreachable while the API cannot boot. |
| 3   | Webhook → Verification          | **WIRED**     | `RecordWebhook` + `PrismaProcessedWebhookStore` — replay-safe dedup, unique on `(tenant, provider, event)`.                                                                         |
| 4   | Verification → Order Paid       | **WIRED**     | `PaymentCapturedConsumer` → `MarkOrderPaid`, both admin and consumer paths gated by `PrismaPaymentVerificationAdapter` (M2-7).                                                      |
| 5   | Order Paid → Licensing          | **NOT WIRED** | `services/licensing` defines **no** event consumer — zero `EventHandler` implementations.                                                                                           |
| 6   | Licensing → Tracking            | **DISABLED**  | Consumer exists and is well-built, but gated off in the shipped ConfigMap.                                                                                                          |
| 7   | Tracking → Analytics            | **NOT WIRED** | No consumer. `ClickHouseAnalyticsReadStore` exists but is never imported under `apps/runtime`; Analytics runs in-memory.                                                            |
| 8   | Analytics → Customer 360        | **NOT WIRED** | `services/customer-360` defines **no** `EventHandler`.                                                                                                                              |
| 9   | Customer 360 → Platform Console | **NOT WIRED** | No consumer.                                                                                                                                                                        |

**One of nine legs is fully operational.** Legs 2–4 form a working segment, but its entry point (leg 1) and its continuation (leg 5 onward) do not exist.

### 4.3 Consumers defined but never registered

Across all 40 services, only four define event consumers at all:

| Service    | Consumers                                                                                                                                                                                                                 | Registered?            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `orders`   | 1 (`PaymentCapturedConsumer`)                                                                                                                                                                                             | **Yes**                |
| `finance`  | 8 (`OrdersPlacedConsumer`, `OrdersPaidConsumer`, `PaymentsCapturedConsumer`, `RefundsIssuedConsumer`, `ReturnsAcceptedConsumer`, `InventoryAdjustedConsumer`, `PricingChangedConsumer`, `MarketingSpendRecordedConsumer`) | **No — zero callers**  |
| `security` | 8 across 4 files                                                                                                                                                                                                          | Config-gated **off**   |
| `example`  | 1                                                                                                                                                                                                                         | Dead reference service |

Finance's eight consumers — the entire revenue-recognition and settlement path — are referenced only by their own definition file.

**Topic coverage:** `bootstrap-topics.sh` provisions **19 business topics**. Exactly **one** (`payments.payment_intent.captured.v1`) has a registered consumer. `orders.order.paid.v1` is produced through the outbox and consumed by nothing.

### 4.4 Ordering, idempotency, duplication, loss

On the one wired leg these properties are **sound and well-engineered**, verified by source read:

- **No lost events** — `OutboxWriter` writes to `platform.outbox` inside the same Postgres transaction as the aggregate (ADR-0003); Debezium's `EventRouter` relays to Kafka; `platform.outbox` is confirmed in the `lumo_outbox` publication.
- **No duplicate effects** — `PrismaProcessedEventStore` provides inbox idempotency per consumer group. Beyond it, `PaymentCapturedConsumer` treats an order already in `paid`/`payment_received` as idempotent success.
- **Ordering** — an out-of-order capture (arriving before `order.placed`) throws and is retried with backoff, absorbing the cross-context race rather than failing.
- **Failure containment** — genuine anomalies (e.g. capture after refund) throw and reach the DLQ via `DeadLetterPublisher` + `PrismaDeadLetterStore` for operator triage; never silently swallowed.

**These properties cannot be validated end-to-end**, because there is no end-to-end flow to validate. They are also not validated against a live broker — `kafka-runtime.integration.test.ts` is among the 78 skipped tests (§2.1).

One brittleness worth recording: duplicate detection in `payment-captured.consumer.ts:55-59` matches on **error-message substrings** (`'from status "paid"'`). It is pinned by unit tests, but a reworded domain error would silently convert idempotent successes into DLQ entries. Pre-existing; Low.

---

## 5. Infrastructure Health

**Structurally consistent. Incomplete for the code it deploys.**

| Check                          | Result                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `kubectl kustomize .`          | **Builds clean, exit 0**                                                                                                      |
| Resource count                 | 42 (excluding the deliberately unlisted `secret.example.yaml`)                                                                |
| Service ↔ Deployment selectors | Consistent across all 5 (`runtime-api`, `runtime-worker`, `runtime-scheduler`, `collector`, `storefront`)                     |
| Named ports                    | `targetPort: http` resolves in all 5; probes use the same named port                                                          |
| Health probes                  | `startupProbe` + `livenessProbe` on `/healthz`, `readinessProbe` on `/readyz`                                                 |
| HPA                            | 4 (api 2–10, worker 2–6, collector 2–10, storefront 2–10). None for scheduler — correct for a leader-elected singleton.       |
| PDB                            | 5. Scheduler uses `maxUnavailable: 1` with an explicit comment that `minAvailable: 1` would wedge drains — correct reasoning. |
| Ingress                        | 3, each with TLS, `ssl-redirect`, HSTS (2-year, includeSubDomains, preload), TLSv1.2/1.3 only                                 |
| NetworkPolicy                  | Ports match the config's requirements (Keto 4466/4467, Kratos 4433/4434) — closed at `995e3b2`                                |
| CDC                            | k8s connector config matches the compose config; `EventRouter` transform, `lumo_outbox` publication                           |
| Secrets                        | Provisioned out-of-band; `secret.example.yaml` deliberately excluded from `kustomization.yaml`                                |
| Storefront → API               | `RUNTIME_API_URL: http://runtime-api.lumo-runtime.svc.cluster.local:3080` — matches the Service                               |

**Gap (see §3.2):** `infrastructure/` contains no `STRIPE_*` and no `S3_*` configuration. The Secret template supplies only `DATABASE_URL`, `REDIS_URL`, and `COLLECTOR_WRITE_KEYS`. The C2-2 and M2-2 remediations are therefore not reachable from any shipped deployment path.

**Not verifiable:** no container or pod was executed. Docker Desktop is confirmed broken in this sandbox and no cluster is available. `kubectl kustomize` proves manifest validity and reference resolvability — it does not prove image availability, probe success, real Secret contents, or in-cluster DNS.

---

## 6. Security Health

**Pass.** No new security finding.

| Control                | Status       | Evidence                                                                                                                                                                                                                                                       |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT                    | **Verified** | Bearer extraction (`server.ts:450`), JWKS verification; `AUTH_ISSUER_URL` + `AUTH_JWKS_URL` required unconditionally — "there is no fake identity provider"                                                                                                    |
| Kratos                 | **Verified** | `KRATOS_PUBLIC_URL`/`KRATOS_ADMIN_URL` required outside `local` via Zod `superRefine` (`config.ts:187-195`)                                                                                                                                                    |
| Keto                   | **Verified** | `KETO_READ_URL`/`KETO_WRITE_URL` required outside `local`; fails closed at composition before any HTTP surface exists                                                                                                                                          |
| Session claim handling | **Verified** | Reads both `sid` and `session_id` (P2.0.3) — the Kratos divergence bug is fixed                                                                                                                                                                                |
| Webhook verification   | **Verified** | `webhook-signature.ts`: HMAC-SHA256, replay-window check, **length pre-check before `timingSafeEqual`** (which throws on unequal-length buffers), constant-time compare, all rejection paths return `false`                                                    |
| CSP                    | **Verified** | `default-src 'none'; frame-ancestors 'none'` scoped to `/api/v*`; deliberately unset for `/docs` (Swagger inline assets) and `/admin`                                                                                                                          |
| Other headers          | **Verified** | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, HSTS 1 year                                                                                                                                                        |
| CORS                   | **Verified** | Collector echoes only allow-listed origins, sets `Vary: Origin`, and **refuses to boot on a `*` origin** (wildcard is incompatible with credentialed CORS). The runtime API has no CORS layer — correct for a Bearer-token API with no browser-origin callers. |
| Rate limiting          | **Verified** | Redis-backed, keyed per principal/tenant (`server.ts:313-320`)                                                                                                                                                                                                 |
| Secrets loading        | **Verified** | No secret material in any committed manifest; `secret.example.yaml` carries `REPLACE_ME__` placeholders and is excluded from the kustomization                                                                                                                 |
| Boot guards            | **Verified** | All seven fail closed (§3.1) — and are the direct cause of §3.2                                                                                                                                                                                                |

**One defense-in-depth observation (Low, not exploitable today):** `apps/admin/src/composition.ts:374` defaults to `AllowAllAccessControl` when no `accessControl` is injected. The runtime always injects Keto-backed access control (`api.ts:154`), and composition fails closed without `KETO_READ_URL`, so no reachable path is permissive. Still, a **default** that fails _open_ is the wrong polarity for an authorization decision point. Recorded, not fixed — changing it is out of this sprint's scope.

---

## 7. Documentation Audit — drift found

| #   | Drift                                                                                                                                                                                                                                                                                                                                                                                                                           | Severity   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D-1 | `FINAL_PRODUCTION_READINESS_REPORT.md:196,242,263` cites the test gate as **"145/145 tests, 30/30 test files"** and uses it as headline verdict evidence. That is `apps/runtime` **alone** — the "30/30 test files" matches that package exactly. The repo-wide gate is **310 files / 1,740 tests** across 77 tasks. The conclusion ("gates are green") is correct; the supporting number understates the suite by roughly 12×. | **Medium** |
| D-2 | Same report: `pnpm typecheck` / `pnpm test` recorded as **"76/76 tasks"**; actual is **77/77**.                                                                                                                                                                                                                                                                                                                                 | Low        |
| D-3 | Same report: arch recorded as **"1,531 modules / 6,676 dependencies"**; actual is **1,536 / 6,687**.                                                                                                                                                                                                                                                                                                                            | Low        |
| D-4 | Same report §6: Kubernetes manifests recorded as **"41 resources"**; actual is **42**.                                                                                                                                                                                                                                                                                                                                          | Low        |
| D-5 | `docs/operations/DEPLOYMENT_GUIDE.md` (72 lines) and `docs/operations/PRODUCTION_CHECKLIST.md` (43 lines) **never mention** `APP_ENV`, the fail-closed guards, MFA, Licensing billing, or Stripe. Both contain step-by-step "Deploy to Kubernetes" instructions. An operator following them lands in CrashLoopBackOff with no forewarning anywhere in the operational documentation.                                            | **High**   |
| D-6 | Nine audit/report `.md` files sit untracked at the repository root and are not part of the committed record, including `FINAL_PRODUCTION_READINESS_REPORT.md` — the document carrying the current READY FOR RC verdict.                                                                                                                                                                                                         | Low        |

**Consistent, no drift found:** ADRs (14 files) match implemented behaviour where checked; `docs/AI_CONTEXT.md` and `docs/DECISIONS.md` correctly describe `@platform/temporal` as a frozen/unwired design; `docs/investigations/C-06-saga-cannot-complete.md` accurately documents the saga's zero-consumer state; the `TRACKING_INGEST_ENABLED` sequencing note in `10-config.yaml:40-46` correctly warns that flipping it against an unseeded registry would crash-loop the worker.

---

## 8. Remaining Risks

### Critical

| ID       | Risk                                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-C1** | **The API cannot boot under the shipped production configuration.** Four independent guards reject it (§3.2). Empirically proven, exit code 7. No production or staging deployment of the API surface is possible today.                                                                        |
| **R-C2** | **The business event chain terminates after "Order Paid."** Licensing, Analytics, Customer 360, and Platform Console receive nothing. Finance's eight consumers — all revenue recognition and settlement — have zero callers (§4.3). Orders are marked paid; no downstream system learns of it. |

### High

| ID       | Risk                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R-H1** | **Operational documentation does not disclose the boot guards** (D-5). The documented deployment procedure leads directly to a crash loop.                                                                                                 |
| **R-H2** | **No integration test has been executed against real infrastructure.** All 78 such tests are skipped (§2.1). Persistence, messaging, authorization, and object-storage behaviour are unverified against live Postgres/Kafka/Keto/Redis/S3. |
| **R-H3** | **C2-2 and M2-2 are unreachable from the shipped infrastructure.** Real Stripe and real S3 adapters exist in code but no manifest supplies their configuration (§3.2, §5).                                                                 |
| **R-H4** | **Tracking ingest is disabled in the shipped ConfigMap.** Correct sequencing (the registry must be seeded first), but it means the tracking leg is inert on deploy, and enabling it against an unseeded registry crash-loops the worker.   |

### Medium

| ID       | Risk                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R-M1** | Analytics runs entirely in-memory; `ClickHouseAnalyticsReadStore` is never imported under `apps/runtime`. Non-durable across restarts (disclosed in the ops runbook per M2-5).                               |
| **R-M2** | The verdict-bearing readiness report's quality-gate evidence is materially wrong (D-1).                                                                                                                      |
| **R-M3** | `SECURITY_PRINCIPAL_PROVISIONING` is off in the shipped config, so the Security principal/role store is never populated from Identity events. Zero-trust enforcement correctly refuses to enable without it. |

### Low

| ID       | Risk                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-L1** | Three dead workspace packages (§1.1). `protobufjs` is formally a production dependency via `@platform/temporal` but unreachable from any entrypoint. |
| **R-L2** | Duplicate-detection by error-message substring in `payment-captured.consumer.ts:55-59` (§4.4).                                                       |
| **R-L3** | `AllowAllAccessControl` as a fail-open default (§6).                                                                                                 |
| **R-L4** | `pnpm arch` does not cover `apps/`; currently benign (§1.3).                                                                                         |
| **R-L5** | `pnpm arch` has no `no-orphans` rule (§1.2).                                                                                                         |
| **R-L6** | Nine untracked reports at repo root (D-6).                                                                                                           |

---

## 9. Deferred Items and Accepted Risks

### Explicitly deferred (by prior sprints, re-confirmed unchanged)

| Item                                                                              | Deferred until              | Status this pass                                                 |
| --------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| **M2-1** — purchase saga cannot complete; `@platform/temporal` has zero importers | Real PSP production rollout | **Unchanged.** Zero callers confirmed.                           |
| **C2-4** — no real MFA provider                                                   | A real provider exists      | **Unchanged.** Guard is total.                                   |
| **M2-3** — no real Licensing payments/financeLedger adapter                       | A real adapter exists       | **Unchanged.** Injection seam exists; guard does not consult it. |
| ClickHouse / durable Analytics                                                    | Post-RC                     | **Unchanged** (R-M1).                                            |
| Fulfillment/Shipping/Returns/Notifications cryptographic webhook verification     | Post-RC                     | Not re-examined this sprint.                                     |
| NetworkPolicy peer-scoped egress tightening                                       | Post-RC                     | Ports correct; peers still broad.                                |
| Stripe sandbox run (C2-2 Task 9)                                                  | User-executed               | Not performed.                                                   |

### External dependencies not satisfiable in this environment

- **Docker Desktop** — confirmed broken in this sandbox. Blocks all 78 integration tests and every container-level check.
- **Kubernetes cluster** — none available. Blocks all runtime infrastructure verification.
- **Ory stack (Hydra/Kratos/Keto)** — not deployed in this repository's infra layer; ConfigMap values are `*.example.com` placeholders.
- **Stripe sandbox** — no live PSP call was made.
- **NotebookLM** — the AI Brain rule query mandated by `CLAUDE.md` could not run: authentication expired and this session is non-interactive. This sprint proceeded on the standing Lumo Engineering Constitution rules already in context. Re-auth with `notebooklm login` in an interactive session.

---

## 10. Fixes Applied

**None.**

Per this sprint's commit rules, a fix is warranted only when an issue is proven and correctable within the sprint's constraints. The two blocking findings are proven but **not correctable here**:

- **R-C1** would require either building a real MFA provider and a real Licensing billing adapter (new features — forbidden), or relaxing `APP_ENV` handling (which would defeat guards that are working exactly as designed). Setting `APP_ENV: "local"` in the production ConfigMap would make the API boot while silently disabling MFA, payment verification, real object storage, and Keto authorization — trading a loud, correct failure for a silent, dangerous one. **That is not a fix and was not applied.**
- **R-C2** would require wiring new consumers across five bounded contexts — new integration work, forbidden by scope.

D-1 through D-6 are documentation defects in reports authored by prior sprints. Correcting another sprint's report is outside this sprint's mandate; they are reported here instead.

**No commit was created.** The working tree contains no source modification by this sprint — verified after the boot probe was deleted.

---

## 11. Production Checklist

| #   | Item                                                 | Status                                                       |
| --- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Typecheck gate green (fresh)                         | ✅ 77/77                                                     |
| 2   | Lint gate green (fresh)                              | ✅ 77/77                                                     |
| 3   | Test gate green (fresh)                              | ✅ 1,740/1,740, 0 failed                                     |
| 4   | Architecture gate green                              | ✅ 0 violations                                              |
| 5   | No circular dependencies                             | ✅                                                           |
| 6   | No duplicate packages                                | ✅                                                           |
| 7   | No orphan source modules                             | ✅                                                           |
| 8   | Lockfile in sync                                     | ✅                                                           |
| 9   | k8s manifests build cleanly                          | ✅ 42 resources                                              |
| 10  | Ingress TLS + HSTS                                   | ✅ 3/3                                                       |
| 11  | Probes / HPA / PDB present and coherent              | ✅                                                           |
| 12  | Webhook signature verification real                  | ✅ HMAC-SHA256 + constant-time                               |
| 13  | Security headers + CSP                               | ✅                                                           |
| 14  | Rate limiting                                        | ✅                                                           |
| 15  | Secrets out-of-band                                  | ✅                                                           |
| 16  | Boot guards fail closed                              | ✅ (all 7)                                                   |
| 17  | **API boots in production config**                   | ❌ **exit 7**                                                |
| 18  | **End-to-end event flow operational**                | ❌ **1 of 9 legs**                                           |
| 19  | **Downstream consumers registered**                  | ❌ Finance 0/8; Licensing/Analytics/C360/Console define none |
| 20  | **Real-infrastructure integration tests executed**   | ❌ 78 skipped                                                |
| 21  | **PSP / object-storage config present in manifests** | ❌ absent                                                    |
| 22  | **Deployment docs disclose boot requirements**       | ❌ absent                                                    |
| 23  | Durable Analytics                                    | ❌ in-memory (deferred)                                      |
| 24  | Purchase saga operational                            | ❌ deferred (M2-1)                                           |

**16 of 24 pass. Items 17 and 18 are disqualifying.**

---

## 12. Final Verdict

# NOT READY

### Evidence

1. **The API process cannot start.** Executed, not inferred: `startApi` with the verbatim contents of `infrastructure/k8s/10-config.yaml` exits **7** at the MFA guard. Three further guards reject the same configuration independently. The `runtime-api` Deployment would CrashLoopBackOff on every pod; `/readyz` would never pass; the Service would never acquire endpoints; the Ingress would route to nothing. (§3.2)

2. **The event flow this sprint was chartered to validate does not exist.** One of nine legs is fully wired. Finance's eight consumers have zero callers. Licensing, Analytics, Customer 360, and Platform Console define no consumers at all. Of 19 provisioned Kafka topics, one has a subscriber. `orders.order.paid.v1` is produced and consumed by nothing. (§4)

3. **The platform is not internally consistent** — the specific question this sprint was asked to answer. `infrastructure/` declares `APP_ENV: "production"` for an application that refuses to run outside `local`; it omits the configuration that C2-2 and M2-2 built real adapters to consume; and the operations documentation describes a deployment procedure that cannot succeed. Each component is individually correct. Together they do not compose into a deployable system.

### What is genuinely strong

This verdict is about deployability and integration, not workmanship. The gates are green on a forced, uncached run across 1,740 tests. Architecture has zero violations across 1,787 modules. Every boot guard is real, total, and test-covered — **there is no code path where a stub silently serves production traffic**, which is the failure mode that actually destroys trust in a commerce platform. The Stripe signature verification is textbook-correct. The one wired event leg has genuinely sound idempotency, retry, and dead-letter semantics. The infrastructure manifests are coherent and security-conscious.

The platform fails RC because it cannot be run, not because it was built badly.

### Difference from the prior verdict

`FINAL_PRODUCTION_READINESS_REPORT.md:258` records **READY FOR RC**. That report states the same central fact at line 121 — _"The runtime cannot currently boot outside `APP_ENV=local`"_ — and classifies it as a disclosed scope boundary rather than a blocker.

This sprint reaches the opposite conclusion on the same fact, for two reasons:

- **A release candidate is a build you can deploy to a candidate environment and exercise.** A build whose primary application process exits at boot in every environment except a developer laptop cannot be exercised, and therefore cannot be a candidate. Whether the limitation was previously disclosed does not change whether it is present.
- **The prior report did not assess the event chain.** The unwired Finance consumers, the empty consumer surface in Licensing/Analytics/Customer 360/Platform Console, and the 1-of-19 topic coverage are established here for the first time. Even a booting API would not carry a purchase past "Order Paid."

Additionally, that report's headline gate evidence — "145/145 tests" — is the runtime package alone, not the 1,740-test repository-wide suite (D-1). The gates were and are green; the number supporting the verdict was wrong.

### Shortest path to READY FOR RC

Neither blocker is deep. R-C1 needs a real MFA provider and a real Licensing billing adapter (or an explicit, documented, injectable satisfaction of both guards), plus `STRIPE_*` and `S3_*` in the manifests. R-C2 needs the eight already-written Finance consumers registered in `worker.ts`. Both are bounded, additive work against interfaces that already exist — which is why the distance to RC is short even though the current answer is no.

---

## 13. Stop Condition

`RC_VALIDATION_REPORT.md` is complete. **STOP.** GA Audit is a separate sprint and was not begun.
