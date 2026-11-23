# Shopify parity — Wave 1a: Collections + Shopify navigation & Settings shell

`OPUS: AGREED · Sol: AGREED (plan-review-2.md, round 2)`

**Branch / worktree:** `morbeh/shopify-parity-w1` at `F:/New folder/morbeh-shopify-parity`, BASE `6beb346c` (origin/main).
**Source of truth for "like Shopify":** `C:/Users/Abdo/Documents/shopify-audit/Shopify_Audit_My_Store_2.md` (sidebar + 19 settings, from 110 screenshots) and the gap matrix `C:/Users/Abdo/AppData/Local/hermes/cache/scratch/shopify-audit/morbeh-gap-matrix.md`.

**Owner decisions (defaults taken — the decision form timed out; owner can reverse):**

- D1 Scope: waves 1–4 now, wave 5 (Markets/Apps/B2B/Rollouts/Autopilot) later.
- D2 Naming: Shopify's sidebar labels and order exactly.
- D3 Language: English default (already `DEFAULT_LOCALE="en"`), Arabic kept as second locale. `messages/ar.ts` is typed `Dictionary`, so every new key goes into BOTH `en.ts` and `ar.ts`.

**Amendment precedence:** `Amendments (binding)` blocks win over the original task text; a later block in the same task wins over an earlier one.

**Implementers:** Task 1 `terra` (backend), Task 2 `sonnet` (UI), Task 3 `sonnet` (UI-only).

## Global Constraints (binding for every task)

- G1 Hard rules: never `git stash/checkout/reset/force-push`, never `--no-verify`; stage only the task's files; commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional type, trailer `Co-Authored-By: <your model>`.
- G2 No Prisma schema change and no migration in this wave (Collection/CollectionItem already exist).
- G3 Tenant comes from `context.tenantId`, never the body. Validation only through `defineRoute` zod schemas (transport 422 `VALIDATION`); no handler-side parsing returning 400.
- G4 Every write route: `idempotent: true`, `POST` (repo convention: update = `POST /x/:id`, delete = `POST /x/:id/delete`).
- G5 Permissions use the existing `collections` resource (already in `SHOP_RESOURCES`, `packages/auth/src/role-table-access-control.ts`): `collections:read|create|update|publish|delete`. Do not edit the role table.
- G6 Brand lock: `@platform/ui` components and semantic tokens only, Lucide icons only, no hex colours, no font/radius/button-shape changes (`AGENTS.md`, `docs/ui/BRAND_LOCK.md`).
- G7 i18n: new strings in `apps/admin-web/src/messages/en.ts` AND `ar.ts` (same keys). Logical CSS (`ms-*`, `text-start`, `border-e`), chevrons `rtl:rotate-180`. Product names inside `<bdi dir="auto">`.
- G8 admin-web UI rules: destructive confirms use the real `Dialog` (title, `DialogDescription` warning, initial focus on Cancel, Escape closes, focus returns to trigger). Server actions call `revalidatePath` for every affected path after EVERY write that reached the API, ok or not. Non-disclosure / dialog tests query `document.body`. New test files start with `expect.hasAssertions()`.
- G9 pnpm: `PNPM="node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs"`. For commits prepend a scratch dir with a `pnpm` shim to PATH (`#!/bin/sh` + `exec node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs "$@"`). Never skip hooks. Do NOT run `next build`.
- G10 Dependencies are installed by Opus before dispatch; do not run `pnpm install`.

---

### Task 1 — Collections admin API (implementer: terra)

**Goal:** guarded admin routes over the existing `CollectionController` (`services/catalog/src/interfaces/collection.controller.ts`), so admin-web can manage manual collections.

**Files**

- Create `apps/admin/src/interfaces/collections.admin-controller.ts`
- Create `apps/admin/src/interfaces/collections.admin-controller.test.ts`
- Create `apps/admin/src/http/collections-routes.ts`
- Create `apps/admin/src/http/collections-routes.test.ts`
- Modify `apps/admin/src/composition.ts` (facade field + wiring) and the file that registers route groups (find where `adminRoutes(admin)` / other `*Routes(admin)` arrays are concatenated in `apps/admin/src/http/server.ts` or `admin-routes.ts`; register `collectionsRoutes(admin)` the same way).

**Interfaces**

