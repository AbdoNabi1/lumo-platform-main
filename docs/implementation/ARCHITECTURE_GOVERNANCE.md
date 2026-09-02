# Architecture Governance — Universal Tracking Platform Layering (FF-ARCH-10..17)

**Status: governance-only milestone, complete.** This document is the canonical reference for
FF-ARCH-10 through FF-ARCH-17 — eight fitness functions that permanently protect the layering rules of
the (now frozen) Universal Tracking Platform, ahead of the Customer Data Platform (CDP) build.

**Nothing about runtime behavior, public API surface, or performance changed to add these.** Every
rule enforces a decoupling that already existed in the code — the Browser SDK, Collector, Execution
Runtime and Delivery Runtime already communicated only through the published event topic
(`tracking.event.captured`) or through injected ports, never through a direct import of one another.
These fitness functions make regressing that a build failure instead of something only a reviewer
might catch.

**FF-ARCH-16 and FF-ARCH-17 (this update) close the final governance gap before the platform is
considered architecturally frozen.** FF-ARCH-10..15 forbid every _specific, named_ forbidden pair among
the tracking layers; they say nothing about a cycle formed by a chain of otherwise-unnamed edges, and
nothing about a package reaching past another package's public barrel into its private implementation.
FF-ARCH-16 (Layer Cycle Detection) and FF-ARCH-17 (Friend Package Protection) close both gaps
generically, so a _future_ layer or package inherits the same guarantee without a governance edit.

---

## The allowed flow

```
Browser SDK  →  Collector  →  Execution Runtime  →  Delivery Runtime  →  CDP
   (browser/)    (collector/)      (execution/)         (runtime/)      (packages/cdp/, future)
```

This diagram describes **data flow**, not import direction. Concretely:

