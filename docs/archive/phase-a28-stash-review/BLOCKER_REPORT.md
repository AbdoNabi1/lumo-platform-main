# Blocker Report — Milestone 1 (Tier 9: Planning/Analysis Docs)

Written before staging or committing anything. No file has been modified to produce this report
except the report itself. `.husky/pre-commit`, `scripts/governance/**`, and all baseline files remain
untouched.

## 0. What was being attempted

Per `REPOSITORY_HISTORY_RECOVERY.md` §4, item 1, the first milestone in the recommended commit order
is **Tier 9 — docs-only** (zero risk, zero dependencies): `ARCHITECTURE_REMEDIATION_PLAN.md`,
`IMPLEMENTATION_DEPENDENCY_GRAPH.md`, `ARCHITECTURE_EXECUTION_MATRIX.md`, `PRODUCTION_CUTOVER_PLAN.md`,
`ARCHITECTURE_GOVERNANCE.md`, `ADR_0060_IMPLEMENTATION_AUDIT.md`, `FINAL_ARCHITECTURE_AUDIT.md` (all 7
already sitting staged in the index from a prior session, alongside `REPOSITORY_HISTORY_RECOVERY.md`
itself). Before staging/committing anything further, per the mandated workflow, I verified the commit
would actually succeed. It will not.

## 1. Root Cause

`.husky/pre-commit`, as it exists **on disk right now** (regardless of git-tracked status — Husky
invokes whatever file is physically present via `core.hooksPath=.husky/_`), contains:

```
pnpm lint-staged
node scripts/governance/run.mjs
```