```ts
// collections.admin-controller.ts
import type { CollectionController } from "@platform/catalog";
export interface CollectionsAdminControllerDeps {
  readonly collections: CollectionController;
  readonly guard: AdminGuard;
}
export class CollectionsAdminController {
  constructor(deps: CollectionsAdminControllerDeps);
  list(p: Principal, i: Parameters<CollectionController["list"]>[0]): Promise<AdminResponse>; // collections:read
  getByIds(
    p: Principal,
    i: Parameters<CollectionController["getByIds"]>[0],
  ): Promise<AdminResponse>; // collections:read
  listMemberProducts(
    p: Principal,
    i: Parameters<CollectionController["listMemberProducts"]>[0],
  ): Promise<AdminResponse>; // collections:read
  create(p: Principal, i: Parameters<CollectionController["create"]>[0]): Promise<AdminResponse>; // collections:create
  rename(p: Principal, i: Parameters<CollectionController["rename"]>[0]): Promise<AdminResponse>; // collections:update
  addProduct(p, i: Parameters<CollectionController["addProduct"]>[0]): Promise<AdminResponse>; // collections:update
  removeProduct(p, i: Parameters<CollectionController["removeProduct"]>[0]): Promise<AdminResponse>; // collections:update
  reorderProducts(
    p,
    i: Parameters<CollectionController["reorderProducts"]>[0],
  ): Promise<AdminResponse>; // collections:update
  publish(p, i: Parameters<CollectionController["publish"]>[0]): Promise<AdminResponse>; // collections:publish
  unpublish(p, i: Parameters<CollectionController["unpublish"]>[0]): Promise<AdminResponse>; // collections:publish
  delete(p, i: Parameters<CollectionController["delete"]>[0]): Promise<AdminResponse>; // collections:delete
}
```

Each method = `const denied = await this.guard.ensure(principal, "<perm>"); if (denied) return denied; return this.collections.<method>(input);` — same shape as `ProductsAdminController.createBrand`.

Facade: add `readonly collections: CollectionsAdminController;` next to `readonly products: ProductsAdminController;` (composition.ts ~line 528) and construct it next to `products: new ProductsAdminController({...})` (~line 1398) with `collections: catalog.collections` and the same `guard`. List every test object literal that builds this facade type (grep `products: new ProductsAdminController` and any `as AdminControllers`/facade fakes in `apps/admin/src/**/*.test.ts`) and add the new field there too.

**Admin DTO** (in `collections-routes.ts`):

```ts
export interface AdminCollectionDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "draft" | "published";
  readonly productIds: readonly string[];
  readonly productCount: number;
}
export function toAdminCollectionDto(c: Collection): AdminCollectionDto;
```

Reuse `mapPage` from `./public-catalog-routes` for the list.

**Routes** (`export function collectionsRoutes(admin: AdminControllers): RouteDefinition[]` — use the exact facade/route types `admin-routes.ts` uses):

| method                                                                                                                                                                                                                                                 | path                                                    | perm                | schema                                                                | handler                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                                                                                                                                                                                                                                                    | `/collections`                                          | collections:read    | query `{ first?: int 1..100, after?: string, query?: string(min 1) }` | `mapPage(list({...query, tenantId}), toAdminCollectionDto)`                                                                                                                                                                                           |
| GET                                                                                                                                                                                                                                                    | `/collections/:collectionId`                            | collections:read    | params uuid                                                           | `getByIds({ ids:[id], tenantId })`; empty → `{status:404, body:{error:{code:"NOT_FOUND"}}}` using the repo's existing not-found envelope helper (grep how `GET /products/:productId` returns 404 and copy it); else 200 `toAdminCollectionDto(first)` |
| GET                                                                                                                                                                                                                                                    | `/collections/:collectionId/products`                   | collections:read    | params + cursor query                                                 | `listMemberProducts` passthrough (same response mapping the public `/public/collections/:slug/products` route uses for products)                                                                                                                      |
| POST                                                                                                                                                                                                                                                   | `/collections`                                          | collections:create  | body `{ name: string.min(1).max(255), slug: string.min(1).max(255) }` | `create`                                                                                                                                                                                                                                              |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId`                            | collections:update  | body `{ name: string.min(1).max(255) }`                               | `rename`                                                                                                                                                                                                                                              |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/products`                   | collections:update  | body `{ productId: uuid }`                                            | `addProduct`                                                                                                                                                                                                                                          |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/products/:productId/delete` | collections:update  | params                                                                | `removeProduct`                                                                                                                                                                                                                                       |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/reorder`                    | collections:update  | body `{ productIds: uuid[] (max 500) }`                               | `reorderProducts`                                                                                                                                                                                                                                     |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/publish`                    | collections:publish | params                                                                | `publish`                                                                                                                                                                                                                                             |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/unpublish`                  | collections:publish | params                                                                | `unpublish`                                                                                                                                                                                                                                           |
| POST                                                                                                                                                                                                                                                   | `/collections/:collectionId/delete`                     | collections:delete  | params                                                                | `delete`                                                                                                                                                                                                                                              |
| Input field names for each controller call: read the `*Input` interfaces in `services/catalog/src/application/*-collection*.use-case.ts` and pass exactly those names (e.g. `CreateCollectionInput = { name, slug, tenantId }`). Do not invent fields. |