- **Browser SDK → Collector** happens over HTTP (the SDK POSTs to the Collector's public endpoint).
  Neither imports the other's source.
- **Collector → Execution Runtime** happens by the Collector publishing to the
  `tracking.event.captured` topic; the Delivery Runtime subscribes and drives the Execution Runtime
  from there. The Collector never imports the Execution Runtime, the Delivery Runtime, or calls
  either directly.
- **Execution Runtime → Delivery Runtime**: the **one** legitimate import edge among these areas.
  The Execution Runtime (`execution/` — the Planner + Pipeline Executor, `execute()`) is a plain
  function library with no ports of its own for publish/subscribe; something has to call it
  synchronously. That caller is the Delivery Runtime (`runtime/` — ingest, delivery and replay
  orchestration), so **`runtime/` importing `execution/` is correct and required**, not a shortcut.
  The reverse (`execution/` importing `runtime/`) is not: a library depending on its own caller is a
  defect waiting to become a cycle.
- **Delivery Runtime → CDP** happens the same way Collector → Execution Runtime does: CDP will
  consume what the Delivery Runtime produces via a subscription, not by either side importing the
  other.

**Every other cross-area import among these five is a shortcut**, and every one of them fails
governance.

---

## The six rules

### FF-ARCH-10 — Browser SDK must never import Runtime, Execution, Registry, Replay or Delivery

**Why**: the Browser SDK's entire contract is "produce a valid Tracking Envelope and POST it to the
Collector" (see the M7 completion report). It has no legitimate reason to import server-side planning
(`execution/`), the registry contracts (`definitions/`), replay (`replay/`), the mapping/adapter layer
(`delivery/`), or the ingest/delivery orchestrator (`runtime/`) — every one of those runs exclusively
server-side, several of them (registry resolution, hashing-adjacent policy) on data the browser must
never see raw.

**Enforcement**: `.dependency-cruiser.cjs`, rule `ff-arch-10-browser-sdk-boundary`.

```js
from: { path: "^packages/tracking/src/browser/" },
to:   { path: "^packages/tracking/src/(runtime|execution|definitions|replay|delivery)/" },
```

**Example diagnostic** (what `pnpm arch` reports if this is ever violated):

```
FF-ARCH-10 FAIL
  packages/tracking/src/browser
    ↓
  packages/tracking/src/runtime
  Forbidden dependency.
  Detected import: packages/tracking/src/runtime/telemetry.ts
  Imported by:      packages/tracking/src/browser/sdk.ts
```

### FF-ARCH-11 — Collector must never import Browser SDK

**Why**: the Collector is a server-side, unauthenticated public endpoint (`apps/collector`); the SDK
is untrusted client code that never runs in the same process. There is no legitimate reason for one
to reference the other's source at all.

**Enforcement**: `.dependency-cruiser.cjs`, rule `ff-arch-11-collector-boundary`
(`collector/` → `browser/`).

### FF-ARCH-12 — Execution Runtime must never import Browser SDK

**Why**: `execution/`'s Planner and Pipeline Executor run entirely server-side, against an
already-captured, already-validated envelope. It has no reason to reach into client code.

**Enforcement**: `.dependency-cruiser.cjs`, rule `ff-arch-12-execution-runtime-boundary`
(`execution/` → `browser/`).

### FF-ARCH-13 — Delivery Runtime must never import Collector or Browser SDK

**Why**: `runtime/` (ingest-runtime, delivery-runtime, replay-runtime, telemetry) receives envelopes
over the published topic — never by calling the Collector's `collect()` function directly — and has
no reason to touch client code either.

**Enforcement**: `.dependency-cruiser.cjs`, rule `ff-arch-13-delivery-runtime-boundary`
(`runtime/` → `(collector|browser)/`).

**The one exception, made explicit**: this rule does **not** forbid `runtime/` importing
`execution/`. See "The allowed flow" above — that edge is the orchestrator calling the library it
invokes, and is required for the platform to ever be wired end-to-end.

### FF-ARCH-14 — Customer Data Platform must never import Browser SDK, Collector or Delivery Runtime

CDP does not exist yet (`packages/cdp/` is not yet a workspace package). This rule is written so it
**activates automatically the day the directory is created** — no governance edit required — and has
two independently-enforced halves, because one enforcement mechanism cannot see the whole shape of
the violation:

**Path-level half** (`.dependency-cruiser.cjs`, rule `ff-arch-14-cdp-boundary`): catches a **deep
import** straight into `packages/tracking/src/(browser|collector|runtime)/` from anywhere under
`packages/cdp/`. This is largely redundant with the pre-existing, generic
`no-deep-package-imports` rule — kept as an explicit, separately-named rule anyway, because the user
of this document needs to be able to point at "FF-ARCH-14" specifically, not infer it from a more
generic rule's incidental coverage.

**Symbol-level half** (`scripts/governance/run.mjs`, `checkArch14CdpBarrelBoundary`): the real gap a
path-based rule cannot close. CDP is expected to consume `@platform/tracking`'s public barrel for
legitimate reasons (Registry Graph types, transformation metadata, envelope contracts). A deep-import
rule cannot tell a legitimate import of that barrel apart from `import { createTrackingClient } from
"@platform/tracking"` — **both resolve to the exact same file**, `packages/tracking/src/index.ts`.
Dependency-cruiser's module graph has no concept of "which named export did this edge actually use,
and which sub-directory did that export originate from" — so this half is a **custom, symbol-aware
scan**, following the same precedent FF-ARCH-09 already established for exactly this class of problem
(`receiveAndDeliver`'s single-ingress rule also cannot be expressed as a file-level dependency rule).

The denylist of forbidden names is **built by reading the current barrels at check time** —
`packages/tracking/src/browser/index.ts` and `execution/index.ts` directly (they have their own area
barrels), and `packages/tracking/src/index.ts`'s explicit `from "./collector/…"` / `from
"./runtime/…"` re-export statements for the other two (they do not have their own area barrels today).
This means the denylist can never go stale: a new export added to any of the four areas is picked up
the next time governance runs, with no maintenance required.

**Example diagnostic**:

```
Forbidden dependency packages/cdp → packages/tracking/src/browser (via the @platform/tracking barrel).
Detected import: "createTrackingClient" from "@platform/tracking", which is exported by browser.
Imported by: packages/cdp/src/profile/profile.ts.
```

A `import * as Tracking from "@platform/tracking"` (namespace import) is flagged separately, as
unverifiable-by-name, rather than silently passed — the check cannot see which properties of
`Tracking` a namespace import actually uses, so it surfaces the import for manual review instead of
guessing.

### FF-ARCH-15 — No package may bypass the Execution Runtime

The general closure rule. FF-ARCH-10 through FF-ARCH-14 name the violations that are easiest to
anticipate; FF-ARCH-15 exists so a shortcut **they didn't specifically name** still fails governance.
Concretely, it adds every remaining forbidden pair among the five areas (Browser SDK, Collector,
Execution Runtime, Delivery Runtime, CDP) that FF-ARCH-10..14 do not already cover, with the one
exception (`runtime → execution`) preserved throughout:

| From                 | Forbidden to             | Rule                                                                                    |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `browser/`           | `collector/`             | `ff-arch-15-browser-collector-shortcut`                                                 |
| `collector/`         | `execution/`, `runtime/` | `ff-arch-15-collector-shortcut`                                                         |
| `execution/`         | `collector/`, `runtime/` | `ff-arch-15-execution-runtime-shortcut`                                                 |
| `packages/cdp/`      | `execution/`             | `ff-arch-15-cdp-execution-shortcut` (+ symbol-level: `checkArch15CdpExecutionBoundary`) |
| `packages/tracking/` | `packages/cdp/`          | `ff-arch-15-tracking-never-imports-cdp`                                                 |

The last row is the reverse direction: CDP is the **terminal consumer** of this flow — nothing
upstream of it should ever depend on it. That rule, like FF-ARCH-14's, matches zero files today and
activates automatically once `packages/cdp` exists.

**Enforcement**: five `.dependency-cruiser.cjs` rules (above) + `checkArch15CdpExecutionBoundary` in
`scripts/governance/run.mjs` (shares its denylist-building helper with FF-ARCH-14's
`checkArch14CdpBarrelBoundary` — see `forbiddenCdpSymbolNames` — parameterized to just the
`execution` area, since FF-ARCH-14 already covers browser/collector/runtime).

### FF-ARCH-16 — Layer Cycle Detection

**Purpose**: the architecture must remain acyclic — not just at the level of individual _files_
(`no-circular` already owns that), at the level of the named architectural _layers themselves_.

**Why a file-level cycle check is not enough**: four files A, B, C, D can each import a different,
unrelated file in the next layer — A (Browser SDK) imports one file in Collector; a **separate** file
in Collector imports one file in Execution Runtime; a separate file there imports one in Delivery
Runtime; a separate file there imports back into Browser SDK (not file A — a different Browser SDK
file, E). No single file is ever imported twice on any path, so there is no file-level strongly
connected component and `no-circular` reports nothing wrong. The **layers** these five files belong to
still close a loop:

```
Browser SDK
  ↓
Collector
  ↓
Execution Runtime
  ↓
Delivery Runtime
  ↓
Browser SDK
```

That is an architecture cycle by any reasonable definition — a change in Delivery Runtime can now
ripple all the way back around to Browser SDK — and it is invisible to a check that only ever asks "did
this file import itself back".

**The barrel/re-export/alias requirement**: a cycle does not need to run through direct relative
imports to be real. `packages/tracking/src/index.ts` re-exports `browser/` via `export * from
"./browser"`; a file that imports `@platform/tracking` (the workspace alias) and never mentions
`browser` by name still reaches the Browser SDK the moment that barrel is resolved. FF-ARCH-16 detects
this because it does not re-implement import resolution — it reads the **already-resolved** module
graph dependency-cruiser builds for `pnpm arch` (`depcruise --output-type json`), which has already
followed every relative deep import, `index.ts` barrel, `export *` re-export, and workspace alias down
to a real file before FF-ARCH-16 ever sees an edge. There is nothing left for FF-ARCH-16 itself to
resolve, which is exactly why it cannot be fooled by indirection.

**How it works** (`scripts/governance/layer-cycles.mjs`): every file inside one of the named layers
(Browser SDK, Collector, Execution Runtime, Delivery Runtime, Delivery Adapters, Registry, Replay, CDP
— the same areas FF-ARCH-10..15 already name) is merged into one graph node per layer. Every file
**outside** all of them (a package barrel, an unrelated shared package, a generic helper) is kept as
its own individual "pass-through" node — never merged with anything — so a chain routed through it
stays connected instead of being dropped. A depth-first search over this mixed graph reports the first
cycle it finds; because the underlying file graph is itself acyclic (enforced separately by
`no-circular`), the only nodes that can ever be revisited are the layer nodes, so any cycle found here
is, by construction, a genuine multi-layer cycle. An edge whose _only_ dependency type is `type-only`
is excluded first, matching `no-circular`'s own stated tolerance — a type flowing back through a barrel
is erased at compile time and creates no runtime cycle.

**Example diagnostic** (what `pnpm governance` reports if this is ever violated):

```
FF-ARCH-16 FAIL
Architecture cycle detected

  Browser SDK
  ↓
  Collector
  ↓
  Execution Runtime
  ↓
  Delivery Runtime
  ↓
  Browser SDK

Full import chain (4 hop(s), including any barrel/re-export/index.ts files in between):
  1. packages/tracking/src/browser/sdk.ts imports packages/tracking/src/collector/collector.ts
  2. packages/tracking/src/collector/collector.ts imports packages/tracking/src/execution/executor.ts
  3. packages/tracking/src/execution/executor.ts imports packages/tracking/src/runtime/telemetry.ts
  4. packages/tracking/src/runtime/telemetry.ts imports packages/tracking/src/index.ts
```

**How to resolve a violation**: find the hop in the "full import chain" that should not exist — usually
the last one, since it is the edge that closes the loop — and remove or invert it. If the dependency is
genuinely needed in both directions, the two layers are not actually separate layers and the layering
diagram (and FF-ARCH-10..15) needs a deliberate, reviewed decision, not a governance bypass.

**Enforcement**: `scripts/governance/run.mjs` (`checkLayerCycles`, delegating the graph-building and
cycle search to `scripts/governance/layer-cycles.mjs`), run as part of `pnpm governance`. Deliberately
**not** a `.dependency-cruiser.cjs` rule: dependency-cruiser's own `forbidden` rules match individual
`from`/`to` path pairs, not a multi-hop cycle condition, so this needed the same kind of custom,
graph-aware check FF-ARCH-09 and FF-ARCH-14/15's symbol-level halves already established a precedent
for — reusing dependency-cruiser's JSON output as the data source rather than re-parsing source.

### FF-ARCH-17 — Friend Package Protection

**Purpose**: protect internal implementation details. No package may import another package's
`internal`, `private`, or `implementation` directory (at any reasonable depth under `src/` — e.g.
`src/internal`, `execution/internal`, `browser/internal`, `collector/internal`, `runtime/internal`) —
only its public barrel is a legitimate dependency.

```
Allowed:    @platform/execution
Forbidden:  @platform/execution/internal
Forbidden:  packages/execution/src/internal   (deep relative import)
Forbidden:  packages/execution/src/private
Forbidden:  packages/browser/src/internal
```

**Why this needed a new rule and not just `no-deep-package-imports`**: the pre-existing
`no-deep-package-imports` rule already forbids importing anything under a package's `src/` other than
its declared public entry — **except** a declared subpath entry (its own carve-out, added for
legitimate cases like a package's `/testing` export). That carve-out is exactly the hole FF-ARCH-17
closes for this one reserved class of directory name: `internal`/`private`/`implementation` are never
part of a package's public contract, **regardless of what a future `package.json#exports` entry might
declare**. A package cannot make its internals importable by declaring a subpath export named
`internal` — the directory name itself is now reserved.

**Two enforcement halves, the same shape as FF-ARCH-14/15**:

1. **Path-level** (`.dependency-cruiser.cjs`, rule `ff-arch-17-friend-package-protection`): forbids any
   import whose **resolved** path lands inside another package's `src/(internal|private|implementation)`
   directory (at `src/internal` or one directory deeper, e.g. `src/execution/internal`), however it got
   there — a deep relative import, a workspace alias, or a future wildcard export subpath. Same-package
   imports are exempt (a package may of course use its own internals) via the identical `pathNot`
   carve-out `no-deep-package-imports` already uses.
2. **Specifier-level** (`scripts/governance/run.mjs`, `checkFriendPackageProtection`): catches the
   `@platform/<pkg>/internal`-shaped specifier **text**, independent of whether it currently resolves to
   anything. A resolved-path rule cannot flag a specifier that fails to compile today — but an
   unrelated, legitimate wildcard export added to some other package's `package.json#exports` tomorrow
   (`"./*": "./src/*"`, added to support a real subpath) could make it start resolving silently, and at
   that point only the string itself still says what was written. This mirrors the precedent
   FF-ARCH-14/15's barrel-symbol scan already established: a plain specifier-text check closes a gap a
   resolved-path graph cannot express. Same-package self-references (a package naming its own alias) are
   exempt for the same reason as the path-level half.

Both halves use two explicit alternatives (`src/internal`, `src/<area>/internal`) rather than an
unbounded `(?:.*\/)?` — dependency-cruiser's built-in `safe-regex` check rejects the unbounded form as
an unsafe nested quantifier even though it cannot actually backtrack ambiguously here; two explicit
depths cover every example this rule names and stay inside that check's comfort zone.

**Example diagnostic** (path-level, `pnpm arch`):

```
ff-arch-17-friend-package-protection
  packages/cdp/src/profile.ts
    ↓
  packages/execution/src/internal/scheduler.ts
  Forbidden dependency.
```

**Example diagnostic** (specifier-level, `pnpm governance`):

```
FAIL   FF-ARCH-17        friend package protection (internal/private/implementation)  (1)
       packages/cdp/src/profile.ts:3  Forbidden import of another package's internal directory:
       "@platform/execution/internal". Only the public barrel is allowed — import
       "@platform/execution", never a deep "internal"/"private"/"implementation" subpath.
```

**How to resolve a violation**: the target package needs to expose the specific capability through its
public barrel (`src/index.ts`) instead — add the export there, or, if the capability is genuinely not
meant to be public, the importer has the wrong dependency and needs a different, already-public port.

**Enforcement**: `.dependency-cruiser.cjs` (`ff-arch-17-friend-package-protection`) +
`scripts/governance/run.mjs`'s `checkFriendPackageProtection`, both run automatically by `pnpm arch` and
`pnpm governance` respectively.

---

## Why two enforcement mechanisms, not one

This work extends the **existing** dependency analysis rather than building a second one, in two
different, already-established places:

1. **`.dependency-cruiser.cjs`** (`pnpm arch`) — the codebase's own stated home for exactly this
   class of rule. `scripts/governance/run.mjs`'s own header says so directly: _"Architecture/boundary/
   cycle checks are delegated to `pnpm arch` (reused, not duplicated)."_ Every rule that is a plain
   "area A must never import area B" file-path check (FF-ARCH-10, 11, 12, 13, 14's path half, all of
   FF-ARCH-15's `.dependency-cruiser.cjs` rows) lives here, exactly like the pre-existing
   `domain-stays-pure`/`application-no-messaging-no-infra` rules it sits alongside.
2. **`scripts/governance/run.mjs`** (`pnpm governance`) — reserved, by the same header comment and by
   precedent (FF-ARCH-09), for checks a **file-level** dependency graph genuinely cannot express: a
   specific exported _symbol's_ origin reachable only through a shared barrel (FF-ARCH-14/15), a
   multi-hop cycle condition no single `from`/`to` pair can state (FF-ARCH-16), or a specifier's literal
   text independent of whether it resolves (FF-ARCH-17's second half). All four reuse this file's
   existing primitives (`tsSources`, `read`, `finding`) rather than introducing a new scanning tool.
   FF-ARCH-16 additionally reuses dependency-cruiser itself as its **data source** (`depcruise
--output-type json`, the identical scope and config `pnpm arch` uses) rather than re-parsing source —
   the cycle search is new, but the resolved module graph it searches is not.

No new checker, no new dependency, no third mechanism. `dependency-cruiser` was already a workspace
devDependency invoked by `pnpm arch`; the regression suite drives it via `pnpm exec depcruise` (a
subprocess, exactly how `pnpm arch` itself invokes it) rather than importing it as a module, so
`scripts/governance`'s own "zero external dependencies" package stays true.

---

## Testing

`scripts/governance/architecture-layering.test.mjs` proves every rule both ways, per the requirement:
create a real, temporary file containing the forbidden import (or, for FF-ARCH-16, a temporary chain of
files forming a real cycle), run the real tool, assert failure, delete the fixture(s), assert the tool
passes again. Nothing is asserted about a mock or a re-implementation of the rule — every assertion
runs the actual enforcement mechanism (`depcruise` via `pnpm exec`, or the actual
`checkArch14CdpBarrelBoundary`/`checkArch15CdpExecutionBoundary`/`checkLayerCycles`/
`checkFriendPackageProtection` functions).

33 tests, covering:

- Each of FF-ARCH-10 through FF-ARCH-13 individually, both the failing and the passing state.
- FF-ARCH-13's one legitimate exception (`runtime → execution`), proven to **not** fail — a false
  positive here would be as harmful as a missed real violation, since it would pressure a future
  change into disabling the rule outright rather than living with it.
- FF-ARCH-14's path-level half (a real fixture under a temporary `packages/cdp/`) and its symbol-level
  half (four cases: a Browser-SDK name, a Collector name, a Delivery-Runtime name, and a _negative_
  case — a Registry Graph export that must **not** be flagged, proving the denylist is scoped
  correctly rather than blocking the whole barrel).
- The namespace-import (`import * as …`) unverifiable-by-name case.
- FF-ARCH-15's five residual shortcut pairs, including the CDP→execution and
  tracking→CDP directions.
- **FF-ARCH-16**: the clean-repo baseline; a cycle spread across **five different files** (proving no
  single file-level cycle exists, so this is genuinely testing layer-level detection and not
  duplicating `no-circular`); and the same cycle with its closing hop routed through the
  `@platform/tracking` alias → root `index.ts` → `export * from "./browser"` → the browser area barrel,
  proving the barrel/re-export/alias requirement is actually met and not merely claimed. Each fixture
  scenario is proven both ways (created → fails, removed → passes).
- **FF-ARCH-17**: the path-level half (cross-package deep import into `internal/`, the same-package
  exemption, and `private/`/`implementation/` at two depths) and the specifier-level half
  (`@platform/<pkg>/internal` at one and two levels deep, the same-package alias exemption, and a
  legitimate public-barrel import proven **not** to be flagged).
- A final full-repository `pnpm exec depcruise` pass, plus a final `checkLayerCycles`/
  `checkFriendPackageProtection` pass, confirming the whole gate is clean with no fixtures present.

A `packages/cdp/src/__placeholder.ts` file is created once, for the whole test file's run, and removed
in `afterAll` — `depcruise` refuses to scan a directory that does not exist at all (a hard CLI error,
distinct from "zero violations"), so the CDP-scoped tests need one real file to point at without
making CDP "exist" in any sense that outlives the test run. Every other fixture is created and removed
per-test, with `afterEach` guaranteeing cleanup even if an assertion throws mid-test.

---

## Confirmed unaffected

- **Runtime behavior**: the FF-ARCH-10..15 milestone touched exactly five files; this FF-ARCH-16/17
  follow-up touches six more — `.dependency-cruiser.cjs` (extended), `scripts/governance/run.mjs`
  (extended), the new `scripts/governance/layer-cycles.mjs`, `scripts/governance/architecture-layering.
test.mjs` (extended), `docs/governance/03-engineering-fitness-functions.md` (extended), and this
  document. Zero files under `packages/`, `services/` or `apps/` source trees changed by either
  milestone. (FF-TRACK-01's Browser SDK exemption removal — the reason
  `no-direct-vendor-tracking.test.mjs` no longer lists `browser/` as a vendor-call-permitted layer — was
  a **prior** milestone's decision, unchanged and unrevisited here; it is not part of this turn's diff.)
- **Public API**: no package's exported surface changed. `pnpm governance`'s FF-API-01 baseline is
  untouched by this milestone.
- **Performance**: no hot path touched. `pnpm arch` and `pnpm governance` are both build-time gates,
  never part of a served request.

Full gate suite (`pnpm typecheck`, `pnpm test`, `pnpm governance`, `pnpm arch`, `pnpm dup`) is green —
see the session's final verification for exact counts.