The second line runs unconditionally, with no staged-file or `HEAD` scoping. Its file-discovery
(`walk()`/`tsSources()` in `scripts/governance/lib.mjs`) reads the entire live filesystem under
`packages/`, `services/`, `apps/` — every one of the ~750 currently-uncommitted files belonging to
Tiers 1–8 and 10 of the recovery plan, not just whatever would be in the commit. `FF-API-01` then diffs
the live TypeScript export surface against `scripts/governance/baseline/public-api.json`, itself
untracked and last written 2026-07-27 11:03 AM — a snapshot from **partway through** the very backlog
this recovery is reconstructing (it already includes `services/orders`' uncommitted Tier-2 checkout
lifecycle, but not Sprint A1's uncommitted `Order.completePayment`/`MarkOrderPaidDeps.shadow`).

**Empirically confirmed this session** (ran `node scripts/governance/run.mjs` directly, read-only, no
`--update`, no files modified):

```
FAIL  FF-API-01  public API stability ... 2 blocking finding(s)
  services/orders  Public API signature changed for "MarkOrderPaidDeps" (breaking, L3)
  services/orders  Public API signature changed for "Order" (breaking, L3)
EXIT CODE: 1
```

This fails **right now**, before any milestone-specific `git add` — meaning it would fail identically
for Milestone 1 (7 pure markdown files, zero source code) as for any other milestone, because the
check does not look at what is staged. A plain `git commit` in the current working tree cannot succeed
for any milestone until this is addressed.

## 2. Affected Files

- `.husky/pre-commit` (working tree only — the governance line is uncommitted; see §4 correction)
- `scripts/governance/run.mjs`, `lib.mjs`, `api-surface.mjs` (unmodified; this is the detection logic being exercised)
- `scripts/governance/baseline/{public-api,dependencies,events}.json` (untracked, stale mid-sequence snapshot)
- The 8 files already staged for Milestone 1 (blocked from being committed as long as the hook fires this way)

## 3. Dependency Chain

```
git commit (Milestone 1, docs-only)
  → core.hooksPath (.husky/_) invokes the on-disk .husky/pre-commit
    → pnpm lint-staged                        (scoped correctly — not the problem)
    → node scripts/governance/run.mjs         (unconditional, whole-tree, no git awareness)
      → FF-API-01 diffs live services/orders export surface vs. stale 11:03 AM baseline
        → 2 blocking findings, unrelated to Milestone 1's own (doc-only) content
          → commit rejected
```

## 4. Historical Reason — including a factual correction to the source documents

`GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md` and `GOVERNANCE_POSITION_IN_HISTORY.md` (both cited as
authoritative for this process) already diagnose this exact mechanism and already recommend a fix
(git worktree + temporary recovery branch), but leave three decisions explicitly open — "needs your
call," "confirm before execution" — rather than resolved. Per this process's own rule ("if a blocker is
found, do not guess, do not work around it"), I have not acted on any of the three.

**Separately, while re-verifying the evidence behind those two documents (not taking their claims on
faith), I found one of their central factual claims is wrong:**

Both documents assert `.husky/pre-commit` has **zero commit history, ever** — quoting
`git ls-tree -r HEAD -- .husky` as empty, and stating "there is no historical moment to place it at."
Re-run this session:

```
git ls-tree -r HEAD -- .husky
  100644 blob ... .husky/commit-msg
  100644 blob ... .husky/pre-commit          <-- IS tracked at HEAD, contrary to both documents' claim

git show HEAD:.husky/pre-commit
  pnpm lint-staged                            <-- one line, no governance call

git log --oneline -- .husky/pre-commit
  ed3654d feat(infrastructure): complete Sprint 0.2 infrastructure foundation
```

`.husky/pre-commit` (the base, `pnpm lint-staged`-only version) has been committed since **Sprint 0.2**
(`ed3654d`) — a commit that does not even appear in `REPOSITORY_HISTORY_RECOVERY.md` §0's own
"already committed, do not touch" inventory. That inventory lists 19 commits; the real `git log
--oneline` has **21** — it is missing both `ed3654d` (Sprint 0.2, the actual root of hook history) and
`bf748f8` (`Merge branch 'main' of https://github.com/AbdoNabi1/lumo-platform`).

**What this changes and what it doesn't:**

- It does **not** overturn Governance's earliest-valid-placement conclusion (after milestone E2) — that
  conclusion rests on `FF-TRACK-01`'s comment text narrating the Browser SDK's completed architecture
  as settled fact, which is independent of `.husky`'s history and unaffected by this correction.
- It **does** invalidate the specific justification given for why a worktree is safe pre-Governance
  ("no hook file exists at all that early"). In reality, a worktree checked out at `HEAD` (or any commit
  from `ed3654d` onward) already has a real, committed `pnpm lint-staged`-only hook that **will** run
  on every commit from the first reconstructed milestone onward — expected to be harmless (it only
  auto-formats staged files, already observed to behave correctly in a prior Tier-9 staging attempt
  per `GOVERNANCE_HISTORY_RECOVERY_ANALYSIS.md` §1), but the documents' claim of "no enforcement at all"
  for early commits is not accurate; it should read "no _governance_ enforcement," lint-staged still runs.
- `REPOSITORY_HISTORY_RECOVERY.md` §0's own commit inventory should be corrected to include `ed3654d`
  and `bf748f8` before being relied on as the definitive "do not touch" baseline list.

I'm flagging this because I was instructed to treat these documents as the single source of truth and
to follow them strictly — and direct verification shows one of their load-bearing factual claims does
not hold. Proceeding as if it did would mean building the next several milestones' governance strategy
on a disproven premise.

## 5. Possible Solutions

**A — Git worktree + temporary recovery branch** (both documents' existing primary recommendation,
corrected per §4 above). `git worktree add` from a new branch at current `HEAD`; each milestone's files
are deliberately copied in and committed there, never bulk-added. Zero modification to any hook,
governance script, lint-staged config, or baseline file. `pnpm lint-staged` runs from the first commit
(harmless auto-format, per the corrected understanding above); the governance script stays silent until
its own milestone (positioned no earlier than after E2, per the unaffected `FF-TRACK-01` argument) lands
within that same branch. Cost: a second `pnpm install` per worktree; files must be copied in per the
plan's own lists rather than bulk-`git add`-ed (a safety improvement, not just overhead).

**B — Stash-snapshot dance** (`git stash push --keep-index --include-untracked` around `git commit`, in
the current tree). Zero file modification, lower setup cost than A. But it reuses today's on-disk hook
content unmodified — meaning it **would** invoke the governance script from the very first commit, and
that script is confirmed failing right now (§1). Making this viable would require either neutralizing
the governance line for the stash window (itself a modification to `.husky/pre-commit`, which the
process rules forbid) or waiting until Governance's own milestone + a correct baseline exist — at which
point it stops being useful for the _early_ milestones it would need to cover. Strictly worse than A for
Milestone 1 specifically.

**C — Commit anyway / `--no-verify`.** Not viable: confirmed failing (§1); `--no-verify` is explicitly
disallowed.

## 6. Recommended Solution

**Option A**, matching both source documents' own conclusion. Not executed in this turn, because it
requires resolving three decisions those same documents explicitly reserve for you, and guessing at
them is exactly what this process's blocker-handling rule forbids:

1. **Confirm the execution mechanism** — worktree + temporary branch (recommended) vs. an alternative.
2. **Confirm Governance's exact landing slot** — after E2 (earliest historically valid position per the
   `FF-TRACK-01` finding), standalone, or folded into R3 Operational Hardening. Does not block Milestone
   1 itself, but determines how many milestones land with zero automated gate, which you should approve
   knowingly rather than have it fall out of a default.
3. **Confirm what the first real `governance:update` baseline should be diffed against**, once
   Governance's own milestone is reached — the docs' own answer is "nothing" (a fresh baseline, not
   today's mid-sequence snapshot), but this is flagged there as a judgment call needing your sign-off,
   not something to assume.

Also worth a decision while we're here: should `REPOSITORY_HISTORY_RECOVERY.md` §0's commit inventory be
corrected (add `ed3654d`, `bf748f8`) before further milestones cite it as the "do not touch" baseline?

Stopping here per the process's blocker rule. No code modified, nothing staged beyond what was already
staged before this session, nothing committed, `.husky`/governance/baseline untouched.
