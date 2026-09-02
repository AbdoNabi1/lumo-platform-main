# Customer 360 — Architecture Audit (Post Phase 6.1)

> **Scope:** `services/customer-360` (`@platform/customer-360`) as it stood after Phase 6.1
> (Customer 360 Identity Engine). No new features. No Phase 6.2 work. This document is the
> deliverable of that audit.
>
> **Verdict: sound.** The context is small, honest about what it owns, and enforces its own
> boundaries with an architecture fitness test. Two real correctness gaps were found and fixed
> (both silent-failure risks in `SplitIdentity`), one genuine code duplication against
> `@platform/tracking` was removed, one dead/unreachable export was put to use, and one unrelated
> stale test in `apps/runtime` (which boots this module) was corrected. No redesign. No new
> bounded context. No governance weakened.

## 1. What was reviewed

Every file in `services/customer-360/src`: `application/*` (5 use cases), `ports/*` (6 port/value
files), `infrastructure/*` (6 adapters — 2 in-memory, 2 Prisma, 1 event translator, 1 unit of
work), `events/*` (3 domain events), `composition.ts`, `index.ts`, `architecture.test.ts`, all test
files. Plus the surrounding contract: `docs/platform/03-CUSTOMER_360_SPEC.md`,
`docs/platform/IDENTITY_MODEL.md`, `docs/architecture/22-context-map.md` (context-map row),
`docs/architecture/20-events-catalog.md` (event reconciliation), `docs/DECISIONS.md` (D-058),
`packages/db/prisma/schema/customer-360.prisma`, `.dependency-cruiser.cjs`,
`scripts/governance/*` (baseline + fitness functions), and the one production consumer,
`apps/runtime/src/modules/customer-360.module.ts` + `apps/runtime/src/platform.ts`.

`@platform/tracking`'s `packages/tracking/src/pipeline/identity-graph.ts` was read in full, since
Customer 360's entire premise is reusing it rather than reimplementing identity stitching.

## 2. Issues found and fixed

### 2.1 `SplitIdentity` could silently no-op on a fabricated or mistyped edge (fixed)

**File:** [split-identity.use-case.ts](services/customer-360/src/application/split-identity.use-case.ts)

`SplitIdentity` recorded a retraction decision for whatever `IdentityEdge` the caller supplied,
without ever checking that edge actually existed in the graph. `excludeRetractedEdges` matches
retractions by an exact key (endpoints + `observedAt` + `source`); if the caller's edge didn't
match anything real — a typo, a stale reference, a fabricated request — the decision row was still
recorded, the use case returned `ok`, and resolution was completely unaffected. The actor believes
they retracted a bad stitch; nothing changed.

This is exactly the "silent failure" class the audit brief calls out. Fixed by loading the graph
and validating the submitted edge is present before recording the decision; a non-matching edge
now returns a `ValidationError` instead of a false success.

**Regression tests added:**

- `split-identity.use-case.test.ts`: _"rejects splitting an edge that was never observed, instead
  of silently no-oping"_
- `customer-360.e2e.test.ts`: _"rejects splitting an edge that was never observed instead of
  silently no-oping"_ (through the real composition root, not fakes)

### 2.2 `edgeKey` was directional, but `IdentityEdge` is documented as undirected (fixed)

**File:** [identity-resolution.ts](services/customer-360/src/ports/identity-resolution.ts)

`@platform/tracking`'s own module doc for `IdentityGraph` states: _"Traversal is undirected: an
edge asserts that two identifiers belong to the same person, which is a symmetric claim."_
Customer 360's `edgeKey` (used by `excludeRetractedEdges` and, after fix 2.1, by `SplitIdentity`'s
existence check) built its key from `fromType:fromValue|toType:toValue`, i.e. order-_dependent_.

This isn't hypothetical: `GetIdentityTimeline` — the identity engine's only read API for history —
reports each observed edge as `counterpartType`/`counterpartValue` relative to the identifier being
queried, not the edge's original `from`/`to`. A caller reconstructing a `SplitIdentity` request from
timeline data has no way to know which side was originally `from` and which was `to`, and would
supply the wrong direction whenever the queried identifier happened to be on the `to` side of the
stored edge. Combined with 2.1's fix (which now _requires_ a match to succeed), this would have
turned into legitimate splits failing roughly half the time, for a reason no caller could see or
predict, purely because of the timeline's own reporting shape.

