# Sprint A0 — Lockfile Reproducibility Repair: Analysis

**Status:** Analysis only — no repair applied yet. This document is the gate the user's
instructions require before `pnpm-lock.yaml` may be touched.

**Scope:** This is an isolated baseline-defect repair against the already-frozen Sprint A0
commit. It is explicitly **not** part of, and does not touch, the Repository History Recovery
work (`REPOSITORY_HISTORY_RECOVERY.md`, `recovery/history-reconstruction` branch/worktree).

## 1. Environment

To avoid disturbing the large pre-existing body of uncommitted work in the main working tree
(`C:\Users\abdoh\Claude code\Git\lumo-platform`, currently 10 commits ahead of `main`'s frozen
baseline with hundreds of dirty files — confirmed via `git status`), this analysis was performed
in a **separate, freshly created git worktree**, checked out detached at the exact frozen commit:

- Worktree path: `C:\Users\abdoh\Claude code\Git\lumo-platform-a0-lockfile-repair`
- Checked out commit: `2dc8e0b9ba90517039a7240861535fb53127fbee`
  (`feat(platform): implement Sprint A0 infrastructure foundations`)
- This is the exact commit tag `sprint-a0-complete` points at (verified: tag → commit
  `2dc8e0b9b...`, matching [[lumo-a0-preconditions]] memory record).
- `git status` in the new worktree at checkout time: `nothing to commit, working tree clean` —
  i.e. the analysis started from the pristine frozen state, not from any dirty tree.
- pnpm version: `11.9.0`

No file in the main working tree or the `lumo-platform-recovery` worktree was read, staged, or
modified to produce this analysis.

## 2. Reproduction of the defect

### 2.1 The declared dependency

Both `packages/messaging/package.json` and `packages/kafka/package.json`, as committed in
`2dc8e0b`, declare:

```json
"@platform/repository": "workspace:*"
```

as a runtime `dependencies` entry (not `devDependencies`). `packages/repository/package.json`
exists and is already a resolved workspace member in the lockfile (used by many other
importers), so this is not a missing package — it's a missing _edge_ in two importers.

### 2.2 The lockfile's importer entries omit it

`pnpm-lock.yaml` (as committed in `2dc8e0b`) has importer blocks for both packages
(`packages/kafka:` at line 677, `packages/messaging:` at line 717), but neither block lists
`@platform/repository` under `dependencies` — every other declared dependency of each package is
present except this one.

### 2.3 Proof via `pnpm install --frozen-lockfile`

Run from the clean worktree, against the committed lockfile, no edits made:

```
Scope: all 44 workspace projects
✓ Lockfile passes supply-chain policies (verified 22d ago)
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>\packages\messaging\package.json

  Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
* 1 dependencies were added: @platform/repository@workspace:*
```

This is the baseline defect: **Sprint A0, as committed, is not reproducible** —
`pnpm install --frozen-lockfile` (what CI and any clean clone must run) fails immediately.
pnpm reports the `messaging` mismatch first; `kafka` has the identical mismatch (confirmed
independently in §2.2 and in the diff below), it's just not reached because pnpm fails fast on
the first outdated importer it finds.

## 3. Regeneration and diff

Procedure:

1. `Copy-Item pnpm-lock.yaml pnpm-lock.yaml.orig` (backup for diffing, untracked, not part of
   the repair).
2. `pnpm install --no-frozen-lockfile` — the only way to let pnpm re-resolve and rewrite the
   lockfile; no `package.json` was touched by this command (pnpm only ever writes
   `pnpm-lock.yaml` and `node_modules` here — verified by `git status` after, §4).
3. `git diff -- pnpm-lock.yaml` against the commit.

### 3.1 Exact diff

```diff
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -688,6 +688,9 @@ importers:
       '@platform/messaging':
         specifier: workspace:*
         version: link:../messaging
+      '@platform/repository':
+        specifier: workspace:*
+        version: link:../repository
       '@platform/utils':
         specifier: workspace:*
         version: link:../utils
@@ -725,6 +728,9 @@ importers:
       '@platform/domain-events':
         specifier: workspace:*
         version: link:../domain-events
+      '@platform/repository':
+        specifier: workspace:*
+        version: link:../repository
       '@platform/utils':
         specifier: workspace:*
         version: link:../utils
```

`git diff --stat`: `pnpm-lock.yaml | 6 ++++++` — **1 file changed, 6 insertions(+), 0
deletions(-)**. Whole-file line count: 8929 → 8935 (+6), consistent with exactly two 3-line
insertions and nothing else.

## 4. Explanation of every changed line