**Tests (input → expected)**
`collections.admin-controller.test.ts` (fake guard returning a 403 `AdminResponse` for a named permission, fake controller recording calls):

1. guard denies `collections:create` → `create` returns the guard's response and the fake controller recorded 0 calls.
2. guard allows → `rename(p, {id, name:"Summer", tenantId:"t-1"})` returns the controller's response, controller recorded one `rename` call with that exact input.
3. Each of the 11 methods asks the guard for the permission in the table (table-driven, 11 cases).
   `collections-routes.test.ts` (in-process Fastify like `admin-http.e2e.test.ts`, staff role `admin`, header `x-tenant-id: t-1`):
4. `POST /api/v1/collections` `{name:"Summer",slug:"summer"}` → 2xx with `{ id }`; then `GET /api/v1/collections` → items contains `{name:"Summer", slug:"summer", status:"draft", productCount:0}`.
5. Same slug twice → second returns 409 (ConflictError mapping).
6. `POST /api/v1/collections` `{name:"",slug:"x"}` → 422 `VALIDATION`.
7. `GET /api/v1/collections/<random uuid>` → 404.
8. publish then publish again → second is the BusinessRuleError mapping (422 or 409 — assert whatever the transport maps `BusinessRuleError` to today; read the mapping, do not guess).
9. viewer role → `GET /collections` 200, `POST /collections` 403.
10. tenant isolation: create under `t-1`, `GET /collections/:id` with `x-tenant-id: t-2` → 404.
    If the in-process server has no catalog persistence fake, use the in-memory repositories `wireCatalog` uses in other route tests (grep `InMemoryCollectionRepository` / how `admin-http.e2e.test.ts` gets products); if none exists for collections, test routes against a fake `CollectionsAdminController` instead and keep tests 4–10 asserting status/body mapping.

**Commands (must pass)**

- `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin test -- collections` → all new tests pass.
- `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin typecheck` → exit 0.

**Do NOT:** change services/catalog domain or use cases, add smart/automated collections, add description/image/SEO fields (no columns exist), touch the public collection routes.

**Amendments (binding) — Plan review 1 (the amendment wins over the task text above)**

_Plan review 1, finding 2 — exact controller inputs and error contracts._ Every controller call gets `tenantId: context.tenantId` plus exactly these fields (verified in `services/catalog/src/application/*collection*.use-case.ts`):

- list `{ first?, after?, query? }`; getByIds `{ ids }`; create `{ name, slug }`; rename `{ collectionId, name }`; addProduct / removeProduct `{ collectionId, productId }`; reorderProducts `{ collectionId, productIds }`; publish / unpublish / delete `{ collectionId }`.
- The recorder test (Task 1 test 2) asserts `rename` was called with `{ collectionId, name: "Summer", tenantId: "t-1" }` (not `id`).
- `GET /collections/:collectionId`: call `getByIds`; if `response.status !== 200` return the response unchanged; if the array is empty return `{ status: 404, body: toErrorEnvelope(new NotFoundError("Collection not found")) }` (`toErrorEnvelope` from `@platform/utils`, `NotFoundError` from the same module the catalog presenter uses); else 200 with `toAdminCollectionDto(items[0])`.
- Status codes come from `services/catalog/src/interfaces/presenter.ts` `STATUS_BY_CODE`. Tests assert exactly: create → 201; duplicate slug → 409 with code `CONFLICT`; second publish → 409 with code `BUSINESS_RULE`; absent id and foreign-tenant id → 404 `NOT_FOUND`; empty name → 422 `VALIDATION`. Every independent POST in a test uses its own `Idempotency-Key`.

