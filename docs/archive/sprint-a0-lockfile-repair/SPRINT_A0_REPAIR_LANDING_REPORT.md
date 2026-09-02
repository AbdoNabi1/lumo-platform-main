# Sprint A0 — Lockfile Reproducibility Repair: Landing Report

**Type:** Isolated baseline-defect repair, landed. **Not** part of Repository History Recovery
(not resumed by this task).

**Prerequisites:**

- [SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md](./SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md) — proved the
  required change before any repair was applied.
- [SPRINT_A0_REPRODUCIBILITY_REPAIR_REPORT.md](./SPRINT_A0_REPRODUCIBILITY_REPAIR_REPORT.md) —
  recorded the validated fix, prior to landing.

## 1. Commit

|             |                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Hash        | `ecb4a05461d83b5226a0f36111e19d7353abb165`                                                            |
| Branch      | `main`                                                                                                |
| Parent      | `830138acca9e378d8d2fe570d2a5a8cec14662a7` (Sprint A0 baseline-record commit — was the tip of `main`) |
| Grandparent | `2dc8e0b9ba90517039a7240861535fb53127fbee` (Sprint A0 implementation commit)                          |
| Message     | `fix(lockfile): restore Sprint A0 reproducibility` (full body as specified, verbatim)                 |

`main` now points at `ecb4a05`; it was a straight fast-forward from `830138a` (no merge, no
rewrite of any existing commit).

## 2. Files committed

**Exactly one file:**

```
pnpm-lock.yaml | 6 ++++++
1 file changed, 6 insertions(+)
```

No other file — tracked or otherwise — is part of this commit.

### How isolation was enforced

`main`'s working tree carries a large amount of pre-existing uncommitted work (hundreds of
modified files, an 8-file staged set for the separate Repository History Recovery effort — the
same state noted in the Sprint A0 freeze). A plain `git add pnpm-lock.yaml && git commit` was not
safe here: the working tree's own `pnpm-lock.yaml` is _also_ modified, but by unrelated
pre-existing pollution (it reflects a much later, uncommitted state of the whole workspace), and
the real index already had the 8 Recovery files staged.

The commit was built with plumbing, entirely via a temporary index (`GIT_INDEX_FILE`), so neither
the real index nor any working-tree file was touched:

1. `git hash-object -w` on the validated repaired `pnpm-lock.yaml` (produced and diff-verified in
   the isolated worktree in the prior analysis step) → blob `27ec85ff39cf3b5b3b84d314bfd4d2e4af7dc57b`.
2. In a temp index: `git read-tree HEAD`, then `git update-index --cacheinfo 100644,<blob>,pnpm-lock.yaml`
   — HEAD's tree with only that one path's blob replaced.
3. `git write-tree` → new tree `ee80ede847605eaeb86f0ad1ae5453cb64d9ff69`. Verified
   (`git diff HEAD <tree>`) that it differs from HEAD by exactly the 6-line lockfile diff — nothing
   else.
4. `git commit-tree <tree> -p HEAD -F <message file>` → commit `ecb4a05`.
5. `git update-ref refs/heads/main ecb4a05 830138a` — moved the branch pointer with an
   old-value guard (fails if `main` had moved since read, preventing a clobber), never touching
   the working tree or the real index.

**Verified post-move:**

- `git diff --cached --stat` — the 8 previously-staged Repository History Recovery files are
  still staged, unchanged, plus `pnpm-lock.yaml` now shows only against the new HEAD (expected,
  since the real index's `pnpm-lock.yaml` entry was never touched — it's still the pre-existing
  dirty blob from before this task, now diffed against a HEAD that is 6 lines further along).
- No file's on-disk content or mtime in the working tree was altered by this operation — only the
  `refs/heads/main` pointer moved.

## 3. Final diff summary

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

Identical to the diff validated in the analysis and pre-landing report — nothing changed between
validation and landing.

## 4. Frozen-lockfile verification

Run against the isolated worktree, whose `pnpm-lock.yaml` is byte-identical to the one now
committed at `ecb4a05` (same blob `27ec85ff39...`):

```
> pnpm install --frozen-lockfile
Scope: all 44 workspace projects
Already up to date
Done in 2.7s using pnpm v11.9.0
```

Exit code `0`.

## 5. Confirmation

- Sprint A0's frozen commits (`2dc8e0b`, `830138a`) were **not** amended, rebased, or rewritten.
- `main` now includes a new, explicit, superseding commit (`ecb4a05`) that fixes exactly the
  reproducibility defect, and nothing else.
- **Sprint A0 is now reproducible:** a clean clone/checkout of `main` at `ecb4a05` (or `2dc8e0b`
  plus this commit) can run `pnpm install --frozen-lockfile` successfully.
- No `package.json`, source file, governance rule, Husky hook, lint-staged config, architecture
  doc, or dependency version was touched, by this commit or by the process used to land it.
- No pre-existing uncommitted work in `main`'s working tree, and no previously-staged file for
  Repository History Recovery, was disturbed.

## 6. Documentation status

Per instructions, documentation is **not** committed as part of this task:

- `docs/implementation/SPRINT_A0_REPORT.md` — updated in place with the "§6 Post-release
  reproducibility repair" addendum.
- `docs/implementation/SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md`,
  `SPRINT_A0_REPRODUCIBILITY_REPAIR_REPORT.md`, and this file
  (`SPRINT_A0_REPAIR_LANDING_REPORT.md`) exist on disk, uncommitted.

These currently exist only in the isolated worktree
(`C:\Users\abdoh\Claude code\Git\lumo-platform-a0-lockfile-repair`); the updated
`SPRINT_A0_REPORT.md` there has not been synced into `main`'s working tree copy. Both are ready
to be committed together as a separate documentation-only commit whenever approved.

## 7. Stop

Per instructions, this task stops here. Repository History Recovery is not resumed.
