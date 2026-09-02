# H-09 — No integration test has ever run in CI; the entire persistence layer is unverified

| Field                      | Value                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                                          |
| **Area**                   | Testing / CI                                                                                                                                                  |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                            |
| **Blocker verdict**        | **True blocker.** The gating mechanism is correct and deliberate; the workflow that satisfies the gate was dropped from `main` and is preserved in `de46df9`. |
| **Public contract change** | **No.**                                                                                                                                                       |

---

## 1. Location

| File                                                                                   | Line  | What is there                                              |
| -------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| `services/customer-360/src/infrastructure/prisma-session-stores.integration.test.ts`   | 23    | `const databaseUrl = process.env["DATABASE_URL_TEST"];`    |
| `services/customer-360/src/infrastructure/prisma-segment-stores.integration.test.ts`   | 27    | same                                                       |
| `services/customer-360/src/infrastructure/prisma-profile-stores.integration.test.ts`   | 22    | same                                                       |
| `services/customer-360/src/infrastructure/prisma-identity-stores.integration.test.ts`  | 24    | same                                                       |
| `services/customer-360/src/infrastructure/prisma-attribute-stores.integration.test.ts` | 29    | same                                                       |
| `services/orders/src/infrastructure/prisma-order-repository.integration.test.ts`       | 26    | same                                                       |
| `services/security/src/infrastructure/prisma-repositories.integration.test.ts`         | 25    | same                                                       |
| `services/security/src/infrastructure/prisma-identity-projection.integration.test.ts`  | 16    | same                                                       |
| `services/security/src/infrastructure/prisma-consent-projection.integration.test.ts`   | 16    | same                                                       |
| `.github/workflows/ci.yml`                                                             | 12–52 | One job; **no service containers**, no `DATABASE_URL_TEST` |
| `packages/db/package.json`                                                             | 16    | `"test": "echo \"no tests yet\""`                          |

Also broker/store-gated: `packages/kafka/src/kafka-runtime.integration.test.ts`, `packages/redis/src/redis-adapters.integration.test.ts`, `packages/storage/src/s3-object-storage.integration.test.ts`.

**Absent from `main`, present in `de46df9`:** `.github/workflows/db-integration.yml`, `.github/workflows/ory-integration.yml`, `.github/actions/setup/action.yml`.

---

## 2. Current implementation

### 2a. The gate is correct

All nine Prisma integration suites read `DATABASE_URL_TEST` and skip when it is absent. This is the right design: unit CI stays fast and DB-free; integration suites run only where a database exists. `de46df9`'s `db-integration.yml` describes exactly this intent:

> _"The unit CI (ci.yml) stays DB-free and fast; this job is the durable-persistence gate. Integration suites are `describe.runIf(DATABASE_URL_TEST)` — they execute here, are skipped locally."_

### 2b. Nothing ever satisfies it

`.github/workflows/ci.yml` is a single linear job with no `services:` block and no `DATABASE_URL_TEST`:

```yaml
- name: Install    → pnpm install --frozen-lockfile
- name: Lint       → pnpm lint
- name: Typecheck  → pnpm typecheck
- name: Build      → pnpm build
- name: Test       → pnpm test          # ← integration suites skip here
- name: Architecture → pnpm arch
- name: Dependency audit → pnpm audit --audit-level high   (continue-on-error: true)
```

`db-integration.yml` and `ory-integration.yml` are absent from `main` (see C-03).

### 2c. Measured, not assumed

I executed `pnpm test` against this working tree. Result: **76 successful, 76 total**, exit 0 — with **70 tests skipped**:

```
@platform/customer-360:  336 passed | 56 skipped (392)
@platform/security:       99 passed |  6 skipped (105)
@platform/orders:         37 passed |  3 skipped  (40)
@platform/redis:           2 passed |  4 skipped   (6)
@platform/storage:         9 passed |  3 skipped  (12)
@platform/auth:           18 passed |  1 skipped  (19)
@platform/kafka:           8 passed |  1 skipped   (9)
```

Every skip is infrastructure-gated. And `@platform/db` — which owns the outbox store, processed-event store, dead-letter store, transaction helper, and audit trail — reports `no tests yet`.

---

## 3. Why it is incorrect

The gate does its job; the job that opens it does not exist. Consequences:

1. **Prisma repositories have never executed a query.** Mappers, `Bytes`↔`Uint8Array` round-tripping, `Json` column handling, optimistic-locking version checks, tenant scoping, unique-constraint behaviour, cascade rules, and transaction propagation via `TransactionClient` are all unverified. The four contexts that _are_ Prisma-backed in production (C-01) are precisely the ones whose persistence is unproven.
2. **Migrations have never been applied.** `packages/db/prisma/MIGRATIONS.md` §1 states the initial migration _"was generated offline … It has **not** run against a real database yet."_ Offline generation cannot detect the 36-table gap in **C-04** — and a migration-drift check is a two-line addition to a DB job that does not exist.
3. **`@platform/db` has zero tests of any kind.** `PrismaOutboxStore.append` enforces the ADR-0003 dual-write invariant by throwing without a transaction client (`prisma-outbox-store.ts:23-28`). That guard has never been executed against a real transaction.
4. **This is why several other findings survived to HEAD.** H-05 (consumer head-of-line blocking) is only observable against a real broker — and `kafka-runtime.integration.test.ts` exists but has never run. C-08 (outbox never marked published) is only observable against a real database with CDC. Both would likely have been caught by a working integration job.

---

## 4. Production impact

**No behaviour is affected directly. The impact is that no behaviour is verified.**

