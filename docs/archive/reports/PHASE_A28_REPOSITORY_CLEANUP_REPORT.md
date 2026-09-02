# Phase A.28 — Repository Cleanup & Stale Worktree Resolution

Date: 2026-08-15
Repository: `lumo-platform` (`C:\Users\abdoh\Claude code\Git\lumo-platform`)
Scope: repository cleanup and stale-worktree resolution only — no production code, public
API, or event-contract changes; no commits; no pushes; no history rewrites.

---

## 1. Initial Repository State

| Item                                            | Value                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD                                            | `1b4ff76e32b53647e11567f0a27166ac0e0554f2` (`feat(payments): real Stripe PSP integration, replacing dev-only payment adapters (C2-2)`) |
| `main` vs `origin/main`                         | in sync (`## main...origin/main`, no ahead/behind)                                                                                     |
| Modified/untracked paths (`git status --short`) | 309                                                                                                                                    |
| Local branches                                  | `main` (current), `recovery/history-reconstruction`, `reference/working-tree-2026-08-03`, `worktree-agent-a861b6bcc84bca9af`           |
| Remote branches                                 | `origin/HEAD -> origin/main`, `origin/main`, `origin/reference/working-tree-2026-08-03`                                                |
| Registered worktrees                            | 4 (see §2)                                                                                                                             |
| Stash entries                                   | 1 — `stash@{0}: lint-staged automatic backup (be9f164)`                                                                                |

None of the 309 pre-existing modified/untracked paths were staged, committed, reset, or
deleted at any point in this phase.

---

## 2. Worktree Analysis

Four worktrees were registered at the start of this phase. Only the one named in the task
(`.claude/worktrees/agent-a861b6bcc84bca9af`) was in scope for possible removal; the other two
extra worktrees discovered during inspection (`lumo-platform-a0-lockfile-repair`,
`lumo-platform-recovery`) were left untouched — out of scope, not mentioned in the task.

| Worktree                                         | HEAD      | Branch                             | In scope                     |
| ------------------------------------------------ | --------- | ---------------------------------- | ---------------------------- |
| `lumo-platform` (main)                           | `1b4ff76` | `main`                             | n/a (this repo)              |
| `.claude/worktrees/agent-a861b6bcc84bca9af`      | `1b4ff76` | `worktree-agent-a861b6bcc84bca9af` | **yes — target of Task 2/5** |
| `lumo-platform-a0-lockfile-repair` (sibling dir) | `2dc8e0b` | detached                           | no — untouched               |
| `lumo-platform-recovery` (sibling dir)           | `ee70711` | `recovery/history-reconstruction`  | no — untouched               |

### Stale-worktree comparison table (Task 2)

| Question                                 | Finding                                                                                                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ahead/behind main?                       | **0 / 0** — `worktree-agent-a861b6bcc84bca9af` points to the exact same commit as `main` (`1b4ff76`)                                                                                                                                               |
| Unique commits?                          | **None** (`git log main..worktree-agent-a861b6bcc84bca9af` empty)                                                                                                                                                                                  |
| Tracked modifications?                   | **None** — `git status --short` inside the worktree showed 0 modified tracked files                                                                                                                                                                |
| Untracked files?                         | **2** — both under `services/identity/src/infrastructure/`: `prisma-access-repositories.integration.test.ts`, `prisma-customer-repository.integration.test.ts`                                                                                     |
| Unique source code?                      | No                                                                                                                                                                                                                                                 |
| Unique tests?                            | **No** — both untracked test files are _older drafts_ of files that already exist, in an improved form, as untracked files in `main`'s own working tree (see below)                                                                                |
| Unique reports/docs?                     | None                                                                                                                                                                                                                                               |
| Newer or older than main's working tree? | **Older** — worktree copies were last written 06:48, main's copies 07:00–07:01 same day; main's copies use a newer helper (`createTestPrismaClient`) and fix an outbox-scoping race under parallel test runs that the worktree's copies don't have |

**Conclusion:** zero unique commits, zero unique production code, zero unique tests, zero
irreplaceable files → safe to remove per Task 5's criteria.

---

## 3. Stash Analysis (`stash@{0}`, "lint-staged automatic backup", parent `be9f164`)

