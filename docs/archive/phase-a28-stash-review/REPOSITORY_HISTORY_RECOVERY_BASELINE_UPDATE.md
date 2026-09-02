# Repository History Recovery — Baseline Update

**Type:** Planning-document update only. **Repository History Recovery has NOT been resumed** —
no milestone was executed, no source code was touched, no branch or worktree was created while
producing this document.

**Companion edit:** `REPOSITORY_HISTORY_RECOVERY_V2.md` §0a (new section), plus in-place
corrections to §1 and §9, record the same facts below inline in the canonical roadmap. This
document is the standalone record the task asked for; it does not duplicate reasoning beyond
what's needed to be self-contained.

## 1. Repair commit hash

```
ecb4a05461d83b5226a0f36111e19d7353abb165
fix(lockfile): restore Sprint A0 reproducibility
```

- Parent: `830138acca9e378d8d2fe570d2a5a8cec14662a7` (`docs(platform): add Sprint A0 frozen
baseline record` — the commit V2 originally cited as `HEAD`).
- Grandparent: `2dc8e0b9ba90517039a7240861535fb53127fbee` (`feat(platform): implement Sprint A0
infrastructure foundations` — tag `sprint-a0-complete`).
- Verified a direct, single-parent, linear descendant of `830138a` (`git merge-base
--is-ancestor 830138a HEAD` → true; `git rev-list --count 830138a..HEAD` → 1). Full Git
  integrity audit: `SPRINT_A0_GIT_INTEGRITY_REPORT.md` (currently in the isolated repair
  worktree, `lumo-platform-a0-lockfile-repair/docs/implementation/` — not yet copied into this
  tree; documentation landing was explicitly deferred as a separate step in the repair task).
- Change: `pnpm-lock.yaml` only, 6 lines / 2 hunks — adds the missing `@platform/repository`
  importer entries for `packages/messaging` and `packages/kafka`. No `package.json`, source file,
  ADR, event contract, governance/Husky/lint-staged config, architecture doc, or dependency
  version changed.

## 2. Why the repair does not alter repository history reconstruction

The reconstruction plan (`REPOSITORY_HISTORY_RECOVERY_V2.md` §1–§9) is built entirely from two
kinds of facts: (a) what commits already exist on `main`, and (b) which of the 80 workspace
packages are clean (Tier −1, already committed) versus dirty (assigned to one of the 60
milestone-bearing tier groups, §3). The repair changes fact (a) by exactly one commit and leaves
fact (b) completely untouched:

- `packages/messaging` and `packages/kafka` were **already** listed in V2 §3's Tier −1 (clean,
  no milestone needed) _before_ the repair, because both packages' source and `package.json`
  were already fully committed in `2dc8e0b`. The repair did not add, remove, or modify any file
  belonging to either package — it corrected `pnpm-lock.yaml`, a workspace-root file that
  describes the resolved dependency graph, not either package's own tree entry.
- No package changed tier. No package was added to or removed from the 80-package inventory
  (§2 of V2). No dependency edge in §4's graph changed, because that graph is expressed in terms
  of which _packages_ depend on which other _packages_ (e.g. "K1 → T1"), and the repair didn't
  add or remove a dependency — `@platform/repository` was already a real, declared dependency of
  both packages in their committed `package.json`; the lockfile simply hadn't caught up.
- The repair commit is not, and does not become, a recovery milestone. It sits chronologically
  before Milestone 1 (Tier 9, §5 step 1) and structurally outside the tier graph — like `BASE`
  and `DOCS` in §4's diagram, it has no incoming or outgoing edge to any tier.

In short: the repair is a correction to metadata _about_ two already-clean packages, made after
they were already fully accounted for in the plan. There is nothing in the reconstruction's
package inventory, tier assignments, or dependency graph for the repair to disturb.

## 3. Why milestone ordering remains unchanged

`REPOSITORY_HISTORY_RECOVERY_V2.md` §5's 25-step recommended commit order is expressed entirely
in terms of tier/group identifiers (Tier 9, K1–K7, T1–T2, C1–C12, G1–G5, P1–P4, N1–N4, E1–E2, GOV,
R1–R3, A1g, A1) and their stated package-level and tier-level prerequisites (e.g. "K7 needs K5",
"GOV needs K2/K4/K7/P1/E1/E2 all landed"). Checked line by line:

- **No step in §5 references a commit hash, `HEAD`, or any specific point in `main`'s existing
  history as a precondition.** Every precondition is a tier or package name.
- **No step's package list includes `pnpm-lock.yaml` as a tracked deliverable.** The lockfile is
  workspace-wide infrastructure that `pnpm install` regenerates as each milestone's packages are
  added; it is not itself one of the 60 assigned packages in §2/§3.
- §7's execution strategy (temporary worktree per milestone) is unaffected in mechanism — a
  worktree checked out from the new baseline (§4 below) behaves identically to one checked out
  from `830138a`, except that `pnpm install --frozen-lockfile` now succeeds immediately instead of
  failing on `messaging`/`kafka` — which is the entire point of doing the repair first.
- Therefore §5's order (Tier 9 → K1 → K2 → K3 → K4 → K5 → K6 → K7 → T1 → T2 → C1–C12 → G1–G5 → P1
  → P2 → P3 → P4 → N1–N4 → E1 → E2 → GOV → R1 → R2 → R3 → A1g → A1) is unchanged, verbatim, by
  this repair.

## 4. Confirmation: the repaired baseline is the official starting point

**`ecb4a05461d83b5226a0f36111e19d7353abb165` is now the official reproducibility baseline for
every recovery milestone.** Concretely:

- Any worktree created to execute a Milestone 1 (or later) commit, per V2 §7's strategy, should
  be checked out from `ecb4a05`, not `830138a`.
- `REPOSITORY_HISTORY_RECOVERY_V2.md` §1's commit table and `HEAD` references have been corrected
  in place (§0a, §1, §9) to reflect this — the canonical document now states `HEAD = ecb4a05`,
  22 commits, consistent with this update.
- This does not change what the recovery is reconstructing (still the 60 dirty packages across
  the tiers in V2 §3), only the exact commit a worktree for that work should start from.

## 5. Remaining prerequisites before Milestone 1

Nothing in this update introduces a new prerequisite. The prerequisites already on record in
`REPOSITORY_HISTORY_RECOVERY_V2.md` remain exactly as stated, unresolved:

1. **Three open sign-offs from V2 §8**, still pending explicit user decision:
   - Confirm worktree + temporary branch as the execution mechanism (V2 §7).
   - Confirm GOV's exact landing slot — standalone after E2 (the default used in §5) vs. folded
     into R3.
   - Confirm the first `governance:update` baseline is diffed against "nothing" (a fresh
     baseline at the post-E2 tree state), not today's already-mid-sequence snapshot.
2. **Two unresolved evidence gaps** (V2 §8, carried from V1): R2 (Purchase Saga) has no dedicated
   `SPRINT_*_REPORT.md`; A1g's own delta has no single owning report.
3. **One flagged-but-unreconciled item** (V2 §8): G4/Catalog's several extra "1.x"-numbered
   design docs weren't fully reconciled against C2's single-report citation before C2 is
   committed.
4. **No gate has been re-executed** (V2 §8's fourth bullet): `pnpm typecheck`/`test`/
   `governance`/`arch`/`dup` still need to be run at each commit boundary during actual
   execution — this was always planned as a structural sequencing pass, not a verification pass.
5. **Documentation landing, deferred, not blocking:** the four Sprint A0 repair evidence docs
   (`SPRINT_A0_LOCKFILE_REPAIR_ANALYSIS.md`, `SPRINT_A0_REPRODUCIBILITY_REPAIR_REPORT.md`,
   `SPRINT_A0_REPAIR_LANDING_REPORT.md`, `SPRINT_A0_GIT_INTEGRITY_REPORT.md`) still exist only in
   the isolated repair worktree, not in this tree's `docs/implementation/`. Not a precondition
   for Milestone 1, but worth landing before those docs are referenced from a committed source.

Repository History Recovery remains **not resumed**. No milestone execution should begin until
the sign-offs in item 1 are given.
