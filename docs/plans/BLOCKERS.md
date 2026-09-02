# Blockers and notable deviations

Phase 0 completed with no blocked tasks. The two entries below are not blockers — nothing was
skipped — but are recorded because they involved a judgment call or a limitation worth knowing
about before later phases build on this one.

## T0.6 — Analytics DTO leak found and fixed (scope expanded beyond the task text)

**Expected:** T0.6 only asked for `admin-web` changes — a new `lib/api/analytics.ts` and a
rewritten `/analytics` page — treating the four `services/analytics` read endpoints as already
correctly wired.

**Found:** `AnalyticsConsoleController` (`services/analytics/src/interfaces/analytics-console.controller.ts`)
returns raw `Metric`/`DimensionDefinition` **value objects** straight through `present()`, with no
DTO mapping. `ValueObject` (`packages/domain/src/shared/value-object/value-object.ts`) stores its
data in a `props` field that is `protected` only at compile time — at runtime it is an ordinary own
enumerable property — so the real wire response was `{"props": {"id": {"props": {"value": "..."}}},
...}`, not the flat shape the plan's "read the actual response shape... type only the fields those
return" instruction assumed. This is the same class of bug `public-catalog-routes.ts`'s doc comment
documents for entities, just on value objects instead.

**Why blocked:** not actually blocked — T0.6 was still implementable, but only by embedding
knowledge of the internal nested `props` shape into the frontend, which would violate the
repo-wide non-negotiable rule ("Domain aggregates never go on the wire... every route that returns
an entity must map it through an explicit, fully-primitive DTO", `README.md`).

**Ruling made:** added `toMetricDto` / `toDimensionDto` mapping directly in
`apps/admin/src/http/analytics-routes.ts` (same place `public-catalog-routes.ts` does its own DTO
mapping), with a doc comment explaining the leak, plus `apps/admin/src/http/analytics-routes.test.ts`
pinning the flat shape and the absence of `"props"` on the wire. `apps/admin-web/src/lib/api/analytics.ts`
and `apps/admin-web/src/app/analytics/page.tsx` were then written against the corrected, flat DTOs.
Cost if wrong: a reviewer who disagrees with expanding scope here can revert just
`analytics-routes.ts`/`analytics-routes.test.ts` and have the frontend read the raw nested shape
instead — but that would reintroduce the aggregate-leak the global rule forbids.

## Environment note — `turbo run <task>` at default concurrency crashes on this Windows host

Running `pnpm typecheck` / `pnpm lint` / `pnpm test` (unmodified, default concurrency) at the repo
root crashes immediately with `[ELIFECYCLE] Command failed with exit code 3221225781` (Windows
`STATUS_ACCESS_VIOLATION`) and no per-package output — this reproduced before any Phase 0 code
changes were made, right after `pnpm install`, so it is a pre-existing environment issue, not a
regression. `pnpm exec turbo run <task> --concurrency=4` succeeds. Every package touched in Phase 0
was also verified individually (`pnpm --filter <name> typecheck/lint/test`) and passes; the
reduced-concurrency full run then passed `typecheck`, `lint`, and `test` repo-wide, and `pnpm arch`
passed at default concurrency with no issue. Later phases on this same host should use
`--concurrency=4` (or lower) for repo-wide `turbo` runs rather than the bare `pnpm typecheck && pnpm
lint && pnpm test` the README specifies.

## T2.3 — `POST /public/checkouts/:id/complete` throws for a genuine guest session (pre-existing C-2 limitation, not fixed here)

**Expected:** Phase 2's public checkout surface lets a guest (no `customerRef`) complete a purchase
end-to-end — the exit criteria say "A guest can go cart → checkout → confirmation in the running
app," and T2.3 explicitly has `POST /public/checkouts` **drop `customerRef`** so a guest session
never has one.

**Found:** `OrderCreationAdapter.create()` (`apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts:71-78`),
the real `OrderCreationPort` `wireAdmin` unconditionally wires in for `CompleteCheckout`, throws a
plain `Error` (not a `DomainError`) whenever `input.customerRef === undefined`. Its own doc comment
already documents this as a known, deliberate C-2 scope boundary: "guest checkout cannot complete
an order today... needs a product decision... before it can be closed." `CompleteCheckout.execute()`
(`services/checkout/src/application/complete-checkout.use-case.ts`) has no try/catch around the
`orderCreation.create()` call, so this plain `Error` propagates as a rejected promise rather than an
`err(DomainError)` `Result` — it is not translated into a clean 4xx by `present()`, and only the
transport's generic error handler stops it from being an unhandled rejection.

**Why blocked:** not blocked at the T2.3 (routes) level — `public-checkout-routes.ts` is built
exactly per spec, guest-only, and every route it defines works correctly for the parts of the flow
that don't require order materialization (start/get/items/addresses/shipping/tax/payment-selection/
recalculate/payment-intent-request all tested and passing for a true guest session with no
`customerRef`). The gap is specifically `complete()` for a session where `session.isGuest` is
`true`, which is every session this public surface can ever create. Fixing it means changing
`OrderCreationAdapter` or `CreateOrderFromCheckout`'s `customerRef` contract — exactly the "product
decision" the adapter's own doc comment says was deliberately left unmade, and out of Phase 2's task
list (T2.1-T2.6 name only `get-checkout-session`, `composition.ts`, `public-checkout-routes.ts`, and
the storefront — never `order-creation.adapter.ts` or Orders).

**Suggested fix:** one decision from a human is needed on how Orders should represent a guest order:
(a) widen `CreateOrderFromCheckout`'s `customerRef` to `string | undefined` and let Orders represent
a guest order with no customer record, or (b) require the storefront to create/attach a lightweight
guest customer record before `startCheckout`, giving every session a real `customerRef`. Until one
of these lands, `public-checkout-routes.test.ts` documents the current behavior directly (a guest
`complete()` call rejects) rather than asserting a successful completion, and
`apps/storefront/src/app/checkout/confirmation/page.tsx` (T2.6) should be built to render whatever
`complete` actually returns today (including surfacing the failure state) rather than assuming
success.

## Environment note (Phase 2 addendum) — the `turbo` binary itself does not run in this session

The previously-documented workaround (`pnpm exec turbo run <task> --concurrency=4`) does not work in
this session: even `pnpm exec turbo --version` crashes immediately with no output (PowerShell
`$LASTEXITCODE -1073741515`, `STATUS_DLL_NOT_FOUND`) — reproduced at `--concurrency=4` and
`--concurrency=1`, with and without the shell sandbox, so it is not a concurrency issue, it is the
`turbo` native binary failing to load in this environment. This is a step further than the
pre-existing Phase 0 finding above (which could still run `turbo` at reduced concurrency).

Phase 2 verification for every touched package was therefore done exclusively via
`pnpm --filter <name> typecheck/lint/test`, not a repo-wide `turbo` run:

- `@platform/checkout`: typecheck ✓, test ✓ (31 passed)
- `@platform/admin`: typecheck ✓, lint ✓, test ✓ (234 passed)
- `storefront`: typecheck ✓, lint ✓, test ✓ (95 passed)
- `pnpm arch` (depcruise, does not go through `turbo`): ✓, twice, default concurrency

A later session (or a human) on a host where `turbo` actually runs should do one repo-wide
`typecheck && lint && test && arch` pass to confirm nothing outside these three packages regressed
— nothing in Phase 2 touched any other package, so this is expected to be clean, not verified here.

## T3.3 — Customer 360 `Map`-over-the-wire gap and journey cards omitted (not blocked, judgment calls)

**Expected:** T3.3 wires four Customer 360 GET endpoints into the customer detail page: unified
profile, identity timeline, and the two `visitorId`-keyed journey endpoints (timeline + state).

**Found (1) — `profile.fields`/`freshness`/`sources` serialize as `{}` on every real response.**
`GetCustomerProfileOutput.freshness`/`.sources` (`services/customer-360/src/application/
get-customer-profile.use-case.ts`) and `CustomerProfile.fields` (`services/customer-360/src/
domain/customer-profile.ts`) are typed `ReadonlyMap` on the backend. `present()`
(`services/customer-360/src/interfaces/presenter.ts`) returns the use-case output verbatim, and
`packages/http/src/server.ts`'s route handler sends it with `reply.status(...).send(response.body)`
— Fastify's default `JSON.stringify`-based serializer, which has no `Map` support and always
serializes a `Map` as `{}` (no own enumerable properties), regardless of how many entries it
holds. Verified directly against the real `GetCustomerProfile`/`mergeProfiles` code path, not
guessed — same class of wire-shape gap `apps/admin-web/src/lib/api/finance.ts`'s `Balance`
doc comment documents for T3.2, just an always-empty object instead of a mis-nested one. Unlike
the Finance case, there is nothing to unwrap here: the entries are genuinely gone by the time the
response body exists, not just nested one level deeper.

**Why not blocked:** the frontend (`apps/admin-web/src/lib/api/customer-360.ts`,
`components/customers/customer-profile-card.tsx`) still types and renders these fields generically
(`Readonly<Record<string, unknown>>`, walked with `Object.entries`) rather than hard-coding
today's emptiness or fabricating field data that was never on the wire. The "Unified profile" card
correctly shows the "no field-level data available" state for every real profile today; the moment
the backend is fixed, the same frontend code renders real fields with no further change.

**Suggested fix:** one decision from a human — either give `present()` (or the two use-cases) a
`Map`-to-object conversion step before the value leaves `services/customer-360`, or register a
Fastify reply serializer that understands `Map`, matching whichever convention Finance's `Balance`
gap eventually gets fixed with, since both are instances of the same "domain value type doesn't
survive the default JSON boundary" class of bug.

**Found (2) — the journey cards (`fetchJourneyTimeline`/`fetchJourneyState`) are never called
from the customer detail page.** Both `/customer-360/journeys/:visitorId/*` routes key on
`visitorId`, but `CustomerDetailDto` (`apps/admin-web/src/lib/api/customers.ts`) — the shape
`GET /customers/:customerId` actually returns — carries no visitor id field at all, and nothing
else on the page resolves a customer id to a visitor id.

**Why not blocked:** T3.3's own brief anticipated exactly this ("if the customer record does not
carry a visitor id, do not fabricate one... render the journey cards only when a visitor id is
actually available, and omit them otherwise"). `fetchJourneyTimeline`/`fetchJourneyState` are
still implemented in `lib/api/customer-360.ts` (with tests) for reuse once a real visitor id is
reachable from this page; they are simply not invoked in `app/customers/[customerId]/page.tsx`
today, per that instruction, rather than being wired up with a fabricated or misused identifier
(e.g. passing `customerId` where a `visitorId` is required, which `identity-timeline`'s own
identifier-type enum would not even catch since `visitorId` is a raw path segment, not a
`identifierType`-validated one).

