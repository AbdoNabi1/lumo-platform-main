# Phase A.28 — Stash Review Archive

Source: `stash@{0}` ("lint-staged automatic backup", parent `be9f164`), inspected 2026-08-15
during repository cleanup Phase A.28. The stash itself was **not dropped** — it still exists
in the reflog/stash list.

## Why these files are here

`stash@{0}` touches 2,116 file paths, but is content-identical (aside from cosmetic Prettier
formatting on 184 files) to the `reference/working-tree-2026-08-03` branch, which is already
committed (`de46df9`, `ab3e466`, `f0e9a5b`) and pushed to `origin/reference/working-tree-2026-08-03`.
So almost nothing in the stash was actually at risk of loss.

The exception: the root-level evidence/governance/recovery markdown reports below exist in the
stash and on `reference/working-tree-2026-08-03`, but **not** anywhere in `main`'s current working
tree. They're copied here so they're reachable without checking out that reference branch.

Where a report existed in multiple numbered versions (`_V4`, `_V5`, unversioned), only the newest
version was kept, per Phase A.28 Task 4 instructions.

## Files

- `A1_COMMIT_BLOCKER_REPORT.md`, `BLOCKER_REPORT.md` — distinct reports, both kept
- `CUSTOMER360_ARCHITECTURE_AUDIT.md`
- `CONFIDENCE_SUMMARY_V5.md`, `EVIDENCE_GAPS_V5.md`, `EVIDENCE_MATRIX_V5.md`,
  `EXECUTION_TIMELINE_V5.md`, `FINAL_EXECUTION_PLAN_V5.md`, `FINAL_VERDICT_V5.md`,
  `PATCH_OWNERSHIP_MATRIX_V5.md`, `RECOVERY_DEPENDENCY_GRAPH_V5.md`,
  `REPOSITORY_HISTORY_RECOVERY_V5.md`, `REVIEW_FINDINGS_V5.md` — newest version of each
  versioned report family
- `FINAL_RECOVERY_CHECKLIST.md`, `GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`,
  `GOVERNANCE_POSITION_IN_HISTORY.md`, `RECOVERY_DOCUMENT_CORRECTIONS.md`,
  `RECOVERY_ERRATA_V4.md`, `REPOSITORY_HISTORY_RECOVERY_BASELINE_UPDATE.md` — standalone,
  no newer version found

## Candidates requiring manual approval (NOT applied)

- `dependency-cruiser.cjs.stash-version` — the stash's `.dependency-cruiser.cjs` contains
  additional architecture-governance rules (`FF-ARCH-10`..`15`, tracking-platform layering)
  that are **not** present in main's currently tracked `.dependency-cruiser.cjs`. Main's git
  history (`git log -- .dependency-cruiser.cjs`) shows these rules were never actually
  committed to main — they only ever existed in this stash / the reference checkpoint. Left
  unapplied per Phase A.28 scope (no production config changes); a human should decide whether
  to port these rules into the real `.dependency-cruiser.cjs`.
- `jscpd.json.candidate` — a `.jscpd.json` (copy-paste-detector config) exists in the stash but
  main has no `.jscpd.json` at all. Left unapplied for the same reason.

## Not archived (explicitly excluded)

- Raw command-output/log files at repo root (`test_*.txt`, `tsc_*.txt`, `typecheck_out*.txt`,
  `arch_out*.txt`, `dup_out*.txt`, `gov_*.txt`, `governance_out*.txt`, `runtime_test_out*.txt`)
  — scratch tool output, not documentation. Still safely preserved in the stash and on
  `reference/working-tree-2026-08-03` if ever needed.
- `services/**`, `packages/**`, `apps/**` source-code content in the stash — either already
  present (often in a more advanced state) in main's current working tree, or abandoned
  experimental code (e.g. `apps/runtime/src/modules/*.module.ts`) that doesn't correspond to
  any path in main's current architecture. Not merged, per Task 4 instructions to report
  source-code differences separately rather than auto-merge them. See
  `PHASE_A28_REPOSITORY_CLEANUP_REPORT.md` at the repo root for details.
- `.github/workflows/*.yml` — main's current tracked versions are newer/more complete than the
  stash's copies (verified by diff).
