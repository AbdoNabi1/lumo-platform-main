# Customer-360 Milestone Report

**Status: Landed as one combined commit** covering `services/customer-360` (226 files) —
Identity Engine (6.1), Customer Profile (6.2), Session Stitching (6.3), Computed Attributes
(6.4 + hardening 6.4.1 + concurrency fix F2/ADR-0060), Segmentation (6.5), and the Phase 9
durable-storage wiring, plus the `packages/db/prisma/schema/customer-360.prisma` schema and its
`20260722010000_customer_360_durable_storage` migration.

## Why K7 (packages/tracking) was a precondition

`services/customer-360` imports `@platform/tracking`'s identity-stitching primitives
(`stitchFromIdentifiers`, `addEdge`, `classifyEdge`, `resolveIdentity`, `EMPTY_IDENTITY_GRAPH`,
`IdentifierType`, `IdentityEdge`, `IdentityGraph`, `ResolvedIdentity`) exclusively through
`@platform/tracking`'s public barrel — enforced by its own `architecture.test.ts`, which asserts
no deep import into `packages/tracking/src/*` exists anywhere in this service. All 10 distinct
symbols it imports are present in the barrel landed by the K7-partial commit (`c24ec9b`); this was
verified directly against the current `packages/tracking/src/index.ts`, not assumed. Customer-360
is therefore **not** blocked by anything still deferred in K7 (the unevidenced `definitions`/
`execution` clusters are never touched here).

## Why this landed as one commit, not six

The internal sprint reports show a real, evidenced dependency chain — **6.1 → {6.2, 6.3} → 6.4
(+6.4.1, +F2) → 6.5 → Phase 9** (6.4 depends on both `GetCustomerProfile` (6.2) and
`GetJourneyState` (6.3); 6.5 depends on 6.4's `GetComputedAttributes` and reuses
`domain/attribute-dependency.ts` verbatim). Splitting into six separate commits was considered, but
`src/index.ts` re-exports `wireCustomer360`/`Customer360WiringDeps`/`WiredCustomer360` from a single
`composition.ts` that already wires every phase together in its current, only-existing form — there
is no earlier, phase-scoped version of `composition.ts` on disk to reconstruct, and authoring one
would mean inventing an intermediate state that never existed, which this recovery's methodology
treats as fabrication, not reconstruction. Every other multi-sprint bounded context in this recovery
(C1–C12, G1–G5) was likewise landed as one commit per named cluster rather than split to
sub-sprint granularity, for the same reason. This report documents the internal ordering for
posterity; the git history does not attempt to replay it commit-by-commit.

## Sprint-report-to-file mapping

| Source                                                                     | Scope                                                                                                                                                                                                                                                                                                                                                            | Confidence                                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 6.1 (Identity)                                                       | `ports/identity-{cluster,decision,decision-store,graph-store,resolution(+.test),timeline}.ts`, `application/{resolve-identity,observe-identity-link,merge-identities,split-identity(+.test),get-identity-timeline}.use-case.ts`, `events/identity-{link-observed,merged,split}.event.ts`, `infrastructure/{identity-event-translator,in-memory-unit-of-work}.ts` | **Gap**: no dedicated Sprint Report exists for 6.1 — only `docs/platform/IDENTITY_MODEL.md` (a model doc) documents it. Flagged, not silently assumed. |
| 6.2 (`SPRINT_6_2_CUSTOMER_PROFILE_REPORT.md`)                              | `domain/{profile-field,profile-version,customer-profile,profile-snapshot,profile-views}.ts` (+tests), `ports/profile-{store,history-store}.ts`, `events/profile-*.event.ts`, profile use-cases + worker, profile infrastructure                                                                                                                                  | High — explicit file list                                                                                                                              |
| 6.3 (`SPRINT_6_3_SESSION_STITCHING_REPORT.md`)                             | `domain/{customer-session,session-boundary,session-snapshot,session-status,session-transition,session-version,session-views,session-window}.ts` (+tests), session ports/events/application/infrastructure                                                                                                                                                        | High — explicit file list                                                                                                                              |
| 6.4 (`SPRINT_6_4_COMPUTED_ATTRIBUTES_REPORT.md`)                           | `domain/{attribute-dependency,attribute-snapshot,attribute-value,attribute-version,computed-attribute,computed-attribute-value,computed-attribute-views}.ts` (+tests), attribute ports/events/application/infrastructure                                                                                                                                         | High — explicit file list                                                                                                                              |
| 6.4.1 (`SPRINT_6_4_1_HARDENING_REPORT.md`)                                 | Stress/bench/replay-safety/concurrency/memory test files (`*.stress.test.ts`, `*.bench.ts`, `*.replay-safety.test.ts`, `*.concurrency.test.ts`, `computed-attributes-memory.test.ts`) + modified `recalculate-computed-attributes.use-case.ts`                                                                                                                   | High — explicit new-file list                                                                                                                          |
| F2 / ADR-0060 (`SPRINT_F2_ATTRIBUTE_STORE_CONCURRENCY_REPORT.md`)          | `ports/attribute-store.ts`, `infrastructure/{in-memory-attribute-store,prisma-attribute-store}.ts`, `application/{update-computed-attribute-projection,rebuild-computed-attributes}.use-case.ts`, CAS-related test additions                                                                                                                                     | High — explicit changed-file list                                                                                                                      |
| 6.5 (`SPRINT_6_5_SEGMENTATION_REPORT.md`)                                  | `domain/{customer-segment,segment-history,segment-membership,segment-version,segment-views}.ts` (+tests), segment ports/events/application/infrastructure                                                                                                                                                                                                        | High — explicit file list                                                                                                                              |
| Phase 9 (`SPRINT_9_OPERATIONAL_HARDENING_REPORT.md`, Customer-360 section) | Current `composition.ts` (Prisma-branching + `buildWiredCustomer360()`), `infrastructure/{identity-graph-store,identity-decision-store}.contract.ts` + their in-memory/Prisma implementations and tests, `packages/db/prisma/schema/customer-360.prisma`, migration `20260722010000_customer_360_durable_storage`                                                | High — explicit "Closed" list; migration file existence verified on disk                                                                               |