_Plan review 1, finding 1 — admin member endpoint (replaces the `listMemberProducts` row in the routes table; do NOT use `ListCollectionProducts`, it is storefront-only: takes a slug, 404s drafts, hides unpublished products)._

- Add `CollectionsAdminController.listMembers(p, { collectionId, first?, after?, tenantId })` (`collections:read`) implemented in the admin controller: (1) `collections.getByIds({ ids:[collectionId], tenantId })` → non-200 passthrough, empty → 404 as above; (2) take the collection's ordered `productIds`, cursor = stringified start index (`after` = index of the last returned item, default `first` 50, max 100); (3) `products.getByIds({ ids: pageIds, tenantId })` via the catalog `ProductController` (add `products: ProductController` to `CollectionsAdminControllerDeps`, wired with `catalog.products`); (4) return 200 `{ items: AdminCollectionMemberDto[], pageInfo: { hasNextPage, endCursor } }` in collection order.
- `interface AdminCollectionMemberDto { productId: string; position: number; name: string | null; status: "draft"|"scheduled"|"published"|"unlisted"|"archived" | null; missing: boolean }` — `missing: true` (name/status null) when the product id no longer resolves (deleted), so the merchant can still remove it.
- Route: `GET /collections/:collectionId/products` → `listMembers`. Querystring `{ first?: int 1..100, after?: string }`.
- Tests: draft collection holding one draft and one published product returns both; membership order `[B, A]` differs from catalog creation order `[A, B]` and the response keeps `[B, A]`; `first: 1` returns one item with `hasNextPage: true` and the second page returns the other; a deleted member comes back with `missing: true`.
- Task 2: `lib/api/collections.ts` adds `fetchCollectionMembers(id, { first?, after? })` returning `{ outcome:"ok"; items: CollectionMemberDto[]; pageInfo } | not_found | unauthorized | error`, mirroring the DTO above. The products card renders rows from this endpoint (no thumbnail in this wave), shows a "Product deleted" label for `missing` rows, and reorder always sends the collection's complete `productIds` (from `fetchCollection`), never just the current page.

_Plan review 1, finding 3 — route tests use the real in-process graph._

- Build the server with `createAdminHttpApi` (as `admin-http.e2e.test.ts` does) with no Prisma and no pinned tenant, so `wireCatalog` installs `InMemoryCollectionRepository`/in-memory products.
- `idGenerator: { generate: () => crypto.randomUUID() }` (no counter suffix — the new routes validate UUIDs).
- Authenticator maps two tokens: `"admin-token"` → `{ id:"staff-1", kind:"staff", roles:["admin"] }`, `"viewer-token"` → `{ id:"staff-2", kind:"staff", roles:["viewer"] }`; inject `accessControl: new RoleTableAccessControl()` (from `@platform/auth`) into BOTH guards the server and composition accept (`server.ts` ~136–147, `composition.ts` ~1225) so the viewer 403 is real. Read those two sites and pass the option they expose.
- Inject at `/api/v1/...`; bodyless POSTs send no `content-type`; `afterAll(() => app.close())`.
- Products for member tests are created through the existing `POST /api/v1/products` route in the same server.
- Controller unit tests may use `vi.spyOn` on real `AdminGuard`/`CollectionController` instances or a `Pick<CollectionController, ...>` typed fake; do not fake permission, persistence or tenant isolation in the route tests.

**Amendments (binding) — Plan review 1, findings 6–7 (the amendment wins over the task text above)**

_Plan review 1, finding 6 — no reorder cap._ The reorder body schema is `{ productIds: z.array(z.string().uuid()) }` with no `.max()` (the shared HTTP body limit still applies). Add a route test: a collection with 501 members accepts a full valid reorder (200); the same list with one id missing → 409 `BUSINESS_RULE`; with a duplicate id → 409 `BUSINESS_RULE`.

_Plan review 1, finding 7 — commands (replace the Task 1 commands)._

- `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run collections` → all new tests pass.
- `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false` → exit 0.

_Plan review 1, finding 9 (Task 1 part)._ The route tests keep the real `RoleTableAccessControl` viewer case: viewer `GET /collections` → 200, viewer `POST /collections` → 403.

