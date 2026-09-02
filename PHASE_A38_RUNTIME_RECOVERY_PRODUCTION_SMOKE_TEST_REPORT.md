# Phase A.38 — Runtime Recovery & Production Smoke Test Report

**Date:** 2026-08-16
**Repo:** `C:\Users\abdoh\Claude code\Git\lumo-platform`
**Branch:** `main`
**HEAD at start:** `22de4125cb61aaacddddc729e1b072f5c0dd5a6b`
**HEAD at end:** unchanged (no commits made this phase)

---

## 1. Executive Summary

This phase's mandate was: attempt to recover Docker Desktop / WSL2 on this machine, and if successful, run a full live-runtime smoke test (Postgres, Hydra, Kratos, Keto, Admin API, Admin Web, OAuth golden path, RBAC, RTL, security headers, restart resilience). If recovery failed, stop runtime verification early, document the exact blocker, and still run the pure code-level validation gates.

**Outcome: Docker Desktop / WSL2 could NOT be recovered.** A safe, documented recovery attempt was made (full process restart of Docker Desktop) and the WSL2 `docker-desktop` backend distro never transitioned out of `Stopped`, and the Docker engine named pipe (`\\.\pipe\dockerDesktopLinuxEngine`) never came up. Toward the end of the attempt, even lightweight `wsl.exe` calls stopped returning within a 20s window, indicating the Windows-side WSL subsystem itself was unresponsive, not just the Docker Desktop Linux VM. This is consistent with the persistent Docker/WSL2 breakage documented across Phases A.12, A.14, and A.19–A.21 in project memory.

Because live Hydra/Kratos/Keto/Postgres/Admin-API/Admin-Web could not be started, **all runtime-dependent verification tasks (service health, DB persistence, Hydra/Kratos/Keto verification, OAuth golden path, RBAC matrix, cross-domain auth, security headers, RTL, restart resilience, live observability) were NOT performed** — no results for these are fabricated or simulated, per the task's explicit constraint.

The pure code-level validation gates that do **not** depend on Docker were run and **all passed**: `pnpm typecheck` (78/78), `pnpm lint` (78/78), `pnpm arch` (0 dependency violations, 1572 modules / 6857 dependencies), `pnpm test` (all suites green, e.g. `@platform/admin` 153/153, `@platform/runtime` 184/184), and `pnpm --filter admin-web build` (Next.js production build succeeded, 20 routes).

No files in the user's pre-existing uncommitted working tree were modified. No commits, pushes, or deployments were made. See §22 for verification.

**Verdict: NOT PRODUCTION READY** (see §23) — live authentication/authorization cannot be verified in this environment, which is a P0 blocker for any production-readiness claim.

---

## 2. Docker/WSL2 Diagnosis

### 2.1 Baseline observations (read-only diagnostics)

| Command                  | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker context ls`      | Returned immediately. Two contexts: `default` (`npipe:////./pipe/docker_engine`) and `desktop-linux *` (current, `npipe:////./pipe/dockerDesktopLinuxEngine`).                                                                                                                                                                                                                                     |
| `docker compose version` | Returned immediately: `Docker Compose version v5.1.4`.                                                                                                                                                                                                                                                                                                                                             |
| `docker info`            | **Hung >120s** on first attempt (moved to background); on retry with a full timeout it returned after ~40s with a clean error (not a hang forever): `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.` Exit code 1. |
| `wsl --status`           | Returned quickly: `Default Distribution: docker-desktop, Default Version: 2`.                                                                                                                                                                                                                                                                                                                      |
| `wsl -l -v`              | Returned quickly (early in the session): `docker-desktop  Stopped  2`, `Ubuntu-24.04  Stopped  2`.                                                                                                                                                                                                                                                                                                 |
| Docker Desktop processes | `Get-Process` showed `Docker Desktop`, `com.docker.backend`, and `docker` CLI helper processes all present and `Responding = True` — i.e. the Windows-side GUI/supervisor processes were alive, but the Linux backend VM/engine was not.                                                                                                                                                           |

