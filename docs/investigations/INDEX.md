# Investigation Reports — Critical & High Findings

**Source audit:** `FINAL_PRODUCTION_READINESS_AUDIT.md` (2026-08-04)
**Baseline:** `main` @ `756bce3`
**Status:** Investigation only. **No code has been changed.**

Each report answers the same seven questions: exact location, current implementation, why it is incorrect, production impact, the smallest _additive_ fix, whether that fix changes a public contract, and whether the finding is a true blocker or an intentional deferral.

---

## Cross-cutting root cause — read this first

Nine of the nineteen findings below share one root cause, discovered during this investigation and **not** visible in the original audit.

Commit **`de46df9`** — _"chore(reference): preserve full working tree as a non-canonical reference checkpoint"_ — contains a complete, working deployment, CI, identity-infrastructure, observability, governance, and ADR layer that **was never carried onto `main`** during the history reconstruction. Comparing the two file sets:

| Missing from `main`, present in `de46df9`                                                                             | Count   | Findings it explains                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `infrastructure/docker/runtime.Dockerfile`                                                                            | 1       | **C-02**                                                       |
| `.github/workflows/{build,validate,security,db-integration,ory-integration}.yml` + `.github/actions/setup/action.yml` | 6       | **C-03**, **H-09**                                             |
| `packages/db/prisma/schema/migrations/2026071[3\|9]*` (6 sprint migrations) + `tracking.prisma`                       | 8       | **C-04** — verified to create **21/21** sampled missing tables |
| `apps/runtime/src/metrics.ts`, `health-server.ts`, `diagnostics.ts`                                                   | 3       | **H-04**, H-07                                                 |
| `apps/runtime/src/tracking/**` (incl. `tracking-ingest.ts` — the consumer)                                            | 12      | **C-07**                                                       |
| `infrastructure/docker/{kratos,keto,hydra}/**`, `infrastructure/ory/keto.yml`, `docker-compose.runtime.yml`           | 7       | **C-09**, H-02                                                 |
| `docs/architecture/adr/0014–0032, 0053, 0059, 0060`                                                                   | 21 ADRs | L-1 (12 cited-but-absent)                                      |
| `scripts/governance/**` + `.jscpd.json` + `pnpm governance` / `pnpm dup` scripts                                      | 17      | M-8, M-2                                                       |

`apps/runtime` alone is missing **80 files**, including a `module.ts` + `modules/*.module.ts` framework for ~40 contexts. **Those modules do _not_ fix C-01** — I read them: they perform boot-time _validation_ (config presence, event-name contract) and do not construct Prisma repositories. Only 6 of ~40 mention `prisma` at all.

Also preserved but **explicitly flagged as defective** by `de46df9`'s own commit message: `apps/runtime/src/purchase-saga-activities.ts` and `src/purchase/**` — _"documented elsewhere as carrying confirmed defects, SAGA-1 through SAGA-11 — present here for reference/audit purposes only, not as an endorsement to reconstruct as-is."_ Do **not** restore those as part of C-06 without addressing the eleven findings first.

**Implication for remediation sequencing.** For these findings the smallest additive fix is _restore and review_, not _implement_. That is a far cheaper path than the audit assumed, and it should be done **first**, because restoring `db-integration.yml` (H-09) is the precondition for trusting any subsequent fix to C-01, C-04, or C-08.

**One caveat that must not be skipped:** `validate.yml` in `de46df9` runs a six-gate matrix including `pnpm governance` and `pnpm dup`. Neither script exists in `main`'s `package.json`, and `scripts/governance/**` and `.jscpd.json` are absent. Restoring `validate.yml` alone will fail. Restore the harness and the scripts together, or trim the matrix — do not restore the workflow in isolation.

---

## Critical

| ID                                               | Finding                                                                       | Blocker?                                                                     | Fix shape                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| [C-01](C-01-in-memory-persistence.md)            | 35 of 39 bounded contexts run on in-memory repositories in the production API | **True blocker** (deferral is real — G-39 — but does not survive deployment) | Large, repetitive; guardrail first          |
| [C-02](C-02-no-runtime-container-image.md)       | No runtime container image; nothing builds one                                | **True blocker**                                                             | Restore 1 file from `de46df9`               |
| [C-03](C-03-missing-ci-workflows.md)             | `deploy.yml`/`release.yml` call three workflows absent from `main`            | **True blocker**                                                             | Restore 6 files + 2 scripts                 |
| [C-04](C-04-migration-schema-drift.md)           | 36 of 129 schema tables have no `CREATE TABLE` in any migration               | **True blocker** (latent today; hard failure the moment C-01 is fixed)       | One generated migration                     |
| [C-05](C-05-payments-no-psp-or-ingress.md)       | No PSP adapter, `verifyWebhook` never called, no webhook route                | **True blocker**                                                             | Fail-closed guard now; adapter is real work |
| [C-06](C-06-saga-cannot-complete.md)             | Purchase saga blocks forever — zero `.signal()` call sites                    | Intentional deferral, **and** a blocker                                      | Fail-closed guard now                       |
| [C-07](C-07-tracking-pipeline-unreachable.md)    | `ingestTrackingEvent` has zero callers; nothing consumes the topic            | **True blocker** for the tracking product                                    | Restore 12 files from `de46df9`             |
| [C-08](C-08-outbox-never-published-or-pruned.md) | Outbox rows never marked published; the pruner matches zero rows forever      | **True blocker**                                                             | Change one predicate + add a gauge          |
| [C-09](C-09-never-booted.md)                     | The platform has never been started (G-41)                                    | **True blocker**                                                             | Restore Ory/compose configs, then execute   |