---

### Task 2 — Collections UI in admin-web (implementer: sonnet)

**Depends on:** Task 1 routes and `AdminCollectionDto`.

**Files**

- Create `apps/admin-web/src/lib/api/collections.ts` + `collections.test.ts`
- Create `apps/admin-web/src/app/collections/page.tsx`, `app/collections/new/page.tsx`, `app/collections/[collectionId]/page.tsx`, `app/collections/actions.ts`, `app/collections/actions.test.ts`
- Create `apps/admin-web/src/components/collections/collections-table.tsx` (+ `.test.tsx`), `collection-products-card.tsx` (+ `.test.tsx`), `collection-delete-dialog.tsx`, `collection-product-picker.tsx`
- Modify `apps/admin-web/src/components/navigation.ts` (add Collections), `messages/en.ts`, `messages/ar.ts`, `src/middleware.ts` only if routes need an explicit role entry (check how `/brands` is classified and mirror it).

**API client** (`lib/api/collections.ts`, same patterns as `lib/api/brands.ts`):

```ts
export interface CollectionDto {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  productIds: readonly string[];
  productCount: number;
}
export function fetchCollectionsPage(q: {
  first?: number;
  after?: string;
  query?: string;
}): Promise<FetchCollectionsPageResult>; // GET /api/v1/collections?...
export function fetchCollection(
  id: string,
): Promise<
  | { outcome: "ok"; collection: CollectionDto }
  | { outcome: "not_found" }
  | { outcome: "unauthorized" }
  | { outcome: "error"; message: string }
>;
export function createCollection(
  i: { name: string; slug: string },
  key: string,
): Promise<MutationResult<{ id: string }>>;
export function renameCollection(
  id: string,
  name: string,
  key: string,
): Promise<MutationResult<unknown>>;
export function addCollectionProduct(
  id: string,
  productId: string,
  key: string,
): Promise<MutationResult<unknown>>;
export function removeCollectionProduct(
  id: string,
  productId: string,
  key: string,
): Promise<MutationResult<unknown>>;
export function reorderCollectionProducts(
  id: string,
  productIds: readonly string[],
  key: string,
): Promise<MutationResult<unknown>>;
export function publishCollection(id: string, key: string): Promise<MutationResult<unknown>>;
export function unpublishCollection(id: string, key: string): Promise<MutationResult<unknown>>;
export function deleteCollection(id: string, key: string): Promise<MutationResult<unknown>>;
```

Every path uses `encodeURIComponent` on ids.

**Pages (Shopify layout)**

- `/collections`: title "Collections", primary button "Create collection" → `/collections/new`; search box (`query`); table columns: Title (link to detail), Products (count), Status badge (Active = published, Draft = draft); empty state "Group your products into categories" + Create button; cursor pagination like `components/discounts/discounts-pagination.tsx`. `activeNavId="collections"`.
- `/collections/new`: Title field + Handle (slug) field pre-filled from title (lowercase, spaces→`-`, strip non `[a-z0-9-]`; Arabic titles → empty slug the merchant must type), Save → create → redirect to `/collections/<id>`.
- `/collections/[collectionId]`: back link, Title card (rename, Save), Status card (Active/Draft select → publish/unpublish), Products card: list in collection order with thumbnail/title (`<bdi dir="auto">`), Move up / Move down buttons (reorder with the full permutation), Remove button; "Browse" opens `collection-product-picker` (reuse the search behaviour of `components/draft-orders/draft-product-picker.tsx`: debounced 300 ms search, stale answers dropped by a request counter; picks a product, not a variant). Delete collection button → `collection-delete-dialog` (G8). Product rows resolve titles via the existing products API (`lib/api/products.ts` list/get by ids — use whatever by-ids or list function exists; if none, call `GET /collections/:id/products`).
- 404 from `fetchCollection` → Next `notFound()`.

**Actions** (`app/collections/actions.ts`, shape of `app/brands/actions.ts`): `createCollectionAction`, `renameCollectionAction`, `setCollectionStatusAction` (value `published|draft`), `addCollectionProductAction`, `removeCollectionProductAction`, `moveCollectionProductAction` (direction `up|down`, computes the permutation from the current `productIds` sent in the form), `deleteCollectionAction` (redirect to `/collections` on ok). After every write that reached the API (any outcome except a local validation error): `revalidatePath("/collections")` and `revalidatePath(\`/collections/${id}\`)`.