**Root cause:** Docker Desktop's Windows-side processes were running, but the WSL2 `docker-desktop` utility distro was `Stopped` and the engine's named pipe was never created — so the daemon was simply not up, not merely slow. `docker info` initially "hanging" was actually a long connection-attempt timeout against a pipe that doesn't exist.

### 2.2 Recovery attempt (safe, documented)

Steps taken, in order:

1. `Stop-Process -Name "Docker Desktop" -Force` and `Stop-Process -Name "com.docker.backend" -Force` — terminated the existing (non-functional) Docker Desktop process tree. This is a standard, documented Docker Desktop recovery step (equivalent to "Quit Docker Desktop" then killing stragglers) and does not touch any project files or the WSL distro data.
2. Confirmed all `Docker*`/`com.docker.*` processes were gone.
3. Relaunched via `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`.
4. Confirmed new process tree came up (`com.docker.backend`, `Docker Desktop` with fresh PIDs/start times).
5. Polled `docker info` / `docker version` repeatedly over roughly **10+ minutes** total elapsed time, waiting for the engine to initialize.

No `wsl --shutdown` was performed (that would have force-stopped every WSL distro on the machine, which was judged higher-risk/more disruptive than necessary and not clearly needed given the engine process itself was restarted). No WSL/Docker data was reset, no `docker system prune`, no reinstall.

### 2.3 Recovery result

- `wsl -l -v`, polled repeatedly after the restart, **continued to show `docker-desktop` as `Stopped`** the entire time — it never transitioned to `Running`.
- `docker info` continued to return the same "cannot find the file specified" pipe error, and later in the wait window, `docker version` / `wsl -l -v` calls stopped completing within a 20s window at all (moved to background, no output captured before the report was finalized) — indicating the WSL subsystem became unresponsive, not just slow.
- **Conclusion: Docker/WSL2 recovery was unsuccessful.** Per the task's explicit instruction, no further destructive or exploratory recovery (e.g. `wsl --shutdown`, WSL kernel update, Docker Desktop reinstall, factory reset) was attempted, since those are outside "safe recovery" scope and risk affecting other work on the machine.

### 2.4 Recovery commands for a future session (not run here, documented only)

If a future session wants to continue investigating, in increasing order of intrusiveness:

```powershell
# 1. Confirm current state
wsl -l -v
docker info

# 2. Full WSL shutdown (stops ALL distros, not just Docker's) + relaunch
wsl --shutdown
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
# then wait 60-120s and re-check `wsl -l -v` / `docker info`

# 3. Check Windows WSL service health directly
Get-Service -Name "WslService" -ErrorAction SilentlyContinue
sc.exe query WslService

# 4. Check for a stuck/corrupted Docker Desktop update or VM disk
# (Docker Desktop > Troubleshoot > "Clean / Purge data" is destructive — do NOT run
# without explicit user approval, it deletes all local images/containers/volumes)

# 5. As a last resort, check Windows optional feature / kernel state
wsl --update
wsl --version
```

---

## 3. Runtime Architecture (dependency map)

Derived from `infrastructure/docker/docker-compose.yml`, `infrastructure/docker/hydra|kratos|keto/`, and `apps/admin-web` — **not verified live**, this section is a static-inspection map only:

```
Postgres (single instance, roles: hydra / kratos / keto / debezium / apicurio — per
 infrastructure/docker/postgres/init/01-roles-and-cdc.sql)
   │
   ├── Hydra (OAuth2/OIDC provider) — public :4444, admin :4445 per compose; DSN → postgres
   ├── Kratos (identity/self-service auth) — public :4433, admin :4434; DSN → postgres
   └── Keto (permission/relationship-tuple authorization) — DSN → postgres
            │
Admin API (@platform/admin, wired through @platform/runtime composition root)
   │  consumes: Hydra JWKS for JwtVerifier, Keto for authorization checks
   ▼
Admin Web (apps/admin-web, Next.js) — apps/admin-web/src/middleware.ts + src/lib/auth/,
   OAuth2 code flow against Hydra, session cookie, RBAC-gated routes
```

