# Final Recovery Checklist

Actionable companion to `REPOSITORY_HISTORY_RECOVERY_V3.md`. Check each item at the point it
applies — this file is meant to be consulted milestone-by-milestone during actual execution, not
read once. Nothing on this list has been performed as part of producing it.

## Before resuming execution at all

- [ ] Confirm sign-off on the worktree + temporary branch execution mechanism (already in active use
      for K1–K2; treat as ratified by practice unless told otherwise).
- [ ] Confirm sign-off on GOV's exact landing slot (standalone, immediately after E2, before R1 —
      the standing default; no evidence this pass argues for folding it into R3 instead).
- [ ] Confirm sign-off that the first `governance:update` baseline (generated at GOV's own
      milestone) is diffed against **nothing** — a fresh baseline — not today's mid-sequence
      `scripts/governance/baseline/public-api.json` snapshot.

## Per-milestone gate (repeat for every remaining step, K3 through A1)

1. [ ] Re-read this milestone's row in `EXECUTION_TIMELINE.md` and `RECOVERY_DEPENDENCY_GRAPH.md` —
       confirm every hard dependency already landed in the recovery worktree (`git log --oneline` on
       `recovery/history-reconstruction`).
2. [ ] Open and read every cited sprint report/ADR/architecture doc **for this milestone specifically**
       — even where `EVIDENCE_MATRIX.md` marks package-level assignment "Confirmed" via a migration or
       schema header, the _narrative_ citation must still be independently opened this milestone,
       per the Evidence Closure Rule. Do not carry forward this pass's "Weak" verdicts as if they were
       "Confirmed."
3. [ ] Reconstruct from those sources first; diff against the dirty `lumo-platform` tree's
       corresponding files only afterward, per `RECOVERY_IMPLEMENTATION_METHODOLOGY.md`'s
       Implementation Source Precedence.
4. [ ] For any file `PATCH_OWNERSHIP_MATRIX.md` marks **Ambiguous** or names a **cross-tier
       patch** (e.g. `packages/db/src/index.ts`, `apps/admin/src/http/admin-routes.ts`,
       `apps/runtime/src/composition.ts`), stage only this milestone's own lines — never the whole
       file wholesale.
5. [ ] Run this milestone's defined gate set per `EXECUTION_TIMELINE.md`'s governance-window rule
       (pre-GOV: `lint-staged` only; post-GOV: full 19-check suite). Do not invent an additional gate
       not defined for this milestone's position; do not skip the one that is defined.