`git stash show --stat` reports **2,116 files changed** (1,945 added, 170 modified, 1 deleted,
+199,823/−1,466 lines) — a very large snapshot.

**Key finding:** this stash is content-identical (modulo cosmetic formatting) to the
`reference/working-tree-2026-08-03` branch, which is already committed (commits `de46df9`,
`ab3e466`, `f0e9a5b`) **and pushed** to `origin/reference/working-tree-2026-08-03`. Comparison:

- `git diff --name-only stash@{0} reference/working-tree-2026-08-03` → **184 files differ**,
  **0 files exist on only one side**. The other 1,932 files (91%) are byte-identical.
- Of the 184 differing files, spot-checks across docs (`docs/DECISIONS.md`, `README.md`) and
  source (`services/cart/src/infrastructure/cart.mapper.ts`) show the differences are Prettier
  reformatting only (markdown emphasis style, line-wrapping) — no semantic change. The
  insertion/deletion counts are symmetric (e.g. `EVIDENCE_MATRIX_V5.md`: 83+/83−), consistent
  with reformatting rather than content edits.
- A small subset (~8 files: `apps/runtime/src/modules/entitlement.module.ts`,
  `packages/auth/src/kratos.ts`, `packages/db/src/audit/prisma-audit-trail.ts`,
  `services/cart/src/interfaces/cart.controller.ts`,
  `services/catalog/src/domain/category.test.ts`,
  `services/wishlist/src/infrastructure/prisma-wishlist-repository.ts`, etc.) show the
  reference branch's copy is drastically shorter/emptied compared to the stash's copy — an
  artifact of that branch's own commit message ("include prettier-reformatted files from the
  **aborted** first commit attempt"). This is _not_ a loss risk: `main`'s current working tree
  already has fresh, non-empty, actively-modified versions of every one of these files (part of
  the 309 pre-existing paths), so both the stash's and the reference branch's copies are simply
  stale relative to `main`'s live state.
- `.github/workflows/*.yml`: `main`'s current tracked copies of `build.yml`,
  `db-integration.yml`, `deploy.yml`, `validate.yml` are **newer/more complete** than the
  stash's copies (diff shows only additions on `main`'s side); `ory-integration.yml`,
  `release.yml`, `security.yml` are identical. `main` additionally has `ci.yml`, which the stash
  doesn't.

### Files considered valuable

Root-level evidence/governance/recovery markdown reports exist in the stash (and on
`reference/working-tree-2026-08-03`) but **do not exist anywhere in `main`'s current working
tree** — the only genuinely useful thing to surface out of this stash:

`A1_COMMIT_BLOCKER_REPORT.md`, `BLOCKER_REPORT.md`, `CUSTOMER360_ARCHITECTURE_AUDIT.md`,
`CONFIDENCE_SUMMARY(.V5).md`, `EVIDENCE_GAPS(.V5).md`, `EVIDENCE_MATRIX(.V4/.V5).md`,
`EXECUTION_TIMELINE(.V4/.V5).md`, `FINAL_EXECUTION_PLAN(.V4/.V5).md`,
`FINAL_RECOVERY_CHECKLIST.md`, `FINAL_VERDICT(.V5).md`,
`GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`, `GOVERNANCE_POSITION_IN_HISTORY.md`,
`PATCH_OWNERSHIP_MATRIX(.V4/.V5).md`, `RECOVERY_DEPENDENCY_GRAPH(.V4/.V5).md`,
`RECOVERY_DOCUMENT_CORRECTIONS.md`, `RECOVERY_ERRATA_V4.md`,
`REPOSITORY_HISTORY_RECOVERY(.BASELINE_UPDATE/.V2/.V3/.V5).md`, `REVIEW_FINDINGS(.V5).md`.

Two tooling configs also stood out as genuinely different from `main`:

- `.dependency-cruiser.cjs` — stash's copy has extra architecture-governance rules
  (`FF-ARCH-10..15`, tracking-platform layering) that `git log -- .dependency-cruiser.cjs` shows
  were **never actually committed to `main`**; they exist only in this stash / the reference
  checkpoint.
- `.jscpd.json` — a copy-paste-detector config that doesn't exist in `main` at all.