This map is consistent with what the code (middleware, auth lib, docker-compose service definitions) declares; it was not confirmed by observing live traffic between these components, since none of them could be started.

---

## 4. Service Health — **NOT VERIFIED (Docker unavailable)**

`docker compose ps` / `docker compose up -d` were not run because `docker info` cannot reach the daemon. No container states can be reported.

## 5. Database Persistence — **NOT VERIFIED (Docker unavailable)**

Cannot confirm `hydra`/`kratos`/`keto` databases exist or that migrations are applied against a live Postgres instance in this session.

## 6. Hydra Verification — **NOT VERIFIED (Docker unavailable)**

No live Hydra public (`:4444`) or admin (`:4445`) endpoint could be reached.

## 7. Kratos Verification — **NOT VERIFIED (Docker unavailable)**

No live Kratos health or self-service login flow could be exercised.

## 8. Keto Verification — **NOT VERIFIED (Docker unavailable)**

No live Keto health or permission-check endpoint could be reached.

## 9. Admin API Verification — **NOT VERIFIED (Docker unavailable)**

Admin API depends on Postgres/Hydra/Keto being reachable at boot for full production wiring; it was not started. (Unit/integration test suite for `@platform/admin` and `@platform/runtime` _was_ run — see §19 — and passed against in-memory/mocked adapters, which is a code-correctness signal only, not a live-runtime signal.)

## 10. Admin Web Verification — **NOT VERIFIED live; build-only verified**

`pnpm --filter admin-web build` succeeded (see §19) — this confirms the app compiles, type-checks, lints its routes, and statically renders 20 routes. It does **not** confirm the app boots, serves traffic, or that its middleware/auth flow works against a live Hydra/Kratos, since no dev/prod server was started (no point starting it with no Identity stack behind it — that would only prove the app returns login-redirect/error states, not a functioning golden path).

## 11. OAuth Golden Path — **NOT VERIFIED (Docker unavailable)**

Not attempted — requires live Hydra + Kratos + Admin Web.

## 12. Session Behavior — **NOT VERIFIED (Docker unavailable)**

## 13. RBAC Matrix — **NOT VERIFIED (Docker unavailable)**

## 14. Cross-Domain Auth — **NOT VERIFIED (Docker unavailable)**

## 15. Security Headers — **NOT VERIFIED (Docker unavailable)**

No live HTTP server to probe with `curl`/`Invoke-WebRequest`.

## 16. Error Handling — **NOT VERIFIED (Docker unavailable)**

## 17. RTL Verification — **NOT VERIFIED (Docker unavailable)**

`apps/admin-web/src/messages/ar.ts` exists (Arabic locale file, part of the pre-existing uncommitted changes) but RTL rendering could not be checked in a live browser without a running Admin Web server.

## 18. Runtime Data Integrity — **NOT VERIFIED (Docker unavailable)**

## 19. Validation Gates (code-level, Docker-independent) — **ALL PASSED**

Run from `C:\Users\abdoh\Claude code\Git\lumo-platform`:

