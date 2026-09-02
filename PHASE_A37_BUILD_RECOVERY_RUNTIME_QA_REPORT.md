# Phase A.37 — Admin Web Build Recovery + Runtime Smoke Test

Date: 2026-08-16
Scope: diagnose and fix the `admin-web` production build failure reported at the end of
Phase A.36, re-run full validation, and attempt a runtime smoke test. No features added, no
redesign, no auth architecture changes, no commits/pushes.

## 1. Initial Build Failure — Root Cause

**Reproduction result: the build did NOT fail.** `pnpm --filter admin-web build` was run fresh
at the start of this phase (exit code 0, all 20 routes compiled and statically generated,
including `/consent` and `/integrations`).

The A.36 report (`PHASE_A36_RUNTIME_BUILD_CLEANUP_REPORT.md`, line 114) recorded the failure as:

```
PageNotFoundError: Cannot find module for page: /consent
```

This specific error — a page whose `page.tsx` exists on disk but is reported "not found" by
Next.js's build-time page manifest — is the signature of a **stale/corrupted `.next` build
cache**, not a source-code defect. It typically results from an interrupted or concurrently-run
build leaving a `.next` directory with a manifest that predates newly-added routes
(`/consent`, `/integrations`, `/auth/callback`, `/login`, `/logout`, `/forbidden`, `/api/*`,
`middleware.ts` were all still untracked/new work at the time of A.36).

Corroborating evidence: an untracked report already present in the working tree before this
phase started, `PHASE_A37_FINAL_UI_VISUAL_QA_REPORT.md` (a prior, differently-scoped session's
output, dated the same day), independently records `next build` **passing** and separately notes
that it had deleted a corrupted `.next` directory after a concurrent `next build` + `next dev`
collision. That cleanup is the most likely reason the manifest desync from A.36 is no longer
present.

**Root cause: stale `.next` build manifest from an earlier interrupted/concurrent build,
already self-resolved by a subsequent `.next` cleanup before this phase began. Not a code
defect. No source files required a fix.**

## 2. Files Modified

**None.** No source file changes were required — the build already passes cleanly with the
current working tree and a clean `.next` output. No fixes were attempted or needed for
`/consent`, `/integrations`, environment handling, or server/client boundaries.

## 3. `/consent` Findings

