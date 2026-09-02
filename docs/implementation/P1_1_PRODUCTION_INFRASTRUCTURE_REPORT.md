# P1.1 — Restore Production Infrastructure

**Milestone:** P1.1 (first of the P1.x production hardening series)
**Closes:** [C-02](../investigations/C-02-no-runtime-container-image.md), [C-03](../investigations/C-03-missing-ci-workflows.md), [H-09](../investigations/H-09-no-integration-tests-in-ci.md)
**Baseline:** `d50cc69` (docs baseline) on top of `756bce3`
**Date:** 2026-08-04
**Method:** restore from the preserved reference commit `de46df9`, review every restored file, correct defects found on review, run all gates.

---

## 1. Objective

Three Critical/High findings shared one root cause: the deployment and CI layer was written, reviewed, and then dropped from `main` during the history reconstruction. `deploy.yml` and `release.yml` on `main` called three reusable workflows that did not exist, so **both failed at workflow-parse time**; no Dockerfile existed for the runtime, so the image the k8s manifests reference could not be built; and no workflow provisioned a database, so no integration test had ever executed.

This milestone restores that layer rather than rewriting it, per the standing rule to prefer restoration of previously implemented production code.

---

## 2. Restored files

All restored verbatim from `de46df9` via `git checkout de46df9 -- <path>`.

| File                                       | Purpose                                                                         | Finding           |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ----------------- |
| `infrastructure/docker/runtime.Dockerfile` | Production image for api/worker/scheduler — one image, three entrypoints        | C-02              |
| `.github/actions/setup/action.yml`         | Composite toolchain action (pnpm + Node 22 + frozen install)                    | C-03              |
| `.github/workflows/validate.yml`           | The reusable quality gate, called by `release.yml` and `deploy.yml`             | C-03              |
| `.github/workflows/build.yml`              | Builds + optionally pushes the runtime image; emits `image`/`digest` outputs    | C-03              |
| `.github/workflows/security.yml`           | Dependency audit, gitleaks, license report, Trivy image scan (SARIF), Syft SBOM | C-03              |
| `.github/workflows/db-integration.yml`     | Postgres 16 service container + `migrate deploy` + integration suites           | H-09              |
| `.github/workflows/ory-integration.yml`    | Live Ory Keto relationship-tuple integration gate                               | H-09              |
| `infrastructure/ory/keto.yml`              | Keto config mounted by `ory-integration.yml`                                    | H-09 (dependency) |

**8 files restored. 0 files rewritten.**

### Why `infrastructure/ory/keto.yml` is in scope

The milestone brief scoped P1.1 to the Dockerfile, workflows, and actions. `ory-integration.yml` mounts `infrastructure/ory/keto.yml` into the Keto container; without it the restored workflow references a non-existent path and cannot run. Restoring a workflow that cannot execute would not satisfy "verify restored code before committing", so the single config file it depends on was restored with it. It is pure CI configuration — no application code, no runtime impact.

---

## 3. Files modified (defects corrected on review)

Review of the restored files surfaced three defects. Two were corrected in this milestone; one was deliberately deferred.

### 3.1 `.github/workflows/validate.yml` — matrix trimmed to gates that exist

**Defect:** the restored matrix was `[typecheck, lint, arch, test, governance, dup]`. Neither `pnpm governance` nor `pnpm dup` exists in `main`'s `package.json`, and `scripts/governance/**`, `.jscpd.json`, and the `jscpd` devDependency were also not carried over. Restoring the workflow unmodified would have produced a red pipeline on every PR.

**Correction:** matrix trimmed to `[typecheck, lint, arch, test]` with an in-file comment recording why and what returns it.

**Why the harness was not restored here.** The governance ratchet reads baselines from `scripts/governance/baseline/*.json` (dependency freeze, public-API surface, event contract). Those baselines were computed against `de46df9`'s tree, which contains ~200 files `main` does not — including 80 under `apps/runtime` alone. Restoring them now would fail on baseline mismatch for reasons entirely unrelated to this milestone, and re-ratcheting them mid-restore would bake `main`'s currently-degraded state in as the approved baseline. It is deferred to its own isolated change, after the composition milestones land. See §7.

### 3.2 `.github/workflows/db-integration.yml` — seed path corrected

**Defect:** the step ran `pnpm --filter @platform/db exec tsx prisma/seed.ts`. That path does not exist. `packages/db/package.json` declares the seed as `"seed": "tsx ../../apps/runtime/src/seed.ts"` under its `prisma` key. Because the step carries `continue-on-error: true`, it would have failed silently forever.

