# M2-4 — Type Safety Hardening

Status: **CLOSED**. Scope: this finding only. No architecture changes, no new bounded contexts, no public API changes, no event contract changes, no new abstractions.

## Investigation

Full-repo search (`*.ts`, `*.tsx`, excluding `node_modules`/`dist`/`.turbo`) for every category named in the finding, counted before any change was made:

| Pattern                                                                              |                                            Occurrences |          Files | Notes                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | -----------------------------------------------------: | -------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ts-ignore` / `@ts-expect-error`                                                    |                                                      0 |              0 | None anywhere in the repo.                                                                                                                                                                                                                                                  |
| `any` (`: any`, `<any>`, `as any`)                                                   |                                                      0 |              0 | The only 5 grep hits were the English word "any" inside comments/JSDoc (e.g. "any failure is swallowed", "any `false`/exception becomes a deny"); read individually and confirmed none are real `any` types.                                                                |
| `satisfies`                                                                          |                                                     13 |             12 | Already in healthy use as the safe alternative to casting (e.g. `edge-middleware.ts`, `authorization.ts`, `policy-condition.ts`, `permission-spec.ts`, `promotion-rule.ts`). Evidence the codebase already defaults to the safe pattern where it applies; no action needed. |
| `as unknown as` (double cast)                                                        |                                                    165 |             54 | The strongest smell — bypasses structural assignability checking entirely. See below.                                                                                                                                                                                       |
| Non-null assertion (`!` on identifier/index/paren, excluding `!=`/`!==`/logical-not) |                                                     96 | 48 (`.tsx`: 0) | Concentrated in `services/customer-360` (segment/computed-attribute domain + its ~30 test files). See below.                                                                                                                                                                |
| Single cast (` as Type`, excluding `import…as`/`export…as` renames and `as const`)   | ~1471 raw / dominated by import-renames and `as const` |            532 | Not independently actionable as a category — the real signal was in the two rows above; a cast that survives narrowing from `as unknown as` still shows up here (expected, not a regression).                                                                               |
| Unsafe generic casts                                                                 |                                  (subset of the above) |              — | No generic-cast pattern (`as T<...>` bypassing constraints) found beyond the Prisma-boundary and index-access cases already covered above.                                                                                                                                  |

No suppressed type checks and no `any` meant the entire finding reduced to two real populations: double casts and non-null assertions.

## Removed / narrowed casts

**`as unknown as` (165 → 55 occurrences, 54 → 26 files; 28 files fully cleared):**

The population split into two groups on inspection:

1. **Prisma JSON-column boundary** (majority: `prisma-*-repository.ts` / `prisma-repositories.ts` across `licensing`, `shipping`, `tenancy`, `theme`, `seo`, `catalog`, `checkout`, `search`, `feature-flags`, `experience`, `notifications`, `automation`, etc.) — a `Prisma.JsonValue` column has no structural overlap with the strongly-typed domain row shape, so TypeScript's single-cast assignability check correctly refuses `row as ProductRow` and forces `as unknown as`. **These double casts are retained** (no existing shared JSON-parsing helper was found anywhere in `packages/db`, `packages/repository`, or `packages/contracts` to route through instead, and inventing one is a new abstraction the sprint rules forbid) — each retained site now carries a one-line comment naming the exact field and why single-cast assignability fails.
2. **False double-casts**: several call sites paired one `as unknown as X` (genuinely needed, JSON boundary) with a _second_ cast on a sibling value that DOES have structural overlap with its target type (e.g. `row.variants as unknown as VariantRow[]` where `row.variants` is already a plain array shape assignable to `VariantRow[]` via a single cast). These were narrowed from `as unknown as` to a single `as`, which restores TypeScript's structural check on that value instead of suppressing it entirely. Example (`services/catalog/src/infrastructure/prisma-catalog-repositories.ts`): `row.variants as unknown as VariantRow[]` → `row.variants as VariantRow[]`, while `row as unknown as ProductRow` (genuine JSON-boundary cast) was left in place and documented.

**Non-null assertions (96 → 81 occurrences, 48 → 37 files; 11 files fully cleared):**

Fixed via the rules-permitted techniques only (type guards, control-flow narrowing, `Array.prototype.at`, restructured lookups) — no new `any`/`unknown`/double-casts introduced:

- `services/customer-360/src/domain/attribute-dependency.ts` — replaced `map.get(name)!` after a separate `has`/`set` guard with `getOrCreate`-style local helpers that return the value they just guaranteed exists, and replaced two indexed `while (cursor < queue.length) { queue[cursor]! }` loops with `for...of` (the queue grows during iteration via push, and `for...of`'s default array iterator re-reads `length` each step, so no index and no assertion is needed).
- `services/analytics/src/domain/value-objects/canonical-id.ts` — `split(".")[0]!` → `split(".")[0] ?? this.props.value` (defensive fallback instead of an assertion; `String.split` always returns ≥1 element, but the nullish-coalescing form doesn't rely on that being obvious to the reader or the compiler).
- `services/analytics/src/infrastructure/in-memory-analytics-read-store.ts` — `params.filters!` inside a closure → destructured into a `const { filters } = params` binding before the closure, since a `const` stays narrowed across a closure boundary but a property access does not.
- `services/finance/src/infrastructure/clickhouse-read-model-store.ts` — `rows[0]!` (two sites) → `rows.at(0)` with an explicit `undefined` check.
- `services/customer-360/src/application/get-customer-profile.use-case.ts`, `evaluate-attribute-graph.use-case.ts`, `recalculate-computed-attributes.use-case.ts`, `recalculate-memberships.use-case.ts`, `get-customer-segments.use-case.ts`, `get-computed-attributes.use-case.ts` and their direct test files — equivalent `arr[0]!` / `map.get(k)!` sites replaced with an explicit `!== undefined` check or a guard already available from the surrounding branch.
- `services/customer-360/src/infrastructure/in-memory-*-history-store.ts` (4 files) — indexed-cursor loops converted to `for...of` for the same reason as `attribute-dependency.ts`.

Where a non-null assertion was left in place (e.g. `services/analytics/src/registry/versioned-catalog.ts`'s `history[history.length - 1]!`, `services/catalog/src/domain/product.ts`'s `this.props.media.find(...)!` inside a reorder that already proved the permutation above it), a comment was added naming the specific invariant that makes the assertion sound, since expressing that invariant in the type system would require a non-empty-array type or a domain redesign — out of scope per "DO NOT introduce speculative abstractions" / "DO NOT redesign architecture."

Test-file (`*.test.ts`) non-null assertions were classified individually, not blanket-skipped; most asserting known-good fixture state right after constructing that fixture were left as genuinely low-risk (the assertion failing would only ever mean the test itself is broken, not runtime code), and are recorded as retained-as-is below rather than silently ignored.

## Remaining casts (retained, with reason)

| Location (representative)                                                                        | Reason retained                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma-*-repository.ts` across ~24 services                                                     | `Prisma.JsonValue` ↔ domain-row boundary; no structural overlap possible, no existing shared parse helper to route through, inventing one is out of scope. Each site now documents the specific field.                                                                                                                               |
| `services/customer-360/src/infrastructure/segment-store.contract.ts` (11)                        | Shared cross-implementation test contract; assertions are on fixture data set up two lines above each use. Not touched — changing a shared test contract file risked rippling into every store implementation's test suite for no runtime-safety benefit.                                                                            |
| `services/analytics/src/registry/versioned-catalog.ts`, `services/catalog/src/domain/product.ts` | Invariant is real (non-empty array by construction; exact-permutation already validated above) but not expressible without a non-empty-array type or restructuring the aggregate — left, now documented.                                                                                                                             |
| Remaining `.test.ts` non-null assertions (bulk of the 81 remaining)                              | Fixture-construction assertions in `services/customer-360`'s ~30 test files, `apps/runtime` security tests, `packages/kafka`/`packages/domain` tests. Failure mode is "test is broken," not a production type-safety gap; left as-is to avoid churning ~30 files with target-only cosmetic changes for a stress/property-test suite. |

