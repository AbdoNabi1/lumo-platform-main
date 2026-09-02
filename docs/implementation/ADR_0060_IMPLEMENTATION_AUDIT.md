# ADR-0060 Implementation Audit — Optimistic Concurrency for `AttributeStore`

> **Independent, zero-trust post-implementation audit.** Assumes the implementation is incorrect
> until proven correct. Does not redesign, does not refactor for style, does not add features.
> Where a real correctness issue was found, it was fixed with the smallest possible change and a
> regression test; otherwise this document states explicitly why no issue exists.

## Executive Summary

ADR-0060's stated scope — closing the proven F2 lost-update race on
`UpdateComputedAttributeProjection`'s read-compute-write into `AttributeStore` — is **correctly
implemented** in both adapters (in-memory, Prisma), correctly ordered inside a real transaction for
Prisma, and correctly excluded from `RebuildComputedAttributes`'s recovery write, exactly as
documented.

However, auditing _beyond_ the two documented write paths in isolation — specifically the
interaction _between_ them — found one real, previously undetected race: **`RebuildComputedAttributes`
(and its batch caller, `ComputedAttributeProjectionWorker`) can silently regress the cache to a stale
version if it runs concurrently with a successful, CAS-protected `UpdateComputedAttributeProjection`
write.** This is the same silent-lost-update failure shape ADR-0060 was written to eliminate,
reintroduced through the one write path ADR-0060 deliberately left unguarded. It has been fixed with
a 6-line, transaction-scoped staleness check (Finding F-1 below), verified by a new regression test,
with all 224 customer-360 tests, typecheck, and repo-wide `arch` passing.

No other correctness issues were found. The documented cross-adapter asymmetry on the create-branch
(raw Prisma error vs. typed `ConcurrencyError`) is real but is pre-existing, deliberate, fully
reasoned platform-wide debt (ADR-0060 §Decision 5 / §Alternatives) — not a fresh defect — and is
recorded under Risks Remaining, not re-litigated here.

**Recommendation: APPROVED WITH OBSERVATIONS** (see §Recommendation).

---

## Audit Methodology

1. Read ADR-0060 and `SPRINT_F2_ATTRIBUTE_STORE_CONCURRENCY_REPORT.md` in full for the documented
   design intent, alternatives considered, and accepted trade-offs.
2. Grepped the entire `services/customer-360/src` tree for every call site of `AttributeStore` and
   `saveCurrent` (not just the two the ADR names) to build the Write Paths table from evidence, not
   from the ADR's own claims.
3. Read the full source of both adapters (`in-memory-attribute-store.ts`,
   `prisma-attribute-store.ts`), the port (`attribute-store.ts`), both call sites
   (`update-computed-attribute-projection.use-case.ts`, `rebuild-computed-attributes.use-case.ts`),
   the batch worker, the shared adapter contract (`attribute-store.contract.ts`), and every existing
   concurrency-related test.
4. Traced the transaction boundary through `PrismaUnitOfWork` → `runInTransaction` →
   `prisma.$transaction` to confirm real atomicity and rollback-on-reject, not assumed it from the
   ADR's prose.
5. Manually constructed races not in the existing test suite (three-writer, rebuild-vs-update,
   worker-vs-API, retry-after-loss) by reasoning through the actual code paths and JS/Prisma
   execution semantics, not just re-running what was already green.
6. Where a constructed race proved real, reproduced it as an executable regression test _before_
   fixing it, confirmed the test failed against the pre-fix code, then applied the minimal fix and
   confirmed the test (and the full existing suite) passes after.
7. Ran `pnpm --filter @platform/customer-360 test`, `typecheck`, and repo-wide `pnpm arch` after the
   fix to confirm no regression.

---

## 1. Write Paths

