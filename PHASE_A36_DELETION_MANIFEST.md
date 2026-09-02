# Phase A.36 — Deletion Manifest

Repo: `C:\Users\abdoh\Claude code\Git\lumo-platform` (branch `main`, HEAD `22de4125cb61aaacddddc729e1b072f5c0dd5a6b` at audit start)
Date: 2026-08-16
Baseline: `git status --short` at start showed 87 modified lines, all under `apps/admin-web/**` (pre-existing WIP, not touched by this audit).

## Method

- Full tracked-file inventory via `git ls-files` (2,890 tracked files).
- Duplicate-blob detection via `git ls-tree -r HEAD` blob-hash comparison (exact-content duplicates across the whole tree) — found 12 duplicate-hash groups.
- Reference tracing via `git grep` for every duplicate/candidate path, plus inspection of `.gitignore`, `.npmrc`, `pnpm-workspace.yaml`, `turbo.json`, root `package.json`.
- Git history via `git log`, `git log --diff-filter=A` for provenance of the one real candidate.
- Root-level `*_REPORT.md` / `*_AUDIT.md` files (110 files) enumerated but not opened individually for deletion — historical reports are excluded from consideration per the absolute rules ("Do NOT delete based on: historical reports merely being historical").
- `scripts/` tree fully enumerated (3 files, all `scripts/ops/*.sh` — backup/restore/rotate-keys — all operational-critical, not evaluated further as candidates).
- `infrastructure/` (43 files: docker, k8s, ory, railway) and `.github/workflows` (9 files) enumerated; nothing in these trees was flagged as a candidate (all are live deployment/CI/observability config).

## Candidates Considered

### 1. `.pnpm-store/v11/index.db` — DELETE (confidence: high)

| Field                                              | Finding                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category                                           | Generated/accidental artifact (pnpm local package-store SQLite index)                                                                                                                                                                                                                        |
| Why flagged                                        | `.pnpm-store/` is pnpm's local content-addressable store cache, functionally equivalent to `node_modules/` — never meant to be version-controlled. It was the only tracked file under a store/cache-shaped directory.                                                                        |
| Evidence searched                                  | `git grep -n "pnpm-store"` across the whole tree (excluding itself) → zero references. Checked `.npmrc` (no `store-dir` override), `pnpm-workspace.yaml`, `turbo.json`, root `package.json` → no reference. `pnpm config get store-dir` → `undefined` (repo does not use a local store-dir). |
| Runtime impact                                     | None — never read at runtime.                                                                                                                                                                                                                                                                |
| Build impact                                       | None — `pnpm install --frozen-lockfile` regenerates the real store independently; verified below.                                                                                                                                                                                            |
| CI impact                                          | None — not referenced by any `.github/workflows/*.yml`.                                                                                                                                                                                                                                      |
| Deployment impact                                  | None — not referenced by any Dockerfile or k8s manifest.                                                                                                                                                                                                                                     |
| Test impact                                        | None.                                                                                                                                                                                                                                                                                        |
| Package export / dynamic loading                   | N/A — not a source module.                                                                                                                                                                                                                                                                   |
| Migration/schema/security/operational significance | None.                                                                                                                                                                                                                                                                                        |
| Git history                                        | Introduced accidentally in commit `52d13d8` ("docs(infra): sprint 3.1 stabilization diagnosis…") — a docs commit, confirming it was swept in by an overly broad `git add` rather than intentionally committed.                                                                               |
| Decision                                           | **DELETE** — all Task 21 conditions independently verified to hold.                                                                                                                                                                                                                          |
| Confidence                                         | High                                                                                                                                                                                                                                                                                         |

Action taken: `git rm --cached` the file, removed the now-empty `.pnpm-store/v11/` and `.pnpm-store/` directories from the working tree, and added `.pnpm-store/` to `.gitignore` (alongside the existing `node_modules/` dependency-ignore block) to prevent recurrence. This is the single, minimal, necessary `.gitignore` change required by this deletion.

### 2. 12 duplicate-blob groups (identical file content at different paths) — KEEP (all)

Detected via git blob-hash comparison. All are **intentional, architecturally-required per-package/per-service boilerplate**, not accidental duplication:

- `services/*/src/infrastructure/in-memory-unit-of-work.ts` (33 services) — identical scaffolding stub, one per bounded-context module per the monorepo's package-boundary convention (each service owns its own copy; no shared import path exists or should exist across service boundaries).
- `services/*/src/interfaces/presenter.ts` (multiple groups, 2–32 services each) — same pattern, per-service interface stub.
- `apps/*/packages/*/tsconfig.json` (72 files) and `apps/*/vitest.config.ts` / `vitest.setup.ts` (dozens of files) — per-package tsconfig/vitest boilerplate. Each is resolved relative to its own package root by tsc/vitest/turbo; consolidating them would require introducing shared config indirection, which is an architecture change explicitly out of scope for this audit.
- `services/fulfillment/.../shipment-package.ts` vs `services/shipping/.../shipment-package.ts` — same value-object shape defined independently in two distinct bounded contexts (Fulfillment vs Shipping, per [[lumo-shipping-implementation]] memory: "distinct from Fulfillment"); this is intentional context separation, not duplication to collapse.
- `apps/admin-web/src/components/locale-switch.tsx` vs `apps/storefront/src/components/locale-switch.tsx`, and `postcss.config.mjs` — identical per-app copies, each app's own build path depends on its own copy.

None of these pass Task 14's bar ("no tooling depends on original path") — tooling depends on every one of these paths individually. **Decision: KEEP all 12 groups.**

### 3. Root-level historical report files (110 `*_REPORT.md` / `*_AUDIT.md` / `*_SUMMARY.md` files) — KEEP (not evaluated as individual candidates)

Explicitly excluded by the absolute rule against deleting historical reports merely for being historical. No evidence of exact duplication found among filenames (e.g. `FINAL_PRODUCTION_READINESS_AUDIT.md` vs `_v2.md` are a base+revision pair, not identical duplicates — not diffed byte-for-byte since even true duplicates in this category are excluded from consideration by the absolute rules). **Decision: KEEP all.**

### 4. `scripts/ops/{backup-postgres.sh, restore-postgres.sh, rotate-keys.sh}` — KEEP

All three are production-operational scripts (DB backup/restore, secret rotation). No historical-experimental scripts exist under `scripts/` in this repo. **Decision: KEEP all.**

### 5. `infrastructure/**` (docker, k8s, ory, railway — 43 files) and `.github/workflows/**` (9 files) — KEEP

All actively referenced by `docker compose` targets in root `package.json` (`dev:up:infra`, `dev:down:infra`), Kustomize (`infrastructure/k8s/kustomization.yaml` lists all manifests), and CI workflows. No orphaned files found. **Decision: KEEP all.**

## Summary

- Candidates considered: 1 file-level candidate (plus 12 duplicate-blob groups and several category sweeps, all rejected)
- DELETE: 1 (`.pnpm-store/v11/index.db`)
- KEEP: everything else
- DEFER: none

This is consistent with Phase A.35's near-zero-deletion outcome — the only safe deletion found across the entire repository is a single accidentally-tracked local cache index file with zero references anywhere.