6. [ ] Stage only the milestone's frozen file scope (per `PATCH_OWNERSHIP_MATRIX.md`). One commit per
       milestone unless `EXECUTION_TIMELINE.md` states otherwise (N1–N4's possible combined commit;
       A1g's possible multi-commit-but-jointly-staged exception).
7. [ ] Before declaring the milestone complete, apply the Evidence Closure Rule: verify every citation
       in the commit message and milestone report traces to a tool-call read made **during this
       milestone's own execution** — not inherited from V3, `EVIDENCE_MATRIX.md`, or any prior
       milestone's report.
8. [ ] Write the milestone report in the structure `K1_MILESTONE_REPORT.md`/`K2_MILESTONE_REPORT.md`
       already established: commit hash, files modified, sources opened, reconstruction-vs-dirty-tree
       comparison, dependency/API/event verification, gate results, scope-freeze proof, current state.
9. [ ] Re-check the open risk register rows in `REPOSITORY_HISTORY_RECOVERY_V3.md` §3 relevant to this
       milestone (e.g. risk #4 for C2, risk #5 for P2, risk #10 for E2/R3, risk #11 for G4/P1) and
       either close them with evidence or carry them forward explicitly — never silently drop one.
10. [ ] Stop after the milestone completes. Do not proceed to the next milestone without explicit
        approval, per the standing sprint-isolation discipline already established for this recovery.

## Specific per-milestone reminders (do not rediscover these at execution time)

- **K3–K7:** Their own cited sprint reports are marked "Weak" in `EVIDENCE_MATRIX.md` — open them for
  real this time; do not treat this V3 pass's package-level corroboration as a substitute.
- **C2:** Reconcile the "1.x"-numbered extra catalog design docs (risk #4) before finalizing scope.
  Cite both `SPRINT_4_2_CATALOG_CORE_REPORT.md` and `SPRINT_7_0_COMMERCE_FOUNDATION_REPORT.md`.
- **C3, C4:** Cite both the base Sprint-4.x report and `SPRINT_7_0_COMMERCE_FOUNDATION_REPORT.md`.
- **C10:** Do **not** edit `packages/db/prisma/schema/migrations/20260726000000_sprint_a0_preconditions/migration.sql`.
  Create a new, additive migration reintroducing the deferred Shipment/A8 idempotency step instead.
- **P2:** Verify `packages/secrets/src/envelope.ts`/`envelope.test.ts`'s attribution against
  `P2_0_ENTERPRISE_SECURITY_REPORT.md`'s KMS section directly (risk #5) before including them in
  P2's scope.
- **P3/P4:** Diff-decompose `apps/runtime/src/composition.ts`/`composition.test.ts`/`config.ts`
  against R1's already-landed baseline (risk #9) rather than assuming the whole file is either
  milestone's alone.
- **N1:** `CUSTOMER360_ARCHITECTURE_AUDIT.md`'s fixes are already layered onto the dirty tree's
  `services/customer-360` — the milestone's reconstruction should include the audit's 2 correctness
  fixes and 1 duplication removal as part of N1's own scope, not treat them as separate.
- **E2 or R3 (whichever executes first):** Resolve `apps/storefront/src/app/page.tsx`'s owner
  (risk #10) by opening its actual diff.
- **G4 or P1 (whichever executes first):** Resolve `docs/architecture/adr/0010-third-party-extension-model.md`'s
  owner (risk #11).
- **GOV:** Generate the fresh baseline at the tree state immediately after E2/before R1 — not
  today's already-mid-sequence snapshot. Re-confirm `FF-TRACK-01`'s comment is still narrating E2 as
  complete fact at the moment GOV actually lands (it should be, since E2 precedes GOV in the order).
- **R2:** State the missing-evidence-report gap explicitly in the milestone report rather than
  fabricating a citation. Gate-check the saga code directly if no report is ever located.
- **R3:** State the H-5 naming/report gap explicitly (risk #3). Include the Customer-360
  durable-storage migration in scope (resolved ownership, not N1–N4's).
- **A1g:** Cite the ~36 per-context reports collectively rather than fabricating a single umbrella
  citation. Do not attempt to split into per-context commits (confirmed infeasible without a
  refactor). Confirm it lands after GOV, not before, despite its narrower real dependency floor
  (deliberate, reasoned choice — see `EXECUTION_TIMELINE.md`).
- **A1:** Already finished and gate-verified (`SPRINT_A1_REPORT.md`) — this milestone is a
  straightforward commit of already-completed, already-reviewed work once C7 and A1g are in place.

## Cross-cutting files — never bulk-commit these under a single milestone

`.dependency-cruiser.cjs` · `.env.example` · `README.md` (root) · `package.json` (root) ·
`pnpm-lock.yaml` (regenerate/verify per-milestone, never diff wholesale) · `pnpm-workspace.yaml` ·
`docs/DECISIONS.md` · `docs/KNOWN_GAPS.md` · `docs/PROJECT_STATE.md` ·
`docs/architecture/20-events-catalog.md` · `docs/architecture/22-context-map.md` ·
`docs/development/SETUP.md`

For each, stage only the specific lines/sections that belong to the milestone currently executing.

## Gate-log hygiene

- [ ] Before any future milestone, delete or `.gitignore` the scratch output files already sitting in
      the dirty tree (`test_*.txt`, `tsc_*.txt`, `typecheck_out*.txt`, `runtime_test_out*.txt`,
      `arch_out*.txt`, `dup_out*.txt`, `gov_index*.txt`, `gov_update*.txt`, `governance_out*.txt`) —
      none of them belong to any milestone; they are gate-run stdout captures, not deliverables.

## After A1 (step 25) lands

- [ ] Confirm `PATCH_OWNERSHIP_MATRIX.md`'s file count reconciles to zero remaining unassigned dirty
      files in `lumo-platform` (every tracked and untracked entry catalogued in this V3 pass should
      have landed under its assigned milestone).
- [ ] Re-run the full gate suite (`pnpm typecheck`/`test`/`governance`/`arch`/`dup`) end-to-end
      against the fully-reconstructed `recovery/history-reconstruction` branch — the one verification
      step every prior pass, including this one, has explicitly deferred to actual execution.
- [ ] Only then consider fast-forwarding `main` to the reconstructed branch, per whatever merge
      strategy is decided at that time (not decided by this document — out of scope for V3).