| Gate              | Command                         | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck         | `pnpm typecheck`                | ✅ PASS | `Tasks: 78 successful, 78 total`, exit code 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Lint              | `pnpm lint`                     | ✅ PASS | `Tasks: 78 successful, 78 total`, exit code 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Architecture      | `pnpm arch`                     | ✅ PASS | `no dependency violations found (1572 modules, 6857 dependencies cruised)`, exit code 0                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Tests             | `pnpm test`                     | ✅ PASS | All suites green; e.g. `@platform/admin`: `Test Files 10 passed (10)`, `Tests 153 passed (153)`; `@platform/runtime`: `Test Files 30 passed (30)`, `Tests 184 passed (184)`. `Tasks: 78 successful, 78 total`, exit code 0. Notable: `src/composition.test.ts` in `@platform/runtime` deliberately exercises "graph builds without any Docker runtime" scenarios and expects `ECONNREFUSED`/unreachable-health-check outcomes — these are _intentional_ assertions about the no-Docker code path, not failures. |
| Admin Web build   | `pnpm --filter admin-web build` | ✅ PASS | `next build` — `✓ Compiled successfully`, `✓ Generating static pages (20/20)`, exit code 0                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm governance` | —                               | N/A     | Script does not exist in root `package.json` — skipped per instructions.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm dup`        | —                               | N/A     | Script does not exist in root `package.json` — skipped per instructions.                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Root `package.json` scripts present: `build, dev, dev:up:infra, dev:down:infra, lint, typecheck, test, arch, production:check, format, format:check, clean, gen, changeset, version-packages, prepare`. No `governance` or `dup` script exists anywhere in this repo's root manifest.

## 20. Security Scan (grep for secrets/keys/passwords in changed/runtime config)

Scanned the diff of the changed runtime/infra config files (`infrastructure/docker/docker-compose.yml`, `infrastructure/docker/postgres/init/01-roles-and-cdc.sql`, `infrastructure/k8s/secret.example.yaml`) for `password|secret|api[_-]?key|token` (case-insensitive):

- `infrastructure/docker/docker-compose.yml`: contains a local-dev-only value `SECRETS_SYSTEM: dev-hydra-system-secret-change-me-32` for Hydra, clearly labeled as a dev value in an adjacent comment ("Dev value; NOT a JWKS"). Not a production secret.
- `infrastructure/docker/postgres/init/01-roles-and-cdc.sql`: creates local Postgres roles `hydra`, `kratos`, `keto` with matching plaintext passwords equal to the role name (e.g. `CREATE ROLE hydra LOGIN PASSWORD 'hydra';`). These are local-only dev database credentials for a container-internal Postgres instance, consistent with the pattern already used for the pre-existing `debezium`/`apicurio` roles in the same file. Not exposed externally; not a production secret.
- `infrastructure/k8s/secret.example.yaml`: every secret value is a `REPLACE_ME__...` placeholder with an inline comment showing the `kubectl create secret ... --from-literal=... openssl rand -hex 32` pattern operators are expected to use. No real secret material present — this is explicitly an `*.example.yaml` template.

**No real/production credentials, API keys, or tokens were found.** No values are reproduced in this report beyond what's shown above (which are dev-only/placeholder by design).

## 21. Observability — **NOT VERIFIED (Docker unavailable)**

No live services to inspect logs/metrics/traces from.

## 22. Runtime Criticality Classification

| Component                                            | Criticality                                          | Verified this phase?                                                         |
| ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Postgres (identity DBs: hydra/kratos/keto)           | P0 — all auth depends on it                          | ❌ Not verified (Docker down)                                                |
| Hydra (OAuth2/OIDC)                                  | P0 — golden path blocker                             | ❌ Not verified (Docker down)                                                |
| Kratos (identity)                                    | P0 — golden path blocker                             | ❌ Not verified (Docker down)                                                |
| Keto (authorization/RBAC)                            | P0 — RBAC blocker                                    | ❌ Not verified (Docker down)                                                |
| Admin API                                            | P0 for admin operations                              | ❌ Not verified live; ✅ unit/integration tests pass against mocked adapters |
| Admin Web                                            | P0 for admin operations                              | ❌ Not verified live; ✅ production build succeeds                           |
| Code-level correctness (types/lint/arch/tests/build) | P1 — necessary but not sufficient for prod readiness | ✅ Fully verified, all green                                                 |

## 23. Final Smoke-Test Matrix

