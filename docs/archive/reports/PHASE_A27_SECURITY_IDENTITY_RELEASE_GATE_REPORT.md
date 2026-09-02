# Phase A.27 — Security Remediation + Identity Production Coverage Gate

**Date:** 2026-08-15
**Scope:** Close A.26's two production-readiness blockers (public pgAdmin credential exposure; zero real-DB Identity coverage) and issue a final release verdict.
**Evidence key:** every claim below is marked **PROVEN** (command run, output observed), **INFERRED** (derived from proven facts, not directly executed), **NOT TESTED** (out of scope or not exercised), or **BLOCKED** (could not be verified).

---

## 1. Executive Summary

**Verdict: NO-GO.**

The platform is technically sound: zero schema drift, zero test failures (2,426 passed / 13 intentionally-gated skips / 0 failed across the full monorepo), zero lint/typecheck/architecture violations, and Identity now has real-Postgres integration coverage (41 new tests, 70/70 total in the package) with **no reproducible production defect found**. Docker infrastructure required for release (Postgres, Redpanda, Debezium/Kafka Connect) is healthy.

The release is blocked by exactly one item, unchanged from A.26: **a real pgAdmin credential is still live on public `origin/main`, in a public GitHub repository, right now.** Per your instruction this phase did not rotate it ("hold off"). Per Task 17's explicit rule set, a live, unrotated public credential exposure is a NO-GO condition regardless of how clean everything else is — this report does not downgrade that.

---

## 2. A.26 Baseline

