# Phase 4 — The read side for the 19 blocked domains

**Goal:** make it possible to build a screen for every domain that currently has write endpoints
and nothing to read.

**The problem, precisely:** the platform has 301 POST endpoints and 67 GET. Nineteen domains have
**zero** read endpoints. You can `POST /wishlists` and then have no way to see it. No amount of
frontend work fixes that — the data has no way out.

This is tracked internally as **G-8** in `docs/KNOWN_GAPS.md` ("Read side: list/query use cases +
CDC read models", status `designed`). Update that row's status as you close domains.

**Estimated size:** 19 domains × ~4 files each, ~4 weeks. This is the longest phase. It is also the
most mechanical — the first domain takes a day, the rest take hours.

**Depends on:** Phase 1 (so the screens built on top of this in Phase 5 have a client to use).

---

## T4.0 — Fix the contract first, before touching any domain

- [x] Task complete

Phase 0 T0.3 found two use cases returning a flat `{ items, hasNextPage, endCursor }` where the
rest return `Paginated<T>` (`{ items, pageInfo }`). Before adding 19 more, pin the contract so it
cannot drift again.

**The contract — every list use case in this phase returns exactly this:**

```ts
Result<Paginated<TAggregate>, DomainError>
```

where `Paginated<T>` comes from `@platform/types` and is `{ items: readonly T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }`.

**Every list route returns exactly this on the wire:**

```json
{ "items": [ /* flat DTOs, never aggregates */ ], "pageInfo": { "hasNextPage": false, "endCursor": null } }
```

**Steps**

1. Confirm T0.3 landed: `grep -rn "hasNextPage" services/*/src/application/*.ts` should show
   `hasNextPage` only inside `pageInfo`, never as a top-level field of a use-case return.
   Fix any stragglers the same way T0.3 fixed the two known ones.
2. Add a short "Read-side contract" section to `docs/architecture/` — put it in the existing
   architecture doc that covers use cases and presenters (find it with
   `grep -rln "presenter" docs/architecture/`). State the two shapes above, and state the DTO rule:
   **a route never returns a domain aggregate**.

---

## The recipe — apply this to every domain below

Each domain needs the same four layers. The reference implementation to copy is **Catalog's
product list**, because it is complete and correct at every layer:

| Layer          | Reference file                                                                    |
| -------------- | ---------------------------------------------------------------------------------- |
| Repository port | `services/catalog/src/domain/product-repository.ts` (`list`, `findById`)          |
| Prisma impl    | `services/catalog/src/infrastructure/prisma-catalog-repositories.ts` (`paginate`)  |
| In-memory impl | `services/catalog/src/infrastructure/…` (the in-memory product repository)         |
| Use case       | `services/catalog/src/application/list-products.use-case.ts` + `get-product.use-case.ts` |
| Controller     | `services/catalog/src/interfaces/product.controller.ts` (`list`, `get`)            |
| Route + DTO    | `apps/admin/src/http/public-catalog-routes.ts` (`toProductDto`, `mapPage`)          |

### Step 1 — repository port

Add to `services/<domain>/src/domain/<x>-repository.ts`:

```ts
list(page: CursorPage, tx?: unknown): Promise<Paginated<TAggregate>>;
```

`findById` already exists on every one of these repositories — do not re-add it.

Import `CursorPage` and `Paginated` from `@platform/types`.

### Step 2 — Prisma implementation

In `services/<domain>/src/infrastructure/prisma-<x>-repository.ts`, add `list` using the exact
cursor mechanics from `PrismaCategoryRepository.list`
(`services/catalog/src/infrastructure/prisma-catalog-repositories.ts:235`):

```ts
async list(page: CursorPage, tx?: unknown): Promise<Paginated<TAggregate>> {
  const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const limit = normalizePageSize(page.first);
  const rows = await client.<model>.findMany({
    where: {
      tenantId: this.deps.tenantId,
      deletedAt: null,                       // only if the model is soft-deletable
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
  });
  return buildPaginatedPage(rows.map(<X>Mapper.toDomain), limit, (x) => x.id.toString());
}
```

`decodeCursor`, `normalizePageSize` and `buildPaginatedPage` all come from `@platform/repository`.

**Three things that will bite you:**

- **`tenantId` is mandatory in the `where`.** Omitting it leaks another tenant's rows. Every
  existing repository includes it; match them.
- **`deletedAt: null` only if the Prisma model actually has that column.** Check
  `packages/db/prisma/schema/<domain>.prisma` before adding it — a `where` on a non-existent column
  is a runtime Prisma error, not a type error.
- **`take: limit + 1`** is how `buildPaginatedPage` detects `hasNextPage`. Do not use `take: limit`.

### Step 3 — in-memory implementation

Every domain has one (e.g. `services/wishlist/src/infrastructure/in-memory-wishlist-repository.ts`,
backed by a `Map<string, TAggregate>`). Add:

```ts
async list(page: CursorPage): Promise<Paginated<TAggregate>> {
  const all = [...this.store.values()].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : all.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}
```

Sorting by id is required: the cursor is the id, so an unsorted `Map` iteration produces a cursor
that skips rows.

### Step 4 — two use cases

`services/<domain>/src/application/list-<x>.use-case.ts`:

```ts
export class List<X> implements UseCase<CursorPage, Paginated<X>, DomainError> {
  constructor(private readonly deps: { readonly <x>s: <X>Repository }) {}
  async execute(input: CursorPage): Promise<Result<Paginated<X>, DomainError>> {
    return ok(await this.deps.<x>s.list(input));
  }
}
```

(Write it with the explicit `private readonly deps` field the neighbouring files use, not a
parameter property, so it matches house style.)

`services/<domain>/src/application/get-<x>.use-case.ts`: copy
`services/catalog/src/application/get-product.use-case.ts` verbatim, changing only types and the
`NotFoundError` message.

Write a `*.test.ts` beside each.

### Step 5 — controller methods

Add `list` and `get` to `services/<domain>/src/interfaces/<x>.controller.ts`, add the two use cases
to its `Deps` interface, and wire them in `services/<domain>/src/composition.ts`.

**Step 5b — the AdminGuard wrapper (not mentioned above, but required):** the README's pipeline
diagram has a layer this recipe skipped — `apps/admin/src/interfaces/<x>.admin-controller.ts`, the
`AdminGuard` wrapper between the route and the framework-agnostic controller (confirmed against
`wishlist.admin-controller.ts`/`reviews.admin-controller.ts`; every existing write method follows
this shape). Add `list`/`get` methods there too, each calling `this.guard.ensure(principal,
"<domain>:read")` before delegating. This class is instantiated once in
`apps/admin/src/composition.ts`; if it already passes the whole service-level controller through
(e.g. `reviews: new ReviewsAdminController({ reviews: reviews.reviews, guard })`), no change is
needed there — the new methods ride along automatically.

### Step 6 — routes

Add to `apps/admin/src/http/<domain>-routes.ts`, above the existing POST routes:

```ts
const pageQuery = z.object({
  first: z.coerce.number().int().positive().optional(),
  after: z.string().optional(),
  last: z.coerce.number().int().positive().optional(),
  before: z.string().optional(),
});
const <x>IdParams = z.object({ <x>Id: z.string().min(1) });
```

then a `GET /<resource>` (list) and a `GET /<resource>/:<x>Id` (detail).

**The DTO rule is absolute.** Write an explicit, fully-primitive DTO interface and a mapper
function for each domain, exactly like `toProductDto` in `public-catalog-routes.ts`. Then:

- list route: `handle: async ({ query, context }) => mapPage(await admin.<domain>.list(context.principal, query), to<X>Dto)` — import `mapPage` from `./public-catalog-routes`.
- detail route: call the controller, return the response unchanged when `status !== 200`, otherwise
  `{ status: 200, body: to<X>Dto(response.body as <X>) }`.

Use permission `<domain>:read`. Check the existing routes in that file for the exact permission
prefix that domain uses — do not invent one.

**Never return `response.body` directly.** It is the domain aggregate; on the wire it becomes
`props` / `_id` / `_domainEvents` / `_version`. The header comment of `public-catalog-routes.ts`
documents this as a real past incident.

### Step 7 — tests

- use-case tests (both)
- a route test asserting the DTO contains no `props`, `_id`, `_domainEvents` or `_version`
- a repository test asserting `list` respects `tenantId` and paginates

### Step 8 — verify

```bash
pnpm --filter @platform/<domain> test && pnpm --filter @platform/<domain> typecheck
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm arch
```

---

## Domains, in priority order

Do them in this order. Group A unblocks customer-facing storefront features; Group B unblocks the
merchandising and content back-office; Group C is platform tooling.

### Group A — customer-facing (do first)

- [x] **T4.1 Reviews** — `services/reviews`. 6 write routes, 0 reads. Needs list-by-product and
      list-by-status (moderation queue) as well as the generic list. Add
      `findByProductRef(productRef, page, tx?)` to the repository alongside `list`.
      Done: `list(page, filter?: { status })` covers the moderation queue (no separate method
      needed); `findByProductRef` added; `GET /reviews`, `GET /reviews/by-product/:productRef`,
      `GET /reviews/:reviewId` added with permission `reviews:read`. Tests: use-case unit tests,
      a Prisma integration test (`DATABASE_URL_TEST`-gated), and a route DTO-leak test — all
      passing. `pnpm --filter @platform/reviews test/typecheck/lint`, `pnpm --filter
      @platform/admin test/typecheck/lint`, and `pnpm arch` all clean.
- [x] **T4.2 Wishlist** — `services/wishlist`. The repository
      (`services/wishlist/src/domain/wishlist-repository.ts`) currently has only `save`,
      `findById`, `findByCustomerRef` — add `list`. The customer-facing screen needs
      `findByCustomerRef`, which already exists; expose it as `GET /wishlists/by-customer/:customerRef`.
      Done: `list`/`get`/`getByCustomer` added at every layer; `GET /wishlists`,
      `GET /wishlists/by-customer/:customerRef`, `GET /wishlists/:wishlistId` added with
      permission `wishlist:read`. Tests (use-case, Prisma integration, route DTO-leak) all
      passing; `@platform/wishlist` and `@platform/admin` test/typecheck/lint clean, `pnpm arch`
      clean.
- [x] **T4.3 Search** — `services/search`. **Special case, read the note below.**
      Done: `GET /search/indexes` (list) and `GET /search/indexes/:indexId` (get) built per the
      recipe. The `GET .../queries` half was **not** built — `POST .../queries` turned out to be
      an analytics-logging write (`LogQuery`), not a query-execution read, and there is no
      `IndexProviderPort.query` capable of returning results at all. See `BLOCKERS.md` T4.3 for
      the full finding and the ruling not to fabricate a fake read. Tests (use-case, Prisma
      integration, route DTO-leak) passing; `@platform/search`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.4 Loyalty** — `services/loyalty`. 7 write routes, 0 reads. The account balance is the
      whole point; expose `GET /loyalty/accounts/:accountId` and a list.
      Done: `list`/`get` added at every layer; `GET /loyalty/accounts`,
      `GET /loyalty/accounts/:accountId` added with permission `loyalty:read`. Tests (use-case,
      Prisma integration, route DTO-leak) passing; `@platform/loyalty`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.5 Promotions** — `services/promotions`.
      Done: `list`/`get` added at every layer (`GET /promotions`, `GET /promotions/:promotionId`,
      permission `promotions:read`). `PromotionCondition`/`PromotionReward`/`CustomerEligibility`
      gained a few read-only getters (`minimumQuantity`, `minimumSubtotalAmountMinor`, `value`,
      `customerRefs`, `segmentRefs`) that did not previously exist on those value objects — needed
      so the DTO mapper could read real data through a public accessor instead of reaching into
      `props`; no behavior change. Tests (use-case, Prisma integration, route DTO-leak) passing;
      `@platform/promotions`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
      **Group A (customer-facing) complete.**

#### T4.3 note — Search must change method, not just gain routes

`POST /search/indexes/:indexId/queries` is the query endpoint. A search query is a **read**: it
must be cacheable, shareable as a URL, and safe to retry. Add
`GET /search/indexes/:indexId/queries` taking the query in the querystring, and keep the POST
route for queries too large for a URL. Do not delete the POST — other callers may exist.

Also add `GET /search/indexes` and `GET /search/indexes/:indexId` so the admin can see what
indexes exist at all.

### Group B — back-office content and merchandising

- [x] **T4.6 Pages** — `services/pages`. Repository is `services/pages/src/domain/repositories.ts`
      (plural filename — this domain has more than one repository; add `list` to each aggregate's).
      Done: `list`/`get` added for both `Page` and `Template` at every layer;
      `GET /pages`, `GET /pages/:pageId`, `GET /templates`, `GET /templates/:templateId` added
      with permission `pages:read`. Tests (use-case, Prisma integration ×2, route DTO-leak)
      passing; `@platform/pages`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.7 SEO** — `services/seo`.
      Done: 4 aggregates (`SeoProfile`, `Redirect`, `Sitemap`, `RobotsPolicy`), each with `list`/
      `get` at every layer (repository/in-memory/Prisma/use-case/controller/AdminGuard/route),
      permission `seo:read`: `GET /seo/profiles(/:profileId)`, `GET /seo/redirects(/:redirectId)`,
      `GET /seo/sitemaps(/:sitemapId)`, `GET /seo/robots-policies(/:policyId)`. Tests (use-case,
      Prisma integration ×4, route DTO-leak ×4) passing; `@platform/seo`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.8 Theme** — `services/theme`.
      Done: `list`/`get` added at every layer; `GET /themes`, `GET /themes/:themeId` added with
      permission `theme:read`. Tests (use-case, Prisma integration, route DTO-leak) passing;
      `@platform/theme`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.9 Components** — `services/components`.
      Done: `list`/`get` added at every layer; `GET /components`,
      `GET /components/:componentDefinitionId` added with permission `components:read`. Tests
      (use-case, Prisma integration, route DTO-leak) passing; `@platform/components`/
      `@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.10 Experience** — `services/experience`.
      Done: `list`/`get` added at every layer; `GET /experiences`, `GET /experiences/:experienceId`
      added with permission `experience:read`. Tests (use-case, Prisma integration, route
      DTO-leak) passing; `@platform/experience`/`@platform/admin` test/typecheck/lint clean,
      `pnpm arch` clean.
- [x] **T4.11 Localization** — `services/localization`.
      Done: 2 aggregates (`Locale`, `TranslationSet`), each with `list`/`get` at every layer,
      permission `localization:read`: `GET /locales(/:localeId)`,
      `GET /translation-sets(/:translationSetId)`. Tests (use-case, Prisma integration ×2, route
      DTO-leak ×2) passing; `@platform/localization`/`@platform/admin` test/typecheck/lint clean,
      `pnpm arch` clean.
- [x] **T4.12 Notifications** — `services/notifications`.
      Done: `list`/`get` added at every layer; `GET /notifications`,
      `GET /notifications/:notificationId` added with permission `notifications:read`. Two fake
      `NotificationRepository` implementations in existing transaction-boundary/FSM test files
      (`send-notification-transaction-boundary.test.ts`, `notification-fsm-regression.test.ts`)
      needed a `list` stub added to keep implementing the interface. Tests (use-case, Prisma
      integration, route DTO-leak) passing; `@platform/notifications`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.13 Cart (admin)** — `services/cart`.
      Done: `GetCart`/`GetCurrentCart` use cases already existed (only used by the storefront's
      public cart surface) — the gap was purely the admin HTTP exposure. Added `list(page,
      filter?: { status?: CartStatus })` to the repository (in-memory/Prisma/`CachedCartRepository`
      — the last one is a wired-but-unused Redis decorator, kept as a deliberately-uncached
      passthrough per its own `findBySessionRef` precedent) and a `ListCarts` use case;
      `GET /carts` (with an optional `status` query param — the abandoned-cart recovery view) and
      `GET /carts/:cartId` (reusing the existing `GetCart`) added with permission `cart:read`. The
      admin DTO deliberately includes `customerRef`/`sessionRef` (unlike the public storefront's
      `PublicCartDto`, which omits them) since the operator recovery workflow needs them to reach
      the customer. Several fake `CartRepository` test doubles across existing use-case/repository
      test files needed a `list` stub added to keep implementing the interface. Tests (use-case,
      Prisma integration ×2 incl. the status filter, route DTO-leak) passing;
      `@platform/cart`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean. 14 admin write routes, 0 reads. The operator use
      case is abandoned-cart recovery, so the list needs a status filter:
      `list(page, filter?: { status?: CartStatus })`.
- [x] **T4.14 Media library** — `services/media`. Add `GET /media/assets` (list) and
      `GET /media/assets/:mediaAssetId`. Phase 3 T3.6 recorded this as a blocker; close it here and
      remove the note from `docs/plans/BLOCKERS.md`.
      Done: confirmed `services/media/src/composition.ts`'s `wireMedia`/`Asset`/`AssetRepository`
      slice is never called by any app (its own doc comment says so) — out of scope, untouched.
      Only the wired `MediaLibraryController` (`Folder` + `MediaAsset`) got `list`/`get` at every
      layer: `GET /media/folders(/:folderId)`, `GET /media/assets(/:mediaAssetId)`, permission
      `media_library:read`. Tests (use-case, Prisma integration ×2, route DTO-leak ×2) passing;
      `@platform/media`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
      **Group B complete.**

### Group C — platform and configuration

- [x] **T4.15 Tenancy** — `services/tenancy`. **Read the special note below.**
      Done: `list`/`get` added for both `Tenant` and `Workspace` at every layer, plus
      `WorkspaceRepository.findCurrent()` (no `tenantRef` argument needed — every repository
      instance is already scoped to one tenant, ADR-0008) with a documented tie-break (prefers an
      active `"production"` workspace, falls back to the most-recently-updated active workspace).
      `GET /tenants(/:tenantId)`, `GET /workspaces(/:workspaceId)`, and `GET /workspaces/current`
      added with permission `tenancy:read`. Tests (use-case incl. the tie-break, Prisma
      integration ×2, route DTO-leak ×2) passing; `@platform/tenancy`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.16 Feature Flags** — `services/feature-flags` (package name
      `@platform/feature-flags-service`).
      Done: `list`/`get` added at every layer; `GET /feature-flags`, `GET /feature-flags/:flagId`
      added with permission `feature_flags:read`. Tests (use-case, Prisma integration, route
      DTO-leak) passing; `@platform/feature-flags-service`/`@platform/admin`
      test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.17 Experimentation** — `services/experimentation`.
      Done: `list`/`get` added at every layer; `GET /experiments`, `GET /experiments/:experimentId`
      added with permission `experiments:read`. Tests (use-case, Prisma integration, route
      DTO-leak) passing; `@platform/experimentation`/`@platform/admin` test/typecheck/lint clean,
      `pnpm arch` clean.
- [x] **T4.18 Recommendations** — `services/recommendations`.
      Done: `list`/`get` added at every layer; `GET /recommendation-models`,
      `GET /recommendation-models/:modelId` (the DTO includes the model's generated sets — no
      separate per-anchor read use case existed or was needed) added with permission
      `recommendations:read`. Tests (use-case, Prisma integration, route DTO-leak) passing;
      `@platform/recommendations`/`@platform/admin` test/typecheck/lint clean, `pnpm arch` clean.
- [x] **T4.19 Platform Console** — `services/platform-console`. Has no repository files today;
      inspect what it actually stores before assuming the recipe applies. If it holds no persistent
      aggregate, record that in `docs/plans/BLOCKERS.md` and skip it rather than inventing storage.
      Done: confirmed no persistent aggregate exists — the whole context is one in-memory KPI
      projection snapshot (`PlatformKpisProjection`), not a collection with ids, so `list`/`get`
      have no target. The single read (`getKpis()`) already exists end-to-end and is already
      wired to `POST /platform/kpis` (kept as `POST`, per that route's own doc comment, to match
      what was actually built). No code changes needed; recorded in `BLOCKERS.md`.
- [x] **T4.20 Reporting** — `services/reporting`. **Read the special note below.**
      Done: built `list`/`get` for `ReportDefinition` (repository → in-memory + Prisma impl →
      `ListReportDefinitions`/`GetReportDefinition` use cases → controller → AdminGuard wrapper
      (`reporting:read`) → `GET /reporting/report-definitions[/:id]`, DTO-mapped, tested at all
      three layers). Also built the same for `Dashboard` (a judgment call — same plain
      save/findById/findByName shape as `ReportDefinition`, not excluded by the note, and an
      operator benefits from seeing what dashboards exist just as much as report definitions).
      Deliberately did **not** build `list`/`get` for `AnalyticsReport` (report *execution*
      results) — its `resultData` is always fake/empty (`InMemoryAnalyticsQuery` returns
      `rows: []` unconditionally, no real `AnalyticsQueryPort` adapter wired anywhere) per the
      note's explicit instruction. Recorded in `docs/plans/BLOCKERS.md` with a pointer to G-8.

#### T4.15 note — Tenancy needs a "current workspace", not a list

`apps/admin-web/src/app/settings/page.tsx`'s doc comment states the real blocker precisely:
admin-web cannot resolve *which* workspace is current, and "neither context exposes a list to
discover one without that". A list endpoint does **not** solve this.

Add `GET /workspaces/current`, resolving from the request's `x-tenant-id` — the same tenant the
pipeline has already resolved and pinned every repository to (`singleTenantGuardedResolver` in
`apps/admin/src/http/server.ts`). Add the generic list as well, but `current` is the one that
unblocks Settings.

#### T4.20 note — Reporting has no data source, and a list endpoint will not change that

`apps/admin/src/composition.ts` wires Reporting's `AnalyticsQueryPort` to
`InMemoryAnalyticsQuery`, which returns `rows: []` unconditionally. Adding read endpoints for
**report definitions** is worthwhile and in scope — an operator should see what reports exist. Do
that.

Adding an endpoint that **executes** a report is out of scope: there is no populated read store and
no CDC pipeline in this codebase. Do not build one, do not wire a fake, and do not let a screen
imply results are real. Record the gap in `docs/plans/BLOCKERS.md` with a pointer to G-8.

---

## Phase 4 exit criteria

- [x] Every domain in Groups A–C has `list` + `get` at repository, use-case, controller and route
      level — or an entry in `docs/plans/BLOCKERS.md` explaining precisely why not. All 20 tasks
      (T4.1–T4.20) done; three documented exceptions in `docs/plans/BLOCKERS.md` (T4.3 Search
      query-execution endpoint, T4.19 Platform Console has no persistent aggregate, T4.20
      Reporting's `AnalyticsReport` results are fake pending G-39).
- [x] Every new list route returns `{ items, pageInfo }`; no use case returns a flat page. Every
      list use case returns `Paginated<T>` from `@platform/types`; every list route wraps it with
      the shared `mapPage` helper (`apps/admin/src/http/public-catalog-routes.ts`).
- [x] Every new route returns flat DTOs; a test in each domain asserts no `props` / `_id` /
      `_domainEvents` / `_version` reaches the wire. One `*-routes.test.ts` per touched domain
      drives the real `wireAdmin()` composition and asserts this directly.
- [x] Every new repository `list` filters by `tenantId`. Every Prisma `list` impl filters
      `where: { tenantId, ... }`; every in-memory repo is one instance per tenant by construction
      (no cross-tenant store to leak from).
- [x] `GET /workspaces/current` exists and Settings can resolve the current workspace. Built in
      T4.15 (`GetCurrentWorkspace` use case, `WorkspaceRepository.findCurrent`).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm arch` pass repo-wide. `pnpm arch`
      (depcruise, does not go through `turbo`) passed repo-wide with no violations. Repo-wide
      `typecheck`/`lint`/`test` could not run in this session — `turbo` itself fails to load on
      this Windows host (re-confirmed at Phase 4's close, see `docs/plans/BLOCKERS.md`'s final
      entry); every touched package was instead verified individually
      (`pnpm --filter <name> typecheck/lint/test`) at every task boundary and is green. Left
      unticked, same as the equivalent Phase 3 bullets, because it asserts something this
      environment cannot directly confirm — a later session/host with a working `turbo` should
      run it once.
- [x] `docs/KNOWN_GAPS.md` G-8 is updated to reflect what is now closed. Status changed
      `designed` → `partial`; both `docs/KNOWN_GAPS.md` and the master ledger
      (`docs/architecture/23-platform-gap-register.md`) note that list/get use cases are closed
      for all 19 domains while CDC-fed read models (Search query execution, Reporting
      `AnalyticsReport` results) remain open.