**Unclaimed by any report (flagged, not fabricated):** `interfaces/customer-360.controller.ts` and
`interfaces/presenter.ts` were extended across at least three phases (6.1/6.2/6.3) but no report
ever names them as its own deliverable. `infrastructure/identity-event-translator.ts`'s own header
comment says "Phase 6.1" while 6.2/6.3's reuse tables cite it as originating in "Phase 1.1"
(Identity Core, a different service) — a citation inconsistency in the source docs themselves,
noted here rather than silently resolved either way.

## What was added alongside the service

- `packages/db/prisma/schema/customer-360.prisma` (new schema file).
- `packages/db/prisma/schema/migrations/20260722010000_customer_360_durable_storage/migration.sql`.
- `packages/db/prisma/schema/main.prisma` — added `"customer_360"` to the datasource `schemas` array
  (required for Prisma's multi-schema validation to accept the new file; without it, `prisma
generate` fails with 13 `P1012` errors, one per `@@schema("customer_360")` model).

## Lint fixes (pre-existing issues in the source, not introduced by this commit)

Two real ESLint violations existed in the code as it sits in `lumo-platform`'s working tree,
caught by this milestone's own gate run (not predicted in advance):

- `customer-360.e2e.test.ts`: six inline `import("@platform/rules").RuleSet<...>` /
  `import("./domain/attribute-value").AttributeValue` type annotations violated
  `@typescript-eslint/consistent-type-imports`. Fixed by adding top-level `import type` statements
  for `RuleSet` and `AttributeValue` and using the plain type names at each call site — behavior
  unchanged, purely a type-import-style fix.
- `domain/computed-attribute.property.test.ts`: one `let attribute` that is never reassigned,
  changed to `const` (`prefer-const`).

## Verification

`pnpm --filter @platform/customer-360 typecheck/test/lint`: green (336/336 runnable tests passing,
56 skipped — Prisma integration tests requiring a live Postgres, consistent with every other
context's integration-test pattern in this repo). `pnpm arch`: 0 violations (1531 modules, up from
1378 after K7). Full monorepo sweep: `pnpm typecheck`/`test`/`lint` all 75/75 tasks green, no
regression in any other package.

## Remaining open items

- The 6.1-lacks-a-Sprint-Report gap and the two unclaimed `interfaces/` files are documented here,
  not resolved — a future documentation pass could backfill a Sprint 6.1 report from
  `IDENTITY_MODEL.md` if that's judged valuable, but nothing on disk requires it.
- Phase 9's Prisma integration tests for the new stores are present but skipped without a live
  database — same as every other Prisma-integration test in this repo; not specific to
  Customer-360.