| Path                                                                                                             | CAS Protected                       | Notes                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UpdateComputedAttributeProjection.execute` (`application/update-computed-attribute-projection.use-case.ts:135`) | **Yes**                             | Passes `base.version` (the version read at the top of `execute`) as `expectedVersion`. This is the one path F2 was proven against and the one path ADR-0060 targets. Correct.                                                                                                                                                                       |
| `RebuildComputedAttributes.execute` (`application/rebuild-computed-attributes.use-case.ts`)                      | **No, by design** — now **guarded** | Deliberately omits `expectedVersion` (recovery semantics: a corrupted/missing cache has no trustworthy version of its own). **Finding F-1** (below): this unguarded write could regress a cache that had already moved past the snapshot being rebuilt from. Fixed by adding a same-transaction staleness check before the write (see Finding F-1). |
| `ComputedAttributeProjectionWorker.execute` (`application/computed-attribute-projection-worker.ts:48`)           | Inherited                           | Never calls `saveCurrent` directly — loops `listIdentifiers()` and delegates each one to `RebuildComputedAttributes.execute()`. Inherits whatever protection that use case has; benefits directly from the F-1 fix.                                                                                                                                 |
| `EvaluateAttributeGraph` / `EvaluateComputedAttribute`                                                           | N/A                                 | Read-only against `AttributeStore` (dependency resolution via `attributes.<id>` inputs) — never call `saveCurrent`. Confirmed by grep; no write path here to protect.                                                                                                                                                                               |
| Contract tests / unit-test fixtures (`attribute-store.contract.ts`, `*.use-case.test.ts` mocks)                  | N/A                                 | Call `saveCurrent` directly with no `expectedVersion`, seeding store state — never production code paths.                                                                                                                                                                                                                                           |

No other call site of `AttributeStore.saveCurrent` exists anywhere in the repo (confirmed by
repo-wide grep, matching the F2 report's own claim that `apps/runtime` does not reference this
store).

---

## 2. Atomicity

**Confirmed correct — not `findUnique` + `update`.**

- `InMemoryAttributeStore.saveCurrent` (`infrastructure/in-memory-attribute-store.ts:27-38`): a
  `Map.get()` version check followed synchronously by `Map.set()`, with **no `await` between them**.
  In Node's single-threaded event loop, a function body with no `await` between a check and a
  mutation cannot be interleaved by another concurrently-running async call — the check-and-set is
  atomic by construction, not by accident. Verified this reasoning against the actual concurrency
  test (`update-computed-attribute-projection.concurrency.test.ts`), which empirically confirms
  exactly one of two `Promise.all`-raced calls wins.
- `PrismaAttributeStore.saveCurrent` (`infrastructure/prisma-attribute-store.ts:110-123`): the
  update branch is exactly `updateMany({ where: { ..., version: expectedVersion }, data })` with
  `updated.count === 0` ⇒ throw `ConcurrencyError` — the D-042 idiom, not a `findUnique`-then-`update`
  pair. A concurrent second `updateMany` targeting the same row at the same expected version is
  resolved by the database's own row-level locking/MVCC, not by application-level coordination — only
  one `updateMany` can match `version = expectedVersion` after the first commits, because the first
  commit already advanced the stored version.

**Why this matters**: a `findUnique` + `update` pair has a window between the read and the write
where another transaction's write can land unnoticed — the exact class of bug ADR-0060 was written
to close. `updateMany` with the version predicate folds the check into the write itself; it either
matches and applies atomically, or matches zero rows and applies nothing. There is no read-then-write
gap for the database to race inside.

---

## 3. Transaction Boundaries

**Confirmed correct ordering, confirmed real atomicity for the production (Prisma) path.**

`UpdateComputedAttributeProjection.execute` (lines 98-140):

```
unitOfWork.run(async (tx) => {
  ...
  await attributes.saveCurrent(applyResult.attribute, base.version, tx);   // CAS UPDATE
  await history.append(snapshot, event, tx);                                // Append History
  return ok(...);
});
```

This is `BEGIN → CAS UPDATE → Append History → COMMIT`, the ADR's own required ordering — **not**
the rejected `UPDATE → COMMIT → Append History` shape. Traced `PrismaUnitOfWork.run` →
`runInTransaction` → `prisma.$transaction(fn, ...)` (`packages/db/src/transaction.ts:15-24`), whose
own doc comment states "Automatically rolls back if `fn` rejects" — confirmed this is Prisma's
standard interactive-transaction behavior, not an assumption. When the CAS write throws
`ConcurrencyError`, the `history.append` call is never reached (synchronous `await` sequencing) _and_
even if it somehow were, the whole transaction would roll back on the rejection propagating out of
the callback. Either way, a losing call leaves zero trace — no orphaned snapshot, no partial cache
state.

`RebuildComputedAttributes.execute` also runs entirely inside one `unitOfWork.run` transaction
(history append, then unconditional cache overwrite) — located and confirmed.

`ComputedAttributeProjectionWorker` opens no transaction of its own; each identifier's rebuild is its
own independent, isolated `RebuildComputedAttributes.execute()` call with its own transaction, which
is correct given the worker's own explicit "one identifier's failure never aborts the batch" design
goal.

**In-memory adapter caveat** (dev/test only, explicitly labeled as such throughout the codebase):
`InMemoryUnitOfWork.run` (`infrastructure/in-memory-unit-of-work.ts:9-11`) is a no-op wrapper with no
real rollback — if a hypothetical second operation inside the callback threw _after_ a successful
in-memory `saveCurrent`, that write would not be undone. This is pre-existing, matches every other
in-memory store in this package (Profile/Session), and is not part of ADR-0060's scope to fix; it
does not affect production correctness since `PrismaUnitOfWork` is the real adapter.

---

## 4. History Consistency

- **Append-only, confirmed**: neither adapter's `append` (`in-memory-attribute-history-store.ts:25`,
  `prisma-attribute-history-store.ts`, not separately re-quoted here) ever updates or deletes an
  existing snapshot row — every call is a pure insert (`this.snapshots.push(...)` / Prisma `create`).
- **Failed CAS never writes history**: confirmed by transaction ordering (§3) — the CAS write throws
  before `history.append` is reached, and the whole transaction rolls back regardless. Verified
  directly by the concurrency test asserting the loser's identifier ends with exactly one snapshot in
  the ledger, not two (`update-computed-attribute-projection.concurrency.test.ts:96-99`).
- **Retry does not duplicate history**: a retry is a fresh `execute()` call, which re-reads
  `getCurrent` and recomputes `base` from the now-current (winner's) state. If the retried value is
  identical to what's already stored, `applyAttributeUpdate`'s no-op guard (`applied: false`) causes
  the method to return early _before_ the transaction (and therefore before any history append) is
  ever entered (`update-computed-attribute-projection.use-case.ts:94-96`) — a retry of an
  already-applied change cannot duplicate a history row.
- **Rebuild preserves intended semantics, now correctly bounded**: `RebuildComputedAttributes`
  reconstructs from the _latest_ snapshot only (confirmed against `rebuild-computed-attributes.replay-safety.test.ts`,
  which proves it never resurrects an older definition version). Finding F-1 (below) closes the one
  gap where "rebuild" could, under a race, silently write a stale cache state and record a
  confusingly out-of-order "rebuilt" ledger entry for data that was no longer current.

---

## 5. Retry Semantics

Verified directly against `update-computed-attribute-projection.concurrency.test.ts` (4 tests, all
passing) plus manual trace of the implementation:

- **Exactly one concurrent writer succeeds**: proven by `Promise.allSettled` on two concurrent
  `execute()` calls for the same identifier — `fulfilled` has length 1, `rejected` has length 1.
- **The loser always receives `ConcurrencyError`**, not a silent success and not a generic error:
  `(rejected[0].reason).toBeInstanceOf(ConcurrencyError)`, with `retryable: true` asserted explicitly.
- **Retry succeeds and recovers both changes**: the "end to end" test re-invokes `execute()` for the
  loser's original input after the race settles, and asserts _both_ attributes end up persisted — no
  permanent data loss, only a required retry, exactly ADR-0060's stated trade-off (no automatic retry
  is implemented; a caller must build its own retry loop, which the test simulates by hand).
- **No lost update remains** after a retry completes — confirmed by final-state assertions in the
  same test.

This is verified against the actual implementation's control flow (not merely re-trusting that the
tests pass): `UpdateComputedAttributeProjection.execute` re-reads `getCurrent` at its very first line
on every call, so nothing about a "retry" requires special-casing — it is structurally just another
ordinary call.

---

## 6. Version Integrity

Traced `applyAttributeUpdate` (`domain/computed-attribute.ts:84-122`) and both adapters:

- **Increments exactly once per applied change**: `nextAttributeVersion = existing === undefined ? 1
: existing.version + 1` (per-attribute) and `version: attribute.version + 1` (aggregate-level) —
  both are unconditional `+1`s on the applied path, never `+N`, never conditional on anything but
  "was this update applied."
- **Never skips**: no code path increments by more than 1; the no-op guard (`applied: false`) returns
  the _unchanged_ `attribute` object with its _original_ version when a value is a no-op re-evaluation
  — it does not bump the version for a rejected update.
- **Never decrements**: no arithmetic in `applyAttributeUpdate`, `InMemoryAttributeStore`, or
  `PrismaAttributeStore` ever subtracts from a version; the only writes are `+1` (domain, on apply) or
  a pass-through of whatever `attribute.version` already is (both `saveCurrent` implementations write
  `attribute.version` as given, never recompute it).
- **Never resets**: `createEmptyComputedAttribute` (the only place `INITIAL_ATTRIBUTE_VERSION` = 0 is
  ever assigned) is called only when `current === null` (a genuinely new identifier) — an existing,
  versioned attribute is never routed back through this constructor.
- **Never increments on failed CAS**: the domain computation (`applyAttributeUpdate`, producing
  `applyResult.attribute` with its bumped version) happens entirely in memory, _before_ the CAS write
  is attempted. If `saveCurrent` throws `ConcurrencyError`, the computed object is simply discarded —
  nothing in the codebase persists a version bump independently of a successful `saveCurrent` call, so
  a failed CAS cannot leave any bumped version behind anywhere (cache or ledger).

All of the above hold for both the in-memory and Prisma adapters identically, since the version
arithmetic lives entirely in the adapter-independent domain layer
(`domain/computed-attribute.ts`) — the adapters only ever compare or persist whatever version they
are handed.

---

## 7. Race Analysis

| Scenario                                                                                      | Safe?                                                                                              | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two concurrent writers, same identifier                                                       | **Yes**                                                                                            | Proven by the existing concurrency test suite (§5) and the atomicity argument (§2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Three (or N) concurrent writers, same identifier                                              | **Yes**                                                                                            | The CAS predicate (`version = expectedVersion`) generalizes to any writer count without modification: at most one `updateMany`/`Map.set()` can match the currently-stored version at any instant, so with N concurrent attempts against the same starting version, at most one succeeds and the rest all throw `ConcurrencyError` — the mechanism does not degrade or special-case beyond two. Not separately re-tested with N=3 since the underlying primitive (`version = expected` predicate) provides no different guarantee at higher N; the 2-writer test already exercises the actual race condition (interleaved `await`s / DB row-lock contention), not a count-specific behavior. |
| Retry storms (repeated re-attempts after `ConcurrencyError`)                                  | **Safe, by absence of scope**                                                                      | No automatic retry loop exists anywhere in this codebase (ADR-0060 §Alternatives, deliberately not built — "no concrete retrying consumer exists yet"). There is therefore no retry-storm amplification risk to analyze; a caller building their own retry loop inherits ordinary backoff-design responsibility, out of this ADR's scope.                                                                                                                                                                                                                                                                                                                                                   |
| Duplicate retries (same losing write retried twice concurrently)                              | **Safe**                                                                                           | Reduces structurally to the "N concurrent writers" case above — two retries of the same logical update are, from the store's perspective, just two more concurrent `saveCurrent` calls; at most one applies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Delayed retries (a retry that lands long after the original race)                             | **Safe**                                                                                           | A retry re-reads `getCurrent` fresh at call time — an arbitrarily delayed retry simply picks up whatever the current state is at that moment and computes `base.version` accordingly; there is no staleness window because nothing is cached across the retry boundary inside the use case itself.                                                                                                                                                                                                                                                                                                                                                                                          |
| **Rebuild + Update** (`RebuildComputedAttributes` racing `UpdateComputedAttributeProjection`) | **Unsafe before this audit — fixed (Finding F-1)**                                                 | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Worker + API** (`ComputedAttributeProjectionWorker` racing any online evaluation)           | **Unsafe before this audit — fixed (Finding F-1)**, via the same code path the worker delegates to | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Finding F-1 — Rebuild can silently regress the cache past a concurrently-applied update

- **Severity**: High (production risk, not yet realized in production only because
  `ComputedAttributeProjectionWorker` is not yet wired as a scheduled job — but it is a fully built,
  directly callable use case today, and its own module doc names becoming a scheduled job as the very
  next planned step).
- **Evidence**: `RebuildComputedAttributes.execute` (pre-fix,
  `application/rebuild-computed-attributes.use-case.ts`) read `history.latestFor(identifier)`
  **before** entering its own transaction, then — inside that transaction — called
  `attributes.saveCurrent(rebuilt, undefined, tx)` **unconditionally**, with no re-check of what the
  cache currently held. Sequence:
  1. Rebuild reads `history.latestFor` → gets the snapshot as of that moment (say version 5).
  2. Concurrently, `UpdateComputedAttributeProjection` runs to completion: its whole transaction (CAS
     cache write to version 6, then history append) commits — this is exactly the operation ADR-0060
     protects, and it succeeds correctly.
  3. Rebuild's own transaction now runs, still holding the stale version-5 snapshot from step 1, and
     unconditionally overwrites the cache with it — silently reverting the cache from version 6 back
     to version 5, with **no exception, no log line, no signal**. It also appends a "rebuilt" snapshot
     to the ledger recording the _older_ version-5 state, out of chronological order relative to the
     version-6 entry that already exists — corrupting the append-only ledger's temporal meaning, not
     just the cache.
  4. Nothing in the existing test suite exercised this interaction —
     `rebuild-computed-attributes.replay-safety.test.ts` only tests sequential rebuild-after-recompute,
     never a rebuild racing a concurrent update; `update-computed-attribute-projection.concurrency.test.ts`
     only tests Update-vs-Update.
- **Production impact**: exactly the silent, undetectable lost-update ADR-0060 exists to eliminate —
  reintroduced through the one write path (`RebuildComputedAttributes`) that ADR-0060 deliberately
  left CAS-unguarded, on the correct reasoning that a _corrupted_ cache has no trustworthy version to
  compare against, but without accounting for the case where the cache is not corrupted at all, merely
  _newer_ than what the rebuild is working from. The moment `ComputedAttributeProjectionWorker` is
  registered as a periodic job (its own stated next step) alongside any live caller of
  `RecalculateComputedAttributes`/`UpdateComputedAttributeProjection`, this race becomes live and will
  intermittently, silently undo real updates.
- **Minimal fix applied** (`application/rebuild-computed-attributes.use-case.ts`): inside the same
  transaction, immediately before the (now-conditional) history append and cache write, re-read the
  current cache via `attributes.getCurrent(identifier, tx)`. If it exists and its version is already
  ahead of `rebuilt`'s version, skip both the history append and the cache overwrite entirely and
  return the current (fresher) cache state instead — the rebuild recognizes it is stale and becomes a
  no-op rather than a regression. When the cache is missing or at/behind `rebuilt`'s version (the
  actual recovery scenario this use case exists for), behavior is completely unchanged. No API
  signature changed; no new dependency; six lines plus a comment.
- **Verification**: added a new regression test,
  `rebuild-computed-attributes.use-case.test.ts` → _"never regresses the cache when a concurrent
  update already advanced it past the snapshot this rebuild read"_, which fails against the pre-fix
  code (confirmed: initially failed with the stale value clobbering the cache) and passes after the
  fix. Full suite: **224/224 customer-360 tests passing** (up from 223; 26 honestly skipped, Prisma
  integration tests requiring a live DB — unchanged), `typecheck` clean, repo-wide `pnpm arch` clean
  (0 violations, 1436 modules) — confirming no regression elsewhere.

---

## 8. Cross Adapter Parity

**Confirmed matching behavior for every scenario in the shared contract** — both adapters pass the
identical `runAttributeStoreContractTests` suite (`attribute-store.contract.ts`), including all four
ADR-0060-specific cases: matching-version CAS success, stale-version CAS rejection, omitted-version
unconditional overwrite (Rebuild's semantics), and basic round-trip/upsert/listIdentifiers behavior.

**One deliberate, documented asymmetry — not semantic drift, not a fresh finding**: on the
create-branch (`expectedVersion === INITIAL_ATTRIBUTE_VERSION` but a row already exists), the
in-memory adapter throws a typed `ConcurrencyError` (cheap `Map` presence check), while
`PrismaAttributeStore` lets a raw, untyped `Prisma.PrismaClientKnownRequestError` (P2002) propagate
instead. This is explicitly called out in the adapter-specific test
(`in-memory-attribute-store.test.ts:10-17`) and reasoned through at length in ADR-0060 §Decision 5 and
§Alternatives: catching P2002 would require adding `@prisma/client` as a direct dependency of
`services/customer-360` (today only a type-only `Prisma` re-export via `@platform/db`), which is a
platform-wide, precedent-setting dependency-baseline change out of proportion to this ADR's scope —
and it mirrors an identical, already-accepted gap in every other D-042 adapter's own create branch
(e.g. `PrismaWishlistRepository`). This is pre-existing, reasoned, platform-wide debt, correctly
carried forward — recorded under Risks Remaining, not treated as a new defect.

---

## 9. Public API Consistency

`AttributeStore`, `InMemoryAttributeStore`, `PrismaAttributeStore` all changed together, additively
(`expectedVersion?: number` inserted before the existing trailing `tx?: unknown`) — every existing
call site that passed zero or one argument continues to compile and behave identically (verified:
`RebuildComputedAttributes` now explicitly passes `undefined` as a one-line, no-behavior-change edit
purely because the parameter list shifted position; every test-fixture mock calling `saveCurrent`
with one argument is unaffected). The governance baseline
(`scripts/governance/baseline/public-api.json`) was updated for exactly these three exports per the F2
report — this audit did not re-diff that baseline file byte-for-byte but confirmed via `pnpm
governance` equivalent reasoning is unnecessary here since the Finding F-1 fix touched no public
signature at all (only `RebuildComputedAttributes`'s internal implementation), so no further baseline
change is needed as a result of this audit.

---

## 10. Performance Regression

The F2 report's own benchmark table (Task 9 lifecycle timing, 200-node registry) shows every post-CAS
number falling inside or within noise of the pre-CAS range — reviewed and found consistent with the
design: the in-memory CAS check is one extra `Map.get()` + integer comparison (O(1)); the Prisma CAS
write replaces one `upsert` round trip with exactly one `create` or one `updateMany` round trip (same
round-trip count, not more).

**This audit's own fix (F-1) adds exactly one extra `getCurrent` read per `RebuildComputedAttributes`
call**, inside the same transaction as the existing history append and (conditional) cache write —
one additional round trip on a recovery/batch path that already does at least two round trips
(history append + cache write) per identifier. Re-ran the full customer-360 suite after the fix;
no test asserting a performance budget regressed, and the change is confined to a path explicitly
documented as not being on any latency-sensitive request path (a scheduled batch job, not yet even
wired into a live scheduler). No further benchmark re-run was performed beyond the existing repo test
suite, since the added cost (one indexed point lookup) is asymptotically identical in shape to costs
already benchmarked and accepted in the F2 report.

---

## Findings Severity Table

| ID                                                                                                                                                | Severity | Status                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| F-1 — `RebuildComputedAttributes` can silently regress the cache past a concurrent, CAS-protected update (Rebuild-vs-Update / Worker-vs-API race) | High     | **Fixed** — staleness guard added, regression test added, full suite green |

---

## Verified Correctness

- ADR-0060's own stated scope (Update-vs-Update lost-update race, F2) is correctly implemented in
  both adapters, correctly ordered inside a real Prisma transaction, with correct rollback-on-reject
  semantics.
- Version integrity (increment-exactly-once, never skip/decrement/reset, never bump on failed CAS)
  holds in all traced code paths, adapter-independently (the domain layer owns all version
  arithmetic).
- Retry semantics behave exactly as ADR-0060 documents: no silent data loss, typed retryable error,
  full recovery on caller-driven retry.
- N-writer and retry-storm/duplicate/delayed-retry races beyond the tested 2-writer case are safe by
  construction — the CAS predicate generalizes without modification, and no retry-amplification logic
  exists anywhere in scope to create a storm risk.
- Cross-adapter behavior matches on every case in the shared contract; the one asymmetry that exists
  is pre-existing, deliberate, and fully reasoned in the ADR itself, not new drift.
- No performance regression beyond what the F2 report already measured and accepted; this audit's own
  fix adds one bounded-cost read to an already batch/recovery-shaped path.

## Risks Remaining

- **`ProfileStore`/`SessionStore` share the identical Update-vs-Update structural gap** ADR-0060
  closed for `AttributeStore` — explicitly out of scope per the Phase 6.5 gate-review decision, and
  explicitly carried forward as documented debt in the ADR itself. Not re-litigated here; flagged only
  because it is the same class of risk this audit was scoped to hunt for, in a sibling store this
  audit was not asked to touch.
- **The create-branch cross-adapter error-type asymmetry** (§8) remains: a genuinely concurrent
  first-ever-evaluation race on `PrismaAttributeStore` surfaces as a raw Prisma error, not
  `ConcurrencyError`. Deliberate, reasoned, platform-wide-consistent debt — not fixed here, matching
  the ADR's own explicit decision not to add a `@prisma/client` dependency for this.
  `ProfileStore`/`SessionStore`'s equivalent Update-vs-Update gap (previous bullet) is a materially
  bigger risk than this one and should be prioritized first if this area gets revisited.
- **No automatic retry policy exists** for a caller hitting `ConcurrencyError` on
  `UpdateComputedAttributeProjection` — by design, per ADR-0060 §Alternatives, since no concrete
  consumer exists yet to size a retry policy against. Any future caller (the deferred
  `RecalculateComputedAttributes`-off-events wiring) must build this itself; not pre-built here.

## Recommendation

**APPROVED WITH OBSERVATIONS.**

ADR-0060's own documented scope is correctly implemented, and the one real gap this audit surfaced
beyond that scope (Finding F-1) has been fixed with a minimal, verified change, not merely flagged.
Approval is conditioned on the Risks Remaining above being tracked as known, accepted debt (they
already are, in the ADR's own text, except for F-1's specific rebuild-vs-update angle, now also
recorded here) — none of them block this ADR's own stated goal of closing the F2 race, and none of
them were left unverified by this audit.
