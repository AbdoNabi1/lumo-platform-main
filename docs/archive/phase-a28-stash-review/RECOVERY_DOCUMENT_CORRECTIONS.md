# Recovery Document Corrections

Produced per explicit instruction: reconcile `REPOSITORY_HISTORY_RECOVERY.md`,
`GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`, and `GOVERNANCE_POSITION_IN_HISTORY.md` against the actual
Git history. No original document was modified. No Git state was modified — every command run to
produce this report was read-only (`git log`, `git ls-tree`, `git show`, `git status --porcelain`,
`git tag`, `git for-each-ref`, `git rev-parse`, a direct read-only invocation of
`node scripts/governance/run.mjs` with no `--update` flag). No workaround is proposed for anything —
this document only states what the real Git history is, where the three documents disagree with it,
and what a corrected statement would be. Nothing here recommends or authorizes an action.

Seven discrepancies were found. Two are load-bearing (affect governance-positioning reasoning and
milestone file-scope respectively); the rest are numeric/labeling drift that don't change the recovery
plan's structure but should be fixed so the documents stay trustworthy as "single source of truth."

---

## Discrepancy 1 — Incomplete commit inventory

- **Document:** `REPOSITORY_HISTORY_RECOVERY.md`
- **Section:** §0, "What is already committed (do not touch)"
- **Original statement:** Lists "Full linear history on `main`, `HEAD` = `830138a`" as a 19-commit
  sequence, from `050300c Initial commit` down to `830138a`.