### Files considered obsolete

Raw command-output/scratch logs at repo root, not documentation:
`test_admin.txt`, `test_finance.txt`, `test_fulfillment(2).txt`, `test_full(2/3/4).txt`,
`test_orders.txt`, `test_runtime3.txt`, `tsc_*.txt` (14 files), `typecheck_out(2-5).txt`,
`arch_out(1-4).txt`, `dup_out(1-4).txt`, `gov_index(1-2).txt`, `gov_update(1-2).txt`,
`governance_out(1-6).txt`, `runtime_test_out(1-2).txt`. These are tool-output captures (tsc,
typecheck, dependency-cruiser, jscpd, governance scripts), not source or documentation — left
out of the archive (not deleted; still recoverable from the stash and from
`reference/working-tree-2026-08-03` if ever needed).

Also considered obsolete for archiving purposes: the unversioned/older members of each
versioned report family (e.g. `EVIDENCE_MATRIX.md`/`EVIDENCE_MATRIX_V4.md` once `_V5` exists) —
superseded by the newest version, which was archived instead, per Task 4's "keep the newest
authoritative version" instruction.

---

## 4. Files Archived

New directory: `docs/archive/phase-a28-stash-review/` (see its own `README.md` for full
provenance notes). Contents:

- 18 evidence/governance/recovery markdown reports (newest version of each family; see §3)
- `dependency-cruiser.cjs.stash-version` — candidate config, **not applied** to the live
  `.dependency-cruiser.cjs`
- `jscpd.json.candidate` — candidate config, **not applied** (no `.jscpd.json` exists in `main`)
- `stale-worktree-untracked-backup/` — the 2 untracked test files from the removed worktree
  (`prisma-access-repositories.integration.test.ts`,
  `prisma-customer-repository.integration.test.ts`), kept as extra insurance even though they
  were assessed as older/inferior drafts of files already present in `main`'s own working tree

Nothing from `services/**`, `packages/**`, or `apps/**` in the stash was merged or copied — per
Task 4, source-code differences are reported here (§3), not auto-merged.

---

## 5. Worktree Removal Result

`git worktree remove .claude/worktrees/agent-a861b6bcc84bca9af` (no `--force`) was tried first
and refused, as expected, because of the 2 untracked files. Those 2 files were backed up (see
§4) before proceeding.