**Correction:** invoke the declared script — `pnpm --filter @platform/db db:seed` — which runs `prisma db seed` and resolves the path from the manifest, so it cannot drift again.

### 3.3 `.github/workflows/db-integration.yml` — test filter widened

**Defect:** the step ran `pnpm --filter @platform/security --filter @platform/identity test`, covering 2 of the packages holding DB-gated suites. It silently skipped the two largest: `@platform/customer-360` (56 integration tests) and `@platform/orders` (3).

**Correction:** replaced with `pnpm test`, which runs every `DATABASE_URL_TEST`-gated suite. Turbo caching keeps the already-green unit suites cheap.

---

## 4. Verification performed

### 4.1 Cross-reference resolution

Every `uses: ./…` reference across all workflows now resolves. Verified programmatically:

```
build.yml                -> .github/actions/setup                                OK
deploy.yml               -> .github/workflows/validate.yml                       OK
release.yml              -> .github/workflows/validate.yml                       OK
release.yml              -> .github/workflows/security.yml                       OK
release.yml              -> .github/workflows/build.yml                          OK
security.yml             -> .github/actions/setup                                OK
security.yml             -> .github/actions/setup                                OK
validate.yml             -> .github/actions/setup                                OK
```

Before this milestone, the three `release.yml` references and the one `deploy.yml` reference were all `MISSING`.

### 4.2 Path references

| Referenced by               | Path                                       | Status |
| --------------------------- | ------------------------------------------ | ------ |
| `build.yml`, `security.yml` | `infrastructure/docker/runtime.Dockerfile` | OK     |
| `ory-integration.yml`       | `infrastructure/ory/keto.yml`              | OK     |
| `deploy.yml`                | `infrastructure/k8s`                       | OK     |
| `db-integration.yml`        | `packages/db/prisma/schema`                | OK     |

### 4.3 Dockerfile consistency (static)

| Assertion                                                                                   | Result                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `corepack prepare pnpm@…` matches root `packageManager`                                     | `pnpm@11.9.0` == `pnpm@11.9.0` ✔    |
| `COPY pnpm-lock.yaml .npmrc` sources exist                                                  | both present ✔                      |
| `WORKDIR /app/apps/runtime` + `CMD … src/api.ts`                                            | `apps/runtime/src/api.ts` present ✔ |
| `EXPOSE 3080` vs k8s `containerPort`                                                        | 3080 == 3080 ✔                      |
| `EXPOSE 3080` vs `config.ts` `PORT` default                                                 | 3080 == 3080 ✔                      |
| `XDG_CACHE_HOME=/tmp` vs k8s `readOnlyRootFilesystem: true` + `/tmp` emptyDir               | consistent ✔                        |
| `tini` ENTRYPOINT vs k8s comment _"keeps the image's tini ENTRYPOINT → SIGTERM forwarding"_ | consistent ✔                        |

### 4.4 Docker build — **not performed** (blocked, honestly reported)