| Item                      | A.26 claim                                      | A.27 independent re-verification                                                                                                                                                                                                                     | Status                               |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Schema drift              | ZERO                                            | ZERO (see §12)                                                                                                                                                                                                                                       | **PROVEN**, re-confirmed             |
| Tests                     | 2,385 passed / 0 failed / 31 skipped            | 2,426 passed / 0 failed / 13 skipped (see §15)                                                                                                                                                                                                       | **PROVEN**, re-run fresh, not reused |
| Typecheck / Lint          | 78/78                                           | 78/78                                                                                                                                                                                                                                                | **PROVEN**, re-run fresh             |
| Architecture              | 0 violations, 1,566 modules / 6,791 deps        | 0 violations, 1,566 modules / 6,791 deps                                                                                                                                                                                                             | **PROVEN**, identical                |
| pgAdmin credential        | Present in `HEAD`, working-tree fix uncommitted | Confirmed still present in `HEAD`/`origin/main`; working-tree fix still present, still uncommitted                                                                                                                                                   | **PROVEN**                           |
| Identity real-DB coverage | Zero                                            | 41 new tests added, 0 defects found                                                                                                                                                                                                                  | **CLOSED**                           |
| HEAD                      | not stated                                      | `1b4ff76e`                                                                                                                                                                                                                                           | **PROVEN**                           |
| origin/main               | not stated                                      | `1b4ff76e` (identical to HEAD, no divergence)                                                                                                                                                                                                        | **PROVEN**                           |
| Repo visibility           | "public" (implied)                              | Confirmed **public** via GitHub API (`AbdoNabi1/lumo-platform`)                                                                                                                                                                                      | **PROVEN**                           |
| Working tree              | large uncommitted set                           | 309 changed paths at phase start → 311 at phase end (net: +2 new Identity test files; nothing else added by this phase besides the 1 checklist-doc edit, which was a pre-existing +1 already counted in the file's own diff, not an additional file) | **PROVEN**                           |

A.26's numbers were not simply trusted — every gate in this table was independently re-run in this phase (§11, §12, §15).

---

## 3. Credential Exposure Status

No secret value is reproduced anywhere in this report or in any command run during this phase.

| Check                                                                  | Result      | Evidence                                                                                                                              |
| ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Real credential in `HEAD` (`infrastructure/docker/docker-compose.yml`) | **PRESENT** | `git show HEAD:infrastructure/docker/docker-compose.yml` — lines 493–494                                                              |
| Present on `origin/main`                                               | **PRESENT** | `origin/main` == `HEAD` (`1b4ff76e`)                                                                                                  |
| Repository public                                                      | **YES**     | GitHub API: `"private": false, "visibility": "public"`                                                                                |
| Working tree uses env vars                                             | **YES**     | `${PGADMIN_DEFAULT_EMAIL:-admin@example.com}` / `${PGADMIN_DEFAULT_PASSWORD:-admin}` pattern confirmed present, **uncommitted**       |
| `.env` gitignored                                                      | **YES**     | `.gitignore:19-20` (`.env`, `.env.*`); `.env` confirmed not tracked                                                                   |
| `.env.example` placeholders only                                       | **YES**     | No real value present; matches placeholder pattern                                                                                    |
| Present in any other currently-tracked file                            | **NO**      | Repo-wide `git grep` for both the password string and the email string returned zero matches                                          |
| Reachable in git history                                               | **YES**     | 3 commits: `3f2520e` (2026-07-06), `ab3e466`, `de46df9` (both 2026-08-03) — all touch only `infrastructure/docker/docker-compose.yml` |
| Reachable on `origin`                                                  | **YES**     | `3f2520e` on `origin/main` **and** `origin/reference/working-tree-2026-08-03`; `de46df9` additionally on the latter                   |
| Reachable on tags                                                      | **YES**     | Both existing tags (`sprint-a0-complete`, `sprint-integration-recovery-baseline`) contain `3f2520e`                                   |

**Classification: CRITICAL — CURRENT PUBLIC EXPOSURE.** Unchanged from A.26. This is a live, ongoing exposure, not a historical-only one — the file is still world-readable at `HEAD` on a public repo today.

**PROVEN.**

---

## 4. Credential Rotation Status

Per Task 3's mandatory gate, you were asked for explicit approval before any rotation step. Your answer: **"Not yet — hold off."**

- Credential rotation: **NOT PERFORMED** (explicit user decision, respected).
- Working-tree remediation: **READY** (env-var pattern confirmed correct, see §3), but **NOT COMMITTED** — per your standing instruction to keep all A.27 changes uncommitted.
- No credential rotation, revocation, or commit was attempted by this phase, consistent with the "only stop for credential rotation / commit / push / history rewrite / destructive ops" execution rule.

**PROVEN** (rotation status is a direct fact of what was/wasn't done, not inferred).

---

## 5. Git History Exposure

| Commit    | Date                | On `origin/main`?                                  | On `origin/reference/working-tree-2026-08-03`? | On tags?                                                           |
| --------- | ------------------- | -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `3f2520e` | 2026-07-06 (oldest) | **YES**                                            | YES                                            | YES (`sprint-a0-complete`, `sprint-integration-recovery-baseline`) |
| `ab3e466` | 2026-08-03          | NO (local-only, `recovery/history-reconstruction`) | NO                                             | NO                                                                 |
| `de46df9` | 2026-08-03 (newest) | NO                                                 | **YES**                                        | NO                                                                 |

- All 3 commits touch only `infrastructure/docker/docker-compose.yml`.
- The secret is present in **every commit from `3f2520e` onward through `HEAD`** on `origin/main` — it has never been removed from history, only masked in the uncommitted working tree.
- Two distinct public remote refs carry it: `origin/main` (the default branch) and `origin/reference/working-tree-2026-08-03`.

**PROVEN** (`git log --all -S`, `git merge-base --is-ancestor`, `git tag --contains`, `git branch -r --contains`).

---

## 6. Git History Rewrite Plan (NOT EXECUTED)

This section is a plan only. No destructive git operation was performed.

**Tool:** `git filter-repo` (not `filter-branch` — purpose-built, faster, and the currently-recommended tool for this).

**Recommended approach:** targeted content redaction rather than file deletion, since `infrastructure/docker/docker-compose.yml` has legitimate ongoing history that shouldn't be erased:

```
git filter-repo --replace-text <redaction-rules-file>
```

where `<redaction-rules-file>` maps the literal secret strings to a placeholder (e.g. `REDACTED`), one rule per line. `--replace-text` operates on blob (file) content only — it does not touch commit author/committer metadata, so it will not affect your git identity even though your real email is part of the leaked value.

**Affected refs (would all need rewriting and force-pushing):**

- `origin/main` (default branch)
- `origin/reference/working-tree-2026-08-03`
- local branches `main`, `recovery/history-reconstruction`, `reference/working-tree-2026-08-03`
- tags `sprint-a0-complete`, `sprint-integration-recovery-baseline` (both contain `3f2520e` — `filter-repo` rewrites tags too; they would need to be re-created pointing at the new commit SHAs)

**Force-push implications:** every commit SHA from `3f2520e` forward changes. Anyone who has already cloned or forked the repo keeps the old, still-secret-containing history locally and on any fork's own remote — a history rewrite on `origin` does **not** retroactively scrub those copies. GitHub's own caches (PR diffs, commit-comment permalinks, cached raw-blob URLs) can continue serving the old content for a period after a force-push, and are outside your control to purge on demand.

**Clone/fork implications:** collaborators would need to re-clone or hard-reset to the new history (`git fetch && git reset --hard origin/main`); any open PRs based on old SHAs would need to be re-based or re-opened.

**Rotation requirement — must happen regardless of history rewrite:** rewriting history only prevents _future_ discovery of the value via `git log`/`git clone`; it does nothing about copies already made (clones, forks, GitHub's caches, any scraper/bot that indexed the public repo before the rewrite). **The credential must be treated as compromised and rotated whether or not history is ever rewritten** — history rewriting is a hygiene/cleanup step, not a substitute for rotation.

**Recommendation:** rotate first (independent of this plan, whenever you choose), then decide separately whether the history-rewrite disruption (force-push, collaborator re-clones, tag recreation) is worth it — the credential being rotated makes the remaining historical exposure a lower-urgency cleanup item rather than an active risk.

**NOT TESTED / NOT EXECUTED** by design — plan only, per hard constraint.

---

## 7. Identity Architecture Audit

Identity's persistence layer (`services/identity/src/infrastructure/`) has two Prisma adapters on the `identity` Postgres schema:

- **`PrismaUserRepository` / `PrismaOrganizationRepository` / `PrismaMembershipRepository`** (`prisma-access-repositories.ts`) — User/Organization/Membership. Each aggregate has a `version` column (optimistic locking) and a `(tenantId, natural-key)` unique index: `users_tenant_id_email_key`, `organizations_tenant_id_slug_key`, `memberships_tenant_id_user_id_organization_id_key` — all confirmed live in `lumo_test`.
- **`PrismaCustomerRepository`** (`prisma-customer-repository.ts`) — Customer (+ Address, + append-only ConsentRecord log), `(tenantId, email)` unique, real FK+cascade from Address/ConsentRecord to Customer.

**Highest-risk paths identified** (and targeted for coverage): Membership role changes (privilege escalation/downgrade correctness), User deactivation vs. lingering Membership access, per-tenant email/slug isolation (cross-tenant leakage), the append-only consent log, and optimistic-concurrency correctness on all four aggregates.

**Architectural observations surfaced (documented as intentional design, not defects, not changed):**

- **Membership↔User/Organization has no database foreign key** (ADR D-002, bare text references — a Membership row can reference a nonexistent User/Organization id). Confirmed by test; by design, not a bug — flagged for release-gate reviewers' awareness.
- **Deactivating a User does not touch Membership rows.** Access revocation for a deactivated user is out-of-band, owned by Keto (the security/authorization context), not Identity. Confirmed by test. Worth reviewers knowing explicitly: deactivation alone does not revoke a user's org role grants at the data layer.
- **Latent, not currently reachable:** `PrismaUserRepository`/`PrismaOrganizationRepository`/`PrismaMembershipRepository` share one `EventContext` built with a single boot-time `tenantId`, while `save()` accepts a per-call `tenantId`. If a single `wireIdentity()` instance ever served multiple tenants, outbox event headers would carry the wrong tenant. `composition.ts`'s own code comment already documents this as a known, deliberate asymmetry; the only real caller (`apps/admin`) wires one `tenantId` per boot, so it is not currently reachable. **Not fixed — flagged only**, per the "don't fix hypothetical problems" constraint.

Identity does **not** depend on Hydra/Kratos at runtime (confirmed via source grep — the only references are doc comments stating that role/permission evaluation is Keto's responsibility, not Identity's). The two crash-looping Hydra/Kratos containers observed in §13 are therefore correctly out of scope for Identity release readiness, per your explicit instruction.

**PROVEN** (source inspection + the integration tests below exercising each claim empirically).

---

## 8. Identity Real-DB Coverage

**41 new integration tests**, split across two new files:

- `services/identity/src/infrastructure/prisma-access-repositories.integration.test.ts` (25 tests — User/Organization/Membership)
- `services/identity/src/infrastructure/prisma-customer-repository.integration.test.ts` (16 tests — Customer/Address/ConsentRecord)

Both run against real, unmocked PostgreSQL (`lumo_test`), gated by `DATABASE_URL_TEST` (skipped, never faked, if unset — matches the repo's existing "HONESTLY GATED" convention used by every other service's integration suite).

**Coverage delivered, mapped to the Task 8 checklist:**

- create / read / update / not-found — **YES**, all four aggregates
- delete-where-applicable — **PARTIAL, by design**: Organization has `archive()` (soft state change, tested); User has `deactivate()` (tested); Membership and Customer have no delete/remove capability in the current implementation at all — nothing to test, not a gap this phase should invent (see §9 coverage gaps)
- duplicate/unique constraint behavior — **YES** (duplicate email, duplicate org slug, duplicate tenant/user/org membership all rejected at the DB constraint level, confirmed via real `P2002` errors)
- invalid foreign-key behavior — **YES** (Address/ConsentRecord → nonexistent Customer rejected via real `P2003`; Membership → nonexistent User/Organization is _not_ FK-enforced, confirmed as intentional per §7)
- transaction commit / rollback / failure atomicity — **YES**, empirically (a thrown error mid-transaction leaves zero trace — verified by checking the row is truly absent afterward, not assumed from Prisma's documented behavior)
- correct UUID/timestamp/versioning — **YES**
- cross-tenant isolation — **YES** (two separately-wired repositories, distinct tenant ids, queries proven not to leak across tenant boundaries)
- concurrency — **YES**, full coverage (see §10)

**PROVEN** — 70/70 passing in the main working tree (see §8.1 for the correction history), verified fresh, not reused from any cached/prior run.

### 8.1 Defect found and fixed in the delivered test files themselves (process transparency)

The subagent that wrote these tests worked in an isolated git worktree that, by construction, only reflected **committed** history — it did not inherit this repo's large body of **uncommitted** changes from earlier phases (A.13 added mandatory `poolMax`/`connectTimeoutMs` fields to `DatabaseConfig`, still uncommitted). Its tests used a raw `createPrismaClient({url, logQueries} as ...)` cast that bypassed the type system, which is exactly the historical footgun `packages/db/src/testing/index.ts`'s `createTestPrismaClient` helper already exists to prevent (its own doc comment describes this precise bug, previously fixed in Phase A.20). When the two new files were merged into the actual working tree (which has A.13's stricter `DatabaseConfig`), all 41 tests failed with `connection_limit=undefined&connect_timeout=NaN` on the connection string.

**Fix applied (this phase, in the main working tree, not the worktree):** both files switched from the raw cast to `createTestPrismaClient(databaseUrl)` from `@platform/db/testing` — the same helper every other current-generation integration suite (Orders, Security, etc.) uses. Re-ran: 70/70 passing, lint clean, typecheck clean.

A second issue surfaced only under `pnpm test` (full monorepo, parallel across ~40 packages): two outbox-assertion tests used `outboxStore.fetchPending(500)` — a global, unscoped, oldest-500-rows query against the shared `platform.outbox` table. Under full-suite parallel execution, enough concurrent writes from _other_ services' own integration tests can push a freshly-written row outside that window, intermittently. **Fix applied:** switched those 4 assertions (2 files) to query `prisma.outboxEntry.findMany({ where: { key: ... } })` directly, scoped by key — the same idiom already used by `services/payments`' and `services/inventory`'s integration tests for exactly this reason. Re-ran the full monorepo suite twice after the fix: 0 failures both times.

Both of these were **test-file bugs, not production defects** — no production code was touched for either fix. This is disclosed for transparency per the "never fabricate completion" instruction, not hidden as a clean first pass.

---

## 9. Identity Defects Found

**No reproducible production defect found** in any audited area: User/Organization/Membership/Customer/Address/ConsentRecord persistence, unique constraints, FK behavior, optimistic concurrency, cross-tenant isolation, outbox-same-transaction writes, or transaction rollback/atomicity. Every test passed against the real database without any production code change (aside from the two test-infrastructure fixes in §8.1, which touched only the new test files).

**Coverage gaps intentionally not closed (functionality does not exist — not invented, per hard constraint):**

- **GDPR erasure:** `Customer.deletedAt` exists in the schema (comment references "GDPR erasure = anonymize + soft delete") but `CustomerRepository`'s interface has no delete/erase method, and nothing in the codebase sets `deletedAt`. No test written — there is nothing to exercise.
- **Membership removal:** Membership supports create + role-change only, no removal. Not a defect, nothing to test.

**PROVEN.**

---

## 10. Identity Concurrency Results

All four aggregates (User, Organization, Membership, Customer) carry a `version` column, so full optimistic-concurrency coverage was achievable — no schema gap here.

- **Same-entity concurrent writes** (User rename, Organization archive, Membership role-change, Customer address-add): the stale second writer is reliably rejected with `ConcurrencyError`; reloading afterward confirms the winning writer's data persisted and the losing write was never applied — **no lost updates, no silent overwrite**, verified empirically per case.
- **Different-entity concurrency:** concurrent role changes to two _different_ memberships in the same organization do not cross-contaminate (verified via `Promise.all`).
- **Transaction atomicity under concurrency:** for the address-add case, the losing writer's address row is verifiably never inserted at all — proving the _whole_ transaction (version bump + address insert) rolled back together, not just the version bump in isolation.
- **Privilege-change safety:** the Membership role-change concurrency test specifically confirms a stale role-change write is rejected rather than silently overwriting a newer (potentially more restrictive) role — i.e., no accidental privilege escalation via a lost update.

**PROVEN.**

---

## 11. Data Integrity

- `lumo_test` migration status: **up to date** — `prisma migrate status` against `lumo_test` reports "Database schema is up to date!" with all 37 migrations applied. **PROVEN.**
- Row integrity: all new-test-created rows are tagged with a `tenant-itest-<uuid>` prefix. Confirmed via direct query that a clean, uninterrupted test run leaves **zero residue** (0 rows matching the prefix after a full pass). **PROVEN.**
- One round of leftover rows (42 customers / 27 users, tagged `tenant-itest-%`) was found and removed during this phase — traced to interrupted runs during the test-writing subagent's own iterative development (its worktree, not a defect in the final `afterEach` cleanup logic, which was independently re-verified to leave zero residue under normal completion). Cleanup was scoped exclusively to the `tenant-itest-%` prefix — no other suite's or historical data was touched. **PROVEN.**
- `lumo` (production-analog) was never mutated by this phase — only `lumo_test` and a disposable, since-dropped `lumo_drift_check_a27` database were written to. **PROVEN.**

---

## 12. Schema/Migration Verification

A fresh, disposable database (`lumo_drift_check_a27`) was created on the same Postgres instance, all 35 migrations applied via `prisma migrate deploy` (clean success, no errors), then diffed column-by-column, constraint-by-constraint, and index-by-index against the live `lumo` database:

| Comparison                                                                                                | Rows compared | Result                |
| --------------------------------------------------------------------------------------------------------- | ------------- | --------------------- |
| Columns (`information_schema.columns`, all 40 domain schemas)                                             | 1,345         | **Identical, 0 diff** |
| Real constraints (PK/FK/UNIQUE, excluding nondeterministic OID-based auto-generated NOT-NULL check names) | 149           | **Identical, 0 diff** |
| Indexes (`pg_indexes`)                                                                                    | 332           | **Identical, 0 diff** |

The only raw diff before filtering was in Postgres-internal auto-generated `CHECK` constraint names of the form `<oid>_<oid>_<n>_not_null` — these embed database-specific OIDs assigned at creation time and are explicitly the kind of "genuinely nondeterministic internal name" the task instructed to ignore. Excluding exactly that pattern (and nothing else) produced a byte-for-byte identical constraint list.

The disposable database was dropped after comparison. `lumo` was never written to.

**Verdict: ZERO REAL DRIFT.** **PROVEN.**

---

## 13. Docker/Infrastructure Status

| Component                | Status                                                    | Evidence                                                                                                       |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Docker Desktop           | Running                                                   | `docker info` succeeded                                                                                        |
| Postgres                 | **healthy**                                               | `docker inspect` health status                                                                                 |
| Redpanda                 | **healthy**                                               | `docker inspect` health status                                                                                 |
| Debezium / Kafka Connect | **healthy**, connector `lumo-outbox` **RUNNING**          | `docker inspect` + `GET /connectors/lumo-outbox/status` → `{"state":"RUNNING"}` on both connector and its task |
| Named volumes            | Intact                                                    | `docker volume ls` shows all 11 expected `lumo_*` volumes present                                              |
| Hydra, Kratos            | **crash-looping** (`Restarting (255)` / `Restarting (1)`) | `docker ps`                                                                                                    |

Hydra/Kratos were **not investigated further**, per your explicit instruction to skip them unless they directly affect Identity release readiness — and per §7's source-level confirmation, they don't (Identity has zero runtime dependency on either; role/permission evaluation is explicitly Keto's responsibility, and Keto itself was not observed crash-looping). This is flagged as a **known, pre-existing, out-of-scope infrastructure issue** in §18, not resolved by this phase and not counted against Identity's readiness.

**PROVEN** for Postgres/Redpanda/Debezium/volumes. **NOT TESTED** (by instruction) for Hydra/Kratos root cause.

---

## 14. Security Regression Search

Performed by a dedicated subagent pass across the full repository (see delegation note in §19). Summary:

**Only CRITICAL finding:** the pgAdmin credential already tracked in §3 (git history / `HEAD` only — the working tree is already fixed).

**Everything else classified LOW or FALSE POSITIVE:**

- `docker-compose.yml`/`docker-compose.runtime.yml`: Postgres, ClickHouse, Apicurio use the shared `lumo`/`lumo` dev-only convention (LOW); MinIO uses its own documented `minioadmin`/`minioadmin` default (LOW); Grafana uses its own documented `admin`/`admin` default, sign-up disabled (LOW). All consistent with the file's own "LOCAL DEVELOPMENT ONLY" header.
- `.env.example`: independently re-verified — placeholders/documented dev defaults only, no real secret.
- `git ls-files | grep -i '\.env'`: only `.env.example` tracked.
- Test-fixture "secrets" (AWS SigV4 published example key `AKIDEXAMPLE`, redaction-test literals, generic `"secret"`/`"key"` fixtures in `*.test.ts` files): all FALSE POSITIVE — published examples or fixture literals, not real credentials, confirmed by file context.
- Kubernetes manifests: every "secret" hit is a `secretRef` to an out-of-band-provisioned k8s Secret, or the explicit `REPLACE_ME` template (`secret.example.yaml`) that is excluded from `kustomization.yaml` and never applied.
- Repo-wide scans for AWS keys, PEM private-key blocks, Slack/GitHub/Stripe live-key patterns, and basic-auth URLs: **clean**, zero matches beyond the already-known dev-convention values.

**No secret value was printed, logged, or reproduced during this search.**

**PROVEN.**

---

## 15. Full Regression Results

All commands below were run fresh, with Turborepo's cache explicitly bypassed (`--force`), against the actual working tree (including the two new Identity test files, post-fix).

| Suite                         | Command                                                                                                          | Result                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity package (standalone) | `DATABASE_URL_TEST=... pnpm --filter @platform/identity test`                                                    | **70/70 passed, 0 failed**                                                                                                                                                                            |
| Security/auth packages        | `DATABASE_URL_TEST=... pnpm --filter @platform/auth --filter @platform/security --filter @platform/secrets test` | `@platform/auth`: 18 passed, 1 skipped (Keto-integration test, gated — Keto not reachable, consistent with §13); `@platform/security`: 107 passed, 0 failed; `@platform/secrets`: 11 passed, 0 failed |
| Full monorepo                 | `DATABASE_URL_TEST=... npx turbo run test --force`                                                               | **78/78 tasks successful.** Aggregate: **2,426 tests passed, 0 failed, 13 skipped**                                                                                                                   |

**First full-suite attempt failed** (1 test, in Identity, under full parallel load) — root-caused and fixed per §8.1 (the `fetchPending(500)` race). **Second full-suite attempt: 0 failures**, exit code 0.

**Skips (13 total, all pre-existing, intentionally gated, unrelated to Identity):**

| Test                                                                       | Gate                              | Why skipped this run               |
| -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------- |
| `packages/auth/src/keto-relationships.integration.test.ts` (1)             | live Keto                         | Keto container crash-looping (§13) |
| `packages/kafka/src/kafka-runtime.integration.test.ts` (1)                 | real Kafka broker env var         | not configured this run            |
| `packages/storage/src/{storage,s3-object-storage}.integration.test.ts` (7) | real S3/MinIO credentials env var | not configured this run            |
| `packages/redis/src/redis-adapters.integration.test.ts` (4)                | real Redis connection env var     | not configured this run            |

This phase's skip count (13) differs from A.26's reported baseline (31) — this reflects which optional integration-gating env vars were set in each run's environment (this phase only set `DATABASE_URL_TEST`), not a change in test count or a hidden failure. All 13 skips here are the same class of honestly-gated, non-Identity-related suites A.26 also described.

**PROVEN** (all numbers read directly from fresh command output, not reused from any prior report).

---

## 16. Quality Gates

| Gate         | Command                                     | Result                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck    | `npx turbo run typecheck --force`           | **78/78 successful**                                                                                                                                                                                                                                                                                       |
| Lint         | `npx turbo run lint --force`                | **78/78 successful**                                                                                                                                                                                                                                                                                       |
| Test         | `npx turbo run test --force`                | **78/78 successful**, 2,426 passed / 0 failed / 13 skipped                                                                                                                                                                                                                                                 |
| Architecture | `pnpm arch` (`depcruise packages services`) | **0 violations**, 1,566 modules / 6,791 dependencies cruised — identical to A.26                                                                                                                                                                                                                           |
| Governance   | —                                           | **N/A** — `governance` script does not exist on `main`. The repo's own `.github/workflows/validate.yml` (lines 29–33) documents why: `scripts/governance/**` and its baselines were not carried over during history reconstruction and would fail for reasons unrelated to any release gate. Not invented. |
| Dup          | —                                           | **N/A** — same as above; `.jscpd.json` and the `jscpd` devDependency were likewise not carried over. Documented in the same CI comment.                                                                                                                                                                    |

**PROVEN** for typecheck/lint/test/arch (fresh runs, cache bypassed). **PROVEN** for governance/dup being genuinely absent (not merely unchecked) via the repo's own CI documentation, not an assumption.

---

## 17. Production Checklist Audit

`docs/operations/PRODUCTION_CHECKLIST.md` was cross-verified claim-by-claim against real evidence (CI workflow files, Dockerfile, k8s manifests, Prometheus/Grafana/Alertmanager config, `RUNBOOKS.md`, `perf/`/`chaos/` directories) by a dedicated subagent pass.

**One correction made:**

- **Before:** "Read-only root filesystem in prod (k8s + compose), `/tmp` tmpfs only" — checked `[x]`.
- **After:** Narrowed to "(k8s only)" with citation; noted `infrastructure/docker/docker-compose.runtime.yml`'s actual runtime services (`api`/`worker`/`scheduler`) set no `read_only`, unlike two unrelated infra-tool services that do.
- **Why:** `readOnlyRootFilesystem: true` verified real in k8s Deployments; grep of both compose files found zero `read_only:` on the runtime app services — the "+ compose" half of the original claim had no supporting evidence.

**Left unchanged after independent spot-verification** (not merely trusted): supply-chain gates (dependency-audit, gitleaks full-history secret scan, Trivy image scan, SBOM/Syft, cosign keyless signing), runtime image hardening (non-root user, tini PID1, healthcheck), Kubernetes hardening (no privilege escalation, all capabilities dropped, seccomp, HPA/PDB, NetworkPolicy), observability (Prometheus job + 3 Grafana dashboards + alert/recording rules, all 13 alerts cross-checked against `RUNBOOKS.md` with a runbook entry for each), and the already-correctly-unchecked items (TLS cert, real on-call wiring, rollback drill, pentest sign-off).

**PROVEN.**

---

## 18. Remaining Risks

1. **CRITICAL, open:** pgAdmin credential live on public `origin/main` and one other public ref, unrotated (§3–§6). This is the sole release blocker.
2. **Documented, by design, not a defect:** Membership↔User/Organization has no FK (§7) — pre-existing architectural choice (ADR D-002).
3. **Documented, by design, not a defect:** User deactivation does not revoke Membership rows at the data layer (§7) — access revocation is Keto's responsibility, out-of-band from Identity.
4. **Latent, not currently reachable:** single-tenant `EventContext` assumption in Identity's access repositories (§7) — flagged, not fixed, no current caller triggers it.
5. **Pre-existing, out of scope for this gate:** Hydra/Kratos containers crash-looping (§13) — confirmed not to affect Identity, not investigated further per instruction.
6. **Coverage gap, not a defect:** GDPR erasure (`Customer.deletedAt`) has no implementing code path to test (§9).
7. **Git history exposure persists** even after any future rotation, until a deliberate history rewrite is executed per §6 (not done this phase).

---

## 19. Exact Modified/New Files

**New (this phase):**

- `services/identity/src/infrastructure/prisma-access-repositories.integration.test.ts`
- `services/identity/src/infrastructure/prisma-customer-repository.integration.test.ts`
- `PHASE_A27_SECURITY_IDENTITY_RELEASE_GATE_REPORT.md` (this file)

**Modified (this phase):**

- `docs/operations/PRODUCTION_CHECKLIST.md` (one claim corrected, §17)

**Unmodified by this phase, still present from before it (verified, not re-touched):**

- `infrastructure/docker/docker-compose.yml` — pgAdmin env-var remediation, uncommitted, pre-existing since before A.27 started

All changes remain **uncommitted**, per instruction. Two files (`prisma-access-repositories.integration.test.ts`, `prisma-customer-repository.integration.test.ts`) were originally produced in an isolated git worktree by a delegated subagent and then copied into this working tree, where a real connection-config bug and a test-concurrency race were found and fixed directly in the working tree (§8.1) — the worktree copies were not used as-is.

---

## 20. Final Verdict

# NO-GO

Per Task 17's explicit rule ("Do not downgrade a NO-GO simply because most tests pass"): every other gate is green, but the pgAdmin credential remains live and unrotated on a public default branch. That single fact is sufficient and disqualifying on its own.

**Smallest concrete action required to unblock release:**

1. Rotate the pgAdmin credential yourself (your admin interface / local environment — I will not see or handle the new value).
2. Commit the already-ready working-tree fix (`infrastructure/docker/docker-compose.yml`'s env-var pattern) — currently uncommitted.
3. Push that commit to `origin/main`.

At that point the _live_ exposure closes. The _historical_ exposure (§5–§6) would still exist in reachable git history and would need a separate, explicitly-approved history rewrite (§6) to fully purge — but per §6, rotation alone is what neutralizes the actual risk; the history rewrite is a cleanup/hygiene step you can schedule independently once rotation is done.

Everything else audited in this phase (Identity real-DB coverage, schema drift, quality gates, full regression, Docker infrastructure, security regression search, production checklist) is release-ready as of this report.