`git worktree remove --force` was then used. Git successfully deregistered the worktree from
its internal tracking on the first attempt, but the directory deletion itself failed partway
through with `Filename too long` — a Windows `MAX_PATH` limitation hit inside the worktree's own
`node_modules/.pnpm/...` tree (pnpm's nested store paths routinely exceed 260 characters). The
worktree was already deregistered from `git worktree list` at that point, so this was a plain
filesystem cleanup problem, not a git-state problem.

Resolved with the standard Windows workaround: `robocopy <empty-dir> <target> /MIR` (which
handles long paths natively) to empty the tree, followed by removing the now-empty directory.
Confirmed empty afterward.

**Result: the stale worktree directory and its git registration are both fully removed.** The
branch `worktree-agent-a861b6bcc84bca9af` itself was left untouched (`git worktree remove` does
not delete branches, and branch deletion was not requested by this task) — it still appears in
`git branch -a`, now without a checked-out worktree.

---

## 6. Stash Preservation Result

**The stash was never touched.** `git stash list` before and after every operation in this
phase shows the same single entry:

```
stash@{0}: lint-staged automatic backup (be9f164)
```

Same commit hash (`be9f1641305bf5426fcb920510898e11569d8f0c`) throughout. Not dropped, not
popped, not applied.

---

## 7. Final Git Status

```
$ git worktree list
C:/Users/abdoh/Claude code/Git/lumo-platform                    1b4ff76 [main]
C:/Users/abdoh/Claude code/Git/lumo-platform-a0-lockfile-repair 2dc8e0b (detached HEAD)
C:/Users/abdoh/Claude code/Git/lumo-platform-recovery           ee70711 [recovery/history-reconstruction]

$ git stash list
stash@{0}: lint-staged automatic backup (be9f164)

$ git branch -a
* main
+ recovery/history-reconstruction
  reference/working-tree-2026-08-03
  worktree-agent-a861b6bcc84bca9af
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
  remotes/origin/reference/working-tree-2026-08-03

$ git status --short | wc -l
310   # 309 pre-existing + 1 new (docs/archive/, this phase's only addition)

$ git rev-parse HEAD
1b4ff76e32b53647e11567f0a27166ac0e0554f2   # unchanged
```

No commits were created. No pushes were performed. No history was rewritten. The pre-existing
staged state (`.env.example`, `infrastructure/docker/docker-compose.yml` showed up in
`git diff --cached` both before and after — untouched by this phase) was left exactly as found.

---

## 8. Disk-Space Impact

Exact pre-deletion size of `.claude/worktrees/agent-a861b6bcc84bca9af` was not captured before
removal (not measured in Task 2, and by the time this was noticed the directory was already
gone). It contained a full `pnpm install` (its own `node_modules/.pnpm/...` store, including a
duplicated Next.js build), plus a full checkout of the repo at `1b4ff76`. As a proxy, the
sibling worktree `lumo-platform-a0-lockfile-repair` (also a full checkout + its own
`node_modules`) measures **1.2 GB** — the removed worktree was very likely in the same range.
`.git` itself is unaffected (11 MB, unchanged — worktree removal only touches working-tree
files and `.git/worktrees/<name>` metadata, never object storage). `.git/worktrees/` now lists
only the two remaining legitimate worktrees (`lumo-platform-a0-lockfile-repair`,
`lumo-platform-recovery`); the `agent-a861b6bcc84bca9af` entry is fully gone, confirming clean
deregistration.

`docs/archive/phase-a28-stash-review/` added: ~413 KB (documentation + 2 config candidates + 2
backup test files).

Net effect: one full duplicate `node_modules` + repo checkout removed; ~413 KB of documentation
added. No data was lost — everything in the removed worktree was independently verified to
already exist, in a newer form, either in `main`'s working tree or in the stash.

---

## 9. Anything Requiring Manual Approval

1. **`.dependency-cruiser.cjs` gap** — `main`'s currently tracked config is missing the
   `FF-ARCH-10..15` tracking-platform layering rules that exist in the stash / reference
   checkpoint (`docs/archive/phase-a28-stash-review/dependency-cruiser.cjs.stash-version`).
   These were never committed to `main`'s real history. A human should decide whether to port
   them in — this phase deliberately did not touch the live config.
2. **`.jscpd.json`** — doesn't exist in `main` at all;
   `docs/archive/phase-a28-stash-review/jscpd.json.candidate` holds the stash's copy. Left for
   manual decision on whether to adopt it.
3. **`worktree-agent-a861b6bcc84bca9af` branch** — still exists locally, now with no checked-out
   worktree. Not deleted (out of scope for this phase); a human may want to delete it separately
   once confirmed it's no longer needed.
4. **Two other worktrees found but not in scope** — `lumo-platform-a0-lockfile-repair`
   (detached HEAD at `2dc8e0b`) and `lumo-platform-recovery`
   (`recovery/history-reconstruction` at `ee70711`) exist as sibling directories and were left
   completely untouched; Phase A.28 only targeted `.claude/worktrees/agent-a861b6bcc84bca9af`.
5. **The stash itself** — per instructions it was preserved, not dropped. It is now known to be
   ~99% redundant with `reference/working-tree-2026-08-03` (already pushed to origin), so it is
   very likely safe to drop in a future phase — but that decision is explicitly left to a human,
   not made here.

## Summary

- **Deleted:** the stale worktree directory `.claude/worktrees/agent-a861b6bcc84bca9af` (git
  registration + all files, including its `node_modules`). Nothing else was deleted.
- **Archived:** 18 evidence/governance/recovery docs + 2 candidate tooling configs + 2
  backup test files, all under `docs/archive/phase-a28-stash-review/`.
- **Preserved:** all 309 pre-existing modified/untracked paths in the main working tree,
  untouched; the stash (`stash@{0}`), untouched and still present.
- **Stale worktree removed:** yes.
- **Stash still exists:** yes — same hash as at the start.
- **Committed or pushed:** no — nothing was committed, nothing was pushed, `HEAD` is unchanged.
