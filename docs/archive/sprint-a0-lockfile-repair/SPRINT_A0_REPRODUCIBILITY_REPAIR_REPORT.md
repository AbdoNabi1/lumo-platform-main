# Sprint A0 — Lockfile Reproducibility Repair: Report

**Type:** Isolated baseline-defect repair. **Not** part of Repository History Recovery.

**Prerequisite:** [SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md](./SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md)
— proved the required change is exactly the two missing `@platform/repository` importer entries,
with zero unrelated changes, before any repair was applied. This report is the record of the
repair the analysis authorized.

## What was broken

Sprint A0's frozen commit (`2dc8e0b9ba90517039a7240861535fb53127fbee`, tag
`sprint-a0-complete`) shipped a `pnpm-lock.yaml` that was out of sync with two `package.json`
files also committed in the same commit: `packages/messaging/package.json` and
`packages/kafka/package.json` both declare `"@platform/repository": "workspace:*"`, but their
importer blocks in the lockfile omitted that entry. Result: `pnpm install --frozen-lockfile` —
the install mode any clean clone or CI run must use — failed immediately with
`ERR_PNPM_OUTDATED_LOCKFILE`. Sprint A0, as committed, was **not reproducible**.

## What was done

1. Created an isolated git worktree (`lumo-platform-a0-lockfile-repair`), detached at commit
   `2dc8e0b9b...`, so the repair could be produced and verified without touching the large
   pre-existing uncommitted work in the main working tree or the separate history-recovery
   worktree.
2. Reproduced the failure directly (`pnpm install --frozen-lockfile` → `ERR_PNPM_OUTDATED_LOCKFILE`,
   naming `@platform/repository@workspace:*` as the missing specifier).
3. Regenerated the lockfile (`pnpm install --no-frozen-lockfile`) and diffed it against the
   committed version.
4. Verified and documented (analysis doc) that the diff is **exactly** 6 lines across 2 hunks —
   the missing `@platform/repository` dependency entry in the `packages/kafka` and
   `packages/messaging` importer blocks — with zero changes to any other importer, the
   `packages:` registry section, the `snapshots:` section, `lockfileVersion`, or any
   `package.json`, governance file, Husky config, lint-staged config, or dependency version.
5. Re-ran `pnpm install --frozen-lockfile`: **succeeded** (`Already up to date`, exit 0).

## Requirements compliance

| Requirement                                       | Status                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Do not modify any `package.json`                  | ✅ none touched (verified via `git status`)                                                      |
| Do not modify any source code                     | ✅ none touched                                                                                  |
| Do not modify Governance                          | ✅ none touched                                                                                  |
| Do not modify Husky                               | ✅ none touched                                                                                  |
| Do not modify lint-staged                         | ✅ none touched                                                                                  |
| Do not modify architecture                        | ✅ none touched                                                                                  |
| Do not modify versions                            | ✅ zero version changes anywhere in the lockfile diff                                            |
| Do not update any dependency                      | ✅ zero entries changed in `packages:`/`snapshots:`; only two missing workspace-link edges added |
| Do not change integrity hashes unless unavoidable | ✅ zero integrity/checksum/resolution lines in the diff — not needed at all                      |
| Only the missing importer references were added   | ✅ proved line-by-line in the analysis doc                                                       |

## Final diff (unchanged from the analysis — nothing further was needed)

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

## Proof of reproducibility

```
> pnpm install --frozen-lockfile
Scope: all 44 workspace projects
Already up to date
Done in 2.7s using pnpm v11.9.0
```

Exit code `0`. Sprint A0's dependency graph, as declared by its committed `package.json` files,
is now fully and correctly represented in `pnpm-lock.yaml`, and a clean clone at commit
`2dc8e0b9b...` (or any commit built on top of it, once this fix lands) can install with
`--frozen-lockfile` — the reproducibility guarantee Sprint A0 was supposed to have shipped with.

## Current state — awaiting approval

The repaired `pnpm-lock.yaml` and this pair of docs exist **only** in the isolated worktree:

```
C:\Users\abdoh\Claude code\Git\lumo-platform-a0-lockfile-repair
```

**Nothing has been committed.** The frozen commit `2dc8e0b` and tag `sprint-a0-complete` have
not been amended, consistent with the standing rule that a frozen sprint's commit is never
rewritten — a correction is a new, explicit, superseding change. No decision has been made yet
about how that new change should be committed (e.g. as a new commit on `main` carrying just this
lockfile fix, forward-ported to wherever `main` currently sits, tagged, etc.) — that is a
decision for the user.

**This task stops here, per instructions.** Repository History Recovery work is not resumed.
