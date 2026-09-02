# Phase 0 — Quick fixes

**Goal:** remove every dead link, and fix three real correctness bugs in the public storefront
API. Nothing here depends on anything else, and nothing later depends on all of it — but do it
first, because it is small and it makes the app honest.

**Estimated size:** 6 tasks, ~1 day.

Read [`README.md`](README.md) first if you have not.

---

## T0.0 — Install dependencies and record the baseline

- [x] Task complete

`node_modules` does not exist in this working copy. Nothing compiles until it does.

```bash
corepack enable && pnpm install
```

Then capture the baseline:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

**Acceptance:** all three pass. If any fail, create `docs/plans/BLOCKERS.md` and record the
exact failing package and error, then continue to T0.1 — pre-existing failures are not yours
to fix unless a later task names them.

---

## T0.1 — Remove the three dead sales-channel links

- [x] Task complete

**Problem:** `apps/admin-web/src/components/navigation.ts` exports `SALES_CHANNEL_NAV` with three
items pointing at `/channels/storefront`, `/channels/pos`, `/channels/mobile-app`. None of those
pages exist under `apps/admin-web/src/app/`, so all three render the 404 page. They are consumed
by `sidebar-nav.tsx:119`.

**Decision (already made — do not re-open):** POS and Mobile app are not products that exist in
this codebase; delete them. The storefront *does* exist (`apps/storefront`, dev port 3000), so keep
that one and point it at the real storefront origin. `sidebar-nav.tsx` already renders
`external: true` items as `<a target="_blank" rel="noreferrer">` with an external-link icon — no
component change is needed.

**Steps**

1. In `apps/admin-web/src/components/navigation.ts`, replace the whole `SALES_CHANNEL_NAV` export
   with:

   ```ts
   /**
    * The one customer-facing surface that actually exists in this monorepo (`apps/storefront`).
    * POS and Mobile app were removed here: they had `/channels/pos` and `/channels/mobile-app`
    * hrefs pointing at pages that have never existed, so both rendered the 404 screen.
    * `NEXT_PUBLIC_*` because `sidebar-nav.tsx` renders in the browser bundle.
    */
   export const SALES_CHANNEL_NAV: readonly NavItem[] = [
     {
       id: "storefront",
       label: (t) => t.nav.storefront,
       href: process.env["NEXT_PUBLIC_STOREFRONT_URL"] ?? "http://localhost:3000",
       Icon: StoreIcon,
       external: true,
     },
   ];
   ```

2. Remove `SmartphoneIcon` and `TagIcon` from the `lucide-react` import at the top of the same
   file — they are now unused and `eslint` will fail on them.
3. Leave the `nav.pos` / `nav.mobileApp` keys in both dictionaries. They are also used at
   `en.ts:100` / `ar.ts:105` (a different section); removing them breaks that.
4. Add `NEXT_PUBLIC_STOREFRONT_URL` to `.env.example` under the admin-web section, with the value
   `http://localhost:3000` and a one-line comment saying it is the public storefront origin the
   admin sidebar links to. This is the one `.env.example` edit this plan authorises.