| #   | Test                                           | Status                          | Blocking?                   |
| --- | ---------------------------------------------- | ------------------------------- | --------------------------- |
| 1   | Docker/WSL2 recovery                           | ❌ FAIL                         | Yes — blocks all rows below |
| 2   | Service health (compose ps)                    | ⛔ NOT RUN                      | Yes                         |
| 3   | Postgres persistence / migrations              | ⛔ NOT RUN                      | Yes                         |
| 4   | Hydra public/admin endpoints                   | ⛔ NOT RUN                      | Yes                         |
| 5   | Kratos health/login flow                       | ⛔ NOT RUN                      | Yes                         |
| 6   | Keto health/permission checks                  | ⛔ NOT RUN                      | Yes                         |
| 7   | Admin API live boot + RBAC checks              | ⛔ NOT RUN                      | Yes                         |
| 8   | Admin Web live boot + route rendering          | ⛔ NOT RUN                      | Yes                         |
| 9   | OAuth golden path (browser)                    | ⛔ NOT RUN                      | Yes                         |
| 10  | Session behavior                               | ⛔ NOT RUN                      | Yes                         |
| 11  | RBAC matrix                                    | ⛔ NOT RUN                      | Yes                         |
| 12  | Cross-domain auth                              | ⛔ NOT RUN                      | Yes                         |
| 13  | Security headers                               | ⛔ NOT RUN                      | Yes                         |
| 14  | Error handling (live)                          | ⛔ NOT RUN                      | Yes                         |
| 15  | RTL verification (browser)                     | ⛔ NOT RUN                      | Yes                         |
| 16  | Runtime data integrity                         | ⛔ NOT RUN                      | Yes                         |
| 17  | Restart resilience                             | ⛔ NOT RUN                      | Yes                         |
| 18  | `pnpm typecheck`                               | ✅ PASS                         | No                          |
| 19  | `pnpm lint`                                    | ✅ PASS                         | No                          |
| 20  | `pnpm arch`                                    | ✅ PASS                         | No                          |
| 21  | `pnpm test`                                    | ✅ PASS                         | No                          |
| 22  | `pnpm --filter admin-web build`                | ✅ PASS                         | No                          |
| 23  | Secrets scan on changed runtime config         | ✅ PASS (no real secrets found) | No                          |
| 24  | Working-tree integrity (no unintended changes) | ✅ PASS (verified, §24)         | No                          |

## 24. Working-Tree Integrity Verification

Before finishing, compared `git status --short` before and after this session's work:

- Before: 90 lines of pre-existing uncommitted changes (modified + untracked), HEAD `22de4125cb61aaacddddc729e1b072f5c0dd5a6b`.
- After: identical set, plus this report file itself as a new untracked file (`PHASE_A38_RUNTIME_RECOVERY_PRODUCTION_SMOKE_TEST_REPORT.md`) and, if present, ephemeral turbo/vitest caches — no tracked source file content was altered by this phase's work. `git diff --stat` and `git diff --cached` were re-run after all commands and show no unexpected changes. No `git add`, `git commit`, `git push`, `git stash`, `git reset`, or `git checkout -- <path>` was executed at any point in this phase.

## 25. Production Readiness Verdict

**NOT PRODUCTION READY.**

Rationale (per the task's explicit rule): live authentication/authorization (Hydra/Kratos/Keto) could not be verified because Docker/WSL2 could not be recovered in this environment, and that is a P0 blocker for any production-readiness claim regardless of how clean the code-level gates are. All static/code-level gates (typecheck, lint, architecture, unit/integration tests, admin-web production build) passed cleanly, which is a positive but insufficient signal — it proves the code is internally consistent and testable, not that the deployed system authenticates, authorizes, and serves traffic correctly end-to-end.

This matches the pattern across Phases A.12, A.14, A.19–A.21: Docker/WSL2 on this specific machine has been an intermittently/persistently broken dependency, and every phase that depended on it for live verification has had to stop short of a full production-ready verdict. Recommend the next attempt either (a) run on a machine/CI runner with healthy Docker/WSL2, or (b) invest in root-causing the WSL2 `docker-desktop` distro's `Stopped` state directly (Windows-side WSL service logs, `wsl --update`, or a Docker Desktop reinstall — none of which were performed here as they exceed this phase's "safe recovery only" scope).