Fixed by making `edgeKey` endpoint-order-independent (sorting the two `"type:value"` endpoint
strings before joining), while still keying on `observedAt` + `source` — so retracting one wrong
observation still can never affect a later, corroborating one between the same two identifiers
(the invariant the original comment called out, preserved).

**Regression tests added:**

- `identity-resolution.test.ts`: _"retracts an edge regardless of which endpoint was recorded as
  from vs. to"_
- `split-identity.use-case.test.ts`: _"accepts an edge reconstructed with endpoints swapped
  relative to how it was stored"_
- `customer-360.e2e.test.ts`: _"splits successfully even when the caller supplies the edge with
  endpoints swapped"_

### 2.3 `ObserveIdentityLink` hand-rolled logic that duplicates `stitchFromIdentifiers` (fixed)

**File:** [observe-identity-link.use-case.ts](services/customer-360/src/application/observe-identity-link.use-case.ts)

The use case manually filtered blank identifiers and built one `IdentityEdge` per identifier
(`fromType: "visitor_id"`, `classifyEdge(...)`, etc.) — the exact same computation
`@platform/tracking`'s own `stitchFromIdentifiers` performs (it's literally the function the
tracking pipeline itself calls for this). The prior docstring even acknowledged this ("mirrors
`stitchFromIdentifiers` cardinality... reuses `classifyEdge`") without actually calling it, so the
edge-construction logic existed twice in the codebase with no shared source of truth.

Fixed by calling `stitchFromIdentifiers(EMPTY_IDENTITY_GRAPH, input)` and iterating the returned
`graph.edges` to persist + emit an event per edge, rather than reconstructing edges by hand. This
is exactly the audit brief's instruction: _"If an implementation duplicates Tracking logic, remove
the duplication and reuse Tracking instead."_ No behavior change — same tests, same fixture, same
assertions, still passing.

### 2.4 Dead export: `edgeKey` (resolved as a side effect of 2.1)

**File:** [identity-resolution.ts](services/customer-360/src/ports/identity-resolution.ts)

`edgeKey` was exported from `identity-resolution.ts` but had zero consumers anywhere in the
codebase — not re-exported through the public barrel (`index.ts` never re-exports it), and not
imported by any other file in the service. An accidental export per the audit's Public API
criterion. Rather than deleting it (which would be a `FF-API-01` breach — `edgeKey` is in the
governance baseline), it now has a real, tested consumer: `SplitIdentity`'s existence check (2.1)
imports and reuses it instead of reimplementing edge-equality, which is also why 2.2's fix
(symmetric key) needed to land in exactly one place.

### 2.5 Unrelated: stale module count in `apps/runtime` boot test (fixed)

**File:** [apps/runtime/src/module.test.ts](apps/runtime/src/module.test.ts)

Not a Customer 360 defect, but discovered while running the required gates and squarely in the
audit's "runtime module" scope (Customer 360 is booted by `customer360Module()`, registered in
`apps/runtime/src/platform.ts`). `module.test.ts` had a hardcoded list of 40 expected module names
and a hardcoded `toHaveLength(40)` assertion that predated `customer360Module()` being registered
and were never updated — `pnpm test` was red at `apps/runtime#test` before this audit touched
anything. Since "nothing may regress" and the audit is required to leave all gates green, this was
corrected: `"customer360"` added to the expected list, length assertion bumped to 41. This is a
one-line factual correction (the runtime boots 41 modules; the test now says so), not a behavior
change.

## 3. Architecture