**Suggested fix:** if a customer ↔ visitor id linkage becomes available (e.g. via the Identity
Engine's own resolved cluster, already computed once per profile fetch in `GetCustomerProfile`'s
`mergedFrom`, which does return `visitor_id`-typed members when the cluster has one), a later task
can read `profileResult.data.mergedFrom` for an entry with `type === "visitor_id"` and pass its
`value` into the two journey fetchers — no backend change required for that path, just a frontend
follow-up outside T3.3's scope.

## Note — `/analytics` not verified in a live browser

No Docker is available in this environment (`docker: command not found`), so the infra stack
(`pnpm dev:up:infra`) could not be started to run `apps/runtime` + `admin-web` together for a live
check of the rewritten `/analytics` page. Verification for T0.6 is via `pnpm --filter admin-web
typecheck/lint/test` and the new `apps/admin/src/http/analytics-routes.test.ts` route-level DTO
tests, not a browser session. A later phase (or a human) with Docker available should load
`/analytics` once to confirm the two tables render against real Finance semantic-layer data.

## T4.3 — Search's "query endpoint" is a write (analytics logger), not a read; no GET query-execution route was built

**Expected:** the Phase 4 plan's T4.3 note states `POST /search/indexes/:indexId/queries` "is the
query endpoint" and that, being a read, it should gain a `GET /search/indexes/:indexId/queries`
counterpart taking the query in the querystring (cacheable/shareable/retry-safe), keeping the POST
for oversized queries.

**Found:** that POST route (`apps/admin/src/http/search-routes.ts`) delegates to
`admin.search.logQuery` → `LogQuery` (`services/search/src/application/search.use-cases.ts`), whose
own doc comment says exactly what it does: "Logs a search query for analytics
(`search.query.logged`) — pure logging, no state mutation" — it raises a domain event and is
persisted through the same `unitOfWork.run()` / `indexes.save()` write path every other mutation in
this file uses. It does not execute a query against an index and does not return search results.
Confirmed by reading `IndexProviderPort` (`services/search/src/application/ports.ts`): it declares
only `upsert(document)` and `delete(productRef)` — there is no `query`/`search` method on the port
at all, so no code path in this service can execute a search and return matching documents.

**Why blocked:** not blocked for the buildable half — `GET /search/indexes` (list) and
`GET /search/indexes/:indexId` (get), which the same note also asks for, were built exactly as
specified (repository `list` → `ListIndexes`/`GetIndex` use cases → controller → AdminGuard wrapper
→ routes, permission `search:read`, DTO-mapped, tested). But converting the "query" write into a
`GET` would be wrong on two counts: (1) there is no query-execution result to return — a GET
built now could only echo the request back or return nothing, which is indistinguishable from a
fake result and violates the repo-wide "never fabricate data" rule; (2) `LogQuery` is a genuine
write (it appends to the event/audit trail), and moving a write onto GET breaks the very safe/
idempotent/cacheable property the plan's note was trying to add. This is the same class of gap as
T4.20 Reporting ("no data source, and a list endpoint will not change that") — recorded per G-8's
own scope, one context earlier than Reporting hits it.

**Suggested fix:** the real fix is out of scope for a "read side" phase — it needs
`IndexProviderPort.query(term, page): Promise<Paginated<SearchDocument>>` (or similar) wired to a
real OpenSearch/pgvector backend (ADR-0020, still a deferred build milestone per
`services/search/src/composition.ts`'s doc comments), plus a new `ExecuteSearchQuery` use case that
calls it and *separately* calls `LogQuery` for the analytics side-effect. Once that port method
exists, `GET /search/indexes/:indexId/queries` can be added exactly as the original note describes.
Until then, the POST route is left as pure analytics logging, unrenamed, so nothing implies it
returns results it cannot produce.

## T4.19 — Platform Console has no persistent aggregate; the recipe does not apply, and the read already exists

**Expected:** T4.19 says "Has no repository files today; inspect what it actually stores before
assuming the recipe applies. If it holds no persistent aggregate, record that in
`docs/plans/BLOCKERS.md` and skip it rather than inventing storage."

**Found:** confirmed by reading every file in `services/platform-console/src/` — there is no
`domain/`, no repository, no aggregate, no Prisma model, no in-memory store keyed by id. The
entire context is `PlatformKpisProjection` (`read-model/projection.ts`), a single in-process
in-memory object (`private snapshot: PlatformKpis`) that folds Tenancy/Licensing/Usage/System
integration events into one running KPI snapshot (MRR/ARR/tenant counts/usage/etc.,
`read-model/platform-kpis.ts`). There is exactly one thing to read — the current snapshot — not a
collection of records with ids, so "list" and "get by id" are not meaningful operations here; the
`list`/`get` recipe (repository → use case → controller → route, cursor-paginated) has no target
to apply to.

**Why blocked:** not blocked — the read this context needs already exists end-to-end:
`PlatformConsoleController.getKpis()` → `PlatformConsoleAdminController.getKpis()` (permission
`platform-console:kpis:read`) → `POST /platform/kpis` (`apps/admin/src/http/
platform-console-routes.ts`). No new work was needed or done.

**Note on the `POST` verb:** the route's own doc comment already flags this as deliberate: "exposed
to platform staff via `POST /platform/kpis` (the report's own literal text; a read/query operation
kept as `POST` here to match what was actually built, not 'corrected' to a more idiomatic verb)."
Left unchanged here for the same reason — renaming an existing, working, permission-gated route is
outside this phase's mandate (add reads, don't reformat what already works) and risks breaking
whatever caller already depends on the `POST` path.

**Suggested fix:** none needed for the read side. If a future phase wants `GET /platform/kpis` for
REST-verb consistency, that is a routing-convention cleanup, not a missing-capability gap — a
one-line addition (a second `defineRoute` with `method: "GET"` delegating to the same
`getKpis()`), not a repository build-out.

## Note — Phase 3 screens not verified in a live browser

Same root cause as the `/analytics` note above: no Docker in this environment, so
`apps/runtime` + `admin-web` could never be run together to load a page in a real browser. All
six Phase 3 tasks (Security Console, Finance, Customer 360, Feature Registry, Licensing usage
counters, Media download links) were verified at the code/test level only —
`pnpm --filter admin-web typecheck && lint && test` (clean throughout, 279 tests passing after
T3.6) plus manual grep/read confirmation that every endpoint from each task's route file has a
matching `fetch…` function and is rendered somewhere on the corresponding page. This is why the
five domain-specific bullets under "Phase 3 exit criteria" below (23 security GETs reachable,
finance statements render, Customer 360 data appears, feature registry visible, usage counters
render) are left unticked even though the wiring is complete — they assert something visible in
a running app, which nothing in this environment can confirm. A later session (or a human) with
Docker available should load `/security`, `/finance`, a customer detail page, `/feature-registry`,
and `/settings` once each to close these out.

## T4.20 — Reporting: `AnalyticsReport` read endpoints deliberately not built (pointer: G-8)

**Expected:** T4.20's note says building read endpoints for report *definitions* is in scope
("an operator should see what reports exist. Do that.") but explicitly warns off building an
endpoint that executes/reads a report's results: "there is no populated read store and no CDC
pipeline in this codebase. Do not build one, do not wire a fake, and do not let a screen imply
results are real. Record the gap in `docs/plans/BLOCKERS.md` with a pointer to G-8."

**Found:** `AnalyticsReport` (`services/reporting/src/domain/analytics-report.ts`) is a write-once
run record — created only via `recordSuccess`/`recordFailure`, no update path
(`PrismaAnalyticsReportRepository.save` only ever calls `.create`, never `.updateMany`). Its
`resultData` comes straight from `GenerateReport.execute()`
(`services/reporting/src/application/reporting.use-cases.ts`) calling
`this.deps.analytics.run(...)` — the injected `AnalyticsQueryPort`. In `wireReporting`
(`services/reporting/src/composition.ts`), `deps.analytics` defaults to `InMemoryAnalyticsQuery`
(`services/reporting/src/infrastructure/in-memory-analytics-query.ts`) whenever no real adapter is
supplied, and no caller in `apps/admin/src/composition.ts` supplies one — so every `AnalyticsReport`
this codebase can currently produce carries fake/empty `resultData` (`rows: []`
unconditionally), exactly the "no populated read store, no CDC pipeline" gap `docs/KNOWN_GAPS.md`
G-8 already documents (status: "designed", not built — deferred behind a real
`@platform/analytics` adapter, tracked as G-39 in the composition root's own doc comments).

**Ruling made:** built `list`/`get` for `ReportDefinition` and `Dashboard` only (repository port →
in-memory + Prisma impl → `ListReportDefinitions`/`GetReportDefinition`/`ListDashboards`/
`GetDashboard` use cases → `ReportingController` → `ReportingAdminController` (permission
`reporting:read`) → `GET /reporting/report-definitions[/:id]` and
`GET /reporting/dashboards[/:id]` in `apps/admin/src/http/reporting-routes.ts`, DTO-mapped, tested
at all three layers). Deliberately did **not** add `list`/`get` for `AnalyticsReport` — doing so
would either surface the permanently-empty fake `resultData` as if it were real report output, or
require wiring a fake read path, both of which the task's own note forbids. `docs/KNOWN_GAPS.md`
G-8 should stay "designed"/unclosed for the `AnalyticsReport` read side specifically until a real
`AnalyticsQueryPort` adapter (G-39) exists; only then does an `AnalyticsReport` `list`/`get`
endpoint have real data to serve.

**Suggested fix:** once a real `@platform/analytics` adapter is wired into `wireReporting`'s
`analytics` dep (G-39), add `AnalyticsReportRepository.list`/`findById`-backed reads the same way
as this task's `ReportDefinition`/`Dashboard` pair — the repository port, mapper, and Prisma model
(`AnalyticsReport`, already tenant-scoped in `packages/db/prisma/schema/*.prisma`) all already
exist and need no schema change, only the `list` method and the use-case/controller/route
plumbing this task added for the other two aggregates.

## Phase 4 exit — repo-wide `turbo` verification re-confirmed broken in this session; per-package verification used instead

Re-tested both previously-documented Windows `turbo` failures at Phase 4's close, exactly as the
exit criteria's `pnpm typecheck && pnpm lint && pnpm test && pnpm arch` line asks:

- `pnpm typecheck` (root, `turbo run typecheck` under the hood) — `[ELIFECYCLE] Command failed with
  exit code 3221225781` (Windows `STATUS_ACCESS_VIOLATION`), same as the Phase 0 finding above, no
  per-package output.
- `pnpm exec turbo run typecheck --concurrency=4` (the Phase 0 workaround) — now also fails:
  `node.exe: error while loading shared libraries: ?: cannot open shared object file` (exit 127),
  the same class of failure as the Phase 2 addendum's `STATUS_DLL_NOT_FOUND` finding (the `turbo`
  binary/its child `node` invocation not loading correctly in this session), just a different
  concrete symptom. Confirms this is a standing environment limitation of this host/session, not
  something that regressed during Phase 4.

