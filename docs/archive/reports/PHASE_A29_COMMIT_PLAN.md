# Phase A.29 — Commit Plan Validation Report

Date: 2026-08-15
Repository: `lumo-platform`
Scope: **validation only**. Nothing was staged, committed, pushed, rotated, rewritten, or
applied. `.dependency-cruiser.cjs` and `.jscpd.json` were not touched; the stash (`stash@{0}`)
was not touched. This report only records what was measured against the working tree as it
already stood.

---

## 1. Full validation results

All four checks ran against the full working tree (all 310 proposed-commit files + the excluded
`.claude/`, since these tools operate on the tree as a whole, not per-group).

| Check                           | Command                                                                                                                                      | Result                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck                       | `pnpm typecheck` (`turbo run typecheck`)                                                                                                     | **PASS** — 78/78 packages successful (`tsc --noEmit`), 510ms, full cache hit (valid — turbo cache keys are content hashes, not timestamps, so a hit here means these exact files were already known-good) |
| Lint                            | `pnpm lint` (`turbo run lint`)                                                                                                               | **PASS** — 78/78 packages successful (`eslint .`), 472ms, full cache hit                                                                                                                                  |
| Architecture boundaries         | `pnpm arch` (`depcruise packages services --config .dependency-cruiser.cjs`) — **the current, unmodified config**, not the stash's candidate | **PASS** — 0 violations, 1566 modules / 6791 dependencies cruised                                                                                                                                         |
| Full test suite, cache disabled | `pnpm test --force` (`turbo run test --force`)                                                                                               | **PASS** — 78/78 tasks successful, 0 cached (confirmed cache was actually bypassed), 2m6s total                                                                                                           |

### Test count

- **2,269 tests passed**
- **378 tests skipped**
- **0 tests failed**

The 5 lines that matched a naive "fail" grep are all test _names_ asserting fail-closed security
behavior (e.g. `FAILS CLOSED outside local without a production MFA provider (C2-4)`,
`fails closed for a human principal with no valid session`) — not failures. Turbo's own summary
line confirms it: `Tasks: 78 successful, 78 total`.

### Why 378 tests are skipped — and the integration-test gap this leaves

Every skipped test is inside a `*.integration.test.ts` file (Postgres via Prisma, Redis, S3,
Kafka, or Ory Keto) that self-skips when it can't reach live infrastructure. Confirmed by
package: `@platform/customer-360` (56), `@platform/identity` (41), `@platform/security` (6),
`@platform/orders` (5), `@platform/returns` (8), `@platform/payments` (9), `@platform/finance`
(8), `@platform/checkout` (8), `@platform/inventory` (8), `@platform/licensing` (8),
`@platform/auth` (1), `@platform/storage` (7), `@platform/redis` (4), `@platform/kafka` (1), and
others.

**Docker Desktop was not running** at the start of this check (`docker ps` failed immediately
with an `npipe`/"daemon not found" error). Per your instruction to run "the strongest available
non-destructive validation," I started Docker Desktop and polled for up to several minutes.
[See §1a below for the outcome — filled in after the poll completed.]

This means: **no repository-specific integration test against a real Postgres/Redis/S3/Kafka/
Keto instance could be executed and confirmed passing in this validation pass**, beyond what the
skip-aware unit/logic-level test suite already covers. This is a recurring, previously-documented
environment limitation in this workspace (Docker/WSL2 has failed to come up cleanly in several
earlier phases per this repo's own history), not something introduced by the changes under
review. It is a real gap in this validation, not a pass — flagged as such below in §5.

### 1a. Docker retry outcome

Attempted: launched Docker Desktop (`Docker Desktop.exe`), confirmed via `tasklist` that 5
`Docker Desktop.exe` processes and 2 `com.docker.backend.exe` processes came up, and confirmed
`wsl --status` reports the `docker-desktop` WSL2 distribution as the default (WSL2 itself is
healthy this time — no OS-level breakage like some earlier phases hit). Despite that, `docker ps`
did not return within any of four separate bounded checks (two 120s waits, then two 15–20s bounded
retries, ~6 minutes total) — the daemon process is up but never became responsive to the CLI in
that window.

**Conclusion: Docker was not usable for live integration testing in this validation pass.**
Stopped retrying at this point rather than continuing indefinitely — this is an environment
issue, not something the code changes under review can affect, and matches this repository's own
history of intermittent Docker/WSL2 unavailability in this environment. Nothing about the code
was changed or worked around because of this; it's recorded here as a validation gap only (see
§5, item 4).

---

## 2. Secret validation (re-scan of the exact proposed commit set)