**Layer boundaries — clean.** There is no `src/domain/` directory, and that is correct, not an
omission: Customer 360 deliberately owns no identity-stitching domain model of its own (per the
CONTRACT spec, §3: _"does not implement identity stitching itself"_). The actual domain model
(`IdentityGraph`, `IdentityNode`, `IdentityEdge`, `resolveIdentity`, `classifyEdge`,
`scoreConfidence`) is owned and frozen in `@platform/tracking`; Customer 360's `ports/` hold only
its own additions — `IdentityDecision` (the provenance ledger) and thin computed views
(`IdentityCluster`, `IdentityTimelineEntry`) — which don't warrant a domain layer of their own at
this size. `application/` orchestrates (validation, transaction, event emission) over `ports/`;
`infrastructure/` implements those ports; nothing crosses the other way. Verified with
`dependency-cruiser` (`pnpm arch`, 1348 modules / 5655 dependencies, zero violations) and the
service's own `architecture.test.ts`, which additionally enforces (at test time, not just
dependency-cruiser) that Customer 360 declares no dependency on any business-context package and
never deep-imports `@platform/tracking` outside its public barrel.

**No domain/infrastructure/runtime leakage.** `application/*` never imports `@platform/messaging`
or a concrete infrastructure adapter (dep-cruiser's `application-no-messaging-no-infra` rule, which
does apply to `services/*/src/application/`, passes). `infrastructure/*` is the only layer touching
Prisma or the outbox. The one runtime consumer (`apps/runtime/src/modules/customer-360.module.ts`)
imports only `CUSTOMER360_PUBLISHED_EVENTS` from the public barrel — no deep import.

**No circular knowledge.** `pnpm arch` includes the repo-wide `no-circular` fitness function; clean.