`docker --version` reports `29.5.3`, but the daemon is unreachable:

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running
```

This reproduces exactly the G-41 blocker recorded in `SPRINT_3_0B_REPORT.md` and re-confirmed in investigation C-09. **The restored Dockerfile has therefore been verified statically but has never been built.** This is the residual risk in §6 and is the reason `build.yml` matters: GitHub-hosted runners have a working daemon, so the first real build will occur on the first PR after this commit.

---

## 5. Quality gate results

| Gate         | Command           | Result                                                                    |
| ------------ | ----------------- | ------------------------------------------------------------------------- |
| Typecheck    | `pnpm typecheck`  | ✅ **76 successful, 76 total**                                            |
| Lint         | `pnpm lint`       | ✅ **76 successful, 76 total**                                            |
| Test         | `pnpm test`       | ✅ **76 successful, 76 total** (FULL TURBO — no source changed)           |
| Architecture | `pnpm arch`       | ✅ **no dependency violations (1531 modules, 6529 dependencies cruised)** |
| Governance   | `pnpm governance` | ⚪ **not available** — script does not exist on `main`; see §3.1 and §7   |
| Install      | `pnpm install`    | ⚪ not required — no dependency change                                    |

No source file was touched in this milestone, so `pnpm test` was fully cached; the gate is nonetheless recorded as run.

---

## 6. Risks

| #   | Risk                                                                                                                                                                                                  | Severity | Mitigation                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The runtime image has never been built. `pnpm fetch` + `pnpm install --frozen-lockfile` inside the container is unverified, as is Prisma engine availability under `node:22-bookworm-slim`.           | **High** | `build.yml` builds it on every release and `security.yml` builds it on every PR for scanning. The first PR after this commit is the real test. Local verification is blocked by G-41 (C-09).                      |
| R2  | `db-integration.yml` now runs `pnpm test` against a live Postgres for the first time ever. Previously-skipped suites (70 tests) will execute for the first time and may fail.                         | **High** | This is the intent of the milestone, not a regression — those failures are pre-existing defects that were invisible. Expect them; triage in P1.4.                                                                 |
| R3  | `prisma migrate deploy` in `db-integration.yml` will run against a real database for the first time. Per C-04, 36 of 129 schema tables have no migration, so the resulting schema will be incomplete. | **High** | Known and scheduled: **P1.4** restores the 6 missing migrations. `db-integration.yml` landing first is deliberate — it is the gate that will _prove_ P1.4 worked.                                                 |
| R4  | `security.yml` runs `pnpm audit --prod --audit-level=high` as a **blocking** gate. `docs/KNOWN_GAPS.md` G-31 records 8 open advisories.                                                               | Medium   | The audit is scoped `--prod`, and G-31's advisories are dev-tooling (vitest/vite/esbuild/postcss). If a production-graph advisory exists, this correctly blocks. `ci.yml`'s non-blocking audit is left untouched. |
| R5  | `ory-integration.yml` starts `oryd/keto:v0.11.1` and runs `packages/auth` tests. That suite has never executed.                                                                                       | Medium   | `packages/auth/src/keto-relationships.integration.test.ts` is present on `main` and gates on `KETO_READ_URL_TEST`/`KETO_WRITE_URL_TEST`, both of which the workflow sets. Verified before restoring.              |
| R6  | Both `ci.yml` and `validate.yml` now run on every PR, duplicating lint/typecheck/build/test.                                                                                                          | Low      | Wasteful, not incorrect. Consolidating them is a separate cleanup; not batched into this milestone.                                                                                                               |

---

## 7. Deferred items

| Item                                                                                                                 | Reason                                                                                                                                                                                                     | Where it belongs                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/governance/**`, `.jscpd.json`, `jscpd` devDependency, `governance`/`dup` root scripts, `docs/governance/**` | Baselines in `de46df9` were computed against a tree `main` has diverged from by ~200 files. Restoring now fails for unrelated reasons; re-ratcheting now would freeze `main`'s degraded state as approved. | Its own isolated change, after P1.5 composition hardening. Restores `validate.yml`'s full 6-gate matrix. |
| Migration-drift gate in `db-integration.yml` (`prisma migrate diff --exit-code`)                                     | Migrations are P1.4's subject. Adding the gate here would fail immediately on the known C-04 drift and block this milestone on the next one.                                                               | **P1.4** — added together with the restored migrations, so it goes green in the same commit.             |
| Consolidating `ci.yml` into `validate.yml`                                                                           | Not a correctness issue; would mix cleanup into a restore milestone.                                                                                                                                       | Separate cleanup change.                                                                                 |
| `infrastructure/docker/{kratos,keto,hydra}/**` and `docker-compose.runtime.yml`                                      | Local-stack composition, not CI. Required for the first live boot.                                                                                                                                         | **C-09** remediation.                                                                                    |
| Collector image + k8s manifests                                                                                      | Out of P1.1 scope.                                                                                                                                                                                         | **H-07**.                                                                                                |

---

## 8. State after this milestone

**Closed:**

- **C-02** — the runtime image can now be built (`build.yml` → `runtime.Dockerfile`), subject to R1.
- **C-03** — `release.yml` and `deploy.yml` parse and resolve; the cosign signing → Trivy scan → signature verification → environment-gated rollout chain is reachable for the first time.
- **H-09** — a Postgres-backed integration job exists and runs every `DATABASE_URL_TEST`-gated suite.

**Not yet closed:** the image has never been built and the integration job has never run (R1, R2) — both are blocked locally by G-41 and unblock on the first CI run.

---

## 9. Commit

Single isolated commit; working tree clean. No source file, no `package.json`, no lockfile, and no application behaviour changed — this milestone is entirely CI, deployment packaging, and one CI config file.