## Regression risk

- **Behavioral**: none of the changes alter control flow in a way that changes runtime output — every narrowed cast still resolves to the same value at runtime (casts are compile-time only), and every non-null-assertion removal was replaced with a check that is true in every path the old assertion covered (verified by reading the surrounding guard, not just pattern-matched).
- **Type-strictness**: strictly increases — several call sites gained real compiler-checked assignability where they previously had none (`as unknown as` → `as`), and several gained a real runtime-verifiable guard where they previously had a compile-time-only promise (`!` → `!== undefined` / `.at()` / `??`).
- **Blast radius**: touches only the 70 files listed in the commit; no shared package's public surface, no Prisma schema, no event payload shape, and no cross-service contract changed.

## Verification results

Run from repo root against the full working tree (all 70 changed files), Turborepo cache cold on the affected packages:

| Gate         | Command                                     | Result                                                                                                                                                                                                                                                                                                                               |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typecheck    | `pnpm typecheck`                            | ✅ 76/76 tasks successful (26 cached, 50 executed), 0 errors                                                                                                                                                                                                                                                                         |
| Lint         | `pnpm lint`                                 | ✅ 76/76 tasks successful (26 cached, 50 executed), 0 errors, 0 new warnings                                                                                                                                                                                                                                                         |
| Test         | `pnpm test`                                 | ✅ 76/76 tasks successful, all suites green (runtime alone: 30 files / 145 tests passed). Console warnings about unreachable `localhost:5432`/Redis and "permissive" fail-open-in-local guards are pre-existing sandbox-environment noise (no live Postgres/Redis/Kratos), not failures — same warnings appear on unmodified `HEAD`. |
| Architecture | `pnpm arch` (`depcruise packages services`) | ✅ "no dependency violations found" — 1531 modules, 6676 dependencies cruised, 0 violations                                                                                                                                                                                                                                          |

No new suppressions were introduced (`@ts-ignore`/`@ts-expect-error` count: 0 before, 0 after). No new `any` or `unknown` escape hatches were introduced. No reduction in strictness anywhere.

## Summary

- `as unknown as`: 165 → 55 occurrences (54 → 26 files)
- Non-null assertions (`!`): 96 → 81 occurrences (48 → 37 files)
- `@ts-ignore` / `@ts-expect-error` / real `any`: 0 before, 0 after
- Files changed: 70 (+260 / −138 lines)
- New abstractions introduced: 0
- Public APIs / event contracts changed: 0