**Acceptance:** every item in the admin sidebar navigates somewhere that renders. The storefront
item opens in a new tab.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint
```

---

## T0.2 — Remove the dead "view report" link on the dashboard

- [x] Task complete

**Problem:** `apps/admin-web/src/components/dashboard/sales-by-channel.tsx:60` renders
`<Link href="/analytics/channels">`. No such page exists.

**Decision (already made):** the per-channel report is Phase 5 work. Delete the link now rather
than leave a 404 behind it.

**Steps**

1. Delete the `<Link href="/analytics/channels">…</Link>` element and, if it is wrapped in a
   `CardFooter` / button that now has no content, delete that wrapper too.
2. Remove the `Link` import if nothing else in the file uses it.
3. Leave the `t.channels.viewReport` dictionary key in place — do not delete dictionary keys in
   this phase.

**Acceptance:** the "Sales by channel" card renders with no link. No 404 reachable from the
dashboard.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## T0.3 — Fix `pageInfo: undefined` on `/public/prices` and `/public/inventory`

- [x] Task complete

**Problem (verified, real):** `mapPage()` in `apps/admin/src/http/public-catalog-routes.ts` reads
`page.pageInfo` off the controller body:

```ts
const page = response.body as Paginated<TAggregate>;
return { status: response.status, body: { items: page.items.map(toDto), pageInfo: page.pageInfo } };
```

Three of the five list use cases return a real `Paginated<T>` (`{ items, pageInfo }`):
`ListProducts`, `ListCategories`, `ListCollections`. **Two do not.** Both
`services/pricing/src/application/list-prices.use-case.ts` and
`services/inventory/src/application/list-inventory-items.use-case.ts` return a *flat* shape:

```ts
return ok({ items: page.items, hasNextPage: page.pageInfo.hasNextPage, endCursor: page.pageInfo.endCursor });
```

The `as Paginated<TAggregate>` cast hides the mismatch from the compiler, so
`GET /public/prices` and `GET /public/inventory` both serve `"pageInfo": undefined`. Pagination on
those two routes is silently broken. The storefront only reads `items`, so nothing has surfaced it
yet.

**Decision (already made):** fix the two use cases to return `Paginated<T>` like the other three.
Do **not** patch `mapPage` to accept both shapes — one wire contract, not two.

**Steps**

1. `services/pricing/src/application/list-prices.use-case.ts`: change the use case's success type
   from the inline `{ items, hasNextPage, endCursor }` object to `Paginated<Price>` (import
   `Paginated` from `@platform/types`, alongside the existing `CursorPage` import), and change the
   body of `execute` to `return ok(await this.deps.prices.list(input));` — matching
   `list-categories.use-case.ts` exactly.
2. `services/inventory/src/application/list-inventory-items.use-case.ts`: same change, with
   `Paginated<InventoryItem>`.
3. Grep for every other caller of these two use cases and fix any that read `.hasNextPage` /
   `.endCursor` off the top level — they must now read `.pageInfo.hasNextPage` /
   `.pageInfo.endCursor`:

   ```bash
   grep -rn "listPrices\|listInventoryItems\|prices.list(\|inventory.list(" services apps packages --include=*.ts
   ```

4. Update the two use cases' own `*.test.ts` files (and any controller test that asserts the old
   flat shape) to the new shape.

**Acceptance:** `GET /api/v1/public/prices?first=2` and `GET /api/v1/public/inventory?first=2`
both return `{ "items": [...], "pageInfo": { "hasNextPage": …, "endCursor": … } }`.

**Verify:**

```bash
pnpm --filter @platform/pricing test && pnpm --filter @platform/inventory test
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm arch
```

---

## T0.4 — Stop `/public/prices` serving draft prices

- [x] Task complete

**Problem (verified, real):** the route's own summary says *"Public: list published prices"*, but
`ListPrices` filters only soft-deleted rows — never `status`. Draft prices reach anonymous
callers. The storefront papers over it with a client-side filter in `resolvePublishedPrice`
(`apps/storefront/src/lib/catalog.ts`), so any *other* consumer — a mobile app, a partner, a CDN
cache — sees drafts.

**Decision (already made):** filter in the **public route handler**, not in `ListPrices`. The same
use case backs the authenticated admin surface, which legitimately needs to see drafts. Keep the
storefront's client-side filter as defence in depth; do not remove it.

**Steps**

1. In `apps/admin/src/http/public-catalog-routes.ts`, change the `/public/prices` route's `handle`
   so it filters the mapped DTOs to `status === "published"` before returning. Write it as an
   explicit helper next to `mapPage` so the intent is greppable:

   ```ts
   /**
    * The public price surface must never serve unpublished prices. `ListPrices` deliberately does
    * not filter by status — the authenticated admin surface shares that use case and needs drafts.
    * So the boundary filters here instead. Note the consequence: `pageInfo` still describes the
    * unfiltered page, so a page can come back with fewer items than `first` while `hasNextPage`
    * is true. That is correct for a cursor API — the caller follows the cursor — but it means
    * callers must not treat "fewer than requested" as "end of list".
    */
   function publishedOnly(response: PageResponse): PageResponse {
     if (response.status < 200 || response.status >= 300) return response;
     const page = response.body as { items: readonly PublicPriceDto[]; pageInfo: unknown };
     return {
       status: response.status,
       body: { items: page.items.filter((price) => price.status === "published"), pageInfo: page.pageInfo },
     };
   }
   ```

   and use it as `handle: async ({ query }) => publishedOnly(mapPage(await admin.publicReads.prices.list(query), toPriceDto))`.

2. Add a test in `apps/admin/src/http/public-catalog-routes.test.ts` (create it if it does not
   exist, copying the style of the nearest existing route test) asserting that a draft price in the
   controller's response does not appear in the route's body.

**Acceptance:** a price with `status: "draft"` never appears in `GET /api/v1/public/prices`.

**Verify:**

```bash
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
```

---

## T0.5 — Add public by-slug routes for products and collections

- [x] Task complete

**Problem (verified, real):** there is no public by-slug endpoint. So
`apps/storefront/src/lib/catalog.ts:74` resolves a single product by fetching the **entire product
list** at the route's page ceiling (`first=100`) and calling `.find()` on it in memory —
`runtime-api.ts:148` documents this. Product number 101 renders a 404 with nothing in the logs.
`resolveCollectionBySlug` has the same shape.

**Good news:** both repositories already expose the method needed —
`ProductRepository.findBySlug(slug, tx?)` (`services/catalog/src/domain/product-repository.ts:8`)
and `CollectionRepository.findBySlug(slug, tx?)`
(`services/catalog/src/domain/collection-repository.ts:8`). Only the use case, the controller
method, the wiring and the route are missing.

**Scope note:** this task fixes *product detail* and *collection detail*. The collection page also
resolves its member products through the list route; leave that as it is — it is bounded by the
collection's own membership and is dealt with in Phase 5.

### Step 1 — two new use cases (`services/catalog`)

Create `services/catalog/src/application/get-product-by-slug.use-case.ts`, copying
`get-product.use-case.ts` byte-for-byte and changing only the input field and the repository call:

```ts
import type { UseCase } from "@platform/application";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface GetProductBySlugInput {
  readonly slug: string;
}