## High

| ID                                                  | Finding                                                                    | Blocker?                                                                      | Fix shape                               |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| [H-01](H-01-in-memory-audit-trail.md)               | Production audit trail is in-memory; the compliant adapter exists, unwired | **True blocker** (compliance + OOM)                                           | **2 lines**                             |
| [H-02](H-02-zero-trust-runtime-dead-code.md)        | Zero-trust runtime is unreachable; its config flags are never read         | Intentional deferral, misreported as active                                   | Guardrail: 3 lines                      |
| [H-03](H-03-mfa-hardcoded-code.md)                  | MFA accepts hardcoded `123456`; no injection seam exists                   | **True blocker** if H-02 is ever fixed                                        | Add a `deps` seam + fail-closed         |
| [H-04](H-04-metrics-never-emitted.md)               | Every SLO rule and alert queries metrics the runtime never emits           | **True blocker**                                                              | Restore `metrics.ts`; wire 3 call sites |
| [H-05](H-05-retry-head-of-line-blocking.md)         | Retry back-off sleeps in-process, stalling the whole consumer up to 1h     | **True blocker**                                                              | Separate consumer group + bounded wait  |
| [H-06](H-06-uncompiled-typescript-in-production.md) | Production runs uncompiled TypeScript via `tsx`                            | **Intentional, documented design — NOT a blocker. Downgraded High → Medium.** | Move `tsx` to `dependencies` (1 line)   |
| [H-07](H-07-collector-readiness-and-deployment.md)  | Collector readiness always healthy; collector not deployed at all          | **True blocker** for tracking                                                 | ~6 lines + 2 manifests                  |
| [H-08](H-08-payment-verification-optional.md)       | `paymentVerification` optional and unwired on the consumer path            | **True blocker**                                                              | Make required; wire the consumer        |
| [H-09](H-09-no-integration-tests-in-ci.md)          | No integration test has ever run in CI                                     | **True blocker**                                                              | Restore 1 workflow from `de46df9`       |
| [H-10](H-10-otel-never-started.md)                  | `startRuntimeTelemetry` has no callers                                     | **True blocker** (with H-04)                                                  | **3 lines per entrypoint**              |

---

## Two hard sequencing constraints

1. **C-04 must land before or with C-01.** Fixing C-01 alone converts silent data loss into an immediate `relation does not exist` crash across ~32 contexts, because their tables have no migration.
2. **H-03 must land before H-02.** Mounting the zero-trust guard exposes the hardcoded `123456` MFA provider, which is currently protected only by the fact that the guard is unmounted.

## Recommended sequencing

1. **Restore layer** (C-02, C-03, C-04, C-07, H-04, H-09, plus the ADR/governance/Ory assets) — cheap, purely additive, and it re-establishes the gates every later fix depends on. **Start with `db-integration.yml`.**
2. **Guardrails** (C-01 Step 1, C-05 Step 1, C-06 Step 1, H-02, H-03) — make silent in-memory/stub composition _fail closed at boot outside `local`_, so no later regression can ship quietly. None of these changes behaviour in `local` or in tests.
3. **Observability wiring** (H-01, H-10, H-04 Step 2, H-07 Steps 1–2) — H-01 and H-10 are 2 and 3 lines respectively; without this set, steps 4–5 cannot be verified.
4. **Correctness** (H-08, H-05, C-08).
5. **Substantive build** (C-01 per-context persistence ×35, C-05 PSP adapter, C-06 signal bridge, H-07 Step 3 collector deployment).
6. **C-09 — first live boot**, which validates everything above and can only be attempted once steps 1–5 land.

### Cheapest fixes, for reference

| Finding                                          | Size                                       |
| ------------------------------------------------ | ------------------------------------------ |
| H-01 audit trail                                 | **2 lines**                                |
| H-10 OTel start                                  | **3 lines per entrypoint**                 |
| H-08 Step 1 payment verification on the consumer | **3 lines**                                |
| H-06 `tsx` → `dependencies`                      | **1 line**                                 |
| C-02, C-03, C-04, C-07, H-04, H-09               | `git checkout de46df9 -- <paths>` + review |