`apps/admin-web/src/app/consent/page.tsx` builds and statically analyzes cleanly (appears in the
build's route table as `ƒ /consent`, 136 B). No server/client boundary violations, no
build-breaking `cookies()`/`headers()`/`redirect()` misuse, no missing Suspense boundary issues.
No fix needed.

## 4. `/integrations` Findings

`apps/admin-web/src/app/integrations/page.tsx` builds and statically analyzes cleanly (`ƒ
/integrations`, 261 B). No import, client/server boundary, or environment-variable issues
found. No fix needed.

## 5. Auth/Build Findings

`middleware.ts`, `/login`, `/auth/callback`, `/logout` all compiled successfully as part of the
same build (`ƒ Middleware`, 40 kB; `/login` 212 B; `/auth/callback` 136 B; `/logout` 136 B). No
build-time environment variables were required beyond what's already declared/validated in
`apps/admin-web/src/lib/env.ts`; the build did not need a live Hydra/Kratos/Postgres connection,
consistent with the architecture requirement that a production build must not depend on live
runtime services.

## 6. Targeted Validation (admin-web)

| Command                         | Result                                      |
| ------------------------------- | ------------------------------------------- |
| `pnpm --filter admin-web build` | **PASS** — 20/20 routes generated, 0 errors |

(`typecheck`/`lint`/`test` for admin-web are included in the full monorepo run below, all green.)

## 7. Full Monorepo Validation

| Command                         | Result                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                | **PASS** — 78/78 tasks (turbo, full cache)                                                                                                                     |
| `pnpm lint`                     | **PASS** — 78/78 tasks (turbo, full cache)                                                                                                                     |
| `pnpm arch`                     | **PASS** — depcruise: 0 violations, 1572 modules / 6857 dependencies cruised                                                                                   |
| `pnpm test`                     | **PASS** — 30 test files, 184 tests passed                                                                                                                     |
| `pnpm dup`                      | **NOT AVAILABLE** — no `dup` script defined in root `package.json`; command not found. Not fixed (adding a script is out of scope for a build-recovery phase). |
| `pnpm --filter admin-web build` | **PASS** — see above                                                                                                                                           |

## 8. Docker Availability

`docker --version` resolved (Docker Desktop 29.5.3 installed). `docker info` hung indefinitely
(30s+, no response) and was not force-killed or worked around, per the phase's instruction not
to attempt infrastructure workarounds. This is consistent with prior session records (A.12,
A.14, A.19-A.21 and the untracked `PHASE_A37_FINAL_UI_VISUAL_QA_REPORT.md`) of WSL2/Docker
being broken in this Windows environment. `docker compose ps` could not proceed either.

**Docker/WSL2 unavailable — infrastructure was not started, per instructions.**

## 9. Runtime Authentication Results

**Not performed — blocked by Docker/WSL2 unavailability.** Postgres, Hydra, Kratos, and Keto
could not be started, so no `login_challenge`/Kratos `flow` could be obtained and the
login → consent → callback → session → API golden path could not be exercised in a real
browser. This matches the finding already on record in the untracked visual-QA report.

## 10. Critical Route Results

**Not performed** for authenticated routes (dashboard, orders, customers, products, discounts,
content, automations, analytics, marketing, integrations, settings, and the three dynamic
detail routes) — same Docker/WSL2 blocker. All of these routes did, however, compile and
statically generate successfully during the production build (see route table in §1/§6),
confirming no build-time defect exists in any of them.

Unauthenticated-reachable behavior (consistent with the prior visual-QA session's findings, not
independently re-verified this phase since no source changes were made that could affect it):
`/` and `/login` correctly redirect toward Hydra's OAuth2 authorize endpoint when no session
cookie is present; `/api/healthz` is reachable without auth.

## 11. Arabic/RTL Results

**Not assessable** — requires authenticated, data-bearing screens unreachable without the live
Hydra/Kratos stack (same blocker as §9–10). No RTL-specific code was touched this phase.

## 12. Browser Console Results

**Not performed** — no authenticated session could be reached to load the pages that would
exercise runtime browser behavior. No client-side code was modified this phase, so no new
console-error risk was introduced.

## 13. Security Results

- No secrets added, no `.env` files created or tracked, no hardcoded OAuth client secrets, no
  JWTs, no private keys.
- No auth bypass, no middleware bypass, no `NODE_ENV` shortcuts — `middleware.ts` was not
  modified.
- No localhost fallback was introduced into production-path code — no source files were
  changed at all this phase.
- Repo secret scan: `git diff` against the Step 0 baseline is empty (zero files modified by
  this phase), so no new secret-scan surface was introduced. A full repo-wide scan was not
  re-run since nothing changed.

## 14. Working-Tree Integrity

Compared against the Step 0 snapshot (`git status --short`, captured before any action):

- **Zero files were modified, created, or deleted by this phase.** No fix was necessary once
  the build was reproduced and found to already pass.
- All pre-existing modified/untracked files from prior phases (A.30–A.36 admin-web/auth/Hydra/
  Kratos/Keto work, infra manifests, etc.) remain exactly as they were — untouched.
- One pre-existing anomaly, **not caused by this phase**, was observed and left alone per the
  "protect files not owned by this phase" rule: `.pnpm-store/v11/index.db` shows as a staged
  deletion (`D`) and `.gitignore` shows a pre-existing modification adding `.pnpm-store/` — both
  already present in the `git status` baseline captured at Step 0, before any command in this
  phase ran. Not reverted, not touched further.
- No build artifacts were accidentally staged or tracked; no temporary files were left behind
  by this phase (only read/list/validation commands were run).

## 15. Remaining Risks

1. Runtime/auth verification (Tasks 9–15) remains fully blocked by the persistently broken
   Docker/WSL2 environment on this machine. This has now been independently confirmed across
   at least five separate phases (A.12, A.14, A.19-A.21, and this one). A dedicated
   infrastructure-repair session (outside this phase's scope, which forbids infrastructure
   workarounds) is the only way to unblock runtime QA.
2. `pnpm dup` has no corresponding script — Task 8's full validation list assumes it exists.
   Flagged for the operator; not added here since introducing a new script/config is outside a
   build-recovery phase's mandate.
3. The A.36-reported build failure appears to have been a transient `.next` cache artifact, not
   a reproducible defect. Because no code change caused or fixed it, there's a residual risk
   that an interrupted build could reintroduce the same `PageNotFoundError` symptom in the
   future; if it recurs, the fix is `rm -rf apps/admin-web/.next` and a clean rebuild, not a
   source-code change.
4. ~49 pre-existing modified tracked files and ~40 untracked paths remain uncommitted from
   prior phases (A.30–A.36) — unrelated to and unaffected by this phase, flagged for the
   operator's awareness per standing sprint-isolation discipline (no cleanup commits made here).

## 16. Final Verdict

**BUILD RECOVERED — RUNTIME BLOCKED**

The `admin-web` production build passes cleanly (confirmed twice, cold and warm) with all 20
routes — including `/consent` and `/integrations` — compiling and statically generating without
error. Full monorepo `typecheck`/`lint`/`arch`/`test` gates are all green. No source changes
were required or made. Runtime/authentication verification (Tasks 9–15) could not be performed
because Docker/WSL2 remains unavailable in this environment, a pre-existing and repeatedly
documented limitation, not something introduced or masked by this phase.