**Navigation:** in `PRIMARY_NAV` products children insert first: `{ id: "collections", label: (t) => t.nav.collections, href: "/collections", Icon: LayersIcon }` (Shopify order: Collections, Inventory, …). `sectionIds` unchanged otherwise.

**i18n keys:** `nav.collections` ("Collections" / "المجموعات") and a `collections` group with every visible string.

**Tests (input → expected)**

1. `fetchCollectionsPage({first:20, query:"sum"})` → fetch URL `http://runtime.test/api/v1/collections?first=20&query=sum`; 200 body maps to `{outcome:"ok", items, pageInfo}`; 401 → `{outcome:"unauthorized"}`.
2. `createCollection({name:"Summer",slug:"summer"},"k1")` → POST `/api/v1/collections`, body JSON equal, header `Idempotency-Key: k1`.
3. `removeCollectionProduct("c 1","p/2","k")` → path `/api/v1/collections/c%201/products/p%2F2/delete`.
4. `moveCollectionProductAction` with productIds `[a,b,c]`, product `b`, `up` → API called with `[b,a,c]`; `a` + `up` → no API call, returns error state (already first).
5. `deleteCollectionAction` API returns 409 → `revalidatePath` still called for both paths.
6. `CollectionsTable` with one draft collection → row shows title link to `/collections/<id>`, count `0`, badge text `en.collections.statusDraft`.
7. Delete dialog: open → `document.body` has role `dialog` named by the title, focus is on Cancel; Escape closes and focus returns to the trigger.
8. `navigation.test.tsx`: products section children ids start with `["collections","categories","inventory"]`; `isInSection(products,"collections")` true.
9. Arabic: rendering `CollectionsTable` with `ar` dictionary shows `ar.collections` strings (no English fallback).

**Commands:** `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web test -- collections navigation` and `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck` → pass.

**Amendments (binding) — Plan review 1, findings 4–9 (the amendment wins over the task text above)**

_Plan review 1, finding 4 — picker search action._ Add to `app/collections/actions.ts`:

```ts
export interface CollectionPickerProduct {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}
export async function searchCollectionProductsAction(
  q: string,
): Promise<readonly CollectionPickerProduct[]>;
```

Body: `const query = typeof q === "string" ? q.trim().slice(0, 100) : "";` → `fetchProductsPage({ first: 50, ...(query === "" ? {} : { query }) })` (from `@/lib/api/products`, server-side) → on non-ok return `[]` → map EVERY returned item (no status filter, unlike `searchDraftProductsAction`) to `{ id, name, status }`, `.slice(0, 20)`. Never fetch variants. `collection-product-picker.tsx` is a client component that calls only this action; it copies from the draft picker only the 300 ms debounce, the request counter that drops stale answers, and the real `Dialog`. Every product name in the picker renders in `<bdi dir="auto">`. Tests: a draft and a published product are both listed and pickable; picking returns the product id with no variant call; no action call before 300 ms (fake timers); an older slower response arriving after a newer one does not replace the list.

_Plan review 1, finding 5 — member pagination on the detail page._ The detail page reads `searchParams.membersPage` (integer ≥ 1, anything else → 1), page size 50, and calls `fetchCollectionMembers(id, { first: 50, ...(page > 1 ? { after: String((page - 1) * 50 - 1) } : {}) })`. The products card shows "Previous" / "Next" links (`?membersPage=n-1` / `n+1`; Next only when `pageInfo.hasNextPage`) and keeps no other search params. Move up / Move down use the row's global `position` against the collection's full `productIds` from `fetchCollection` (so a move across a page boundary works); Remove is shown on every row including `missing` rows on any page. Test: a collection with 51 members, page 2 shows member 51; removing it calls `removeCollectionProduct` with its id; Move up on member 51 sends the full 51-id permutation with members 50 and 51 swapped.

_Plan review 1, finding 6 — no reorder cap._ The reorder body schema is `{ productIds: z.array(z.string().uuid()) }` with no `.max()` (the shared HTTP body limit still applies). Route test: a collection with 501 members accepts a full valid reorder (200); the same list with one id missing → 409 BUSINESS_RULE; with a duplicate → 409 BUSINESS_RULE.

_Plan review 1, finding 7 — targeted test commands (replace every `test -- …` command in Tasks 1–3)._