- **Evidence from Git:**
  ```
  git log --oneline | Measure-Object -Line   →  21
  git log --oneline                          →  (21 commits; the two oldest are)
    0e72ffe feat(application): implement Sprint 0.3 foundation
    ed3654d feat(infrastructure): complete Sprint 0.2 infrastructure foundation
  ```
  Also present but likewise not in the document's list:
  `bf748f8 Merge branch 'main' of https://github.com/AbdoNabi1/lumo-platform` (this one _is_ mentioned
  in the doc's list, but `ed3654d` — the oldest commit in the repository, tagged `sprint-0.2` — is not).
- **Corrected statement:** The real committed history at `HEAD` is 21 commits, not 19. The list in §0
  should be prefixed with `ed3654d feat(infrastructure): complete Sprint 0.2 infrastructure foundation`
  as the true root of recorded history, predating `0e72ffe`.
- **Changes recovery order?** No — `ed3654d` is already committed, already at/before `HEAD`; there is
  nothing to schedule.
- **Changes milestone boundaries?** No.
- **Changes governance positioning?** No by itself, but it is the direct evidence base for Discrepancy 3
  below (the commit where `.husky/pre-commit` first entered history).
- **Changes implementation strategy?** No, but any future document that says "since committed history
  began" or enumerates "do not touch" commits by hash should include this one.

---

## Discrepancy 2 — `sprint-a0-complete` tag mis-attributed to `HEAD`

- **Document:** `REPOSITORY_HISTORY_RECOVERY.md`
- **Section:** §0, last line of the commit table
- **Original statement:** `830138a docs(platform): add Sprint A0 frozen baseline record <-- HEAD, tag sprint-a0-complete` — implying the tag sits on `HEAD` itself.
- **Evidence from Git:**
  ```
  git for-each-ref --format="%(refname) -> %(objectname) -> points-to:%(*objectname)" refs/tags/sprint-a0-complete
    refs/tags/sprint-a0-complete -> 3dfbe539... -> points-to:2dc8e0b9ba90517039a7240861535fb53127fbee

  git log -1 --format="%H %s" sprint-a0-complete
    2dc8e0b9ba90517039a7240861535fb53127fbee feat(platform): implement Sprint A0 infrastructure foundations

  git tag -l -n99 sprint-a0-complete
    sprint-a0-complete Sprint A0 (Preconditions) — frozen. Commit 2dc8e0b.

  git show --no-patch --format="%H %s" HEAD
    830138acca9e378d8d2fe570d2a5a8cec14662a7 docs(platform): add Sprint A0 frozen baseline record
  ```
- **Corrected statement:** `sprint-a0-complete` is an annotated tag pointing at `2dc8e0b` (the commit
  that actually implements Sprint A0), one commit _before_ `HEAD`. `830138a` (`HEAD`) is the following,
  untagged, docs-only commit that records the freeze. The two hashes should not be presented as if the
  tag marks `HEAD` — it marks `HEAD`'s parent.
- **Changes recovery order?** No — both commits are already-committed, already in the "do not touch"
  region.
- **Changes milestone boundaries?** No.
- **Changes governance positioning?** No.
- **Changes implementation strategy?** No, but any later milestone that cites "the frozen baseline tag"
  as a reference point should cite `2dc8e0b`, not `HEAD`, if it means the tagged commit specifically.

---

## Discrepancy 3 — `.husky/pre-commit` and `.husky/commit-msg` falsely claimed to have no commit history

- **Document:** `GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md`
- **Section:** §7 (table: "Does Governance belong in the recovery plan as its own milestone?") and §9
  ("Can recovery be completed without modifying the hook at all?")
- **Original statement:** §7's table: `.husky/pre-commit, .husky/commit-msg (the actual hook scripts) | No, ever | git ls-tree -r HEAD -- .husky empty; no commit history for the path exists`. §9: "Since `.husky/` has _never_ been committed (§7), a fresh worktree has **no hook file to invoke at all** for early commits."
- **Evidence from Git:**
  ```
  git ls-tree -r HEAD -- .husky
    100644 blob ... .husky/commit-msg
    100644 blob ... .husky/pre-commit          <-- tracked, contrary to the claim

  git show HEAD:.husky/pre-commit
    pnpm lint-staged                            (one line only, no governance call)

  git show HEAD:.husky/commit-msg
    pnpm commitlint --edit "$1"

  git log --oneline -- .husky/pre-commit
    ed3654d feat(infrastructure): complete Sprint 0.2 infrastructure foundation

  git diff HEAD -- .husky/pre-commit
    +node scripts/governance/run.mjs            (only this second line is uncommitted)
  ```
  Note this directly contradicts the **same document's own §1 and §3(c)**, which correctly quote
  `git show HEAD:.husky/pre-commit → "pnpm lint-staged" (that's the whole file)` — i.e., the document
  already contains the correct evidence elsewhere and draws the wrong conclusion from it in §7/§9.
- **Corrected statement:** `.husky/pre-commit` (containing only `pnpm lint-staged`) and
  `.husky/commit-msg` (containing `pnpm commitlint --edit "$1"`) have both been committed since Sprint
  0.2 (`ed3654d`, tagged `sprint-0.2`). They are not new, not uncommitted, and have real, datable commit
  history. The only uncommitted part of the hook mechanism is the second line added to
  `.husky/pre-commit` (`node scripts/governance/run.mjs`) and everything under `scripts/governance/`
  itself (confirmed separately: `git ls-tree -r HEAD -- scripts/governance` is empty).
- **Changes recovery order?** No.
- **Changes milestone boundaries?** No — the governance _addition_ (the second hook line + the script
  suite + baselines) is still correctly identified elsewhere as entirely uncommitted and still needing
  its own milestone.
- **Changes governance positioning?** **Partially.** The document's ultimate conclusion in
  `GOVERNANCE_POSITION_IN_HISTORY.md` — Governance cannot land before milestone E2 — is unaffected,
  because that conclusion rests on `FF-TRACK-01`'s comment text narrating the Browser SDK's completed
  architecture as settled fact (independently verified accurate, see Discrepancy 4's evidence), not on
  `.husky`'s commit history. What changes is the _stated justification_ for why a worktree-based
  execution strategy is safe before Governance's milestone lands: the reasoning "no hook file exists at
  all that early, so nothing runs" is false. The correct reasoning is "the _base_ hook (`lint-staged`
  only) already exists from Sprint 0.2 onward and will run on every commit in a worktree from the very
  first milestone; only the _governance_ line is absent until Governance's own milestone adds it."
- **Changes implementation strategy?** Minor. Anyone executing the worktree strategy should expect
  `pnpm lint-staged` to run and potentially reformat staged files on every commit from the first
  milestone onward (as it already did, correctly, in the prior Tier-9 staging attempt this document
  itself cites in §1) — not assume zero hook activity until Governance's milestone.

---

## Discrepancy 4 — Same `.husky` claim repeated

- **Document:** `GOVERNANCE_POSITION_IN_HISTORY.md`
- **Section:** §5 ("Historical Consistency" — "Missing repository structure" bullet) and §7 (table, row
  "Governance guarantees")
- **Original statement:** §5: "`.husky/pre-commit`/`.husky/commit-msg` (the hook mechanism itself) have **no commit history at all** — not 'not yet landed in this sequence,' but zero evidence they were ever committed at any point in this repository's real lifetime." §7: "there is no `.husky/pre-commit` to invoke at all (§9 of the prior analysis — `.husky/` has no commit history anywhere)."
- **Evidence from Git:** Same as Discrepancy 3.
- **Corrected statement:** Same as Discrepancy 3 — the base hook has committed history since `ed3654d`
  (Sprint 0.2); only the governance-invoking line is new.
- **Changes recovery order?** No.
- **Changes milestone boundaries?** No.
- **Changes governance positioning?** Same partial impact as Discrepancy 3 — the E2 floor stands, the
  "no enforcement at all before Governance" framing needs to become "no _governance_ enforcement before
  Governance; lint-staged enforcement already exists from Sprint 0.2."
- **Changes implementation strategy?** Same note as Discrepancy 3.

---

## Discrepancy 5 — `packages/tracking/src` subdirectory count and unassigned scope

- **Document:** `GOVERNANCE_POSITION_IN_HISTORY.md`
- **Section:** §5 ("Missing packages" bullet)
- **Original statement:** "...and five of `packages/tracking/src/`'s eight subdirectories are confirmed
  untracked (`git status --porcelain` → `??` for all of them)."
- **Evidence from Git:**
  ```
  Get-ChildItem packages/tracking/src -Directory   →  13 directories:
    browser, collector, definitions, delivery, envelope, execution, ids,
    inspector, intelligence, pipeline, queue, replay, runtime

  git ls-tree -r --name-only HEAD -- packages/tracking/src/
    packages/tracking/src/index.ts        (only file tracked — zero subdirectories tracked)

  git status --porcelain -- packages/tracking
     M packages/tracking/package.json
     M packages/tracking/src/index.ts
    ?? packages/tracking/src/browser/       ?? .../collector/      ?? .../definitions/
    ?? .../delivery/  ?? .../envelope/  ?? .../execution/  ?? .../ids/  ?? .../inspector/
    ?? .../intelligence/  ?? .../pipeline/  ?? .../queue/  ?? .../replay/  ?? .../runtime/
  ```
- **Corrected statement:** There are 13 subdirectories under `packages/tracking/src/` today, not 8, and
  **all 13** are untracked at `HEAD` (0 of 13 tracked), not "five of eight." `REPOSITORY_HISTORY_RECOVERY.md`'s
  own tier breakdown only assigns 6 of these 13 to a named milestone: K7 explicitly names
  `collector/`, `runtime/`, `definitions/`, `delivery/`, `envelope/` (5), and E2 (Browser SDK) owns
  `browser/` (1). Seven subdirectories — `execution/`, `ids/`, `inspector/`, `intelligence/`,
  `pipeline/`, `queue/`, `replay/` — are not named in any tier's scope anywhere in
  `REPOSITORY_HISTORY_RECOVERY.md`.
- **Changes recovery order?** Not by itself.
- **Changes milestone boundaries?** **Yes, potentially.** Before K7 or E1/E2 are actually committed,
  the 7 unassigned subdirectories need an explicit owner — either folded into K7's existing scope
  (undocumented today) or given their own sub-item — otherwise they would either be silently omitted
  from the reconstructed history or silently swept into whichever milestone happens to touch
  `packages/tracking/src/` last, neither of which matches this process's "verify every file belongs to
  the milestone" rule.
- **Changes governance positioning?** No direct effect on the E2-floor argument (which concerns
  `browser/` specifically, correctly identified).
- **Changes implementation strategy?** Yes — whoever executes the K7/E1/E2 milestones should re-derive
  the exact file list for `packages/tracking/src/` from the live directory listing at that time, not
  from this document's "five of eight" figure.

---

## Discrepancy 6 — Workspace package count off by one

- **Document:** `REPOSITORY_HISTORY_RECOVERY.md`
- **Section:** §0 preamble ("Method and evidence," item 1)
- **Original statement:** "`git status --porcelain` across the whole repo (79 workspace packages; 20
  fully match `HEAD`, 59 have uncommitted content...)."
- **Evidence from Git:** Counted every directory one level under `apps/`, `packages/`, `services/` with
  its own `package.json`, plus `scripts/governance` (itself a workspace member per
  `pnpm-workspace.yaml`'s own package list):
  ```
  apps: 4   packages: 35   services: 40   scripts/governance: 1   → TOTAL 80

  Per-directory git status --porcelain check (clean vs. any uncommitted content):
    CLEAN (matches HEAD): 20
    DIRTY (uncommitted content): 60
  ```
- **Corrected statement:** 80 workspace packages exist today, not 79. The clean count (20) matches the
  document exactly. The dirty count is 60, not 59 — a net drift of +1 package since this figure was
  written, most plausibly `scripts/governance` itself (entirely untracked, and a `pnpm-workspace.yaml`
  member) not having been counted, or a similarly recently-added package (`services/example` is the
  other candidate — its own purpose is not documented in any tier).
- **Changes recovery order?** No.
- **Changes milestone boundaries?** No direct change, but worth flagging: `scripts/governance`'s own
  package (its `package.json`/workspace membership, separate from the script files and baselines already
  discussed) should be explicitly listed as part of the Governance Suite milestone's file scope, since it
  is itself one of the 80 uncommitted-or-not packages this count is tracking.
- **Changes governance positioning?** No.
- **Changes implementation strategy?** No — bookkeeping precision only.

---

## Discrepancy 7 — "65 uncommitted report/design docs" undercounts `docs/implementation/`

- **Document:** `REPOSITORY_HISTORY_RECOVERY.md`
- **Section:** §0 preamble, item 3
- **Original statement:** "65 of these report/design docs are themselves uncommitted."
- **Evidence from Git:**
  ```
  Get-ChildItem docs/implementation -Filter "*.md"                     →  107 total .md files
  git ls-tree --name-only HEAD -- docs/implementation/ (*.md only)     →  32 tracked at HEAD
  git status --porcelain -- docs/implementation                        →  76 changed paths
  ```
- **Corrected statement:** Roughly 75 of the 107 `docs/implementation/*.md` files do not match `HEAD`
  (107 total − 32 tracked-and-clean ≈ 75; 76 raw status lines corroborate this, allowing for the one
  already-tracked-but-modified file, `SPRINT_3_0B_REPORT.md`, counted differently by each method). The
  figure of 65 undercounts by roughly 10 documents.
- **Changes recovery order?** No.
- **Changes milestone boundaries?** No — this is an aggregate count used for narrative color in the
  document's evidence section, not a per-tier file list; the per-tier "Evidence" column citations
  elsewhere in the document were not found to be inaccurate by this pass.
- **Changes governance positioning?** No.
- **Changes implementation strategy?** No.

---

## Summary Table

| #   | Document(s)                                   | Severity                                 | Changes recovery order? | Changes milestone boundaries?                                                   | Changes governance positioning?                            | Changes implementation strategy?                                 |
| --- | --------------------------------------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | REPOSITORY_HISTORY_RECOVERY.md §0             | Low                                      | No                      | No                                                                              | No                                                         | No                                                               |
| 2   | REPOSITORY_HISTORY_RECOVERY.md §0             | Low                                      | No                      | No                                                                              | No                                                         | No                                                               |
| 3   | GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md §7/§9 | **High** (internally self-contradictory) | No                      | No                                                                              | **Partial** — reasoning changes, E2-floor conclusion holds | Minor — expect lint-staged to run from the first worktree commit |
| 4   | GOVERNANCE_POSITION_IN_HISTORY.md §5/§7       | **High**                                 | No                      | No                                                                              | **Partial** — same as #3                                   | Minor — same as #3                                               |
| 5   | GOVERNANCE_POSITION_IN_HISTORY.md §5          | **Medium**                               | No                      | **Yes** — 7 subdirectories under `packages/tracking/src/` have no assigned tier | No                                                         | Yes — re-derive K7/E1/E2's file list at execution time           |
| 6   | REPOSITORY_HISTORY_RECOVERY.md §0             | Low                                      | No                      | No (minor scope note re: `scripts/governance` package)                          | No                                                         | No                                                               |
| 7   | REPOSITORY_HISTORY_RECOVERY.md §0             | Low                                      | No                      | No                                                                              | No                                                         | No                                                               |

**Net assessment:** the recovery plan's overall tier structure, dependency graph, and Governance's
earliest-valid-placement conclusion (after milestone E2) all survive this reconciliation pass intact —
none of the seven discrepancies overturns them. What does need attention before those specific
milestones are executed: (a) the `.husky` history claim's _reasoning_ (Discrepancies 3–4) should be
corrected wherever it's cited as justification for the worktree strategy being "zero-enforcement" early
on, and (b) K7/E1/E2's file scope (Discrepancy 5) should be re-checked against the real 13-subdirectory
`packages/tracking/src/` tree before that milestone is staged, so the 7 currently-unassigned
subdirectories don't get silently dropped or silently absorbed into the wrong commit.

No document was modified. No Git state was modified. No workaround is proposed. Stopping here.