`pnpm arch` (depcruise, does not go through `turbo`) **does** run at the repo root and was run
successfully at Phase 4's close: `no dependency violations found (1633 modules, 7441 dependencies
cruised)`.

Verification for Phase 4 was therefore done exclusively via `pnpm --filter <name>
typecheck/lint/test` per touched package, for every one of T4.1–T4.20 individually before that
task's checkbox was marked done (not batched at the end) — the same approach the Phase 2 addendum
above used, just applied continuously through 20 tasks instead of once at the end. The two packages
every task touched, `@platform/admin` and the relevant `services/<domain>` package, were both green
(typecheck/lint/test) at every task boundary; the final state was re-confirmed once more here for
`@platform/reporting` (13 passed, 2 skipped — Prisma integration tests gated on
`DATABASE_URL_TEST`, not present) and `@platform/admin` (261 passed).

A later session (or a human) on a host where `turbo` actually runs should do one repo-wide `pnpm
typecheck && pnpm lint && pnpm test` pass to confirm nothing outside the touched packages
regressed — nothing in Phase 4 touched any package outside the 19 `services/<domain>` packages and
`@platform/admin`, so this is expected to be clean, not verified here.

## T5.1 — Brand/category pickers are plain id inputs, not pickers; no `GET /brands` route exists and `GET /categories` returns a raw domain aggregate

**Expected:** T5.1's brief asks for a brand `<select>` and a category checklist on the Product
Detail write screen, backed by `fetchBrands`/`fetchCategories` list calls, scoped to just what
those two pickers need (T5.7 owns the full brand/category CRUD screens later).

**Found (1) — no `GET /brands` route.** `admin-routes.ts` defines only `POST /brands` (create),
`POST /brands/:brandId` (rename), and `POST /brands/:brandId/delete` — no list/get route exists to
build `fetchBrands` against at all.

**Found (2) — `GET /categories` exists but returns the raw `Category` domain aggregate, not a
DTO.** Unlike every product route (`toProductListItemDto`/`toProductDetailDto` in
`admin-routes.ts`), the categories route's handler is a one-line passthrough:
`admin.products.listCategories(context.principal, query)` → `CategoryController.list` →
`present(await listCategories.execute(input), 200)` (`services/catalog/src/interfaces/
presenter.ts`), which sends `result.value` — a `Paginated<Category>` — straight onto the wire with
no mapping step. `Category extends AggregateRoot<CategoryProps> extends Entity<CategoryProps>`
(`packages/domain/src/shared/{aggregate/aggregate-root,entity/entity}.ts`) stores its data in
`props`/`_id` fields that are `protected`/`private` only at compile time — at runtime they are
ordinary own enumerable properties with no `toJSON` anywhere in the chain — so the real wire shape
would be the same `{"props": {...}, "_id": {"props": {"value": "..."}}}` nesting (plus a
`_domainEvents` array and a `_version` from `AggregateRoot`) that `docs/plans/BLOCKERS.md`'s T0.6
entry already found and fixed once for Analytics' `Metric`/`DimensionDefinition`, and that T3.3's
`Map`-over-the-wire entry documents a sibling instance of for Customer 360.

**Why not blocked:** not actually blocked — the screen ships without either backend gap fixed.
Building a typed `fetchCategories` against an undocumented, leaky aggregate shape would mean
hand-coding knowledge of `Category`'s internal `props`/`_id` layout into `admin-web`, which is
exactly the "domain aggregates never go on the wire" violation the repo-wide rule forbids (and the
brief's own T0.6/T3.3 precedent treats as a bug to route around, not to encode). `lib/api/
products.ts`'s doc comment and `product-organization-card.tsx`'s doc comment both record this.

**Ruling made:** the brief's own brand fallback ("if a brands list GET route is not visible... note
it here and render the brand field as a plain text input for the brand id instead") is applied to
both fields. `ProductOrganizationCard`'s brand field is a plain `brandId` text input
(`setProductBrandAction`), and its categories field is a plain comma-separated `categoryIds` text
input (`assignProductCategoriesAction`, full replace) — both send exactly the primitive
`string`/`string | null`/`string[]` bodies `admin-routes.ts`'s zod schemas expect, with no aggregate
parsing involved. This matches the read side's own existing discipline: `ProductOrganizationCard`
already rendered raw category/brand ids (not resolved names) before this task, for the identical
reason ("no cross-context join here... shows the honest reference rather than inventing a resolved
name").

**Suggested fix:** T5.7 (Categories and brands, no UI yet) is the natural place to fix both gaps at
once, since it needs real list reads anyway: (a) add `toCategoryDto`/a category list DTO mapper in
`admin-routes.ts`'s `/categories` handler, the same pattern `toProductListItemDto` already uses;
(b) add a `GET /brands` route (list/cursor-paginated) with its own DTO mapper. Once both exist,
`apps/admin-web/src/lib/api/categories.ts` and `brands.ts` can be added with real `fetchCategories`/
`fetchBrands` functions, and this task's two plain-text inputs can become a `<select>` and a
checklist with no change to the write actions themselves (they already send the right primitive
shapes).

**Resolved by T5.7:** both backend gaps are fixed — `ListBrands` (use-case/`BrandController.list`/
`ProductsAdminController.listBrands`), a new `GET /brands` route (`brands:read`), and a
`toCategoryDto`/`toBrandDto` mapping applied to `GET /categories`/`GET /brands` in
`admin-routes.ts`. `apps/admin-web/src/lib/api/categories.ts` and `brands.ts` now exist with real
`fetchCategoriesPage`/`fetchBrandsPage` functions, and `ProductOrganizationCard`'s brand field is a
real `<select>` and its categories field is a real checklist, both populated from the parent server
component (`app/products/[productId]/page.tsx`) — no client-side fetch, per the "never call the
runtime API from browser JS" rule. Capped to the first page of each list (no search-as-you-type
picker); a currently-assigned id outside that page still renders as its own option so a save can
never silently drop it.

## T5.3 — Returns list screen not built; backend has no `GET /returns` and no `GET /returns/:returnId`

**Expected:** the Phase 5 backlog's T5.3 note says "Give returns their own list and detail
screens."

**Found:** `services/returns/src/interfaces/returns.controller.ts` and
`apps/admin/src/http/returns-routes.ts` expose exactly one read route — `GET
/orders/:orderId/return`, keyed by `orderRef`, already wired read-only into `OrderReturnsCard`
before this task. There is no `GET /returns` (list, paginated, filterable by status) and no `GET
/returns/:returnId` (get by the return's own id) anywhere in the returns HTTP surface — the 8
routes this task actually adds write functions for are all `POST`, and the one existing `GET` only
resolves a return by the order it belongs to.

**Why blocked:** building a "Returns list" screen, or a detail screen reachable by the return's own
id, would mean either fabricating a list/by-id read the backend cannot serve or inventing a new
backend endpoint — both against `docs/plans/README.md` rule 4 ("never fabricate data") and outside
this frontend-only task's scope (`docs/plans/README.md`'s global constraints: `apps/*` build
against routes that exist, they don't add new ones on the backend as a side effect of a frontend
task).

**Ruling made:** built the **detail** screen only, keyed by `orderId` — the one key the backend
actually supports — at `apps/admin-web/src/app/orders/[orderId]/returns/page.tsx`, reached via a
"Manage return" / "Open a return" link from `OrderReturnsCard` on the Order Detail page. No
`/returns` list screen and no by-return-id route were built. All 8 write routes
(`create`/`decision`/`rma`/`receive`/`inspection`/`accept`/`transitions`/`resolution`) are wired
into this one screen, gated by `apps/admin-web/src/lib/return-lifecycle.ts`'s hand-kept copy of
`services/returns/src/domain/value-objects/return-status.ts`'s `TRANSITIONS` table.

**Suggested fix:** add `GET /returns` (list, cursor-paginated, filterable by status — same shape as
`GET /orders`) and `GET /returns/:returnId` (get by id) to `services/returns`' read side and
`returns-routes.ts`, DTO-mapped through the same `toReturnDetailDto` the existing `getByOrder`
handler already uses. Once both exist, a `/returns` list screen (with a link to
`/returns/:returnId`, or this task's existing `/orders/:orderId/returns` screen could simply add a
returnId-keyed alternate route) can be added with no change needed to the 8 write functions this
task already built in `apps/admin-web/src/lib/api/returns.ts` — they are keyed by `returnId`
already, independent of how the operator navigates to a given return.

## T5.4 — Fulfillment and Shipping have no list-all and no get-by-own-id routes either (same gap as T5.3, both domains)

**Expected:** the Phase 5 backlog's T5.4 note says Fulfillment and Shipping's 6 + 8 routes are
"both read-only inside order detail today," implying full write screens should follow — the
brief's own ruling (already resolved before this task started) anticipated the same "no list
screen" situation T5.3 hit for Returns and pre-emptively scoped this task to detail screens only.

**Found:** `services/fulfillment`/`apps/admin/src/http/fulfillment-routes.ts` and
`services/shipping`/`apps/admin/src/http/shipping-routes.ts` each expose exactly one read route —
`GET /orders/:orderId/fulfillment` (keyed by `orderRef`) and `GET
/fulfillments/:fulfillmentOrderId/shipment` (keyed by `fulfillmentRef`) respectively, both already
wired read-only into `OrderFulfillmentCard`/`OrderShippingCard` before this task. There is no `GET
/fulfillments` (list) and no `GET /fulfillments/:fulfillmentOrderId` (get by the fulfillment
order's own id) anywhere in the fulfillment HTTP surface; there is likewise no `GET /shipments`
(list) and no `GET /shipments/:shipmentId` (get by the shipment's own id) anywhere in the shipping
HTTP surface. Every other route in both files is `POST` (5 fulfillment writes, 7 shipping writes).

**Why blocked:** building a "Fulfillment" or "Shipping" list screen, or a detail screen reachable
by the fulfillment order's/shipment's own id, would mean either fabricating a list/by-id read the
backend cannot serve or inventing new backend endpoints — both against `docs/plans/README.md` rule
4 ("never fabricate data") and outside this frontend-only task's scope.

**Ruling made (already decided in the task brief before implementation started):** built two
**detail** screens only, both keyed by `orderId` — the one key actually reachable end-to-end —
`apps/admin-web/src/app/orders/[orderId]/fulfillment/page.tsx` and
`apps/admin-web/src/app/orders/[orderId]/shipment/page.tsx`. The shipment screen additionally
chains through the fulfillment order first (`fetchFulfillmentByOrder` → `fetchShipmentByFulfillment`,
the same two-hop read `OrderShippingCard` already used) and renders an explicit "not yet fulfilled"
message with no create-shipment form at all when no fulfillment order exists — per the ruling, "if
there is no fulfillment yet, there cannot be a shipment either." No `/fulfillments` or `/shipments`
list screens, and no by-fulfillment-id/by-shipment-id alternate routes, were built. All 5
fulfillment write routes (`create`/`transitions`/`reserve`/`shipments`/`webhook`) and all 7
shipping write routes (`create`/`transitions`/`label`/`label-void`/`tracking`/`retry`/`webhook`)
are wired into these two screens, gated by `apps/admin-web/src/lib/fulfillment-lifecycle.ts` and
`apps/admin-web/src/lib/shipping-lifecycle.ts`'s hand-kept copies of
`services/fulfillment/src/domain/value-objects/fulfillment-status.ts` and
`services/shipping/src/domain/value-objects/shipment-status.ts`'s `TRANSITIONS` tables.

**Suggested fix:** add `GET /fulfillments` + `GET /fulfillments/:fulfillmentOrderId` to
`services/fulfillment`'s read side and `fulfillment-routes.ts`, and `GET /shipments` + `GET
/shipments/:shipmentId` to `services/shipping`'s read side and `shipping-routes.ts` — same
cursor-paginated list + DTO-mapped get-by-id shape as `GET /orders`, reusing
`toFulfillmentDetailDto`/`toShipmentDetailDto` (already defined in each routes file for their
existing `getByOrder`/`getByFulfillment` handlers). Once both exist, list screens (each linking to
a fulfillment-order-id-keyed or shipment-id-keyed alternate detail route) can be added with no
change needed to the write functions this task already built in
`apps/admin-web/src/lib/api/fulfillment.ts`/`shipping.ts` — they are keyed by
`fulfillmentOrderId`/`shipmentId` already, independent of how the operator navigates to a given
record.

## T5.5 — No `GET /warehouses` list route exists; warehouse ids are plain text inputs (same gap class as T5.1's brand/category finding)

**Expected:** T5.5 wires the 6 Inventory routes (`receive`/`adjust`/`reserve`/`release`/`commit`/
`transfer`) plus the 2 warehouse-registry routes (`register`/`deactivate`) into new write screens.

**Found:** `admin-routes.ts` defines exactly `POST /warehouses` (register) and `POST
/warehouses/:warehouseId/deactivate` for the warehouse registry — there is no `GET /warehouses` (or
any warehouse list) route anywhere in this codebase. `ProductInventoryCard`'s existing read (`GET
/products/:productId/inventory`) returns one row per warehouse the product already has stock rows
in, but that is a stock-by-product view, not a warehouse registry — it only ever shows warehouses a
given product already has activity in, not the full set of registered warehouses, and it returns
nothing at all for a product with no stock anywhere. This is the identical shape of gap
`docs/plans/BLOCKERS.md`'s T5.1 entry already found for brand/category: a write screen needs a
picker for an id space, and no list endpoint exists to build one against.

**Why not blocked:** not actually blocked — this task's own brief pre-emptively ruled on it before
implementation started (same as T5.4's brief pre-empted the fulfillment/shipping list-screen gap).
Building a warehouse `<select>` against `ProductInventoryCard`'s per-product inventory rows would
mean fabricating a "known warehouses" list out of data that only reflects one product's stock
history, in a fresh product's case an empty list — exactly the "never fabricate data" violation
`docs/plans/README.md` rule 4 forbids, and outside this frontend-only task's scope to fix by adding
a new backend endpoint.

**Ruling made (already decided in the task brief before implementation started):** every
`warehouseId`/`sourceWarehouseId`/`destinationWarehouseId` field across both new screens
(`ProductInventoryTable`'s per-row receive/adjust forms and its standalone "receive at a warehouse"
form, plus the Inventory operations console's register/deactivate/transfer/reserve/release/commit
forms) is a plain text input for the operator-typed id, not a picker — the same fallback
`ProductOrganizationCard`'s brand/category fields use per the T5.1 ruling. The operations console
(`app/inventory/page.tsx`) itself has no read/list backing it at all and renders as independent
forms with their own success/error feedback, not a shared table, for the same reason.

**Suggested fix:** add a `GET /warehouses` route (list, cursor-paginated, DTO-mapped) to
`services/inventory`'s warehouse registry read side and `admin-routes.ts` — `WarehouseController`
(`services/inventory/src/interfaces/warehouse.controller.ts`) already has `register`/`deactivate`
use-cases wired; it would need a `list` use case and repository method added, same shape as T5.1's
suggested `GET /brands` fix. Once it exists, `apps/admin-web/src/lib/api/inventory.ts` can add a
`fetchWarehouses` function and every plain-text `warehouseId` input above can become a `<select>`
with no change needed to the 8 write functions this task already built — they are keyed by
`warehouseId` string already, independent of how the operator selects one.

## T5.6 — No `GET` route exists anywhere in the Pricing domain; every id field is a plain text input (same gap class as T5.1's brand/category and T5.5's warehouse findings)

**Expected:** T5.6 wires the 7 Pricing routes (create/activate price list, create/change/publish
price, create tax class, create pricing rule) into a new operations console.

**Found:** `admin-routes.ts` lines ~1432-1502 define exactly those 7 `POST` routes for prices,
price lists, tax classes, and pricing rules — there is no `GET` route anywhere in this domain: no
list, no get-by-id, for any of the four record types. This is a bigger gap than either prior
finding: T5.1's brand/category at least has `GET /categories` (returning a raw aggregate, itself a
separate finding), and T5.5's warehouse gap at least has `ProductInventoryCard`'s indirect
per-product read. Pricing has no read path of any kind, direct or indirect.

**Why not blocked:** not actually blocked — this task's own brief pre-emptively ruled on it before
implementation started (same as T5.4's and T5.5's briefs pre-empted their own list-screen gaps).

**Ruling made (already decided in the task brief before implementation started):** every
`priceListId`/`productId`/`priceId`/`taxClassRef` field across the Pricing operations console
(`app/pricing/page.tsx`) is a plain text input for the operator-typed id, not a picker, the same
fallback `ProductOrganizationCard`'s brand/category fields and the Inventory console's warehouse
fields use per the T5.1/T5.5 rulings. Because there is also no way to browse back to a created
record afterward, `createPriceList`/`createPrice`/`createTaxClass`/`createPricingRule`
(`apps/admin-web/src/lib/api/pricing.ts`) each read the `id` off their create response (same
`isCreatedProduct`-style guard as `lib/api/products.ts`, since none of these handlers map the
response through a DTO) and the console's four "create" forms
(`components/pricing/pricing-operations-forms.tsx`) render that id as selectable text after a
successful submit — the only way an operator will ever see it.

**Suggested fix:** add cursor-paginated, DTO-mapped `GET /price-lists`, `GET /prices`, `GET
/tax-classes`, and `GET /pricing-rules` list routes (plus get-by-id where useful) to
`services/pricing`'s read side and `admin-routes.ts`, same shape as T5.1's suggested `GET /brands`
fix and T5.5's suggested `GET /warehouses` fix. Once any of them exist, the corresponding plain-text
id fields above can become pickers and the created-id notices can link to a real detail view, with
no change needed to the 7 write functions this task already built — they are keyed by id strings
already, independent of how the operator selects or discovers one.

## T5.13 — Live dashboard: only the Revenue KPI has a real data source; Orders-count/AOV/Conversion Rate, Sales Overview, Top Products, and Sales By Channel stay demo (per-tile, not per-page)

**Expected:** `apps/admin-web/src/data/dashboard.ts` returned one page-wide `provenance: "demo"`
flag; the task asked to convert the dashboard tile by tile, giving each section (KPIs/Sales
Overview/Top Products/Sales By Channel) its own accurate `provenance`, live where a real source
exists and honestly labelled demo where it doesn't, never flipping a tile to `"live"` while it
still reads sample data. The pre-task research (`docs/plans/.progress/task-T5.13-brief.md`) named
three candidate live sources: Finance (`GET /finance/income-statement`), Orders (`GET /orders`),
and Catalog (`GET /products`).

**Found — the old single flag was actively hiding real functionality, not just imprecise.**
`app/page.tsx`'s only branch was `data.provenance === "demo" ? <banner + Recent Orders> : <full
page>`, and `getDashboardData()` always returned `"demo"` — so the KPI row, Sales Overview chart,
Top Products table, and Sales By Channel donut never rendered at all, not even with sample data.
Splitting `DashboardData` into per-section (`kpis`/`sales`/`topProducts`/`channels`) and per-KPI
(within `kpis`) `provenance` fixes this regardless of how many tiles end up live: every section now
renders unconditionally, tagged "Live" or "Demo" per its own honest status.

**Found — Revenue is the only tile with a real backend source.** `fetchIncomeStatement` (T3.2,
`lib/api/finance.ts`) already returns real revenue/cogs/expenses/netIncome for an arbitrary date
range. `getDashboardData()` now calls it twice per request (current period + comparison period, in
parallel) and computes the Revenue KPI's value and delta from the real response, with
`provenance: "live"`. Its `trend` sparkline is deliberately left empty (`[]`) rather than
fabricated: Finance has no daily-granularity endpoint, and building one from 7+ separate
income-statement calls per page load was judged not worth the request fan-out for a decorative
sparkline (`Sparkline` already renders nothing for fewer than 2 points, so an empty trend is a
correct "no trend" state). Any non-`"ok"` outcome (network error, unauthorized, unexpected shape)
falls back to the demo Revenue figure, still truthfully labelled `provenance: "demo"` — a fetch
failure degrades the tile rather than either breaking the KPI row or silently mislabelling stale
data as live.

**Found — Orders-count KPI and the Sales Overview chart cannot go live at all, and the gap is worse
than the brief's own research anticipated.** The brief flagged that `OrdersPageDto.pageInfo` has no
total-count field, only `hasNextPage`/`endCursor`. Re-verified directly against
`apps/admin/src/http/admin-routes.ts`'s `listOrdersQuery` (`z.object({ first, after, status,
search })`, lines ~114-118) and `apps/admin-web/src/lib/api/orders.ts`'s `OrdersListQuery`: **`GET
/orders` has no date-range filter of any kind** — not just no total count. There is no
`createdAfter`/`createdBefore`/`startDate`/`endDate` parameter anywhere on this route. This means
neither the brief's option (a) (a capped "first 100" count with a "100+" qualifier) nor any
period-scoped orders/revenue-by-day aggregation is possible even in principle: a "capped count for
the selected period" cannot be built when the endpoint cannot be scoped to a period at all — it can
only return the N most-recently-placed orders overall, which is a different (and misleading)
question than "how many orders were placed in this 7-day window." Building either tile from this
endpoint would mean either fabricating a period boundary the backend never applied, or silently
mislabelling "most recent N orders" as "orders in the selected period" — both forbidden by
`docs/plans/README.md` rule 4. Both tiles stay demo (`sales.provenance`, and the `orders` /
`averageOrderValue` KPIs' `provenance`, all `"demo"`).

**Found — AverageOrderValue KPI stays demo, per the brief's own explicit rule.** AOV is only
derivable from Revenue ÷ Orders-count when both are live; since Orders-count is demo (previous
paragraph), AOV must stay demo too rather than being half-computed from one real and one fake
number. `data/dashboard.ts`'s `DEMO_AVERAGE_ORDER_VALUE_KPI` is unconditional.

**Found — ConversionRate KPI has no data source anywhere in this codebase.** No
traffic/analytics/session capability exists in any service this frontend can reach — confirmed by
the same G-8 reporting-read-model gap (`docs/KNOWN_GAPS.md`) T4.20's and T4.3's BLOCKERS.md entries
already documented ("no populated read store, no CDC pipeline"). Stays demo unconditionally.

**Found — Top Products has no sales-ranking source.** `GET /products` (`fetchProductsPage`, T5.1)
returns catalog data only — id/sku/name/slug/status/variantCount/price — no `unitsSold`, `views`,
or `conversion`, and no sales-ranking endpoint exists anywhere in this codebase. Re-verified against
`services/catalog`'s and `apps/admin/src/http/admin-routes.ts`'s product routes: nothing computes or
stores per-product sales aggregates. This is the same G-8 gap as ConversionRate. Ranking by a
proxy such as "most recently updated" was considered and rejected — it is not "top selling
products" and would mislead an operator under that label, per the brief's own explicit instruction.
Stays demo unconditionally.

**Found — Sales By Channel has no channel-attribution source.** Neither `OrderListItemDto`/
`OrderDetailDto` (`lib/api/orders.ts`) nor any Finance DTO carries a sales-channel dimension.
Re-verified by reading every field on both DTOs — there is no `channel`/`source`/`origin` field
anywhere in the Orders or Finance wire shapes this frontend can read. Stays demo unconditionally.

**Why not blocked:** not blocked — the task's own instruction anticipated most of the tiles staying
demo ("this is normal, not a failure") and explicitly forbade fabricating data to force them live.
Every one of the four findings above is a genuine absence of backend capability, not a frontend
gap; the task is fully implemented per its own success criterion ("done" means the refactor is
complete and every tile's provenance is accurate, not that every tile is live).

**Ruling made:** `DashboardData` now carries per-section provenance (`kpis.kpis[].provenance` per
KPI, `sales.provenance`, `topProducts.provenance`, `channels.provenance`) instead of one page-wide
flag; `summarizePageProvenance` folds these into a "live"/"demo"/"mixed" reading used only by
`DashboardHeader`'s single badge (today: "mixed", since Revenue is live and everything else is
demo). Every section/KPI now renders unconditionally with its own "Live"/"Demo" tag
(`t.data.liveTag`/`t.data.demoTag`) and, for a still-demo card, a scoped one-line explanation
(`t.sales.demoExplanation`/`t.topProducts.demoExplanation`/`t.channels.demoExplanation`) — replacing
the old all-or-nothing top-of-page banner (which is now shown only in the genuine "everything is
demo" case, e.g. Finance also being unreachable). See
`docs/plans/.progress/task-T5.13-report.md` for the full per-tile table.

**Suggested fix:** (1) Orders-count/Sales Overview: add a date-range filter (`createdAfter`/
`createdBefore` or `startDate`/`endDate`) to `GET /orders`'s query schema and a period-scoped
count/aggregation path in `services/orders`' read side — this is a new capability, not present in
any form today, unlike T5.1/T5.5/T5.6's "list route is entirely missing" gaps. (2) ConversionRate
and Top Products: both need the same G-8 reporting-read-model build-out T4.20/T4.3 already flagged
(a real `AnalyticsQueryPort` adapter, G-39) — Top Products additionally needs a sales-ranking
projection (units sold / views / conversion per product) fed from Orders + a real analytics/traffic
source, which doesn't exist as a concept anywhere in this codebase yet. (3) Sales By Channel needs
a channel dimension added to Orders' domain model (a new field on order creation, not just a new
read), which is a product decision, not a wiring gap. Once any of these land, the corresponding
`provenance: "demo"` literal in `data/dashboard.ts` is the only place that needs to flip to a real
fetch — the per-section/per-KPI plumbing this task built already renders either state correctly.


## T5.16 — Customer account and order history: DESIGN ONLY, no code written

**This entry is a design decision, not an implementation record.** No route, no cookie, no guard,
no use case, and no repository method was added for this task. T5.16's whole deliverable is the
written design below, so a later session can implement T5.16/T5.17/T5.19/T5.18-write directly
against it without re-deriving the same decision four times. **Nothing here is done. Read to the
bottom before assuming any of this exists in the codebase.**

### Why a customer identity decision has to happen before any of these four tasks

The storefront (`apps/storefront`) has no login of any kind today. Confirmed by reading
`apps/storefront/src/app/cart/actions.ts` and `apps/storefront/src/lib/cart.ts`:
`GUEST_SESSION_COOKIE` (`lumo-storefront-guest-session`) is minted by
`currentOrNewSessionRef()` as a bare `crypto.randomUUID()`, HttpOnly, 30-day, with no principal,
no credential, and no server-side identity check behind it — it is proof of *cart ownership*
only (`resolveSessionRef`'s doc comment in `apps/admin/src/http/public-cart-routes.ts`: "never
`customerRef`, never trusted from anywhere but this field"). Reusing or extending it for identity
would let anyone forge access to another customer's orders/wishlist/loyalty balance by
guessing or replaying a cart token — this is the exact vulnerability class H-05/H-01 in this same
file were fixed against for cart data, and order/wishlist/loyalty data is more sensitive, not
less. `GET /orders/:orderId` (admin) is `permission: "orders:read"`, gated behind the full
`AdminGuard`/staff `Principal` — a storefront shopper has no admin principal and never should.

A `Customer` domain entity does already exist
(`services/identity/src/domain/customer.ts`/`customer-repository.ts`): `email`, `name`,
`addresses[]`, an append-only `consents[]` log, created via `Customer.register(id, email, name,
...)`, looked up by `CustomerRepository.findByEmail`/`findById`. It has no password, no session,
no MFA, and no login concept of its own — it is a profile record, not an authenticatable
principal. Separately, `Order.customerRef`, `WishlistRepository.findByCustomerRef`,
`LoyaltyAccountRepository.findByCustomerRef`, and `Review.customerRef` (checked directly in each
domain — `services/orders/src/domain/order.ts:23`, `services/wishlist/src/domain/
wishlist-repository.ts:8`, `services/loyalty/src/domain/loyalty-account-repository.ts:8`,
`services/reviews/src/domain/review.ts:17`) all already key their data off a bare `customerRef`
string — this is Identity's `Customer.id`. So the shape of "what does a customer's own data scope
look like" is already settled across four bounded contexts; what's missing is *how a request
proves it is entitled to a given `customerRef`* at all.

### 1. Authentication flow — recommendation: reuse Security's use cases, do not build a second auth stack

**Recommendation: a new, separate, public-facing authentication surface that reuses Security's
existing `Authenticate`/`EstablishSession`/MFA/session use cases (`services/security/src/
application/{authentication,session,mfa}.use-cases.ts`), unwrapped from `AdminGuard` and wrapped
in a new, much lighter customer-facing guard instead of building customer auth as its own
mechanism from scratch.**

Reasoning:

- Security already owns a complete, tested authentication stack: `RegisterAuthMethod` +
  `Authenticate` (provider-agnostic verification, risk scoring via the Risk Engine, MFA
  decisioning via the MFA Engine, device trust, and — on success — `Session.establish`), plus
  `RefreshSession` (rotates the refresh-token fingerprint, extends TTL), `RevokeSession`/
  `RevokeAllSessions` (logout / force-logout-everywhere), and `IntrospectSession` (read-only
  validity check). All of it is domain-tested (`session.use-cases.ts`, `authentication.use-cases.ts`,
  the various `*.e2e.test.ts` files in `services/security/src`) and already proven end-to-end for
  staff via T5.12e's admin-web wiring (`apps/admin-web/src/app/security/sessions/page.tsx` +
  `apps/admin-web/src/components/security/sessions-actions.tsx` call `establishSession`,
  `authenticate`, `enrollMfa`, `revokeSession`, `revokeAllSessions`, etc. today — currently
  100% admin-guarded).
- Building a second, customer-only password/session/MFA stack from scratch would duplicate all of
  that — credential storage, risk scoring, device trust, audit trail, revocation — and create two
  divergent definitions of "this request is authenticated as a person" in the same codebase. That
  is a maintenance and security liability (two places to patch the next auth bug), not a
  simplification, even though a customer's auth needs are narrower than an operator's (no ABAC
  permission checks, no impersonation/delegation).
- `Principal` (`services/security/src/domain/principal.ts`) is already Security's "unified
  identity" concept, and its own doc comment states the shape this needs: "`human` principals are
  a *reference* to an Identity-context user (`subjectRef`)... Security stores no human PII."
  `Session.principalRef` and `Authenticate`'s `principal.id.toString()` both key off `Principal`,
  not off `Customer` directly. So the missing link is a `Principal` (`kind: "human"`, `subjectRef:
  customer.id.toString()`) created alongside each registered `Customer` — either at
  `Customer.register()` time (Identity's registration use case additionally provisions a
  `Principal` via a port into Security, the same cross-context adapter pattern
  `OrderCreationPort`/`OrderCreationAdapter` already establishes for Checkout→Orders) or lazily on
  first successful authentication. That provisioning step is itself new work, but it is additive —
  it does not require inventing new session/credential/MFA primitives, only wiring the existing
  `Principal.register` use case (`services/security/src/application/principal.use-cases.ts`,
  confirmed to exist in the file listing) into Customer registration.
- Concretely: a new `POST /public/auth/login` (and `/register`, `/logout`, `/refresh`) route
  surface, `public: true` at the route level (same as `public-cart-routes.ts`), calling
  `Authenticate`/`EstablishSession`/`RefreshSession`/`RevokeSession` through a **new**
  `CustomerAuthController` — a thin wrapper parallel to `SecuritySessionsAdminController`, but
  gated by a new `CustomerGuard` (not `AdminGuard`): "is there a valid, unexpired customer
  session" only, no `Permission`/ABAC check, since a customer's request is never authorized
  against a permission grid — it is scoped to "this session's own `customerRef`," full stop.
- One config-level decision explicitly left to whoever implements this (not an architectural
  blocker): whether the customer-facing `authenticate()` call registers/uses a distinct
  `AuthMethodKind` (e.g. a `"customer_password"` entry in the versioned `authMethodRegistry`,
  `packages/registry`) separate from whatever staff auth methods are registered, so a customer's
  password policy/provider can be configured independently of admin console auth. Nothing here
  requires deciding that now.

### 2. Session mechanism

- **Cookie name:** a new `CUSTOMER_SESSION_COOKIE = "lumo-storefront-customer-session"` —
  distinct from `GUEST_SESSION_COOKIE` (`lumo-storefront-guest-session`, cart ownership only) and
  `CHECKOUT_SESSION_COOKIE` (`lumo_checkout_session`, single-sitting checkout flow). Same
  `HttpOnly`/`Secure`-in-prod/`SameSite: "lax"` shape as `GUEST_SESSION_COOKIE_OPTIONS`
  (`apps/storefront/src/lib/cart.ts`) for consistency, but a shorter `maxAge` — recommend a
  sliding ~30–120 minute TTL refreshed on activity (mirroring `Session.refresh`'s rotate-and-extend
  semantics), not the cart's 30-day window, since this cookie carries a real identity, not an
  anonymous convenience token.
- **What it carries:** the opaque Security `Session.id` (the same UUID `EstablishSession`/
  `Authenticate` already return as `SessionOutput.id`) — **never** the raw `customerRef`/`Customer`
  id, and never a self-contained JWT with embedded claims. Opacity is deliberate, not just
  defense-in-depth: because the cookie is *only* a lookup key, `RevokeSession`/`RevokeAllSessions`
  take effect immediately on the next request (the introspection call below will report
  `active: false`); a self-contained signed token would keep validating locally until its own
  expiry regardless of a revocation the server already recorded.
- **Validation on each request:** a server-only lookup, in a new customer-facing equivalent of
  `IntrospectSession` — never called from browser JS (same rule `public-cart-routes.ts`'s doc
  comment states: "the browser only ever talks to the storefront's own server"). The storefront
  reads the cookie in a Server Component/Server Action, calls the new backend endpoint with the
  session id, which internally runs `IntrospectSession(sessionId)` → `{active, session}`, then
  resolves `session.principalRef` → `Principal.subjectRef` → `Customer.id`. This
  session→principal→customer resolution happens **entirely server-side inside the new backend
  route handler**; the storefront frontend never receives or stores a raw `customerRef` from
  anywhere the browser could tamper with it.
- **Expiry/rotation:** reuse `RefreshSession` as-is (rotates the refresh-token fingerprint,
  extends TTL — "refresh must rotate the token, reuse rejected" per `Session.refresh`'s own
  guard) on a sliding window triggered by continued activity. Logout = `RevokeSession` on the
  current session id, cookie cleared. "Logout everywhere" = `RevokeAllSessions` — already built
  and already exposed on the admin console (`RevokeAllSessionsForm`), directly reusable for a
  customer-facing "sign out of all devices" control with no new use case needed.
- **Guest-cart-to-customer-account relationship on login (design intent, not implemented):**
  `Cart` already has exactly the two domain operations this needs —
  `assignCustomer(customerRef)` ("Assigns a customer to a previously-guest cart. Idempotent-
  guarded: fails if already assigned," `services/cart/src/domain/cart.ts:131`) and
  `merge(source: Cart)` ("Merges another (typically guest) cart's lines into this one — same-
  currency only. Emits `cart.merged`," same file, line 139) — both already implemented and
  tested (`cart.test.ts`), currently reachable only through the admin `cart-routes.ts`, not any
  public route. What a future implementing task should do, server-side, inside the login Server
  Action, immediately after a successful `Authenticate`/`EstablishSession` call: look up whether
  the now-identified customer already has an assigned cart; if not, call `assignCustomer` on the
  current guest cart (promoting it in place — no data loss, no new cart id); if the customer
  already has a cart, call `merge(guestCart)` to fold the guest cart's lines into it, then clear
  the now-orphaned guest cart. Either way, `GUEST_SESSION_COOKIE` should then be cleared (not left
  set) so a stale guest UUID never continues to alias an account whose cart just got promoted or
  merged — the two identity spaces (anonymous cart token vs. authenticated session) must not be
  left pointing at the same cart under two different cookies simultaneously. This requires two new
  public route wrappers around the already-existing `assignCustomer`/`merge` cart methods (not new
  domain logic) — out of scope to build here, but the mechanism to use is settled.

### 3. New backend surface: a customer-scoped, session-derived `me/orders` read endpoint

Route shape: `GET /public/customers/me/orders` (cursor-paginated, same `first`/`after` shape as
every other list route in this codebase) — **not** `GET /public/orders?customerId=...`. The
`customerRef` scoping the query must never be a client-supplied parameter (query string, body, or
otherwise); it is derived exclusively from the validated session, inside the route handler, via
the session→principal→customer resolution in §2. A request with no valid customer session gets a
401/redirect-to-login response, not an empty list (an empty list would be indistinguishable from
"you have zero orders," which is a different, and here false, statement for an unauthenticated
caller).

Auth requirement: the same new `CustomerGuard` from §1 — valid, unexpired customer session, no
ABAC permission check (there is exactly one thing to authorize: "is this session's own
`customerRef`," which the handler already enforces structurally by never accepting a different
one).

Response shape: a cursor-paginated DTO projection of `Order`, following the same "domain
aggregates never go on the wire" rule every other route in this codebase already follows (see
`public-catalog-routes.ts`'s DTO-mapping doc comment) — reuse the shape of whatever
`toOrderListItemDto`-equivalent the admin Orders route already produces, minus any admin-only
fields (internal notes, staff-facing audit metadata) a customer should not see.

**Backend gap found, and why it matters for this specific route (not just noted for a future
implementer to discover blind):** `OrderRepository`/`OrderListQuery`
(`services/orders/src/domain/order-repository.ts`) has no exact-match `customerRef` filter today
— only a `search?: string` field, documented as "matches the order number **or** customer
reference (case-insensitive substring)." That is a convenience filter for an operator typing a
partial string into a search box; it is not a safe security-scoping mechanism for a customer-facing
endpoint — a substring match can both over-match (one customer's ref happens to be a substring of
another's, or of an order number) and under-match, and "match the order number too" is actively
wrong for this use case (a customer must never see another customer's order just because its
*number* happens to contain their ref as a substring). **A future implementation must add a
genuine exact-match `customerRef` filter** — either a new `customerRef?: string` field on
`OrderListQuery` handled as `WHERE customerRef = $1` (not `ILIKE '%...%'`), or a dedicated
`listByCustomer(customerRef, page)` repository method — before wiring this route to real data.
This is the same shape of gap Wishlist/Loyalty do **not** have (next section) — call it out
explicitly so it isn't silently reused as unsafe scoping.

### 4. Blast radius on T5.17 (Wishlist), T5.19 (Loyalty balance), T5.18-write (review authoring)

All three need exactly the same thing from this decision and nothing more: **a validated
`customerRef`, resolved server-side from the session as described in §2, available to their own
route handler.** None of them need a new session mechanism, a new cookie, or a new guard of their
own — they reuse `CustomerGuard` and the session→principal→customer resolution verbatim.

- **T5.17 Wishlist:** `WishlistRepository.findByCustomerRef(customerRef)` already exists
  (`services/wishlist/src/domain/wishlist-repository.ts:8`) — unlike Orders, there is **no**
  backend list-query gap to fix first. Once `CustomerGuard` exists, `GET
  /public/customers/me/wishlist` is a direct wire-up: guard → resolve `customerRef` → 
  `findByCustomerRef` → DTO-map → return. Any wishlist-mutation routes (add/remove item) this task
  adds need the identical guard and the identical `customerRef` resolution, never a client-
  supplied one.
- **T5.19 Loyalty balance:** identical situation —
  `LoyaltyAccountRepository.findByCustomerRef(customerRef)` already exists
  (`services/loyalty/src/domain/loyalty-account-repository.ts:8`). `GET
  /public/customers/me/loyalty` is the same direct wire-up as Wishlist, no repository gap.
- **T5.18-write (review authoring, deferred by T5.18's own report):** `Review.customerRef`
  (`services/reviews/src/domain/review.ts:17`) is required at creation and is also the key
  `vote(customerRef, ...)` uses to prevent double-voting (`review.ts:125-126`). Writing a review
  or casting a vote both need the same server-derived `customerRef` this design produces — the
  storefront must never let a client supply its own `customerRef` for either action (that would
  let anyone attribute a review, or a helpful/not-helpful vote, to an arbitrary other customer).
  No Reviews-side repository gap was found for this — `customerRef` is already a required
  constructor/method argument, not something the write path has to newly derive a lookup for.

### 5. What this design explicitly does not do

**No code was written for T5.16.** Not implemented, not started, not scaffolded: no
`CUSTOMER_SESSION_COOKIE`, no `CustomerGuard`, no `CustomerAuthController`, no `/public/auth/*`
routes, no `/public/customers/me/*` routes, no `Principal` provisioning on `Customer.register()`,
no `customerRef` exact-match filter on `OrderRepository`, no guest-cart merge/assign wiring. Every
file named above (`cart.ts`'s `assignCustomer`/`merge`, the `Wishlist`/`LoyaltyAccount`
`findByCustomerRef` methods, `Session`/`Principal`/`Authenticate`/`EstablishSession`/
`RevokeSession`) was read to confirm it exists and behaves as described, not modified. Do not mark
T5.17/T5.19/T5.18-write's own checkboxes done by pointing at this entry — they still need their
own route/guard/DTO wiring built against the recommendation above; this entry only removes the
need for each of them to re-derive the identity decision from scratch.

## T5.15 — Storefront search built against Catalog's substring search, not the Search context (which still has no query-execution capability at all)

**Expected:** the Phase 5/6 backlog's T5.15 note says storefront search "needs Phase 4 T4.3's `GET
/search/indexes/:indexId/queries`" and to "expose a public search route the way
`public-catalog-routes.ts` exposes catalog reads."

**Found — the named route doesn't exist, and this is the same gap T4.3's entry above already
documents, re-confirmed fresh for this task.** Re-read `services/search/src/interfaces/
search.controller.ts` in full: it exposes exactly `create`/`advance`/`upsertDocument`/
`deleteDocument`/`addSynonym`/`removeSynonym`/`addSuggestion`/`logQuery`/`list`/`get` — no
`search`/`query`/`execute` method anywhere on the class, and `list`/`get` operate on **index
records** (index config), not on documents inside an index. The only `queries` route in
`apps/admin/src/http/search-routes.ts` is `POST /search/indexes/:indexId/queries`, which delegates
to `admin.search.logQuery` → `LogQuery` — pure analytics logging (`search.query.logged`), not a
query execution + results read. `IndexProviderPort` (`services/search/src/application/ports.ts`)
declares only `upsert(document)`/`delete(productRef)` — no `query` method exists on the port either,
so no code path anywhere in the Search bounded context can execute a search and return matching
documents. The Search context manages index **configuration** only; it has no query-execution
capability at all, exactly as T4.3's entry already found for Phase 4's read-side task.

**Why not blocked:** T5.15 is fully implementable via a different, already-wired path. Catalog's
`ListProducts` use case (`services/catalog/src/application/list-products.use-case.ts`) already
accepts an optional `query?: string` and delegates to `ProductRepository.search()` — a
case-insensitive substring match over product name/sku — whenever it's given (its own doc comment:
"a case-insensitive substring stopgap... the real ranked search projection is the Search context's
job, not a competitor built here"). The admin `GET /products` route already threads this field
through (`listProductsQuery` in `admin-routes.ts`); the public `GET /public/products` route did not.
This task added that one field to the public route.

**Ruling made:** `apps/admin/src/http/public-catalog-routes.ts` gained a route-scoped
`publicProductsQuery` schema (`pageQuery.extend({ query: z.string().min(1).optional() })`, kept
separate from the shared `pageQuery` so categories/collections/prices/inventory — none of which have
a query-aware `list()` — don't silently accept and drop an unsupported param) and `GET
/public/products`'s `schema.querystring` now uses it; the handler already forwarded the whole
`query` object to `admin.publicReads.products.list(query)`; no controller/use-case/handler-body
change was needed. `apps/storefront/src/lib/runtime-api.ts` gained `searchProducts(query, first?)`
(same route, same `ProductSummary` DTO as `getProducts`) and `apps/storefront/src/lib/catalog.ts`
gained `searchPublishedProducts(query)`, which filters to `status === "published"` the same way
`listPublishedProducts` does — the public route returns every status, so a draft/scheduled/archived
product must never surface just because its name matched a search term. The storefront's header
(`components/site-header.tsx`) now has a plain `<form method="get" action="/search">` field (no
client JS, matching the storefront's simpler-than-admin-web public-read convention) and a new
`app/search/page.tsx` reads `?q=`, calls `searchPublishedProducts`, and renders one of three
explicit states: a search prompt (no query yet), an empty-results state (query with zero matches),
or an error state (the catalog call failed) — reusing the existing `ProductCard`/`StatePanel`
components, never a blank page and never implying ranked relevance the backend doesn't have.

**Suggested fix:** unchanged from T4.3's entry — `IndexProviderPort.query(term, page):
Promise<Paginated<SearchDocument>>` (or similar) wired to a real OpenSearch/pgvector backend
(ADR-0020, still deferred per `services/search/src/composition.ts`), plus a new
`ExecuteSearchQuery` use case that calls it and separately calls `LogQuery` for the analytics
side-effect. Once that exists, the storefront's `searchProducts`/`searchPublishedProducts` could be
repointed at a real `GET /search/indexes/:indexId/queries` (or a public wrapper over it) for ranked
relevance instead of Catalog's substring stopgap, with no change needed to `app/search/page.tsx`'s
three-state rendering.

## T5.17 — Customer auth foundation + Wishlist: SHIPPED, with four downstream gaps found

**Both parts landed and are verified.** This entry is not a "blocked" record — it is the list of
gaps found *while* implementing, each of which was worked around honestly rather than papered over.
T5.16's design (above) was implemented essentially as written; the deviations are called out below.

### 1. Wishlist share tokens can be minted but never redeemed

**Expected:** T5.17's brief says to check `wishlist-routes.ts`/`services/wishlist` for a
share-token-*resolution* capability and, if one exists, wire it as a separate unauthenticated public
route (a share link is meant for someone without an account).

**Found — no such capability exists.** `WishlistRepository`
(`services/wishlist/src/domain/wishlist-repository.ts:5-10`) declares exactly `save` / `findById` /
`findByCustomerRef` / `list` — there is no `findByShareToken`. No use case in
`services/wishlist/src/application/wishlist.use-cases.ts` accepts a token as input either;
`ShareWishlistItem` only *mints* one (idempotently replaying the item's existing token). The token is
real and persisted on the `WishlistItem` value object (`value-objects/wishlist-item.ts:6`), but
nothing anywhere can look one up.

**Why not blocked:** the owner-facing half is fully implementable and shipped —
`POST /public/wishlists/me/items/share` returns the real token. **No unauthenticated redeem route was
added**, because building one requires a new repository method + use case, i.e. new Wishlist domain
surface, which this task is not scoped to add. The storefront deliberately labels the value a "share
reference" and renders it as text with an explicit "share links can't be opened yet" note rather than
as a link — the alternative (rendering a URL that 404s) would be exactly the fabricated-affordance
anti-pattern the plan forbids.

**Suggested fix:** `WishlistRepository.findByShareToken(token): Promise<Wishlist | null>` (plus the
Prisma/in-memory implementations) + a `ResolveSharedWishlistItem` use case returning just the shared
item's `productRef`, wired as `GET /public/wishlists/shared/:token` with `public: true` and **no**
guard. That route must project one item only, never the whole wishlist and never the `customerRef` —
holding a token proves nothing about who you are.

### 2. `CartRepository` has no `findByCustomerRef`, so the guest-cart merge is promote-only

**Expected:** T5.16 §2 (above) specifies: on login, look up whether the customer already has a cart;
if not, `assignCustomer` the guest cart in place; if they do, `merge(guestCart)` into it; **then clear
`GUEST_SESSION_COOKIE`** so a stale guest UUID never aliases a promoted cart.

**Found — the lookup that decision branches on does not exist.** `CartRepository`
(`services/cart/src/domain/cart-repository.ts`) exposes `save` / `findById` / `findBySessionRef` /
`list` only. There is no way to ask "which cart does customer X own", so the "customer already has a
cart" branch is unreachable and `MergeGuestCart` (which exists, and is already exposed on
`CartController.merge`) cannot be triggered from a login flow. Separately, `Cart.assignCustomer`
(`cart.ts:131`) had no use case wrapping it at all — no transport could reach it.

**What shipped instead:** a new `AssignCartCustomer` use case
(`services/cart/src/application/assign-cart-customer.use-case.ts`) + `CartController.assignCustomer`
+ `POST /public/auth/claim-cart`, which promotes the guest cart in place. Re-login by the same
customer short-circuits to a no-op (the domain method refuses *any* second assignment, which is right
for the aggregate but wrong for a login flow); a cross-customer re-assignment is still refused.

**Deviation from the design, deliberate:** `GUEST_SESSION_COOKIE` is **kept**, not cleared. Because
`sessionRef` is the only key that resolves "my current cart" (`GetCurrentCart` →
`findBySessionRef`), clearing it would strand the cart that was just claimed and silently empty the
shopper's cart on login — the exact data loss the promotion exists to prevent. The cookie can only be
cleared once a customer's cart is reachable without it.

**Suggested fix:** add `findByCustomerRef(customerRef): Promise<Cart | null>` to `CartRepository`
(with the same tenant scoping every other lookup has). That unblocks three things at once: the real
merge-vs-promote branch, clearing the guest cookie on login as designed, and item 3 below.

### 3. Wishlist's `CartPort` is an in-memory stub in the admin composition — `MoveWishlistItemToCart` moves nothing

**Found:** `wireWishlist(deps)` is called in `apps/admin/src/composition.ts` with no `cart` adapter,
so `services/wishlist/src/composition.ts:65`'s `deps.cart ?? new InMemoryCartPort()` resolves to the
stub, which pushes `{customerRef, productRef}` onto an in-process array and touches no cart
(`infrastructure/in-memory-port-adapters.ts`). `MoveWishlistItemToCart` removes the item from the
wishlist and calls that stub — so routing the public move-to-cart route through it would make the
shopper watch an item vanish while their cart stayed empty, with the API reporting success.

**What shipped instead:** `POST /public/wishlists/me/items/move-to-cart` composes the two REAL
operations at the route level — resolve the price server-side via the existing `resolvePrice` helper
(H-01: no caller chooses a cart line's price), `cart.add`, and only then `wishlist.removeItem`, so a
failure leaves the item on the wishlist rather than losing it. Cart ownership is proven by the guest
`sessionRef`, the same proof every other public cart route requires, because of gap 2 above.

**Suggested fix:** a `WishlistCartAdapter` in `apps/admin/src/infrastructure/cross-context/`
(mirroring `OrderCreationAdapter`), injected as `wireWishlist({...deps, cart: adapter})`. It needs
gap 2's `findByCustomerRef` to locate the customer's cart, and must re-resolve the price itself —
`CartPort.addItem(customerRef, productRef)` carries no price, which is correct, but means the adapter
owns that resolution.

### 4. Password credentials live in a per-process in-memory map (pre-existing, now load-bearing)

**Found:** `wireSecurity` registers exactly one `AuthenticationProviderPort` for `"password"` —
`InMemoryPasswordAuthProvider` (`services/security/src/infrastructure/in-memory-auth-adapters.ts:115`)
— a seedable identifier→credential map held in process memory. It already backed the admin console's
`POST /security/authenticate`; T5.17 now also registers customer credentials through it, via the
`CustomerCredentialsPort` seam (`apps/admin/src/interfaces/customer-credentials.port.ts`).

This task deliberately did **not** build a password store of its own — the brief's constraint 10 is
to reuse Security's existing credential machinery, not to reimplement hashing/storage, and inventing
a second credential path beside the one `Authenticate` actually consults would have been worse in
every dimension. But the consequence should be explicit: **customer credentials do not survive a
process restart and are not shared across replicas.** Two related notes:

- `wireSecurity` has no `deps.authProviders` override seam (unlike `mfaProviders`/`kms`/`crypto`/
  `identityDirectory`), so a production provider cannot currently be injected at all.
- `WiredSecurity.identityDirectory` returns the in-memory default **even when a live
  `deps.identityDirectory` (Kratos) was injected** (`composition.ts:414-416, 685`), so
  `CustomerCredentialsPort.registerSubject` only takes effect on the in-memory branch. With a live
  directory the customer must already exist in it — which is the correct production flow (the IdP
  owns the subject), but it makes the shipped adapter explicitly the local/offline one.

**Suggested fix:** add `readonly authProviders?: AuthenticationProviderResolver` to
`SecurityWiringDeps` (same `deps.X ?? default` convention as `mfaProviders`), and have
`apps/runtime`'s production guards refuse to boot outside `local` without one — exactly the pattern
C2-4 already established for the MFA provider stub. A Kratos/Auth0-backed provider then implements
credential storage, and `CustomerCredentialsPort` becomes two no-ops.

### 5. Config decision T5.16 §1 left open, now made

T5.16 §1 left "does customer auth get its own `AuthMethodKind` (e.g. `customer_password`)" to the
implementer. **Decision: reuse the existing `"password"` kind.** It is already a member of the frozen
`AuthMethodKind` union (adding one is a `packages/registry`/domain change out of this task's scope)
and is the kind `InMemoryPasswordAuthProvider` registers against. `Authenticate` refuses a method
that is not in the versioned registry and nothing in the boot path registers one, so
`CustomerAuthAdminController.ensurePasswordMethod()` registers it lazily, once per process — and only
if absent, reading `registryExplorer()` first so it never overwrites a `displayName`/`enabled` an
operator set through the admin console (a method an operator explicitly *disabled* stays disabled,
and login then correctly fails).

## T6.3 — `turbo run test:coverage` not exercised; verified per-package instead (same pre-existing environment issue as Phase 0/2/4)

**Expected:** the coverage gate wired for T6.3 (`test:coverage` script + turbo task in every
package, blocking `Coverage gate` step in `ci.yml`) should be exercisable the same way as the
existing `pnpm test`/`typecheck`/`lint` turbo tasks.

**Found:** `pnpm exec turbo --version` in this session fails immediately —
`node.exe: error while loading shared libraries: ?: cannot open shared object file` (exit 127) —
the identical `STATUS_DLL_NOT_FOUND`-class failure this file's Phase 2 addendum already documented
for this Windows host/session (turbo's native binary/its child `node` invocation not loading), not
a regression from anything in T6.3.

**Why not blocked:** every piece T6.3 added was still verified directly, per-package, the same
substitute pattern the Phase 0/2/4 entries above already used for `typecheck`/`lint`/`test`:
`pnpm --filter @platform/domain test:coverage`, `pnpm --filter admin-web test:coverage`, and
`pnpm --filter @platform/runtime test:coverage` (the latter two needed a fresh, corrected coverage
measurement — see `docs/KNOWN_GAPS.md` G-21 for why the first batch measurement mis-measured them)
all ran and passed against their new ratcheted thresholds. A deliberate negative check (temporarily
raising `packages/domain`'s `lines` threshold from 80 to 99, re-running, confirming
`ERROR: Coverage for lines (91.51%) does not meet global threshold (99%)`, then reverting) confirms
the gate mechanism itself — not just the scripts existing — actually enforces.

**Suggested fix:** none needed for T6.3 itself. A later session (or a human) on a host where
`turbo` actually runs should do one `pnpm test:coverage` (repo-wide) pass to confirm the 74
per-package thresholds hold together under a real turbo orchestration run — nothing about running
them via turbo instead of individually is expected to change the result, since each package's
`vitest.config.ts` is independent and turbo only parallelizes/orders the same per-package command
this session already ran directly.

## T6.3 — one pre-existing `apps/runtime` test times out at the default 5s under coverage instrumentation (not a regression)

**Found:** `services/security/wire-security-provisioning.test.ts`'s
`"returns null and never touches the store when SECURITY_PRINCIPAL_PROVISIONING is off (default)"`
test timed out at the default `testTimeout: 5000` when run with `--coverage` (v8 coverage
instrumentation adds real per-call overhead) during this session's initial coverage-measurement
sweep. Re-running `apps/runtime`'s coverage with `--testTimeout=30000` passed cleanly and produced
the real baseline now recorded in `apps/runtime/vitest.config.ts`'s threshold comment (70.95%
lines). The test itself is unmodified — this is purely coverage-instrumentation overhead against a
tight default timeout, not a logic issue with the test or anything T6.3 changed.

**Why not blocked:** not blocked — `apps/runtime/package.json`'s `test:coverage` script
(`vitest run --coverage`) uses `apps/runtime/vitest.config.ts`'s own (currently unset,
vitest-default 5000ms) `testTimeout`, same as this session's first, failing attempt. It has not
been changed to a higher value here, since raising a global test timeout is exactly the kind of
"weaken the config to make a run pass" edit T6.5's "never weaken a guard" spirit warns against by
analogy, and this session cannot tell from one flaky-under-instrumentation run whether 5s is too
tight in general or this was noise.

**Suggested fix:** if this recurs (in CI's `Coverage gate` step or otherwise), the fix is a
per-test or per-file `testTimeout` override on that one slow test/file
(`services/security/wire-security-provisioning.test.ts`), not a global bump in
`apps/runtime/vitest.config.ts` — keeps the tight default timeout everywhere else instrumented
coverage doesn't stress.

## T6.1 — Playwright suite built but not run against a live stack; three specific things a session with Docker should verify

**Expected:** T6.1's three specs (guest purchase, operator create, authorization) should pass
against the real local stack.

**Found:** no Docker in this environment (same limitation every "not verified in a live browser"
note in this file already records for Phases 0–5), so nothing in `apps/e2e` was ever run against a
real browser + real backend. What WAS verified without a live stack:

- `pnpm --filter @platform/e2e typecheck`/`lint` — both clean.
- `pnpm exec playwright test --list` (from `apps/e2e`) — all 3 spec files parse, 5 tests total,
  correctly split across the `storefront`/`admin-web` projects by `testMatch`.
- `pnpm --filter @platform/e2e run e2e -- --list` (via the package script, not the direct binary)
  — confirms `playwright.config.ts`'s `webServer` entries behave as designed when the stack is
  NOT up: it starts `next dev` for the storefront project, waits, and fails with a clear
  `Error: Timed out waiting 60000ms from config.webServer.` rather than hanging silently or
  passing vacuously.

**Why not blocked:** not blocked — T6.1 asked for the config, the turbo task, and the three specs,
all of which exist and are internally consistent (parse cleanly, typecheck, lint clean). Running
them for real needs infrastructure this session doesn't have, the same class of limitation as
every other "needs a live browser" note in this file.

**Three things to check first, in order, on a host with Docker** (`apps/e2e/README.md` has the
full bring-up sequence):

1. **`support/admin-login.ts`'s selectors are a best-effort guess**, not confirmed against a real
   rendered Kratos login form. It targets `input[name="identifier"]`/`input[name="password"]`
   based on the research finding that `apps/admin-web/src/app/login/page.tsx`'s `renderNode`
   renders Kratos's own flow nodes directly — but the exact node `name`/`group` Kratos's default
   `identity.schema.json` emits for the password method was never confirmed against a running
   Kratos instance. If login hangs on `identifier`'s `toBeVisible` timeout, start here.
2. **`scripts/seed-e2e-identities.mjs` assumes Keto's ReBAC model accepts the same
   `namespace: "permissions", relation: "granted"` tuple shape `scripts/dev/seed-auth-local.mjs`
   already uses** (copied verbatim) — should be safe since it's the existing working pattern, but
   was never re-run itself, only read.
3. **`guest-purchase.spec.ts`'s `test.fail()` annotation assumes the T2.3 gap (`docs/plans/
   BLOCKERS.md`, "T2.3 — `POST /public/checkouts/:id/complete` throws for a genuine guest
   session") is still open.** That entry predates T5.16–19's customer-auth work; nothing in this
   session re-confirmed the gap still reproduces for a true (never-logged-in) guest session after
   those landed. If it turns out closed, remove `test.fail()` — the spec's assertions are already
   written for the successful/target behavior, no other change needed.

**Suggested fix:** run the suite once on a host with Docker per `apps/e2e/README.md`, fix
whatever `support/admin-login.ts` selector turns out wrong (most likely failure point), and
re-confirm item 3 above before deciding whether `test.fail()` stays.

## T6.5 — the "KMS / secrets provider" guard is not fail-closed anywhere, unlike the other four; found, not fixed

**Expected:** T6.5's table lists 5 items to configure before a staging deploy, including
`SECURITY_KMS_PROVIDER` and its per-provider vars.

**Found:** the other four guards (`C2-4` MFA, `V-1` PaymentProvider, `M2-3` Licensing,
`M2-2` ObjectStorage) are all real `assertProduction*Configured` functions in
`apps/runtime/src/api.ts`, collected by `startApi`'s `guardFailures` array and fail-closed outside
`APP_ENV=local`. **No fifth guard exists for KMS.** `config.ts`'s zod refinement (~line 264-293)
validates that IF `SECURITY_KMS_PROVIDER` is explicitly set to `vault`/`aws`/`gcp`/`azure`, its
required keys are present — but nothing aborts boot if it is simply left at its `local` default
(`node:crypto`, in-process, unmanaged) outside `local`. Confirmed via grep: `wireSecurityProviders`/
`wireSecurityRuntime` (`apps/runtime/src/security/wire-security-providers.ts`,
`wire-security-runtime.ts`) are called only from `apps/runtime/src/worker.ts` — never from
`api.ts` or `apps/admin/src/composition.ts` — and `worker.ts` has **no** fail-closed production
guards of any kind today (no `assertProduction*` calls, no `guardFailures`-style aggregation).

**Why not blocked, and not fixed:** this is a real, previously-undocumented gap — not something
T6.5 asked for as an implementation task (its own table lists this row with no named guard ID,
"—", unlike the other four, which already have C2-4/V-1/M2-3/M2-2). Recorded here rather than
patched blind: adding a new fail-closed boot guard to a process (`worker.ts`) this session could
never actually boot or test (no Docker, no way to confirm the guard fires correctly and doesn't
false-positive-block a legitimate `local` boot) is exactly the kind of safety-critical change that
needs live verification before it lands — the same reasoning `docs/operations/DEPLOYMENT_GUIDE.md`'s
new "Pre-deploy guard checklist" section states inline. Getting a boot guard wrong in either
direction (fails closed when it shouldn't, or silently passes when it shouldn't) is worse than
leaving the gap visible and documented.

**Suggested fix:** add `assertProductionKmsConfigured(appEnv, wired.kms)` to `worker.ts`, mirroring
`assertProductionObjectStorageConfigured`'s shape in `api.ts` (takes the already-resolved value,
not just `appEnv`, so it can tell "configured" from "not" — `wireSecurityProviders` already returns
`kms: undefined` when `SECURITY_KMS_PROVIDER === "local"`, so the guard's condition is just
`wired.kms === undefined`). Needs a live boot test (`APP_ENV` set to something other than `local`,
`SECURITY_KMS_PROVIDER` left at default, confirm `worker.ts` refuses to start; then set a real
provider, confirm it starts) before merging — not something to trust from a code read alone, given
`worker.ts` currently has zero guards to pattern-match against for this exact shape.