export interface GetProductBySlugDeps {
  readonly products: ProductRepository;
}

/** Fetches a single product by slug — the storefront's product-detail lookup. */
export class GetProductBySlug implements UseCase<GetProductBySlugInput, Product, DomainError> {
  private readonly deps: GetProductBySlugDeps;

  constructor(deps: GetProductBySlugDeps) {
    this.deps = deps;
  }

  async execute(input: GetProductBySlugInput): Promise<Result<Product, DomainError>> {
    const product = await this.deps.products.findBySlug(input.slug);
    return product === null ? err(new NotFoundError("Product not found")) : ok(product);
  }
}
```

Create `services/catalog/src/application/get-collection-by-slug.use-case.ts` the same way, with
`Collection` / `CollectionRepository` / `"Collection not found"`.

Write a `*.test.ts` beside each, copying the assertion style of the nearest existing use-case test:
one case returning the aggregate, one case returning a `NotFoundError` when the repository
returns `null`.

### Step 2 — controller methods

- `services/catalog/src/interfaces/product.controller.ts`: add
  `getProductBySlug: GetProductBySlug` to `ProductControllerDeps`, and a method next to `get`:

  ```ts
  async getBySlug(input: GetProductBySlugInput): Promise<ControllerResponse> {
    return present(await this.deps.getProductBySlug.execute(input), 200);
  }
  ```

- `services/catalog/src/interfaces/collection.controller.ts`: add
  `getCollectionBySlug: GetCollectionBySlug` to `CollectionControllerDeps` and the matching
  `getBySlug` method. `CollectionController` has no `get` today — `getBySlug` will be its first
  read-by-key method.

### Step 3 — wiring

In `services/catalog/src/composition.ts`, inside `buildControllers`, add to the
`new ProductController({...})` literal:

```ts
getProductBySlug: new GetProductBySlug({ products }),
```

and to the `new CollectionController({...})` literal:

```ts
getCollectionBySlug: new GetCollectionBySlug({ collections }),
```

Import both classes at the top of the file alongside the existing use-case imports.

### Step 4 — two public routes

In `apps/admin/src/http/public-catalog-routes.ts`, add a slug params schema next to `pageQuery`:

```ts
const slugParams = z.object({ slug: z.string().min(1) });
```

and add these two routes to the array returned by `publicCatalogRoutes`. Note they return a single
DTO, not a page, so they do **not** go through `mapPage`:

```ts
defineRoute({
  method: "GET",
  path: "/public/products/:slug",
  version: 1,
  permission: "products:read",
  public: true,
  summary: "Public: get one product by slug",
  schema: { params: slugParams },
  handle: async ({ params }) => {
    const response = await admin.publicReads.products.getBySlug(params);
    if (response.status !== 200) return response;
    return { status: 200, body: toProductDto(response.body as Product) };
  },
}),
defineRoute({
  method: "GET",
  path: "/public/collections/:slug",
  version: 1,
  permission: "collections:read",
  public: true,
  summary: "Public: get one collection by slug",
  schema: { params: slugParams },
  handle: async ({ params }) => {
    const response = await admin.publicReads.collections.getBySlug(params);
    if (response.status !== 200) return response;
    return { status: 200, body: toCollectionDto(response.body as Collection) };
  },
}),
```

**Route-order warning:** Fastify matches static segments before parameterised ones, so
`/public/products` and `/public/products/:slug` do not collide. Keep the list route defined first
anyway, for readability.

**DTO warning:** do not return `response.body` directly. That is the domain aggregate, and
returning it leaks `props` / `_id` / `_domainEvents` / `_version` — the exact incident documented
at the top of this file.

### Step 5 — storefront switch

In `apps/storefront/src/lib/runtime-api.ts`, add two functions beside `getProducts`:

```ts
/** One product by slug (`GET /public/products/:slug`). Replaces the list-and-filter workaround that broke past 100 products. */
export async function getProductBySlug(slug: string): Promise<ProductSummary | null> {
  const { body } = await fetchItem<ProductSummary>(`/api/v1/public/products/${encodeURIComponent(slug)}`);
  return body;
}