- Task 1: `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run collections`
- Task 2: `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run collections navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- Task 3: `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run settings navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- Typecheck (each task, its package): `… --filter @platform/admin exec tsc --noEmit --incremental false` / `… --filter admin-web exec tsc --noEmit --incremental false` (same quoted `cd` and pnpm path). Do not run a whole-package suite through `test --`.

_Plan review 1, finding 9 — middleware (Task 2 part)._ Add to `ROUTE_ROLE_REQUIREMENTS` in `apps/admin-web/src/middleware.ts`, before less specific entries: `["/collections/new", "operator"]`, `["/collections", "viewer"]`. Add `middleware.test.ts` cases: viewer may open `/collections` and `/collections/<id>`; viewer is redirected from `/collections/new`; operator may open `/collections/new`. The existing PRIMARY_NAV child-href walk in `middleware.test.ts` must stay green with the new Collections link.

---

### Task 3 — Shopify sidebar labels + Settings sub-navigation (implementer: sonnet, UI-only)

**Files**

- Modify `apps/admin-web/src/components/navigation.ts`, `components/navigation.test.tsx`, `messages/en.ts`, `messages/ar.ts`
- Create `apps/admin-web/src/components/settings/settings-nav.tsx` + `settings-nav.test.tsx`
- Create `apps/admin-web/src/components/settings/settings-frame.tsx` (layout wrapper: SettingsNav on the start side, page content on the end side; stacked under 1024px with the nav as a select/list on top)
- Create `apps/admin-web/src/app/settings/[section]/page.tsx` ("not available yet" page for sections Morbeh lacks)
- Modify each existing settings page to render inside `SettingsFrame` with its `activeId`: `app/settings/page.tsx`, `general`, `billing`, `payments`, `shipping`, `taxes`, `domains`, `policies`, and `app/locales/page.tsx`.

**Sidebar (D2, Shopify order and labels)**

- `marketing` item: label key changes to `nav.growth` = "Growth" / "النمو" (keep id `marketing` and href `/marketing` so links and `activeNavId`s keep working). Child `automations` stays.
- `content` item gains children (Shopify: Metaobjects, Files, Menus, Blog posts — only what exists): `{ id: "online-store-navigation", label: t.nav.menus ("Menus"/"القوائم"), href: "/online-store/navigation", Icon: MenuIcon }`. Remove that entry from `ONLINE_STORE_NAV.children`. Every page that passes `activeNavId="online-store-navigation"` keeps working because the id is unchanged; update `navigation.test.tsx` oracles that expected it under Online Store.
- No other renames (Finance and SEO are Morbeh extras and stay).

**Settings sub-navigation — Shopify's 19 entries in this order:**