| Line added                      | Section                                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'@platform/repository':`       | `importers. packages/kafka .dependencies`     | Registers the dependency key already declared in `packages/kafka/package.json` line 22, alphabetically ordered between `@platform/messaging` and `@platform/utils` (pnpm sorts importer dependency keys alphabetically — matches the existing ordering convention of every other importer block in the file).                                                                                                                                                                                                                                                                                                           |
| `specifier: workspace:*`        | same                                          | Echoes the exact version range from `package.json` verbatim — identical string already used for every other `workspace:*` dependency in both files. Not a new specifier value; not a resolution decision.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `version: link:../repository`   | same                                          | The resolved workspace link target. `packages/repository` is a sibling directory of `packages/kafka` and `packages/messaging` under `packages/`, so the relative path is `../repository` — identical in form to the pre-existing `link:../messaging`, `link:../utils`, `link:../health`, etc. entries already present in the same blocks. This is not a new resolution: `packages/repository` was already present and linked elsewhere in the lockfile (`importers. packages/repository:` block, and as a link target for numerous other importers) — this just adds the missing edge from `kafka`/`messaging` _to_ it. |
| (three more, identical in kind) | `importers. packages/messaging .dependencies` | Same three lines, same reasoning, for the `messaging` importer, matching `packages/messaging/package.json` line 21.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

No other line in the file changed. No key was removed, reordered, or had its value changed.

## 5. Proof that no unrelated package changed

- `git diff --stat -- pnpm-lock.yaml` → exactly 6 insertions, 0 deletions, 1 file.
- `git diff -- pnpm-lock.yaml` (full, reproduced in §3.1) contains exactly two hunks, both
  confined to the `importers:` top-level section, at the `packages/kafka` and
  `packages/messaging` blocks specifically (line ranges 677–716 and 717–747 pre-change).
- The top-level `lockfileVersion: '9.0'` header (line 1) and `settings:` block (lines 3–5) are
  unchanged — confirmed by direct read, not present in the diff.
- The `packages:` section (external npm package registry/version list) has **zero** diff lines.
  No package version was added, removed, or bumped — `@platform/repository` needed no new
  registry resolution because it is a workspace link, not an npm package.
- The `snapshots:` section (dependency-tree resolution snapshots for npm packages) has **zero**
  diff lines.
- Every other importer block (all 44 workspace projects) — `apps/*`, and every other
  `packages/*` / `services/*` importer — is byte-identical before and after.
- `git status --porcelain` after regeneration shows exactly one tracked-file change:
  `M pnpm-lock.yaml`, plus the untracked backup file `pnpm-lock.yaml.orig` created solely for
  this diff (not part of the repair, will not be committed).
- No `package.json` anywhere in the tree was modified (`pnpm install --no-frozen-lockfile` only
  rewrites the lockfile and `node_modules`; `git status` confirms no `package.json` appears as
  modified).
- No governance, Husky, lint-staged, architecture, or version-pinning file appears in the diff or
  in `git status` — this command touches only the lockfile.

## 6. Proof that the dependency graph is identical

- `packages/repository` was **already** a resolved workspace member of the lockfile before this
  change (its own `importers. packages/repository:` block already existed at line 828 of the
  original file, and it was already a `link:../repository` target for other importers such as
  `packages/messaging`'s siblings). Adding the `kafka`/`messaging` → `repository` edge does not
  introduce a new node into the graph — it only adds two edges that should already have existed,
  connecting two existing nodes.
- No transitive npm dependency of `@platform/repository` needed re-resolution: `@platform/repository`
  is itself a workspace package (`workspace:*`, `link:` protocol), so linking to it pulls in
  no new external package versions. This is why the `packages:`/`snapshots:` sections have zero
  diff (§5) — there is nothing new to resolve, only a wiring omission to correct.
- `pnpm install --no-frozen-lockfile`'s own summary output listed only devDependency version
  notices for the workspace root (`@changesets/cli`, `eslint`, `turbo`, etc. — informational
  "newer version available" notices, not applied changes.) It reported **zero** added, removed,
  or updated dependencies for any workspace package, and the diff proves the lockfile content
  agrees: nothing in `packages:`/`snapshots:` moved.
- No integrity hash changed anywhere in the file (no `checksum:`/`resolution:` line appears in
  the diff) — confirming the instruction "do not change integrity hashes unless unavoidable" is
  satisfied trivially: it was not necessary at all, because no npm package resolution changed.

## 7. Proof that only the missing importer references were added

Combining §3–§6: the entire diff is exactly the two missing `@platform/repository` dependency
entries in the `packages/kafka` and `packages/messaging` importer blocks — the exact defect
predicted by the task (matching `package.json` declarations that were absent from the lockfile).
Nothing else in the 8929-line file changed.

## 8. Verdict

**Diff is minimal and isolated.** No unrelated change of any kind was found. Per the governing
instructions, the repair may proceed: `pnpm-lock.yaml` may be updated with exactly this 6-line
diff, and `pnpm install --frozen-lockfile` should then be re-run to prove reproducibility.

No blocker report is required.