Scanned all 310 files/directories across G1, G2, G3, G5, G6, G7 (everything except the excluded
`.claude/`) — both the tracked diff (`git diff`, added lines) and the full contents of every new
untracked file — against patterns for AWS access keys, Stripe/Slack/GitHub/GitLab/Google live-key
shapes, PEM private-key blocks, and embedded `user:password@host` connection strings.

**Confirmed clean.** No real credentials, API keys, tokens, private keys, or `.env` files are
present in the proposed commit set. Every match was one of:

- An environment-variable **name** referenced in code/docs (`STRIPE_SECRET_KEY`,
  `S3_ACCESS_KEY_ID`, `ADMIN_API_TOKEN=` with no value) — not a value.
- The project's own well-known **local/CI-only dev convention** `postgresql://lumo:lumo@...`
  (used identically in `.env.example`, Docker Compose, CI workflow, and every integration test's
  doc-comment — never a real host), or the explicit template placeholder
  `postgresql://USER:PASSWORD@postgres.data.svc.cluster.local/...` in
  `infrastructure/k8s/secret.example.yaml` (a file this validation didn't even touch).
- A **test fixture** value: `postgresql://lumo:secret@db-host:5432/lumo` in
  `packages/db/src/client.test.ts` (verifying URL-building/redaction logic) and `tok_abc` in a
  payments test (a fake, obviously-non-real Stripe-style token used as a fixture).
- `.env` itself: confirmed **not** part of the changed/proposed set at all, and confirmed
  gitignored (`.gitignore:19`).

### Known blocker — carried forward, not re-introduced

**`infrastructure/docker/docker-compose.yml` `HEAD` (current, committed, pushed to
`origin/main`) contains a hardcoded real credential** (operator email + password) introduced in
commit `3f2520e`, also present in `reference/working-tree-2026-08-03` (`ab3e466`, `de46df9`,
also pushed). Confined to that one line/file; not reused elsewhere in the repo or its history.

The value is **not printed here** (already documented, not reproduced, in the prior turn's
findings — that stands).

- The diff **in G5** _fixes this going forward_ (moves to `${PGADMIN_DEFAULT_PASSWORD:-admin}`,
  a safe generic local-only fallback) — this fix contains no secret and is safe to commit.
- Committing that fix **does not remove the old value from git history** — it stays reachable
  in past commits on `origin/main` and `origin/reference/working-tree-2026-08-03` until you
  explicitly decide to rotate the real credential and/or rewrite history. **Per your instruction,
  neither action was taken.** This remains an open blocker requiring your explicit decision,
  tracked here and in the prior turn's findings.

---

## 3. Commit grouping (unchanged, not split)

| Group                                          | Files | Status                                                           |
| ---------------------------------------------- | ----- | ---------------------------------------------------------------- |
| G1 — financial/transaction-integrity hardening | 184   | validated (see §1, §4)                                           |
| G2 — Lumo Design System                        | 81    | validated (see §1, §4)                                           |
| G3 — Storefront app                            | 23    | validated (see §1, §4) — **has a hard dependency on G2, see §4** |
| G5 — Infra/tooling                             | 13    | validated (see §1, §4) — **should land after G1/G2/G3, see §4**  |
| G6 — Release-readiness audit docs              | 7     | validated (docs only, no code dependency)                        |
| G7 — Phase A.28 cleanup                        | 2     | validated (docs only, no code dependency)                        |
| Excluded — `.claude/`                          | 1     | local tooling config, not project code                           |

Exact file lists: unchanged from `PHASE_A29_COMMIT_PLAN.md` sent previously (same categorization,
re-verified during this pass — see `categorized.txt` derivation in this session).

G1 was **not split** — per your instruction, that decision is deferred until the full working
tree's validation (this section) is complete. It now is: full validation is clean per §1. The
recommendation on whether to split G1 is in §5.

---

## 4. Dependency-consistency check across proposed groups

### Cross-group source-code imports

Checked every file in each group for `import ... from "@platform/*"` statements pointing at a
package that belongs to a _different_ group.

- **G1 → G2/G3: none.** No file under `services/`, `apps/admin`, `apps/runtime`, or
  `packages/db` imports `@platform/ui` or `@platform/design`.
- **G2 → G1: none.** No file under `apps/admin-web`, `packages/ui`, or `packages/design`
  imports `@platform/payments`, `@platform/orders`, `@platform/returns`, `@platform/checkout`,
  `@platform/cart`, or `@platform/finance`. `admin-web` talks to the backend over HTTP, not by
  importing service internals.
- **G3 → G2: confirmed, hard dependency.** `apps/storefront/src/app/layout.tsx` imports
  `ThemeProvider` and `apps/storefront/src/app/page.tsx` imports `Card`/`CardContent`/
  `CardHeader`/`CardTitle` from `@platform/ui`. Checked `packages/ui/src/index.ts` **as it
  exists at current `HEAD`** (before any of these changes): **neither `ThemeProvider` nor `Card`
  is exported there.** They only exist after G2's changes land. **A G3 commit cannot build in
  isolation before G2 has landed.**

### Shared / derived files

No single file is double-counted across groups — the categorization is a strict partition. But
**`pnpm-lock.yaml` (in G5) is a derived artifact whose correct content depends on package.json
changes spread across G1, G2, _and_ G3**, not just G5:

| package.json                   | Group | New dependency lines                                                                                                                |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/package.json`      | G1    | `@platform/types` (workspace)                                                                                                       |
| `apps/runtime/package.json`    | G1    | `@platform/payments`, `@platform/returns` (workspace)                                                                               |
| `packages/db/package.json`     | G1    | `vitest` (devDep), new `"./testing"` export                                                                                         |
| `packages/design/package.json` | G2    | `vitest` (devDep)                                                                                                                   |
| `packages/ui/package.json`     | G2    | `@platform/design` (workspace), 6 new `@radix-ui/*` packages, `lucide-react`, `react`/`react-dom`, `vitest` + testing-library stack |
| `apps/storefront/package.json` | G3    | `@fontsource/ibm-plex-sans-arabic`, `geist`, `lucide-react`, `vitest` + testing-library stack                                       |

If `pnpm-lock.yaml` is committed in G5 while G5 is ordered _before_ G1/G2/G3, a
`pnpm install --frozen-lockfile` run against any of the intermediate commits (after G1/G2/G3's
package.json changes land but before the matching lockfile does) would fail — the lockfile
wouldn't yet contain entries for the new dependencies those package.json files declare.

**This is not a defect in the code** — the combined end state (what `pnpm typecheck`/`lint`/
`test` validated in §1) is entirely correct. It's purely a _commit-ordering_ constraint. See §5
for the recommended fix (reorder, not re-split).

### Config files with a soft ordering dependency on G2

`.prettierignore` and `eslint.config.mjs` (both G5) each remove the now-dead ignore rule for
`apps/admin/prototype/**` — dead because G2 deletes
`apps/admin/prototype/admin-dashboard.frozen.html`. If G5 lands before G2, there's a harmless
window where that file still exists but is no longer lint/format-excluded (cosmetic only, not
build-breaking, and moot once the same reorder recommended above is applied).

`turbo.json` (G5) adds `DATABASE_URL_TEST` to `globalEnv` — used for turbo's cache-key hashing
of G1's new integration tests. Affects cache correctness only, not functional correctness; also
resolved by the same reorder.

### Generated / temporary / do-not-commit files

- **Generated:** `pnpm-lock.yaml` itself (machine-generated; see dependency note above — commit
  it, don't hand-edit it, watch the ordering).
- **Temporary/scratch:** none found in the proposed set. (The `test_*.txt`/`tsc_*.txt`/
  `typecheck_out*.txt`/etc. scratch files that appeared in the Phase A.28 stash review never
  existed in this working tree — they were only ever in the stash, not part of this commit set.)
- **Do not commit:** `.claude/` (already excluded — local Claude Code tooling config:
  `launch.json`, `worktrees/`). Nothing else identified.

---

## 5. Recommendations (no action taken — for your review)

1. **G1 stays one commit.** Full-tree typecheck/lint/arch/test all pass, and per the earlier
   analysis its ~184 files can't be cleanly sliced by phase without risking non-buildable
   intermediate states. Nothing in this validation pass changes that recommendation.
2. **Commit order: G1 → G2 → G3 → G5 → G6 → G7.**
   - G2 before G3 is **mandatory** (G3 imports G2's new `@platform/ui` exports).
   - G5 after G1/G2/G3 is **strongly recommended**, so `pnpm-lock.yaml` (and the two small
     config cleanups) land only once every package.json change they depend on already has.
   - G6 and G7 are docs-only and have no ordering constraint on anything; placed last as a
     matter of convention (audit trail after the code it audits).
3. **Two items remain explicit blockers, unresolved by design, per your instructions:**
   - The pgAdmin credential in git history on `origin/main` and
     `origin/reference/working-tree-2026-08-03` — needs your decision on rotation and/or history
     rewrite. Not touched.
   - `.dependency-cruiser.cjs` and `.jscpd.json` candidates from the stash — not applied, not
     touched.
4. **Real gap, not a pass:** 378 integration tests against Postgres/Redis/S3/Kafka/Keto could not
   be executed live in this environment (see §1a). If a live Postgres is reachable in CI or on
   another machine before you approve, worth running `pnpm test` there once for the DB-touching
   groups (G1 especially) as a final check — this local validation pass could not provide that
   evidence.

**Still waiting on your approval before anything is staged, committed, or pushed.**