A deployment would be the first time any of the following executed: `prisma migrate deploy`, a Prisma repository query, a real Kafka subscribe, a Redis Lua rate-limit script, an S3 object write, a Debezium CDC capture. Per C-09 that is already true at the process level; H-09 is why it is also true at the _component_ level despite 305 test files existing.

Specific risks this leaves unquantified:

- Whether `prisma migrate deploy` succeeds at all (C-04 says it will succeed while producing an incomplete schema).
- Whether the `platform.outbox` `Bytes` payload column round-trips through `BinaryDataConverter` as Debezium expects.
- Whether optimistic-locking retries behave under real concurrency, or only under the in-memory repositories' simplified semantics (`docs/KNOWN_GAPS.md` G-12 notes in-memory repos lack version enforcement and snapshot isolation — so the unit tests are _weaker_ than production, not equivalent).

---

## 5. Smallest additive fix

**Restore one workflow.** This is the single highest-leverage action in the entire remediation set.

```bash
git checkout de46df9 -- .github/workflows/db-integration.yml .github/actions/setup/action.yml
```

The preserved workflow already provisions a real database:

```yaml
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_USER: lumo, POSTGRES_PASSWORD: lumo, POSTGRES_DB: lumo_test }
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready -U lumo" --health-interval 10s --health-timeout 5s --health-retries 5
env:
  DATABASE_URL: postgresql://lumo:lumo@localhost:5432/lumo_test?schema=public
  DATABASE_URL_TEST: postgresql://lumo:lumo@localhost:5432/lumo_test?schema=public
steps:
  - run: pnpm --filter @platform/db exec prisma generate
  - run: pnpm --filter @platform/db exec prisma migrate deploy
  - run: pnpm --filter @platform/security --filter @platform/identity test
```

### Three corrections it needs before it is trusted

I read the restored file rather than assuming it is complete. Three issues:

1. **Its test step covers only two packages.** `--filter @platform/security --filter @platform/identity` misses **`@platform/customer-360` (56 skipped tests — the largest integration suite) and `@platform/orders` (3)**. Widen it to `pnpm test` so every `DATABASE_URL_TEST`-gated suite runs, or add the two filters explicitly.
2. **The seed step path is wrong for `main`.** It runs `pnpm --filter @platform/db exec tsx prisma/seed.ts`, but `packages/db/package.json:23` declares the seed as `tsx ../../apps/runtime/src/seed.ts`. It is marked `continue-on-error: true` so it will not fail the job — it will silently never verify the seed. Fix the path or drop the step.
3. **Add the migration-drift gate** — the check whose absence allowed C-04:
   ```yaml
   - name: Migration drift (schema vs migrations)
     run: |
       pnpm --filter @platform/db exec prisma migrate diff \
         --from-migrations prisma/schema/migrations \
         --to-schema-datamodel prisma/schema \
         --shadow-database-url "$DATABASE_URL" --exit-code
   ```
   `--exit-code` returns non-zero on any drift. **This one step would have caught 36 missing tables.**

### Follow-ons (each additive, each unblocks another finding)

- **Redpanda service container** → unblocks `kafka-runtime.integration.test.ts` → would surface **H-05**.
- **Restore `ory-integration.yml`** together with the Kratos/Keto/Hydra configs (also missing, see C-09) → verifies the auth stack `config.ts` requires outside `local`.
- **Add coverage reporting** to close `docs/KNOWN_GAPS.md` G-21 (M-2). No `coverage` key exists in any `vitest.config.ts` today.

---

## 6. Public contract impact

**None.** CI configuration and test execution only. No source file, signature, route, event schema, or package export is touched. The `DATABASE_URL_TEST` gating in the nine test files stays exactly as written — the fix supplies the variable rather than changing the gate.

---

## 7. Blocker or intentional deferral?

**True blocker — and the _gating_ is a correct deliberate design that was left half-built.**

The `DATABASE_URL_TEST` pattern is right: `de46df9`'s workflow header explains the split (_"The unit CI stays DB-free and fast; this job is the durable-persistence gate"_), and nine test files implement it consistently. Someone designed this properly.

What is missing is the other half — and it existed. `db-integration.yml` was written, works, and is preserved in `de46df9`; it simply did not survive the history reconstruction onto `main`, the same **file-loss defect** as C-02, C-03, C-04, C-07, and H-04.

`docs/KNOWN_GAPS.md` tracks **G-21** (coverage gate) and **G-16** (contract testing) as open, but does not track "integration tests never run" — because at the time the gap register was written, they did.

**Verdict: true blocker**, and the one I would fix first. It is a single `git checkout` plus three corrections, and it is the precondition for trusting any fix to C-01, C-04, C-08, or H-05.

---

## 8. How this was verified

- `pnpm test` **executed** against this working tree → 76/76 tasks pass; per-package totals and 70 skips recorded above.
- `grep 'DATABASE_URL_TEST'` across `**/*.integration.test.ts` → 9 files, line numbers listed in §1.
- `.github/workflows/ci.yml` read in full (57 lines) — no `services:`, no `DATABASE_URL_TEST`.
- `git ls-files .github` → 3 files; `db-integration.yml` and `ory-integration.yml` absent.
- `git show de46df9:.github/workflows/db-integration.yml` read in full — service container, env, and steps quoted above; the three defects in §5 identified by reading it, not by assumption.
- `packages/db/package.json` read — `"test": "echo \"no tests yet\""`, seed path `tsx ../../apps/runtime/src/seed.ts`.
- `packages/db/prisma/MIGRATIONS.md` §1 read.
- No code was modified.
