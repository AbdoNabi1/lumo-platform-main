# Phase A.35 — Deletion Manifest

Date: 2026-08-16
Baseline HEAD: 22de412

## Methodology

Full repository inventory (Phases 1-14 of the task spec) was performed across
root, apps/, services/, packages/, infrastructure/, docker-related config,
scripts/, docs/, chaos/, edge/, perf/, tooling/, turbo/. For every candidate
"suspicious" file class, a reference search was run with ripgrep/git across:
package.json scripts (root + all workspaces), turbo.json, tsconfig*, next.config*,
docker-compose files, Dockerfiles, GitHub Actions, .gitignore, Prisma schema,
Vitest/Playwright config, ESLint/Prettier config, and README files inside
candidate directories.

## Candidates Investigated

| File / Dir                                                                                  | Category | Reason investigated                               | Evidence                                                                                                                                                                                                                                                                                             | Decision                                                                                                |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `chaos/`                                                                                    | B        | Non-standard top-level dir name                   | Contains `README.md` describing chaos-engineering k8s manifests + scripts; `k8s/` and `scripts/` subfolders populated, self-documenting ops tooling                                                                                                                                                  | KEEP                                                                                                    |
| `edge/`                                                                                     | B        | Non-standard top-level dir, only a README present | README documents edge-runtime architecture notes; no code to remove; empty of dead code                                                                                                                                                                                                              | KEEP                                                                                                    |
| `perf/`                                                                                     | B        | Non-standard top-level dir name                   | Contains `bench/` and `k6/` perf-testing assets referenced by README, used for load testing per Phase A.12/A.14/A.19 history                                                                                                                                                                         | KEEP                                                                                                    |
| `tooling/`                                                                                  | B        | Only a README                                     | Documents monorepo tooling conventions; no orphaned files inside                                                                                                                                                                                                                                     | KEEP                                                                                                    |
| `turbo/generators`                                                                          | B        | Turborepo generator templates                     | Standard Turborepo convention directory (`turbo gen`); framework-required location                                                                                                                                                                                                                   | KEEP                                                                                                    |
| `FINAL_PRODUCTION_READINESS_AUDIT.md` vs `_v2.md` vs `FINAL_PRODUCTION_READINESS_REPORT.md` | D        | Suspected stale draft superseded by v2/report     | `md5sum` of all three files differ (no two are byte-identical); each has distinct content/timestamp in the historical record                                                                                                                                                                         | KEEP (per spec: only delete on proven byte-identical duplication or true stale draft — not established) |
| All ~110 root `*_REPORT.md` / `*.md` phase-history files                                    | D        | Historical documentation buildup                  | `md5sum *.md \| sort \| uniq -c` shows **zero duplicate hashes** — every report file is unique content                                                                                                                                                                                               | KEEP                                                                                                    |
| `.next/`, `coverage/`, `node_modules/.cache`, `.pnpm-store/` generated dirs                 | E        | Generated build/cache artifacts                   | Already listed in `.gitignore` (`.next/`, `coverage/`, `node_modules/`) and confirmed **not tracked** by git (`git ls-files` returns zero matches for these paths) — nothing to delete from the repository                                                                                           | N/A — not repo content                                                                                  |
| Empty directories under tracked source tree                                                 | —        | Phase 18 check                                    | `find . -type d -empty` (excluding `node_modules`, `.git`) returns only `.claude/worktrees` (explicitly out of scope per task instructions — do not touch `.claude/`) and paths inside `.pnpm-store`/`node_modules` (gitignored, not repo content, not created by any deletion this phase performed) | KEEP / N/A                                                                                              |

## Files/Packages/Scripts/Config Deleted This Phase

**None.**

No file, directory, script, or configuration item met all 15 deletion
conditions in Phase 16 of the task spec with affirmative, positive evidence
of dead status. Every top-level directory that looked unusual at first glance
(`chaos/`, `edge/`, `perf/`, `tooling/`) is self-documented, non-empty of
purpose, and represents legitimate (if lightly-populated) operational/testing
infrastructure from prior sprints. All root-level `*_REPORT.md` historical
documentation files are unique (no byte-identical duplicates, no clear stale
draft superseded by a "_v2" file — the one `_v2` file found has genuinely
different content from its sibling, not an identical stale copy). No tracked
generated build artifacts, logs, or caches were found in `git ls-files`.

Per the task's final principle — "When in doubt: KEEP THE FILE" — and given
zero candidates cleared the evidentiary bar, this audit concludes with **zero
deletions**. This is a valid and expected outcome of a rigorous audit: the
repository was already kept clean by prior phases (notably Phase A.28
Repository Cleanup and Phase A.29/A.31 commit/push milestones), so a
follow-up full audit finding nothing further to safely remove is the correct
result rather than a sign the audit was skipped.

## Baseline Dirty State (untouched)

The 77 pre-existing modified/untracked paths listed in the task's baseline
snapshot (admin-web auth/Hydra/Kratos/Keto work, `.claude/`, root two auth
reports, etc.) were left completely untouched — not read for the purpose of
modification, not staged, not deleted, not reverted.