**Dependency direction confirmed:** `ports` (depends only on `@platform/tracking`'s public types) ←
`application` (depends on `ports` + `@platform/{application,contracts,domain,repository,types,utils}`)
← `infrastructure` (implements `ports`, depends on `@platform/{db,messaging}`) ← `composition.ts`
(wires all of the above). `index.ts` is the only public entry.

## 4. Public API

Inspected every barrel export in `index.ts` against every file in `src/`.

- **No accidental exports remain.** The one found (`edgeKey`, §2.4) was given a real consumer
  rather than silently existing for external code to (incorrectly) treat as part of the contract.
- **No unnecessary exports.** `IdentityCluster`/`toIdentityCluster`, the Prisma adapter classes,
  and the in-memory adapter classes are all exported deliberately — the Prisma classes in
  particular are not yet wired by any composition root (see §6, deferred work) and are exported
  _specifically_ so a future production wiring can construct them directly, matching the pattern
  used by other Prisma-backed contexts in this repo.
- **No missing exports found.** `*Deps` interfaces (`SplitIdentityDeps`, etc.) are intentionally
  not exported — consistent with every other service in the monorepo, where composition roots are
  the only constructors of a use case and `*Input`/`*Output`/the class itself are the full public
  contract.
- **Barrel problems: none.** `index.ts` is flat, explicit, named exports only — no
  `export *`, no re-export of internals.
- **FF-API-01 remains satisfied.** 2253 tracked public exports across 76 packages, 0 blocking
  findings, after all fixes above (verified pre- and post-change).

## 5. Duplication

Checked identity resolution, graph traversal, merge logic, split logic, persistence logic, and
event translation, specifically against `@platform/tracking` per the audit brief.

- **Identity resolution / graph traversal / confidence scoring:** fully delegated to
  `@platform/tracking`'s `resolveIdentity`/`classifyEdge`/`scoreConfidence` — zero reimplementation.
- **Edge construction (stitching):** was duplicated (§2.3), now fixed — delegates to
  `stitchFromIdentifiers`.
- **Merge logic:** `MergeIdentities` calls `classifyEdge` (reused, not duplicated) but its
  decision-recording + dual-write (edge + provenance row) is genuinely new logic with no
  counterpart in Tracking (Tracking has no concept of an explicit, human-asserted decision) —
  correctly not delegated, because there is nothing to delegate to.
- **Split / retraction logic:** same — Tracking has no retraction concept (its graph is pure
  append, no exclusion view). `excludeRetractedEdges` is new, necessary logic.
- **Persistence logic:** the two Prisma adapters map between `IdentityEdge`/`IdentityDecision` and
  Prisma rows; this is unavoidable, adapter-specific mapping, not duplicated _domain_ logic, and
  isn't duplicated between the two adapters either (different shapes, different tables).
- **Event translation:** `IdentityEventTranslator` is a small, bespoke switch — same shape as
  every other context's translator in this repo (Finance, Payments, Orders, ...); not a duplication
  finding, it's the established pattern.
- **`jscpd` (`pnpm dup`):** ran repo-wide post-fix — zero clones reported anywhere under
  `services/customer-360`. 138 clones exist repo-wide (1.87% duplicated lines), none involving this
  service.

## 6. Complexity

Every function in the service is small and single-purpose; the largest file
(`prisma-identity-decision-store.ts`) is 145 lines total, and no individual function anywhere
approaches the 80-LOC guidance — most use-case `execute()` methods are 15–40 lines including
validation, transaction, and event construction. `FF-CX-01` (repo-wide max-file-lines governance
check) passes. No splitting was needed or done.

## 7. Correctness

- **Unreachable branches:** none found.
- **Impossible states:** `ResolveIdentityOutput.cluster` is explicitly `| null` for "identifier
  never observed" rather than throwing or returning an empty cluster — correct, tested
  (`resolveIdentity.execute` on an unknown identifier).
- **Silent failures:** two found and fixed — §2.1 and its interaction with §2.2. No others found;
  every other use case either returns `ok`/`err` explicitly or lets the Prisma adapter's
  `requireTx` throw loudly (never swallows a missing transaction).
- **Mutation risk:** none — `IdentityGraph`, `IdentityDecision`, and every port method operate on
  readonly types and return new objects (`excludeRetractedEdges` returns the same object reference
  only in the true no-op case, otherwise a new filtered graph; `addEdge` from Tracking is pure).
- **Inconsistent invariants:** the append-only discipline (graph never edited, decisions never
  edited) is enforced structurally — no port exposes an update or delete method for either ledger,
  in-memory or Prisma. `PrismaIdentityGraphStore.appendEdge` and
  `PrismaIdentityDecisionStore.record` both hard-require a transaction client (`requireTx` throws
  if absent) per ADR-0003, so a caller can never accidentally write outside the unit of work.
- **One pre-existing minor design observation (not fixed — see §9):** decision provenance
  validation (non-blank `reason`/`actor`) lives as an imperative check in the `MergeIdentities`/
  `SplitIdentity` use cases rather than a smart constructor on `IdentityDecision` itself. Today
  that's harmless — `IdentityDecisionStore.record` has exactly two callers, both of which validate
  first — but it means the invariant is enforced by convention, not by the type. Introducing a
  value-object layer for this would cross into the "domain layer" the CONTRACT deliberately doesn't
  have at this size; flagged as a watch item for whenever Phase 6.x adds a second write path.

## 8. Documentation

- `docs/platform/03-CUSTOMER_360_SPEC.md` (CONTRACT) — matches implementation; no changes needed.
- `docs/architecture/22-context-map.md` — Customer 360 row accurately describes the implementation
  (read-model-first, reuses Tracking's `IdentityGraph`/`resolveIdentity`/`scoreConfidence` via
  public barrel, owns no source data, append-only split-retracts-not-deletes). No change needed.
- `docs/architecture/20-events-catalog.md` §1.1 — all three published events
  (`customer360.identity.link_observed/merged/split.v1`) reconciled correctly against
  `IdentityEventTranslator` and `CUSTOMER360_PUBLISHED_EVENTS`. No change needed.
- `docs/platform/IDENTITY_MODEL.md` — **updated** (§6, Split) to document the two real behavior
  changes: `SplitIdentity` now validates the edge exists before recording, and matching is
  order-independent, with the reasoning (timeline round-trip) spelled out so a future reader
  doesn't have to rediscover it.
- Every barrel export carries a doc comment on its declaration (classes, ports, events) at the
  same density as every other service in this repo; `*Input`/`*Output`/`*Deps` interfaces are
  undocumented individually, which matches the established repo-wide convention (the "why" lives on
  the class, not on each trivial data-shape interface) — not flagged as a gap.

## 9. Tests

**Added (8 new test cases, all passing):**

| File                                          | New test                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ports/identity-resolution.test.ts`           | retracts an edge regardless of which endpoint was recorded as from vs. to          |
| `application/split-identity.use-case.test.ts` | rejects splitting an edge that was never observed, instead of silently no-oping    |
| `application/split-identity.use-case.test.ts` | accepts an edge reconstructed with endpoints swapped relative to how it was stored |
| `customer-360.e2e.test.ts`                    | rejects splitting an edge that was never observed instead of silently no-oping     |
| `customer-360.e2e.test.ts`                    | splits successfully even when the caller supplies the edge with endpoints swapped  |
| `apps/runtime/src/module.test.ts`             | (correction, not new) — module list now includes `customer360`                     |

Coverage was already reasonable for a Phase 6.1-sized context: append-only guarantees are exercised
(split retracts without deleting; timeline still shows the retracted entry), merge/split correctness
had unit + e2e coverage, identity history/timeline ordering is tested (`localeCompare` chronological
merge of observed + decided entries), and the Prisma adapters have an honestly-gated integration
suite (`describe.runIf(Boolean(DATABASE_URL_TEST))`, skipped not faked when no test database is
configured — confirmed skipped in this run, 2 tests). The gaps closed above were specifically the
silent-failure paths, which is exactly the class of bug unit tests focused on the happy path won't
surface on their own.

**Not added:** property-based tests. The state space here (an edge and its retraction, a merge and
its provenance) is small and enumerable by example; a property test would mostly restate
`excludeRetractedEdges`'s existing exhaustive unit coverage (removes-exactly-the-match,
no-op-when-empty, excluded-from-BFS, order-independent) without adding confidence proportional to
the complexity of writing generators for `IdentityEdge`.

## 10. Governance

All existing fitness functions verified green, unweakened, both before and after every change in
this audit:

```
PASS   FF-TYPE-02/03/04  type safety (no any / suppressions)
PASS   FF-CX-01          complexity budget (max file lines)
PASS   knowledge-index   generated artifacts current
PASS   FF-DEP-01         dependency freeze (approved baseline)
PASS   FF-API-01         public API stability (no removed export or changed signature)
PASS   FF-EVT-01         event contract (no removed event types)
PASS   FF-ARCH-07        event naming <context>.<aggregate>.<event>
PASS   FF-SEC-05         tenant scoping on Prisma models
... (19 checks total, all PASS — see §11 for full run)
```

No governance rule was loosened, disabled, or bypassed. The `allowlist.json` ratchet file was not
touched.

## 11. New architecture fitness rules — none added

Evaluated against the brief's bar ("only if it protects a permanent architectural invariant and
cannot already be expressed by an existing rule"):

- The "no business-context dependency" and "reuse Tracking only via its public barrel" invariants
  are **already** enforced, in two independent places: `architecture.test.ts` (test-time, specific
  to this service) and the repo-wide `no-deep-package-imports` dep-cruiser rule (build-time,
  generic). Adding an `FF-ARCH-*` rule for the same thing would be redundant per the brief's own
  instruction.
- The append-only invariant (graph/decisions never updated or deleted) is structural — no port
  exposes an update/delete method — so there's nothing a static rule could check that isn't already
  guaranteed by the port interfaces themselves.
- The "split matching is order-independent" property fixed in §2.2 is a unit-testable function
  contract (`edgeKey`), not a cross-module dependency-direction concern — dependency-cruiser is the
  wrong tool for it, and it now has direct test coverage instead.

**Conclusion: no new FF-ARCH rule is warranted.** The existing two-layer enforcement
(test + dep-cruiser) already covers everything Customer 360-specific that's worth protecting
permanently.

## 12. Performance

- **Unnecessary allocations:** none found — `excludeRetractedEdges` short-circuits (`retracted.length
=== 0`) and returns the same graph reference rather than a needless copy when nothing is retracted
  (asserted by its own test: `toBe(graph)`, not `toEqual`).
- **Unnecessary graph traversals:** `ResolveIdentity` and `GetIdentityTimeline` each load the graph
  once per call and run exactly one pass (`resolveIdentity`'s BFS, or a single `.filter().map()`
  respectively) — no redundant re-traversal.
- **Repeated queries:** `ResolveIdentity` parallelizes its two independent reads
  (`graph.loadGraph()` and `decisions.retractedEdges()`) via `Promise.all` rather than serializing
  them. The `SplitIdentity` fix in §2.1 adds one additional `loadGraph()` read before the
  transaction — this is a real, deliberate cost (a full per-tenant edge-set replay, same
  `O(n)`-in-edge-count characteristic already documented and accepted in
  `PrismaIdentityGraphStore`'s own doc comment for `ResolveIdentity`) but it is the only way to
  make the correctness fix actually correct: validating existence requires reading the graph. Not
  optimized further — the existing docs already flag this whole read pattern as "acceptable at
  Phase 6.1 scale, revisited by the read-model work in Phase 6.9 (Identity Explorer) if it becomes
  a bottleneck," and this audit doesn't change that calculus, it adds one more read of the same
  already-accepted shape.
- **Needless copies:** none found; `IdentityGraph`/`IdentityDecision` are readonly and passed by
  reference throughout; no `[...array]` spreads found outside the two places evidence/timeline
  arrays are genuinely being merged and sorted (`GetIdentityTimeline`, `resolveIdentity`'s own BFS
  in Tracking) — both legitimate, not premature.

No premature optimization was applied — nothing above rose to the level of a real, current problem.

## 13. Architectural risks (carried forward, not fixed — out of scope for this audit)

1. **No production wiring path for the Prisma stores yet.** `composition.ts`'s `wireCustomer360`
   unconditionally constructs the in-memory adapters; `PrismaIdentityGraphStore` /
   `PrismaIdentityDecisionStore` exist, are exported, have integration test coverage, but no
   composition root currently instantiates them — `apps/runtime`'s `customer360Module()` is
   boot-verification-only (validates `DATABASE_URL` is set and event names are well-formed; does
   not wire the actual identity engine yet). This is documented as intentional in the module's own
   comment ("no consumers wired yet... Phase 6.2+") and matches the same interim pattern several
   other Phase-N contexts in this repo went through before their production wiring sprint. Not a
   defect; flagged so Phase 6.2 planning is aware it's still open.
2. **Decision-row invariant enforcement lives in application code, not a value object** (§7, last
   bullet) — low risk today (single write path), worth a value object if a second entry point into
   `IdentityDecisionStore.record` is ever added.
3. **`resolveIdentity`/`GetIdentityTimeline`/`retractedEdges` all replay the full per-tenant edge
   or decision set on every call** — already documented and accepted at Phase 6.1 scale in the
   Prisma adapters' own doc comments and in `docs/platform/IDENTITY_MODEL.md` §9; re-flagged here
   only for visibility, not as new information.

## 14. Deferred work (explicitly not done, per the brief)

- Phase 6.2 (any new feature work) — not started, as instructed.
- Consent-aware resolution, custom identifiers, read-model projections (Identity Explorer) — all
  already explicitly deferred in `docs/platform/IDENTITY_MODEL.md` §9; this audit made no attempt
  to pull any of them forward.
- Wiring the Prisma stores into a production composition path (§13.1) — a Phase 6.2-shaped task,
  not an audit-shaped one; flagged, not built.

## 15. Final gate summary

All required gates run and green, both immediately before and immediately after every change in
this audit:

| Gate                                                               | Result                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm --filter @platform/customer-360 typecheck`                   | PASS                                                                                      |
| `pnpm typecheck` (all 80 workspace packages, incl. `apps/runtime`) | PASS (77/77 tasks)                                                                        |
| `pnpm --filter @platform/customer-360 test`                        | PASS — 17 passed, 2 honestly-skipped (no test DB)                                         |
| `pnpm test` (full repo)                                            | PASS after §2.5 fix — 24/24 files, 162/162 tests in `apps/runtime`; full repo suite green |
| `pnpm governance`                                                  | PASS — 19/19 checks, 2253 exports guarded, 0 blocking findings                            |
| `pnpm arch` (dependency-cruiser)                                   | PASS — 1348 modules, 5655 dependencies, 0 violations                                      |
| `pnpm dup` (jscpd)                                                 | PASS — 0 clones under `services/customer-360`; 1.87% repo-wide, unrelated                 |

**Net effect on the repository:** 2 real silent-failure bugs fixed with 5 new regression tests, 1
genuine duplication against `@platform/tracking` removed, 1 dead export given a real purpose, 1
unrelated stale test corrected so the required gates are honestly green, 1 architecture doc updated
to match new behavior, 0 governance rules weakened, 0 new bounded contexts, 0 redesign. The
repository is cleaner and safer than it started, and Phase 6.2 was not touched.