/** One collection by slug (`GET /public/collections/:slug`). */
export async function getCollectionBySlug(slug: string): Promise<CollectionSummary | null> {
  const { body } = await fetchItem<CollectionSummary>(`/api/v1/public/collections/${encodeURIComponent(slug)}`);
  return body;
}
```

Then in `apps/storefront/src/lib/catalog.ts`:

- `resolveProductBySlug` calls `getProductBySlug(slug)` instead of listing and `.find()`-ing.
  Keep the existing `isPublishedProduct` check on the returned product — the public route does not
  filter by publish state, so an unpublished product must still resolve to the same not-found
  result the page already renders.
- `resolveCollectionBySlug` calls `getCollectionBySlug(slug)` for the collection itself. Keep the
  existing list-based resolution for its **member products** unchanged.
- Delete the now-stale doc comments that describe the list-and-filter workaround, in both
  `catalog.ts` and `runtime-api.ts:148`, and replace them with one line saying the by-slug route
  is used.
- Update `apps/storefront/src/lib/catalog.test.ts` for the new call shape.

**Acceptance:** a product whose position in the catalog is beyond the first 100 resolves correctly
at `/products/<slug>`. `resolveProductBySlug` no longer fetches a list.

**Verify:**

```bash
pnpm --filter @platform/catalog test && pnpm --filter @platform/catalog typecheck
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront test
pnpm arch
```

---

## T0.6 — Make the Analytics screen real

- [x] Task complete

**Problem:** `apps/admin-web/src/app/analytics/page.tsx` renders an "unavailable" card. Its doc
comment is correct that no *query execution* endpoint exists. But four read endpoints do exist and
are wired, and nothing in the frontend calls them:

| Endpoint                        | Returns                     |
| ------------------------------- | --------------------------- |
| `GET /analytics/metrics`        | every governed metric def    |
| `GET /analytics/metrics/:id`    | one metric definition        |
| `GET /analytics/dimensions`     | every governed dimension def |
| `GET /analytics/dimensions/:id` | one dimension definition     |

(Source: `apps/admin/src/http/analytics-routes.ts`. Note these four take **no** querystring —
`schema: {}` — so they are not paginated. Do not send `first`/`after`.)

**Decision (already made):** turn the page into a **metric catalog explorer**: two lists (metrics,
dimensions) showing each definition's real fields. Keep an honest note that query execution is not
connected — do not invent revenue numbers. This is the "never fabricate" rule from
[`README.md`](README.md), satisfied without leaving the page empty.

**Steps**

1. Create `apps/admin-web/src/lib/api/analytics.ts` following
   `apps/admin-web/src/lib/api/content.ts` exactly: a narrow response type, a
   `function isX(value: unknown): value is X` type guard, and a `fetch…` function calling
   `getAdminApi<T>(path, isX)`.
   **Before writing the types**, read the actual response shape from
   `apps/admin/src/interfaces/analytics.admin-controller.ts` and the metric/dimension entities
   under `services/analytics/src/domain/`. Type only the fields those return — do not guess field
   names.
2. Rewrite the body of `apps/admin-web/src/app/analytics/page.tsx`
   to fetch both lists and render them as two `Card`s with a definition table each. Use the
   existing `AppShell` / `getCurrentUser` / locale preamble unchanged; copy the list-rendering
   markup from `apps/admin-web/src/app/content/page.tsx`.
3. Handle all four `ApiResult` outcomes (`ok` / `unauthorized` / `not_found` / `error`) the way
   `content/page.tsx` does. Do not let an error render as an empty list.
4. Keep a short, honest footer note on the page: the catalog is definitions only; running a query
   needs a populated read store, which is not connected. Rewrite
   `t.analyticsPage.unavailableTitle` / `unavailableBody` into new keys that say this, in **both**
   `en.ts` and `ar.ts`.

**Acceptance:** `/analytics` lists real metric and dimension definitions from the API. With the API
unreachable it renders an error state, not a blank page or fake numbers.

**Verify:**

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

---

## Phase 0 exit criteria

- [x] `pnpm typecheck && pnpm lint && pnpm test` pass repo-wide.
- [x] `pnpm arch` passes.
- [x] No link in `apps/admin-web` navigates to a route with no page.
- [x] `/public/prices` and `/public/inventory` return a populated `pageInfo`.
- [x] `/public/prices` returns no draft prices.
- [x] `/public/products/:slug` and `/public/collections/:slug` exist and the storefront uses them.
- [x] `/analytics` shows real data.