| #                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | id                | label (en)                 | href                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- | ----------------------------- |
| 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | general           | General                    | `/settings/general`           |
| 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | plan              | Plan                       | `/settings/billing`           |
| 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | billing           | Billing                    | `/settings/billing`           |
| 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | users             | Users                      | `/settings/users`             |
| 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | payments          | Payments                   | `/settings/payments`          |
| 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | checkout          | Checkout                   | `/settings/checkout`          |
| 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | customer-accounts | Customer accounts          | `/settings/customer-accounts` |
| 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | shipping          | Shipping and delivery      | `/settings/shipping`          |
| 9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | taxes             | Taxes and duties           | `/settings/taxes`             |
| 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | locations         | Locations                  | `/inventory`                  |
| 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | markets           | Markets                    | `/settings/markets`           |
| 12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | apps              | Apps and sales channels    | `/settings/apps`              |
| 13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | domains           | Domains                    | `/settings/domains`           |
| 14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | customer-events   | Customer events            | `/settings/customer-events`   |
| 15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | notifications     | Notifications              | `/settings/notifications`     |
| 16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | custom-data       | Metafields and metaobjects | `/settings/custom-data`       |
| 17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | languages         | Languages                  | `/locales`                    |
| 18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | customer-privacy  | Customer privacy           | `/settings/customer-privacy`  |
| 19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | policies          | Policies                   | `/settings/policies`          |
| (Plan and Billing share Morbeh's one page; both entries link there and both highlight when `activeId` is `billing`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Export `SETTINGS_NAV_ITEMS: readonly SettingsNavItem[]` with `{ id, label:(t)=>string, href, available: boolean }`; `available=false` for users, checkout, customer-accounts, markets, apps, customer-events, notifications, custom-data, customer-privacy. Unavailable entries still link (to `/settings/<id>`), show a small "Soon" badge, and their page `app/settings/[section]/page.tsx` renders inside `SettingsFrame` a card: section title + "This section is coming to Morbeh soon." + link back to `/settings`. Unknown `section` (not one of the 9 unavailable ids) → `notFound()`. Static routes (`general`, `billing`, …) take precedence over `[section]` in Next; do not move them. |
| The settings landing `/settings` keeps its current cards but renders inside `SettingsFrame` with no active item; keep the existing usage-counters content and platform-tools logic unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Tests (input → expected)**

1. `SettingsNav` renders 19 links in the table order (assert the label list equals the 19 en labels).
2. `activeId="billing"` → both Plan and Billing links have `aria-current="page"`; `activeId="general"` → only General.
3. Unavailable entry shows the `en.settingsNav.soon` badge; available ones don't.
4. `/settings/[section]` with `section="checkout"` renders the coming-soon title "Checkout"; `section="nope"` calls `notFound` (mock `next/navigation`).
5. `navigation.test.tsx`: content section children ids `["online-store-navigation"]`; online store children no longer contain it; marketing label renders "Growth" with `en`, "النمو" with `ar`.
6. With `ar`, `SettingsNav` labels come from `ar.settingsNav` and the container has no hard-coded `left/right` classes (assert absence of `ml-`/`mr-`/`pl-`/`pr-` in className strings of the rendered nav).

**Commands:** `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web test -- settings navigation` and `cd "F:/New folder/morbeh-shopify-parity" && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck` → pass. (Task 3 runs after Task 2 because both touch `navigation.ts` and the message files.)

---

**Amendments (binding) — Plan review 1, findings 7–9 (the amendment wins over the task text above)**

_Plan review 1, finding 7 — commands._ Use the Task 3 command and typecheck lines from the Task 2 amendment block (`exec vitest run settings navigation middleware …` and `exec tsc --noEmit --incremental false`).

_Plan review 1, finding 8 — the two existing navigation oracles that change._

- `components/navigation.test.tsx` top-level label list (currently `en.nav.marketing` at ~line 68): replace with `en.nav.growth`.
- The test "puts Navigation right after Pages under Online Store (Part 2)" (~lines 111–121): rewrite it to render with `activeId "online-store-navigation"`, query the primary navigation landmark, assert the Content section is expanded and its link labelled `en.nav.menus` has `href="/online-store/navigation"` and `aria-current="page"`, and assert the sales-channels landmark contains no link to `/online-store/navigation`.
- Keep unchanged the Online Store Themes/Pages/Preferences/SEO assertions (~lines 92–109) and the Languages→Settings test (~lines 132–139).
- Keep the `nav.marketing` and `nav.navigation` dictionary keys if any other copy still uses them; only the nav label selectors change.
- Add one shared-consumer regression: `global-search` (or the mobile drawer) lists "Menus" under Content and "Growth" for the marketing item, proving no second nav structure was created.

_Plan review 1, finding 9 — middleware (Task 3 part)._ Leave `/online-store/navigation` (viewer) and `/locales` (viewer) unchanged even though Menus/Languages move in the nav. The nine `/settings/<section>` placeholders stay admin-only through the existing `["/settings", "admin"]` entry; keep the `["/settings/policies", "viewer"]` exception. Add middleware cases: viewer is redirected from `/settings/checkout`; admin may open it; viewer may still open `/online-store/navigation` and `/locales`.

_Review notes folded in._ The `[section]` page awaits `params: Promise<{ section: string }>` (Next 15.5) and checks the nine-id allowlist itself, calling `notFound()` otherwise. Each settings page keeps a single outer `AppShell` with `SettingsFrame` inside it (`languages` active for `/locales`, none for `/settings`) and keeps its existing fetch/error paths and the policies page's viewer/editor distinction. `expect.hasAssertions()` goes inside each test or in `beforeEach`, not at module level.

## Execution order

Task 1 → Task 2 → Task 3 (serial: Tasks 2 and 3 share `navigation.ts`/messages). Each task: implement → Sol review → fixes → Opus acceptance. Wave 1b (Customers write + Segments + Files page + Users & permissions UI) is planned after this wave lands.
