# Sprint 3.0C Report — Repository Protection & Baseline

> 2026-07-05. Protection only: no architecture, no runtime, no Docker, no push.

## 1. Inspection & classification

HEAD `a5cfabe` (Sprint 1.2; clean per-sprint history + tags `sprint-0.2…0.5` before it).
Working tree: **189 paths** — services 71, packages 54, docs 42, infrastructure 10, apps 6,
root configs 6 (93 new files, 96 modified). Junk check: clean — no `node_modules`/`.next`/
`dist`/secret files stageable; only the tracked `.env.example` (legitimate, no secrets).
Classification by sprint exists authoritatively in `docs/implementation/SPRINT_*_REPORT.md`
(each lists its files created/modified) and `CHANGELOG_AI.md`.

## 2–3. Commit plan — and the honest isolation verdict

The requested sequence (each report''s recommended message, 1.3 → 3.0B, ~14 commits) is
**documented in the reports and CHANGELOG_AI** — but it CANNOT be executed truthfully from this
tree. Proof: shared files hold the superposition of many sprints (`packages/contracts/src/
index.ts` = 0.7+2.3+2.4+2.7+2.8; `services/orders/src/index.ts` = 1.4+2.2+2.5+2.9;
`pnpm-workspace.yaml` = 0.1+2.8; every docs file = every sprint). Git commits path SNAPSHOTS:
staging "Sprint 1.3''s files" would commit their CURRENT (Sprint-3.0-era) content under a
Sprint-1.3 message — a fabricated history. **Never fake separation** ⇒ the truthful protection
is ONE baseline commit whose message states exactly what it is, with the per-sprint record
living in the reports it points to. Per-sprint commits resume PROSPECTIVELY from the next
sprint (D-051 + RELEASE_PROCESS already mandate it).

## 4. Tagging strategy (continues the existing `sprint-*` convention)

- `sprint-3.0C-baseline` on the baseline commit (also serves as the phase-1/phase-2 marker —
  separate phase tags on the SAME commit would imply separable states that don''t exist).
- Every future sprint: `sprint-<n>` on its own commit. Releases: `v<semver>` via changesets.

## 5. Branch strategy

`main` = protected, always green (CI gate). `develop` deliberately NOT adopted — trunk-based
with short-lived `feature/<sprint-or-ticket>` branches + PRs fits a solo+AI team; `hotfix/*`
from the release tag; `release/*` only when a stabilization window is ever needed. (Adding
git-flow ceremony now would be process theater; revisit at multi-team scale.)

## 6. Backup strategy

1. **Immediate (executed this sprint):** local `git bundle --all` snapshot outside the repo
   directory (survives repo corruption/deletion; NOT disk failure).
2. **Primary (operator, next action — push is forbidden THIS sprint):** push `main` + tags to
   the GitHub remote; enable branch protection + require CI.
3. **Nightly:** GitHub is the offsite copy; optional scheduled `git bundle` to a second drive.
4. **Database:** N/A until first boot seeds data; then doc 15 §2.5 (pg_dump → versioned
   `backups` bucket; PITR posture prepared in 2.2.5).
5. **Secrets:** none in-repo by policy (verified again); real values live only in the
   operator''s `.env.local` + future Vault (D-014) — back up OUTSIDE git.

## 7. Readiness verdict

After baseline commit + tag + bundle: the repository is protected **locally** and MAY proceed
to First Boot. Full protection requires the operator''s GitHub push (blocked by this sprint''s
own no-push rule — it is the single next action). G-0 status: closed-locally / push-pending.

## Execution record (post-commit)

- Baseline commit: `f1336a5` — first attempt was REJECTED by commitlint (sentence-case subject +
  > 100-char body lines; honest hook, honest fix). lint-staged's prettier reformatted ~220
  > previously-committed files during the hook run; the reformat is included in the baseline.
- Tag: `sprint-3.0C-baseline` (continues the existing `sprint-0.x` convention).
- Backup: `%USERPROFILE%\morbeh-backups\morbeh-platform-3.0C-baseline.bundle` — `git bundle verify`
  = okay (all refs + tags).
- Post-reformat gates re-verified: lint/typecheck/test 120/120 ✅ · arch 0 violations ✅.
- Working tree: CLEAN (0 paths). G-0: closed-locally; the GitHub push remains the operator's
  next action (forbidden this sprint by its own rules).
