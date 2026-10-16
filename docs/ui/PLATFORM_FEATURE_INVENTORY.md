# Platform Feature Inventory

> **Status: AUDIT ONLY — no backend or design-system changes.** This document traces every
> bounded context's actual source code (domain, application, HTTP routes, composition wiring,
> persistence) to establish what is real, what is stubbed, and what is missing before any
> product UI is built. It supersedes any prior document's claims about implementation status
> where they conflict with direct code evidence cited here.
>
> Compiled 2026-08-09. Scope: all 39 bounded contexts under `services/` (`services/example` is a
> non-business walking-skeleton reference and is excluded).

## Methodology

Six parallel research passes, each independently tracing a group of bounded contexts against
the live source tree — no capability is inferred from a name, a package description, or an
older report. For every context the following was read directly: the domain model
(`src/domain`), every application use case (`src/application/*.use-case*.ts`), every HTTP route
(`apps/admin/src/http/*.ts`), the composition root (`services/<name>/src/composition.ts`), and
`apps/admin/src/composition.ts` / `apps/runtime/src/composition.ts` / `apps/runtime/src/api.ts`
for how each context actually reaches a running process. Prior audit documents (root-level
`*_REPORT.md`/`*_AUDIT*.md`/`RC_*.md` files and `docs/implementation/*.md`) were cross-checked
against current code and are cited only where confirmed accurate, or explicitly flagged where
found **stale** (i.e., contradicted by direct code reading — this happened repeatedly for one
specific claim, addressed below).

**A rule applied uniformly across all 43 capability rows below, per this audit's brief:**

- A port/interface is never counted as a real integration unless a composition root actually
  constructs a non-stub implementation for it.
- A write-only API (no `GET`/read route, no read use case) is never rated P0/P1 regardless of
  how complete its write side is — a product UI needs to read back what it wrote.
- A capability with zero HTTP route of any kind — even if the domain and use cases are fully
  built and tested — is rated **P3**, not P2: nothing can call it today.

### One correction applied throughout this document

Two composition-root comments — `apps/admin/src/composition.ts:135-141` and
`apps/runtime/src/api.ts:110-114` — both state, verbatim: _"today: Finance, Feature Registry,
Security, Customer 360 [have a Prisma branch]... the other 35 wired contexts have no Prisma
composition branch of their own yet."_ Direct reading of every context's own
`services/<name>/src/composition.ts` shows this is **stale**: at least 33 of the 39 contexts
have a working `deps.prisma !== undefined` branch that constructs real Prisma repositories,
independently corroborated by `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`'s own table (37 contexts
listed as Prisma-confirmed) and by dated per-context milestone reports (`P1_5_*_REPORT.md`,
`FINANCE_M2_REPORT.md`). Only **`analytics`** and **`platform-console`** genuinely have no
Prisma branch — correctly so, since neither owns a persisted aggregate at all. This document
does not repeat "no Prisma branch" as a finding for any context except those two; where it
appears in an older report it has been verified against current code and marked superseded.

---

## Executive summary

| #   | Metric                                                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Total verified capabilities traced                       | **43** (39 bounded contexts; 4 contexts split into sub-capabilities — Catalog, Identity, Media — because their two halves have materially different readiness, plus the storefront's public-read surface counted as its own capability)                                                                                                                                                                                                                                             |
| 2   | P0 — ready for product UI                                | **3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | P1 — valuable but secondary                              | **3**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | P2 — integration/backend gap                             | **33**                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | P3 — not ready                                           | **4**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6   | Contexts exposing ≥1 working HTTP route                  | **37 of 39** (Identity's Customer vertical and Media's Phase-1 Asset slice are fully built and wired into their own composition root but have **zero** HTTP routes anywhere)                                                                                                                                                                                                                                                                                                        |
| 7   | Read/query endpoints found                               | **≈51**, concentrated almost entirely in 6 places: Security (≈21), the 5 public storefront routes, Finance (5), Feature Registry (5), Customer 360 (4), Analytics (4). **27 of 39 contexts expose zero read endpoints at all.**                                                                                                                                                                                                                                                     |
| 8   | Write/mutation endpoints found                           | Several hundred platform-wide (Security alone ≈57 of its ≈78 routes; Catalog's inline surface is the single largest block). Not independently re-totalled to the route in this pass — see each context's own route list below, which is the primary source; treat any single platform-wide write-route total as an estimate, not a verified count.                                                                                                                                  |
| 9   | Confirmed **real** (non-stub) cross-context integrations | **5** — Payments↔Stripe (real PSP, HMAC-verified webhooks); Orders↔Payments via the production Kafka consumer `PaymentCapturedConsumer → MarkOrderPaid`; Security↔Identity via live projection consumers of `identity.user.created`/`identity.user.deactivated`/`identity.customer.consent_changed`; Security↔Ory Kratos/Keto (live session/authorization calls); Shipping↔Notifications via the one real event consumer, `ShipmentShippedConsumer` on `shipping.carrier.accepted`. |
| 10  | Confirmed **stubbed** cross-context integrations         | **≥25 distinct declared ports**, every one resolving to an in-memory fake in _every_ composition path including the "production" one — see [Cross-cutting finding #2](#2-the-g-39-pattern-every-declared-cross-context-port-defaults-to-a-stub-and-nothing-overrides-it) for the full list.                                                                                                                                                                                         |
| 11  | Capabilities with a real, wired frontend UI today        | **1 of 43** — the storefront's Home smoke-screen renders 4 of the 5 public catalog/pricing/inventory reads (products, categories, collections, inventory; `getPrices()` exists in `runtime-api.ts` but is never called by any page).                                                                                                                                                                                                                                                |
| 12  | Capabilities missing a frontend UI                       | **42 of 43.** `apps/admin-web` has exactly one page (the Dashboard, on mock data not wired to any backend) plus two dead nav-link entries (`/content`, `/automations`) with no route behind them.                                                                                                                                                                                                                                                                                   |
| 13  | Major architectural blockers                             | See [Cross-cutting findings](#cross-cutting-findings) — the Temporal purchase saga has zero callers, the stale Prisma-branch comment mis-describes 33 contexts, and Tenancy's own multi-tenant domain model is structurally disabled by the runtime (`TENANT_MODE=multi` throws at boot).                                                                                                                                                                                           |
| 14  | Major production-readiness blockers                      | Payments cannot boot outside `local` under the shipped k8s config (missing `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, plus an unconditional MFA guard); Licensing's billing-collection path is boot-gated to `local` for the same class of reason; Notifications has **no** boot guard despite every channel provider being a hardcoded fake — it will silently "send" nothing, in production, with no warning.                                                                   |

---

## Cross-cutting findings

These patterns recur across many contexts and are the load-bearing facts behind most of the P2
ratings below. Each is cited once here rather than repeated 20 times in the per-context sections.

### 1. Write-only APIs are the norm, not the exception

27 of the 39 bounded contexts expose **zero** `GET`/read routes: Cart, Checkout (general state —
only two narrow handoff-snapshot reads exist), Fulfillment, Shipping, Returns, Tenancy,
Notifications, Identity's Access surface, all 7 Growth/CX contexts (Promotions, Coupons,
Loyalty, Wishlist, Reviews, Search, Recommendations), Reporting, Feature Flags, Experimentation,
Automation, and all 7 Experience-Platform contexts (Content, Localization, SEO, Components,
Theme, Experience, Pages). In every one of these, the domain model and write path are real and
Prisma-persisted — but nothing written through the API can be read back through it. This is the
single largest reason the P0/P1 counts are so low: a product screen needs to display what it
just saved.

### 2. The G-39 pattern: every declared cross-context port defaults to a stub, and nothing overrides it

Every context that depends on another context does so through an outbound port interface — and
in every single case found, the composition root falls back to an `InMemoryXPort` because no
caller supplies a real one. The pattern is always the same: `deps.foo ?? new InMemoryFooPort()`,
with `AdminWiringDeps` in `apps/admin/src/composition.ts` never declaring a `foo` field for that
context to receive. Confirmed instances:

- Coupons → Promotions (`InMemoryPromotionsPort`, always reports "active")
- Wishlist → Cart (`InMemoryCartPort`)
- Reviews → Orders (`InMemoryOrdersPort`, always reports "not purchased")
- Recommendations → Search (`InMemorySearchQueryPort`)
- Search → its own index engine (`InMemoryIndexProvider` — no OpenSearch/pgvector adapter
  exists anywhere in the repo, confirmed by a repo-wide grep)
- Checkout → Pricing, Inventory, Tax/Finance, Shipping, Promotions (all 5 orchestration ports)
- Reporting → Analytics (`InMemoryAnalyticsQuery`)
- Automation → its action dispatcher (`InMemoryActionDispatcher`)
- Licensing → Payments and → FinanceLedger for billing collection (boot-gated outside `local`)
- Notifications → Email, SMS, Push, Webhook (all 4 channels; **no boot guard**, unlike Licensing)
- Fulfillment/Shipping/Returns each declare their own separate `OrdersPort`/`InventoryPort`/etc.
  — none of the four independent `OrdersPort` interfaces across the repo has a real
  implementation anywhere

### 3. The Temporal purchase saga has zero callers

`packages/temporal` contains a fully built, unit-tested, deterministic saga
(`saga/purchase-saga.ts`) implementing the documented pricing→inventory→payment→order
orchestration with compensation (ADR-0012). A repo-wide grep confirms **no file under `apps/`
imports `@platform/temporal`**. The only way an order is created and paid today is the
synchronous admin-HTTP path (`POST /checkouts/:id/complete`, `POST /orders/from-checkout`,
`POST /orders/:id/mark-paid`) or the one real Kafka consumer (`PaymentCapturedConsumer`). The
architecture documents describe a saga that does not run.

### 4. Analytics' real backend is deliberately unwired

`services/analytics` has a real, code-complete `ClickHouseAnalyticsReadStore` — but
`wireAnalytics()` never constructs it; the composition root wires only the metric/dimension
_catalog_ (a registry, no query execution). `docs/implementation/ANALYTICS_V2_REPORT.md` states
this is intentional: _"It depends on a future CDC/projection pipeline that does not exist yet
anywhere in this codebase."_ Finance has the identical shape: `ClickHouseReadModelStore` exists,
is exported, and is never instantiated.

### 5. No cryptographic verification on any external webhook except Stripe's

Payments' webhook route does real HMAC-SHA256 verification with a replay window
(`packages/psp-stripe/src/webhook-signature.ts`). Fulfillment's, Shipping's, and Returns'
carrier/warehouse callback routes are gated behind ordinary admin RBAC + JWT — a real carrier or
3PL system cannot call them without possessing an admin bearer token. This was flagged by
`RC_AUDIT_SECURITY.md` as finding **R2 (Medium)**.

### 6. Persistence durability is inconsistent even where "Prisma-backed" is true

Payments has a durable `PrismaProcessedWebhookStore` for webhook-replay dedup. Fulfillment's,
Shipping's, and Returns' equivalent dedup stores are unconditionally in-memory in _both_
composition branches, even though the Postgres tables for them already exist
(`docs/implementation/ARCHITECTURE_EXECUTION_MATRIX.md:134`). A process restart silently drops
carrier/warehouse replay protection for these three contexts while their main aggregate data
stays durable.

### 7. Two contexts are fully built but completely unreachable

Identity's Customer vertical (`RegisterCustomer`/`AddAddress`/`ChangeConsent`, wired into
`WiredAdmin.customers`, exercised only in `apps/admin/src/admin.e2e.test.ts`) and Media's
Phase-1 Asset slice (`RegisterAsset`, its own separate `wireMedia()` composition function) have
no `defineRoute(...)` anywhere calling into them. This is a routing gap, not a persistence or
stub gap — the fix is one file each.

### 8. Tenancy's own domain model is structurally disabled

`apps/runtime/src/composition.ts` throws if `TENANT_MODE=multi` — every Prisma repository across
the whole platform is pinned to one `tenantId` at process boot (ADR-0008). Tenancy ships a full
multi-tenant `Tenant`/`Workspace` domain model that the runtime cannot currently operate in
multi-tenant mode.

### 9. Old specification documents are measurably stale against current code

Two examples, confirmed by direct reading: `docs/platform/01-WORKFLOW_AUTOMATION_ENGINE_SPEC.md`
states "No application code" for Automation — Automation has 4 fully wired use cases, both
persistence branches, and 4 HTTP routes. The "35 wired contexts have no Prisma branch" comment
(above) is the same pattern at platform scale. Treat any status claim in an older doc as a
hypothesis to verify against code, not as fact — this document only asserts what was directly
read.

---

## Classification table

| Capability                                 | Context/Package                                              | Read API                                                 | Write API                                    | Real cross-ctx?                          | Frontend                          | Tier     |
| ------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | --------------------------------- | -------- |
| Storefront public catalog browsing         | `public-catalog-routes.ts` (spans Catalog/Pricing/Inventory) | ✅ 5 public routes                                       | —                                            | n/a                                      | ✅ partial (4/5 rendered)         | **P0**   |
| Order management (detail/mark-paid/refund) | `services/orders`                                            | ✅ GET by id (no list)                                   | ✅ 7 routes                                  | ✅ real prod consumer                    | ❌                                | **P0**   |
| Catalog — Products                         | `services/catalog`                                           | ✅ list + by-id + public                                 | ✅ ~19 routes                                | n/a                                      | ❌                                | **P0**\* |
| Security                                   | `services/security`                                          | ✅ ~21 routes                                            | ✅ ~57 routes                                | ✅ Kratos/Keto/Identity                  | ❌                                | P1       |
| Feature Registry                           | `services/feature-registry`                                  | ✅ 5 routes                                              | ✅ 12 routes                                 | ✅ feeds Entitlement                     | ❌                                | P1       |
| Finance                                    | `services/finance`                                           | ✅ 5 routes                                              | ✅ 14 routes                                 | partial (real call path, adapters gated) | ❌                                | P1       |
| Catalog — Collections                      | `services/catalog`                                           | ✅ public only                                           | ❌ no admin route                            | n/a                                      | ❌ (public read only)             | P2       |
| Pricing                                    | `services/pricing`                                           | ✅ public only                                           | ✅ 7 routes                                  | n/a                                      | ❌                                | P2       |
| Inventory                                  | `services/inventory`                                         | ✅ public only (`CheckAvailability` has no route at all) | ✅ 8 routes                                  | n/a                                      | ❌                                | P2       |
| Cart                                       | `services/cart`                                              | ❌ none                                                  | ✅ 14 routes                                 | n/a                                      | ❌                                | P2       |
| Media — Library                            | `services/media`                                             | ✅ download-url only                                     | ✅ 4 routes                                  | n/a                                      | ❌                                | P2       |
| Checkout                                   | `services/checkout`                                          | ⚠️ 2 handoff-snapshot reads only                         | ✅ 14 routes                                 | ❌ 5 stub ports                          | ❌                                | P2       |
| Payments                                   | `services/payments`                                          | ✅ GET by id (no list)                                   | ✅ 4 routes                                  | ✅ real Stripe                           | ❌ (boot-blocked outside `local`) | P2       |
| Fulfillment                                | `services/fulfillment`                                       | ❌ none                                                  | ✅ 5 routes                                  | ❌ 4 stub ports                          | ❌                                | P2       |
| Shipping                                   | `services/shipping`                                          | ❌ none                                                  | ✅ 7 routes                                  | ❌ 3 stub ports                          | ❌                                | P2       |
| Returns                                    | `services/returns`                                           | ❌ none                                                  | ✅ 8 routes                                  | ❌ 5 stub ports                          | ❌                                | P2       |
| Identity — Access (staff/orgs)             | `services/identity`                                          | ❌ none                                                  | ✅ 7 routes                                  | n/a                                      | ❌                                | P2       |
| Customer 360                               | `services/customer-360`                                      | ✅ 4 routes (data never populated live)                  | ❌ ~31 use cases unreachable                 | ❌ no event feed wired                   | ❌                                | P2       |
| Tenancy                                    | `services/tenancy`                                           | ❌ none                                                  | ✅ 8 routes                                  | n/a                                      | ❌                                | P2       |
| Notifications                              | `services/notifications`                                     | ❌ none                                                  | ✅ 6 routes                                  | ❌ 4 stub channels, no boot guard        | ❌                                | P2       |
| Promotions                                 | `services/promotions`                                        | ⚠️ evaluate-only (POST)                                  | ✅ 4 routes                                  | ❌ never called by real consumer         | ❌                                | P2       |
| Coupons                                    | `services/coupons`                                           | ❌ none                                                  | ✅ 3 routes                                  | ❌ Promotions stub                       | ❌                                | P2       |
| Loyalty                                    | `services/loyalty`                                           | ❌ none                                                  | ✅ 7 routes                                  | n/a (no ports declared)                  | ❌                                | P2       |
| Wishlist                                   | `services/wishlist`                                          | ❌ none                                                  | ✅ 6 routes                                  | ❌ Cart stub                             | ❌                                | P2       |
| Reviews                                    | `services/reviews`                                           | ❌ none                                                  | ✅ 6 routes                                  | ❌ Orders stub                           | ❌                                | P2       |
| Search                                     | `services/search`                                            | ❌ none (no query use case exists)                       | ✅ 8 routes                                  | ❌ index engine stub                     | ❌                                | P2       |
| Recommendations                            | `services/recommendations`                                   | ❌ none                                                  | ✅ 4 routes                                  | ❌ Search stub (both ends)               | ❌                                | P2       |
| Reporting                                  | `services/reporting`                                         | ❌ none                                                  | ✅ 5 routes                                  | ❌ Analytics stub                        | ❌                                | P2       |
| Feature Flags                              | `services/feature-flags`                                     | ❌ none                                                  | ✅ 5 routes                                  | n/a                                      | ❌                                | P2       |
| Experimentation                            | `services/experimentation`                                   | ❌ none                                                  | ✅ 4 routes                                  | n/a                                      | ❌                                | P2       |
| Automation                                 | `services/automation`                                        | ❌ none                                                  | ✅ 4 routes                                  | ❌ dispatcher stub                       | ❌ (dead nav link)                | P2       |
| Analytics                                  | `services/analytics`                                         | ✅ 4 routes (catalog only, no real numbers)              | n/a (read-only by design)                    | n/a                                      | ❌ (dead nav link)                | P2       |
| Licensing                                  | `services/licensing`                                         | ✅ 1 route (usage)                                       | ✅ 12 routes (13 more use cases unreachable) | partial, boot-gated                      | ❌                                | P2       |
| Content                                    | `services/content`                                           | ❌ none                                                  | ✅ 3 routes                                  | n/a                                      | ❌ (dead nav link)                | P2       |
| Localization                               | `services/localization`                                      | ❌ none                                                  | ✅ 4 routes                                  | n/a                                      | ❌                                | P2       |
| SEO                                        | `services/seo`                                               | ❌ none (no sitemap.xml/robots.txt delivery)             | ✅ 5 routes                                  | n/a                                      | ❌                                | P2       |
| Components                                 | `services/components`                                        | ❌ none                                                  | ✅ 2 routes                                  | n/a                                      | ❌                                | P2       |
| Theme                                      | `services/theme`                                             | ❌ none                                                  | ✅ 3 routes                                  | ✅ real `@platform/design` seed          | ❌                                | P2       |
| Pages                                      | `services/pages`                                             | ❌ none (no public page delivery)                        | ✅ 4 routes                                  | n/a                                      | ❌                                | P2       |
| Media — Phase-1 Assets                     | `services/media`                                             | ❌ none                                                  | ❌ none (dead code, unwired)                 | n/a                                      | ❌                                | **P3**   |
| Identity — Customer (accounts)             | `services/identity`                                          | ❌ none                                                  | ❌ none (0 HTTP routes, fully built)         | n/a                                      | ❌                                | **P3**   |
| Platform Console                           | `services/platform-console`                                  | ⚠️ 1 route, always-empty (no live event feed)            | n/a                                          | ❌ aspirational only                     | ❌                                | **P3**   |
| Experience (Canvas builder)                | `services/experience`                                        | ❌ none                                                  | ✅ 3 routes (stores a tree nobody renders)   | n/a                                      | ❌                                | **P3**   |

\* Catalog — Products is rated P0 with one flagged defect: variant price/selection edits are
silently dropped on update (`CPI-1`, confirmed critical, see the Catalog dossier below) — this
must be fixed before shipping a Variants editing panel specifically; Product create/publish/SEO/
brand/category management is unaffected.

---

## Full per-context dossiers

Grouped by the six research areas. Every fact below was traced to source by the corresponding
research pass; file paths are repo-relative to `morbeh-platform/`.

### Commerce Foundation

#### Catalog — `services/catalog` (`@platform/catalog`)

- **Domain capabilities:** `Product`, `Brand`, `Category`, `Collection` (all aggregates),
  `Variant` (entity); value objects `Sku`, `Slug`, `Seo`, `PublishState`, `ProductOption`,
  `VariantSelection`.
- **Application use cases:** 18 for Products (create/update/get/list/delete/archive/publish/
  unpublish/schedule-publish/add-variant/update-variant/remove-variant/set-options/set-seo/
  set-brand/assign-categories/attach-media/detach-media/reorder-media), 3 for Brands, 4 for
  Categories, 10 for Collections (create/rename/delete/publish/unpublish/list/add-product/
  remove-product/move-product/reorder — all implemented, unit-tested, wired).
- **Read endpoints:** `GET /products`, `GET /products/:productId`, `GET /categories` (all
  admin-authenticated) + `GET /api/v1/public/{products,categories,collections}` (public).
- **Write endpoints:** ~19 product routes, brand/category CRUD, all inline in
  `apps/admin/src/http/admin-routes.ts` (no dedicated `catalog-routes.ts` file exists).
  **Collections has no admin write route at all** — `services/catalog/src/composition.ts:90`:
  "Package-internal only — no `apps/admin` surface (Sprint 7.0 §13, 'No UI' scope)."
- **Persistence:** Prisma in production (`prisma-catalog-repositories.ts`), in-memory for tests.
  Composition branches correctly on `deps.prisma`. **Zero test file anywhere references the
  Prisma repository classes** — no integration test covers the production persistence path.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:348` (`wireCatalog(deps)`);
  reaches production only via `apps/runtime/src/api.ts` threading `prisma`/`tenantId` through
  `createAdminHttpApi`. Also seeded directly by `apps/runtime/src/seed.ts`.
- **Cross-context dependencies:** none real or stub — Catalog holds only bare-id refs
  (`BrandRef`, `CategoryRef`, `MediaRef`) into other aggregates it owns or Media.
- **Authentication/authorization:** JWT `Principal` + per-route RBAC permission (e.g.
  `products:create`, `products:publish`) for every admin route; the 3 public routes require
  neither.
- **Frontend route:** none in `apps/admin-web`; `apps/storefront`'s Home page calls
  `getProducts()`/`getCategories()`/`getCollections()` against the public routes.
- **Known gaps (verbatim, `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md`):**
  - **CPI-1 (Critical, confirmed):** "Prisma repo silently drops variant price/selection edits
    (`skipDuplicates` on unchanged PK)... the use case still returns 200 and increments the
    version." Silent data loss on a merchant-facing admin action.
  - **CPI-2 (Critical, confirmed):** "Catalog persists its own price, duplicating Pricing's
    authority" — Checkout's real pricing path never reads it, so it can silently drift.
- **Production-readiness status:** Product CRUD is real and reachable; Variants editing must not
  ship until CPI-1 is fixed; Collections has no admin authoring surface at all.

#### Pricing — `services/pricing` (`@platform/pricing`)

- **Domain capabilities:** `PriceList`, `Price`, `PricingRule`, `TaxClass` (all aggregates).
- **Application use cases:** `CreatePriceList`, `ActivatePriceList`, `CreatePrice`,
  `ChangePrice`, `PublishPrice`, `ListPrices` (read), `CreatePricingRule`, `CreateTaxClass`.
- **Read endpoints:** none admin-side — `ListPrices` has no reachable admin route;
  `PricingAdminController` exposes only create/activate. Only public read is
  `GET /api/v1/public/prices` (deliberately withholds `cost`/`compareAt`).
- **Write endpoints:** 7, inline in `admin-routes.ts` (`// -- Pricing... Sprint 4.4 --`).
- **Persistence:** Prisma (`prisma-pricing-repositories.ts` + `prisma-pricing-registry-
repositories.ts`) vs. in-memory; working `deps.prisma` branch confirmed.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:353`; production via
  `createAdminHttpApi` indirection; also seeded by `apps/runtime/src/seed.ts:89`.
- **Cross-context dependencies:** none — `Price` holds a bare `ProductRef`.
- **Auth:** JWT + RBAC on all admin routes; public route open.
- **Frontend route:** none admin-side; storefront calls `getPrices()` — but the storefront
  page never actually invokes it (confirmed by reading `apps/storefront/src/app/page.tsx`).
- **Known gaps:** **CPI-3 (High, confirmed):** "No invariant against multiple concurrently-
  published prices... a retried/duplicate `CreatePrice` call creates two published prices...
  a customer could be charged a stale or wrong amount." **CPI-8 (Medium):** `PricingRule` is
  built but never consulted at checkout — "Determination only — never applied."
- **Production-readiness status:** Not P0-viable as-is: no way to browse/audit existing prices
  from the admin API, and the concurrent-publish race is a real correctness risk.

#### Inventory — `services/inventory` (`@platform/inventory`)

- **Domain capabilities:** `InventoryItem`, `Warehouse` (aggregates), `Reservation` (entity).
- **Application use cases:** `ReceiveStock`, `AdjustInventory`, `ReserveStock`,
  `ReleaseReservation`, `CommitReservation`, `TransferStock`, `RegisterWarehouse`,
  `DeactivateWarehouse` (writes); `ListInventoryItems`, `CheckAvailability` (reads).
- **Read endpoints:** `CheckAvailability` has **no route at all**, admin or public.
  `ListInventoryItems` is reachable only via `GET /api/v1/public/inventory`.
- **Write endpoints:** 8, inline in `admin-routes.ts` (`// -- Inventory... Sprint 4.3 --`).
- **Persistence:** Prisma (`prisma-inventory-item-repository.ts` + `prisma-warehouse-
repository.ts`) vs. in-memory; working branch confirmed. Zero test coverage of the Prisma
  classes.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:349`; production via the
  standard indirection; also seeded directly.
- **Cross-context dependencies:** none real — `ReserveStock.reference` is a bare string
  "meant to hold an order/cart reference," but Cart never calls Inventory in code.
- **Auth:** JWT + RBAC on all admin routes; public route open (withholds live reservations).
- **Frontend route:** none admin-side; storefront calls `getInventory()`.
- **Known gaps:** **CPI-5 (Medium):** no referential integrity Inventory↔Warehouse.
  **CPI-6 (Medium):** N+1 query in `CheckAvailability`. **CPI-10 (Low):** reservation set fully
  rewritten on every save. **SAGA-4 (Critical):** "`Reservation` has no unique constraint on
  `(tenantId, itemId, reference)`... the highest actual production-risk idempotency gap in the
  whole cluster." **SAGA-5:** the per-line reservation loop has no partial-failure compensation.
- **Production-readiness status:** Same shape as Pricing — real writes, no admin read surface,
  plus a confirmed idempotency defect that matters the moment two concurrent checkouts reserve
  the same SKU.

#### Cart — `services/cart` (`@platform/cart`)

- **Domain capabilities:** `Cart` (aggregate), `CartItem` (entity).
- **Application use cases:** 14 write use cases (`CreateCart`, `AddItem`,
  `ChangeItemQuantity`, `RemoveItem`, `ReplaceVariant`, `MergeGuestCart`, `AbandonCart`,
  `CheckOutCart`, `LockCart`, `UnlockCart`, `SaveCartForLater`, `RestoreCart`, `ExpireCart`,
  `ClearCart`). **No read/get use case exists anywhere in the package.**
- **Read endpoints:** none — no `GET /carts/:cartId` route exists, consistent with the missing
  use case.
- **Write endpoints:** 14, dedicated file `apps/admin/src/http/cart-routes.ts`.
- **Persistence:** Prisma (`prisma-cart-repository.ts`) vs. in-memory; working branch confirmed.
  A separate `CachedCartRepository` (Redis read-through, its own tests) exists and is exported
  but **`wireCart` never constructs it** — built, tested in isolation, never wired.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:357`; production via the
  standard indirection only; not seeded by `seed.ts`.
- **Cross-context dependencies:** none real — unit price and inventory-available are
  caller-supplied snapshots, never a live Pricing/Inventory call.
- **Auth:** JWT + RBAC on all 14 routes.
- **Frontend route:** none anywhere.
- **Known gaps:** **SAGA-6 (High):** `Cart.lock()` exists but `StartCheckout` never calls it
  automatically — a cart can be edited mid-checkout. **SAGA-10:** saga can be submitted against
  an unlocked session.
- **Production-readiness status:** No cart page is buildable today without adding a read/get
  use case and route first — this is the cleanest, cheapest fix in the whole inventory (see
  Recommended Productization Order).

#### Media — `services/media` (`@platform/media`)

Two unrelated slices exist in one package.

- **Media Library (Sprint 5.4) — the live one.** Domain: `MediaAsset`, `Folder` (aggregates).
  Use cases: `CreateFolder`, `ArchiveFolder`, `RegisterMediaAsset`, `ArchiveMediaAsset` (writes),
  `GetDownloadUrl` (read). Routes: 5, dedicated file `media-library-routes.ts`, including the one
  read (`GET .../download-url`) — no list/browse route exists. Persistence: Prisma
  (`prisma-library-repositories.ts`) vs. in-memory, working branch. Wired:
  `apps/admin/src/composition.ts:382`. Reaches production via the standard indirection, with a
  real object-storage backing (`StorageServiceObjectStorage`, S3/MinIO) when `S3_*` env vars are
  set — `apps/runtime/src/api.ts` fails closed outside `local` if it's still the in-memory stub.
- **Phase-1 Asset slice — dead.** `RegisterAsset` + its own separate `wireMedia()` composition
  function. `services/media/src/media-library.composition.ts:48-49`: "a separate, unrelated
  composition function never called by `apps/admin` — out of scope here." Confirmed: `wireMedia`
  has zero callers under `apps/`. A `PrismaAssetRepository` exists but is only ever constructed
  inside this dead function.
- **Auth:** JWT + RBAC on all Library routes.
- **Frontend route:** none.
- **Known gaps:** `M2-2` (from `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`), "Media object storage
  is a stub that reports every object as existing" — **superseded**: the real S3 adapter and its
  boot guard now exist in `apps/runtime`.
- **Production-readiness status:** Library is a real, narrow write API with one non-list read;
  Phase-1 Assets is dead code that should not be built on.

### Commerce Fulfillment

#### Checkout — `services/checkout` (`@platform/checkout`)

- **Domain capabilities:** `CheckoutSession` (aggregate); value objects for address/items/state/
  totals/selections.
- **Application use cases:** 13 across 4 files — `LoadItems`, `SetBillingAddress`,
  `SetShippingAddress`, `SelectShipping`, `SelectPayment`, `ValidateCheckout`,
  `RequestTaxCalculation`, `RequestShippingQuote`, `ValidatePromotion`, `RecalculateTotals`,
  `Lock`, `ExpireCheckout`, `CompleteCheckout`, `FailCheckout`, `StartCheckout` (all write except
  `GenerateOrderDraft`/`GeneratePaymentIntentRequest`, which are read — pure snapshot assembly).
- **Read endpoints:** `GET .../order-draft`, `GET .../payment-intent-request` — handoff
  snapshots only, not a general "read my checkout state" route.
- **Write endpoints:** 14, dedicated file `checkout-routes.ts`, 16 routes total.
- **Persistence:** Prisma (`prisma-checkout-session-repository.ts`, JSONB snapshot columns,
  optimistic locking + same-tx outbox) vs. in-memory; working branch. The 5 orchestration ports
  (pricing/inventory/tax/shipping/promotion validation) are **stub adapters in both branches**.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:358`. **No dedicated
  `apps/runtime` wiring at all** — `apps/runtime/src/composition.ts` never imports
  `@platform/checkout`; reached only through the single HTTP process.
- **Cross-context dependencies:** declared for Pricing/Inventory/Finance(tax)/Shipping/
  Promotions — **all 5 are stubs** (see cross-cutting finding #2).
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** none.
- **Known gaps:** the Temporal saga this context is meant to front has zero callers (cross-
  cutting finding #3) — `RC_VALIDATION_REPORT.md:197`: "Checkout → Payment | **NOT WIRED**."
  **SAGA-6/SAGA-10:** submittable against an unlocked cart/session.
- **Production-readiness status:** The synchronous admin path genuinely works end to end
  (start→items→addresses→validate→complete), but every orchestration decision (tax, shipping
  cost, promo validity, actual price/stock) is computed against a fake — a checkout completed
  today would use fictitious numbers for all five.

#### Orders — `services/orders` (`@platform/orders`)

- **Domain capabilities:** `Order` (aggregate, status derived from an append-only `OrderEvent`
  history), `OrderItem`, `RefundPolicy`.
- **Application use cases:** `CreateOrderFromCheckout`, `MarkOrderPaid` ("the ONE authoritative
  payment-completed path"), `AdvanceOrder`, `RequestPaymentCapture`, `RequestFulfillment`,
  `PlaceOrder`, `RefundOrder` (writes); `GetOrder` (read).
- **Read endpoints:** `GET /orders/:orderId` only — **no list/index route exists**, confirmed by
  the full inline route enumeration in `admin-routes.ts` (no `GET /orders`).
- **Write endpoints:** 7, inline in `admin-routes.ts` — `place`, `refund`, `from-checkout`,
  `advance` (explicitly excludes payment completion by design), `mark-paid`,
  `request-payment-capture`, `request-fulfillment`.
- **Persistence:** Prisma (`prisma-order-repository.ts`) vs. in-memory; working branch. **The
  only context in this batch with a real Prisma integration test**
  (`prisma-order-repository.integration.test.ts`, Docker-gated).
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:350`, **and** the only context
  with dedicated production wiring in `apps/runtime/src/composition.ts` —
  `buildPaymentCapturedRuntime(core)` builds a real `PrismaOrderRepository` + `MarkOrderPaid` +
  `PaymentCapturedConsumer`, registered as a live Kafka consumer in `apps/runtime/src/worker.ts`,
  gated by `PrismaPaymentVerificationAdapter` reading the `payment_intents` table directly.
- **Cross-context dependencies:** Payments (via `PaymentPort`/`PaymentVerificationPort` — the
  verification half is real, see above), Inventory+Shipping (`InventoryPort`/`ShippingPort` for
  fulfillment — stubs), Notifications (best-effort, stub).
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** none — `apps/admin-web`'s nav has an `orders` link/badge and the Dashboard
  mocks an "Orders" KPI, but no `/orders` page exists.
- **Known gaps:** `ARCHITECTURE_REMEDIATION_PLAN.md`: "No single mechanism enforces 'order-paid
  is caused only by a captured-payment event'... Orders can be marked paid with zero money
  having moved" — **partially superseded**: `RC_VALIDATION_REPORT.md:200` confirms both the
  admin action and the consumer path are now gated by `PrismaPaymentVerificationAdapter` (M2-7
  closed this for the two paths that route through it). `R-C2`: "the business event chain
  terminates after 'Order Paid.' Licensing, Analytics, Customer 360, and Platform Console
  receive nothing."
- **Production-readiness status:** The most production-real context found in this audit outside
  Security — real read+write, real durable persistence, real live consumer. The one gap that
  matters for a UI is structural, not a defect: **there is no list endpoint**, so a Dashboard
  "Recent Orders" table cannot be backed by a real call without adding one `GET /orders` route.

#### Payments — `services/payments` (`@platform/payments`)

- **Domain capabilities:** `PaymentIntent` (aggregate, dual legacy + full lifecycle state
  machine), `Charge`, `PaymentAttempt`, `Refund`.
- **Application use cases:** `CreatePaymentIntent`/`CreatePaymentIntentLifecycle`,
  `CapturePayment`/`CapturePaymentLifecycle`, `FailPayment`, `AuthorizePayment`,
  `RefundPayment`/`RefundPaymentLifecycle`, `AdvancePayment`, `RecordWebhook` (writes);
  `GetPaymentIntent` (read).
- **Read endpoints:** `GET /payment-intents/:id` only — no list route.
- **Write endpoints:** 4, dedicated file `payments-routes.ts`.
- **Public/unauthenticated route:** `POST /payments/webhook` — the repo's _only_ other public
  route besides the 5 catalog reads, gated by real Stripe signature verification, not RBAC.
- **Persistence:** Prisma (`prisma-payment-intent-repository.ts` + `prisma-processed-webhook-
store.ts`) vs. in-memory; working branch, including durable webhook-replay dedup (the one
  context of the four "webhook-adjacent" contexts with this done right).
- **PSP integration — real:** `packages/psp-stripe/src/stripe-payment-provider.ts` makes real
  authenticated REST calls to `api.stripe.com` (create/capture/cancel/refund/verify), with real
  HMAC-SHA256 constant-time-compared webhook verification. Conditionally wired in
  `apps/runtime/src/composition.ts:210-219` when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are
  present; `apps/runtime/src/api.ts` refuses to boot outside `local` without it.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:359`; PSP resolution happens in
  `apps/runtime/src/composition.ts`, but there is no dedicated `wirePayments` call there — same
  single-HTTP-process indirection as Checkout.
- **Cross-context dependencies:** `OrdersPort` (real, consumed by Orders' verification adapter),
  `FinancePort`, `NotificationPort` (stubs).
- **Auth:** JWT + RBAC on the 4 admin routes; the webhook route is signature-gated instead.
- **Frontend route:** none.
- **Known gaps:** `RC_VALIDATION_REPORT.md:158,258`: even with real Stripe code present,
  "`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` appear **nowhere** in `infrastructure/`" — the
  k8s config never supplies them, and combined with the unconditional MFA boot guard, "the API
  process cannot boot under the shipped k8s config at all (exit code 7, empirically
  reproduced)." Older audit claims of "no PSP adapter anywhere" are **stale**, contradicted by
  `packages/psp-stripe` now existing.
- **Production-readiness status:** The code is genuinely production-grade; the _deployment_ is
  not — this is a configuration/infrastructure gap, not a backend gap.

#### Fulfillment — `services/fulfillment` (`@platform/fulfillment`)

- **Domain capabilities:** `FulfillmentOrder` (aggregate, full pick/pack/ship lifecycle),
  `FulfillmentAttempt`.
- **Application use cases:** `CreateFulfillment`, `CreateShipment`, `AdvanceFulfillment`,
  `RecordCarrierWebhook`, `RequestReservation` — all writes, no read use case.
- **Read endpoints:** none.
- **Write endpoints:** 5, dedicated file `fulfillment-routes.ts`, including the carrier webhook
  — gated by ordinary admin RBAC, not a signature (cross-cutting finding #5).
- **Persistence:** Prisma (`prisma-fulfillment-order-repository.ts`) vs. in-memory, working
  branch. **Gap:** `ProcessedCarrierWebhookStore` is unconditionally in-memory in both branches
  (cross-cutting finding #6).
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:360` only; no dedicated
  `apps/runtime` wiring.
- **Cross-context dependencies:** Orders, Inventory, its own `ShippingProviderPort` (carrier
  abstraction, distinct from the `shipping` bounded context), Notifications — all stubs.
- **Auth:** JWT + RBAC on every route including the webhook.
- **Frontend route:** none.
- **Known gaps:** `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md:233`: "Five separate
  contexts (Payments, Fulfillment, Shipping, Returns, Notifications) each have a real,
  unique-constrained Postgres table designed exactly for this purpose, and each one is
  unconditionally wired to an in-memory store instead" — now stale for Payments specifically
  (fixed), current for the other four.
- **Production-readiness status:** Real domain, no way to display fulfillment status anywhere,
  no way for a real carrier system to call the webhook.

#### Shipping — `services/shipping` (`@platform/shipping`)

- **Domain capabilities:** `Shipment` (aggregate, carrier-agnostic lifecycle with 3 retryable
  recoverable states), `ShippingAttempt`, `TrackingEvent`.
- **Application use cases:** `CreateShipment`, `RecordCarrierWebhook`, `AdvanceShipment`,
  `CreateLabel`, `VoidLabel`, `UpdateTracking`, `RetryShipment` — all writes, no read use case.
- **Read endpoints:** none.
- **Write endpoints:** 7, dedicated file `shipping-routes.ts`.
- **Persistence:** Prisma (`prisma-shipment-repository.ts`) vs. in-memory, working branch. Same
  unconditional-in-memory webhook-dedup gap as Fulfillment.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:361` only.
- **Cross-context dependencies:** Fulfillment (`FulfillmentPort`), `CarrierProviderPort`,
  Notifications — all stubs. Also referenced by Returns (`ShippingPort.verifyReturnShipment`).
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** none.
- **Known gaps:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md:549`: "S-7 | Carrier webhooks gated
  behind admin RBAC — unusable, and no alternative ingress" — confirmed current.
- **Production-readiness status:** Same shape as Fulfillment.

#### Returns — `services/returns` (`@platform/returns`)

- **Domain capabilities:** `ReturnRequest` (aggregate, full RMA lifecycle), `ReturnAttempt`,
  `ReturnInspection`.
- **Application use cases:** `CreateReturnRequest`, `AdvanceReturn`, `DecideApproval`,
  `GenerateRma`, `ReceivePackage`, `InspectItems`, `AcceptItems`, `DecideResolution` — all
  writes, no read use case.
- **Read endpoints:** none.
- **Write endpoints:** 8, dedicated file `returns-routes.ts`, including the warehouse-callback
  ingress (`/receive`) — gated by admin RBAC, same pattern as the carrier webhooks.
- **Persistence:** Prisma (`prisma-return-request-repository.ts`) vs. in-memory, working branch.
  Same unconditional-in-memory callback-dedup gap.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:365` only.
- **Cross-context dependencies:** Orders, Inventory (restock), Shipping (verify), Payments
  (refund), Notifications — all stubs.
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** none.
- **Known gaps:** `docs/implementation/ARCHITECTURE_EXECUTION_MATRIX.md:131,134` names Returns
  among the five contexts whose `buildController` constructs the dedup store unconditionally.
- **Production-readiness status:** Same shape as Fulfillment/Shipping.

### Identity, Access & Communications

#### Identity — `services/identity` (`@platform/identity`)

Two disjoint surfaces in one package.

- **Access (users/organizations/memberships).** Use cases: `CreateUser`, `RenameUser`,
  `DeactivateUser`, `CreateOrganization`, `ArchiveOrganization`, `AddMembership`,
  `ChangeMembershipRole` — all writes. Routes: 7, inline in `admin-routes.ts`
  (`// -- Access... Sprint 4.1 --`). **No list/read route for users, orgs, or memberships
  anywhere.** Persistence: Prisma (`prisma-access-repositories.ts`) vs. in-memory, working
  branch.
- **Customer (register/address/consent) — unreachable.** Use cases: `RegisterCustomer`,
  `AddAddress`, `ChangeConsent` — fully built, guarded, and tested (exercised directly in
  `apps/admin/src/admin.e2e.test.ts`), wired into `WiredAdmin.customers`
  (`apps/admin/src/composition.ts:443`). **Zero HTTP route calls into it anywhere** — confirmed
  by grepping every file under `apps/admin/src/http/`. This is the one clean "just add the
  route" gap in the whole platform.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:351`; reaches production only
  via the standard `createAdminHttpApi` indirection. Also used directly by
  `apps/runtime/src/seed.ts`.
- **Cross-context dependencies:** Security consumes Identity's events
  (`identity.user.created`, `identity.user.deactivated`, `identity.customer.consent_changed`)
  through **real, wired** projection consumers — one of the 5 confirmed-real integrations.
- **Auth:** JWT + RBAC on the 7 Access routes; the Customer vertical has no route to gate.
- **Frontend route:** none.
- **Known gaps:** none context-specific found in the audit-doc set beyond the routing gap above.
- **Production-readiness status:** Access is write-only (P2 shape); Customer registration —
  arguably the single most core-to-commerce capability missing a route in this entire audit —
  is fully built and rated P3 purely because nothing can call it yet.

#### Customer 360 — `services/customer-360` (`@platform/customer-360`)

- **Domain capabilities:** five engines — Identity Graph, Profile, Session, Computed
  Attributes, Segmentation — each with its own snapshot/version/history value objects.
- **Application use cases:** ~35 across the five engines (observe/resolve/merge/split/rebuild/
  evaluate/get, per engine). Only 4 are HTTP-reachable: `GetCustomerProfile`,
  `GetIdentityTimeline`, `GetJourneyTimeline`, `GetJourneyState` — **all four are reads**.
- **Read endpoints:** 4, dedicated file `customer-360-routes.ts` — `GET .../profile/...`,
  `GET .../identity-timeline/...`, `GET .../journeys/:visitorId/timeline`,
  `GET .../journeys/:visitorId/state`.
- **Write endpoints:** none reachable — every mutation use case (`ObserveIdentityLink`,
  `MergeIdentities`, `CreateSegment`, `ObserveSession`, etc.) is wired in `composition.ts` but
  has no route and no runtime caller (grepped, zero matches outside the package).
- **Persistence:** Prisma (10 store files under `infrastructure/`) vs. in-memory, working
  branch — the largest test surface found in this audit (~79 test files, ~340 test cases,
  including Prisma integration tests).
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:352` only.
- **Cross-context dependencies:** designed to stitch identity from `@platform/tracking`'s
  event graph — but `RC_VALIDATION_REPORT.md:204-205`: "Analytics → Customer 360 |
  **NOT WIRED** | `services/customer-360` defines no `EventHandler`." Nothing populates these
  engines with live data in production.
- **Auth:** JWT + RBAC (`customer360:read`) on all 4 routes.
- **Frontend route:** none.
- **Known gaps:** `R-C2` (shared finding with Orders): "the business event chain terminates
  after 'Order Paid.' ... Customer 360 ... receive[s] nothing."
- **Production-readiness status:** The 4 read endpoints are real code that would work — but
  would always return an empty/default snapshot in production, because nothing ever calls the
  observe/merge/rebuild use cases that populate the underlying store. Read surface exists;
  the data pipeline into it does not.

#### Tenancy — `services/tenancy` (`@platform/tenancy`)

- **Domain capabilities:** `Tenant` (status/isolation-tier/branding), `Workspace`
  (env/status/white-label config).
- **Application use cases:** `CreateTenant`, `ActivateTenant`, `SuspendTenant`, `CancelTenant`,
  `RebrandTenant`, `CreateWorkspace`, `ArchiveWorkspace`, `ConfigureWorkspace` — all writes, no
  read use case.
- **Read endpoints:** none — no list route for tenants or workspaces anywhere.
- **Write endpoints:** 8, dedicated file `tenancy-routes.ts`.
- **Persistence:** Prisma (`prisma-repositories.ts`) vs. in-memory, working branch.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:383` only.
- **Cross-context dependencies:** `Tenant.id` is the platform-wide `tenantId` primitive every
  other context's composition is pinned to at boot (see cross-cutting finding #8).
  `Tenant.subscriptionRef` references Licensing by bare id.
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** none.
- **Known gaps:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md:199-203`: "the architecture advertises
  multi-tenancy that the runtime does not implement" — confirmed by the `TENANT_MODE=multi`
  boot-time throw.
- **Production-readiness status:** Real writes, no reads, and the domain concept
  (multi-tenancy) it exists to serve is structurally disabled at the runtime level today.

#### Security — `services/security` (`@platform/security`)

- **Domain capabilities:** the largest context in the platform — `Principal`, `Session`,
  `Role`/`RoleAssignment`, `Credential`, `Device`, `Delegation`, `Incident`,
  `MachineIdentityProfile`, `AiGovernanceProfile`, `Policy`, `ComplianceEngine`, `AuditChain`,
  `Relationship` (ReBAC), `TenantSecurityProfile`, `ThreatIntel`, plus 7 evaluation engines
  (authorization, ABAC, MFA, risk, trust, zero-trust).
- **Application use cases:** ~62 across authN/sessions/MFA/devices/RBAC/ReBAC/policy/
  credentials/delegation/machine-identity/AI-governance/risk/compliance/incidents/registry.
- **Read endpoints:** ~21 across all 6 route files — `resolve/*` lookups and `console/*`
  explorer dashboards for identity, sessions/devices/risk, permissions/policy/registry,
  secrets/lineage, incidents/audit, AI governance.
- **Write endpoints:** ~57 across the same 6 files — register/authenticate/establish/revoke/
  enroll/grant/define/publish/write-relation/issue/rotate/delegate/govern/open-incident, etc.
- **Persistence:** Prisma (`prisma-repositories.ts` + two dedicated consent/identity
  projection stores) vs. in-memory, working branch.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:368`, **and** extensive
  dedicated `apps/runtime/src/security/*` wiring — `wire-security-identity.ts` connects a live
  Kratos/Keto consumer fleet, `wire-security-providers.ts` config-selects real KMS/threat-intel
  providers, `wire-security-edge.ts` builds the real permission guard + OTel. This is
  independently the most substantively production-wired context in the audit.
- **Cross-context dependencies:** consumes Identity's events (real, wired projection
  consumers). 4 of ~9 provider seams (`deviceTrust`, `telemetry`, `geoIp`, `authProviders`)
  are unconditionally in-memory with **no override seam** — cannot be swapped without editing
  the composition root.
- **Auth:** every route requires JWT + RBAC; MFA itself is boot-gated — `apps/runtime/src/api.ts`
  refuses to boot outside `local` without a real MFA provider configured.
- **Frontend route:** none.
- **Known gaps (`RC_AUDIT_SECURITY.md`):** R1 (Critical, blocks GA): Payments webhook stub —
  superseded, real Stripe now exists. R2 (Medium): Fulfillment/Shipping/Returns/Notifications
  webhook ingress has no signature check. R3 (High): MFA/Payments/Licensing guards make
  non-local boot impossible until real adapters exist. R5 (Informational): Hydra
  (OAuth2/OIDC) has no integrated client code anywhere, only referenced as an external issuer.
- **Production-readiness status:** Technically the most production-ready context in the
  platform — but it is enterprise identity/security infrastructure, not a merchant-facing
  commerce capability, so it is rated P1 (valuable, real, not core-loop-first) rather than P0.

#### Notifications — `services/notifications` (`@platform/notifications`)

- **Domain capabilities:** `Notification` (aggregate, `created`→`queued`→`sent`→`delivered`
  lifecycle, no contact PII per ADR-0006), `DeliveryAttempt`, `NotificationEvent`.
- **Application use cases:** `CreateNotification`, `QueueNotification`, `AdvanceNotification`,
  `SendNotification`, `RetryNotification`, `RecordProviderCallback` — all writes, no read.
- **Read endpoints:** none.
- **Write endpoints:** 6, dedicated file `notifications-routes.ts`; the provider-callback route
  is admin-RBAC-gated, not signature-verified — "not exploitable, but also not functional — no
  real carrier/PSP/warehouse system could call them successfully" (`RC_AUDIT_SECURITY.md`).
- **Persistence:** Prisma (`prisma-notification-repository.ts`) vs. in-memory, working branch
  for the aggregate itself. **All 4 outbound provider ports (email/SMS/push/webhook) and the
  callback-dedup store are unconditional in-memory stubs in both branches — and unlike
  Payments/MFA/Licensing/object-storage, there is no boot-time guard anywhere in
  `apps/runtime/src/api.ts` for this** (grepped, zero matches). Notifications will silently run
  on fake providers in production with no warning.
- **Runtime/composition wiring:** `apps/admin/src/composition.ts:369` only.
- **Cross-context dependencies:** Orders is "the sole exception, correctly wired" caller
  (`ARCHITECTURE_REMEDIATION_PLAN.md`) — Payments/Returns/Fulfillment default to no-op stubs
  even in production composition.
- **Auth:** JWT + RBAC on every route.
- **Frontend route:** the topbar bell icon in `apps/admin-web` is UI chrome, not a wired
  feature — confirmed no functional connection.
- **Known gaps (`ARCHITECTURE_REMEDIATION_PLAN.md` §1.6, all CONFIRMED):** NOT-1 (Critical):
  "Notifications never progress past `created` in production — nothing auto-queues/sends."
  NOT-2: "~20-event documented catalog vs. one real consumer." NOT-7 (High): "All four
  notification channels hardcoded in-memory stubs, including production."
- **Production-readiness status:** The weakest context in this batch — persistence is real,
  but the feature does not functionally work in any environment, and unlike every comparable
  gap elsewhere, nothing stops it from silently "succeeding" in production.

### Growth & Customer Experience

All 7 contexts in this group share an identical shape: real domain + real Prisma persistence +
write-only admin API + every declared cross-context port defaulting to a stub. Individual
notes below cover what's distinct about each.

#### Promotions — `services/promotions`

- Use cases: `CreatePromotion`, `AdvancePromotion` (write); `EvaluatePromotions` (read, "pure
  read, no mutation"); `RecordPromotionUsage` (write). Routes: 4, all `POST` including
  `POST /promotions/evaluate` — a read operation exposed as a write verb, and never actually
  called by any real consumer (Coupons is the only intended caller, and it uses a stub instead).
  Persistence: Prisma vs in-memory, working branch. No frontend.

#### Coupons — `services/coupons`

- Use cases: `CreateCoupon`, `AdvanceCoupon`, `RedeemCoupon` (writes, idempotent). Routes: 3,
  all writes. Depends on `PromotionsPort` — stub, "always active" regardless of the real
  Promotion's actual status.

#### Loyalty — `services/loyalty`

- Use cases: `OpenAccount`, `AdvanceAccount`, `EarnPoints`, `SpendPoints`, `RecordCashback`,
  `RedeemReward`, `CompleteReferral` (all writes, idempotent). Routes: 7, all writes. **No
  outbound ports declared at all** — the only fully domain-isolated context in this group.

#### Wishlist — `services/wishlist`

- Use cases: `CreateWishlist`, `AdvanceWishlist`, `AddWishlistItem`, `RemoveWishlistItem`,
  `ShareWishlistItem`, `MoveWishlistItemToCart` (all writes, idempotent). Routes: 6, all
  writes. Depends on `CartPort` — stub; a "move to cart" action today does not touch the real
  Cart aggregate.

#### Reviews — `services/reviews`

- Use cases: `CreateReview` (checks `OrdersPort.hasPurchased`), `AdvanceReview`, `VoteReview`,
  `ReportReview` (auto-flags at 3 reports), `RespondToReview`, `ModerateReview` (replay-safe).
  Routes: 6, all writes. Depends on `OrdersPort` — stub, always reports "not purchased," so
  **no review created through this API can ever be marked verified-purchase** until the port is
  wired.

#### Search — `services/search`

- Use cases: index-management only — `CreateIndex`, `AdvanceIndex`, `UpsertDocument`,
  `DeleteDocument`, `AddSynonym`, `RemoveSynonym`, `AddSuggestion`, `LogQuery`. **No
  query/retrieval use case exists anywhere in this context.** Routes: 8, all writes. The actual
  search engine (`IndexProviderPort`, meant to be OpenSearch/pgvector per ADR-0020) has exactly
  one implementation repo-wide: `InMemoryIndexProvider`. A repo-wide grep for `OpenSearch`/
  `pgvector` finds no adapter anywhere.

#### Recommendations — `services/recommendations`

- Use cases: `CreateModel`, `AdvanceModel`, `GenerateRecommendationSet`,
  `RegenerateRecommendationSet` (all writes). Scoring is positional-decay only
  (`score: 1 / (index + 1)`) — no ML, no learned weights, confirmed by reading the use case.
  Routes: 4, all writes — **a generated recommendation set can never be read back over HTTP.**
  Depends on `SearchQueryPort` — stub, and the thing it reranks (Search's related-products
  feed) is itself backed by a stub, so both ends of this pipeline are fake.

### Intelligence, Ops & SaaS Foundation

#### Reporting — `services/reporting`

- Use cases: `CreateReportDefinition`, `AdvanceReportDefinition`, `GenerateReport` (internally
  reads via `AnalyticsQueryPort`), `CreateDashboard`, `AdvanceDashboard` — all write-shaped.
  Routes: 5, all writes. Persistence: Prisma vs in-memory, working branch. Depends on
  `AnalyticsQueryPort` — stub (`InMemoryAnalyticsQuery`), so `GenerateReport` never queries real
  data. No frontend.

#### Feature Flags — `services/feature-flags` (package name `@platform/feature-flags-service`,

distinct from the lower-level contracts package `@platform/feature-flags` in `packages/`)

- Use cases: `CreateFeatureFlag`, `AdvanceFlag`, `SetRolloutPercentage` (deterministic FNV-bucket
  rollout), `AddFeatureRule`, `SetEnvironmentOverride` — all writes, no read use case. Routes:
  5, all writes. Persistence: Prisma vs in-memory, working branch; a real evaluator
  (`AggregateFeatureFlags`) is built from whichever repo is active in both branches. No
  frontend.

#### Experimentation — `services/experimentation`

- Use cases: `CreateExperiment` (variant allocations must sum to 100), `AdvanceExperiment`,
  `RecordExperimentResult`, `DeclareWinner` — all writes, no read use case. Routes: 4, all
  writes. Persistence: Prisma vs in-memory, working branch. Accepts optional `featureFlagRef`/
  `goalMetricRef` as bare string references — no real cross-context call. No frontend.

#### Automation — `services/automation`

- Use cases: `CreateWorkflow`, `AdvanceWorkflow`, `TriggerWorkflow` (replay-safe by
  `triggerId`), `RetryExecution` — all writes, no read use case. Routes: 4, all writes.
  Persistence: Prisma vs in-memory, working branch; `ActionDispatcherPort` is a stub in both.
  **`docs/platform/01-WORKFLOW_AUTOMATION_ENGINE_SPEC.md`'s "No application code" claim is
  confirmed stale** — the application layer, both persistence branches, and 4 routes all
  exist. `apps/admin-web/src/components/navigation.ts:45` has a dead `/automations` nav link
  with no page behind it.

#### Feature Registry — `services/feature-registry` (ADR-0027)

- Domain: `FeatureDefinition` (versioned-immutable), `FeatureBundle`, `CapabilityGraph`,
  `FeatureRegistryValidator` — "the single source of truth for every platform capability... owns
  DEFINITIONS only, never feature state." 17 use cases including 5 reads: `ResolveFeature` (the
  query the platform's Entitlement layer actually uses — real, live consumer, confirmed in
  `apps/runtime/src/entitlement`), `ListFeatures`, `AnalyzeCapabilityGraph`, `ListBundles`,
  `ValidateRegistry`. Routes: 17, including all 5 reads. Persistence: Prisma vs in-memory,
  working branch. This is dev/platform tooling (defining what features exist and their
  requirements), not merchant-facing — rated P1 despite being fully real and consumed in
  production.

#### Analytics — `services/analytics` (D-064/D-065)

- **No `src/application` directory and no aggregates at all** — this is a governed semantic
  _catalog_ (`SemanticModel`, `SemanticBinding`, `DimensionDefinition`, `ReadModelDescriptor`),
  not a CRUD context. Its behavior lives in `src/engine/` and `src/registry/`. Routes: 4, all
  `GET` (`analytics:read`) — metrics list/by-id, dimensions list/by-id — genuinely functional
  for browsing the catalog. **The real backend, `ClickHouseAnalyticsReadStore`, is never
  instantiated by `wireAnalytics()`** (cross-cutting finding #4) — no route in this context can
  ever return an actual computed number, only catalog metadata. `services/analytics/src/
infrastructure/finance-semantics.ts` registers Finance's metrics into the shared registry —
  the one cross-context registration found. No frontend (dead `/analytics` nav link in
  admin-web).

#### Finance — `services/finance` (ADR-0024)

- Domain: `Journal` (immutable ledger), `Account`, `Budget`, `CogsSnapshot`, `CostCenter`,
  `ExchangeRate`, `ExpenseCategory`, `Expense`, `FiscalPeriod`, `TaxProfile` + 13 domain
  services (posting, statements, fiscal closing, COGS, cash-flow, tax, currency conversion...).
  26 use cases across 5 files, including a real read surface: `TrialBalanceQuery`,
  `IncomeStatementQuery`, `BalanceSheetQuery`, `GetReadModel`, `QueryReadModel`. Routes: 19,
  **inline** in `admin-routes.ts` (no dedicated file), 6 of them `GET`. Persistence: Prisma (10
  repository classes) vs. in-memory, working branch — but `security`, `forecast`, and
  `readModels` stay in-memory in **both** branches; a real `ClickHouseReadModelStore` exists and
  is exported but never instantiated (same pattern as Analytics). Cross-context: receives a
  configured chart-of-accounts (`DEFAULT_FINANCE_POSTING_ACCOUNTS`) from
  `apps/admin/src/composition.ts` — real, not a stub — but the 6 event consumers that would
  auto-post commerce events (order-paid, payment-captured, refund, etc.) into the ledger are
  fully implemented in `services/finance/src/interfaces/finance-consumers.ts` and **registered
  nowhere** (not in `wireFinance()`, not exported, not referenced under `apps/runtime`). No
  frontend. This is genuinely the most complete back-office context found — rated P1 because
  it's inherently secondary to a first commerce product experience, not because of its own
  readiness.

#### Licensing — `services/licensing` (ADR-0018)

- Domain: `Plan`/`PlanVersion`, `Subscription`, `Credit`, `Invoice`, `MerchantCapabilities`,
  `MerchantFeatureOverride`, `UsageCounter`, `EntitlementResolver`. 26 use cases across 2 files
  (plans/subscriptions/overrides/usage + billing). **Only 13 of 26 are exposed via HTTP** —
  `SchedulePlanVersion`, `ClonePlanVersion`, `ArchivePlanVersion`, `ComparePlanVersions`,
  `ActivateSubscription`, `PauseSubscription`, `ResumeSubscription`, `PreviewRenewal`,
  `RevokeMerchantCapability`, `RecordUsage`, `IssueInvoice`, `ConsumeCredit`, `ExpireCredit`
  are all wired into the controller but have no route. Of the 13 reachable, one is a read
  (`GET /usage-counters`). Persistence: Prisma (7 repositories) vs in-memory, working branch;
  `payments`/`financeLedger` billing adapters stay stubs in both branches, and
  `apps/runtime/src/api.ts` refuses to boot outside `local` without real ones configured
  (M2-3). `CollectInvoice` does make a real call chain into Finance
  (`FinanceLedgerPort.postSettlement`) once configured. Feeds the platform Entitlement layer
  alongside Feature Registry. No frontend.

#### Platform Console — `services/platform-console` (Sprint 5.6 foundation)

- **No `src/domain` and no `src/application` directory at all.** The entire context is one
  pure in-memory event-folding projection (`PlatformKpisProjection`) with an `apply()`/
  `current()` pair, exposed as `POST /platform/kpis` (a read kept on the `POST` verb "to match
  what was actually built"). No persistence of any kind. `ingest()` is explicitly a "test/
  composition-only seam" — nothing in production feeds it a live event, so the one route
  always returns an empty/default snapshot. No frontend.

### Experience Platform

All 7 contexts here (`content`, `localization`, `seo`, `components`, `theme`, `experience`,
`pages`) share one architecture: a single `*.use-cases.ts` file, a dedicated route file, a
`composition.ts` with a confirmed working `deps.prisma !== undefined` branch, both Prisma and
in-memory repositories, and exactly two test files each (domain + e2e). **Every one of the 20
routes across all 7 is a `POST`/`PUT` write — none has a `GET` route, and none has a read use
case at all**, confirmed by reading all 7 use-case files, all 7 controllers, and all 7 route
files directly.

- **Content** (`@platform/content`): `ContentBlock`, `ContentVersion`. `CreateContentBlock`,
  `AdvanceContentBlock`, `UpdateContentBody`. 3 routes. Dead `/content` nav link in admin-web.
- **Localization** (`@platform/localization`): `Locale`, `TranslationSet`, `Translation`.
  `CreateLocale`, `CreateTranslationSet`, `SetTranslation`, `PublishTranslation`. 4 routes.
- **SEO** (`@platform/seo`): `SeoProfile`, `Redirect`, `Sitemap`, `RobotsPolicy`.
  `SetSeoProfile`, `CreateRedirect`, `CreateSitemap`, `RegenerateSitemap`, `SetRobotsPolicy`.
  5 routes. **Verified: no `/sitemap.xml` or `/robots.txt` delivery route exists anywhere** —
  SEO data is captured but has no public-facing delivery mechanism at all.
- **Components** (`@platform/components`): `ComponentDefinition` (schema-driven rendering
  contract). `CreateComponentDefinition`, `AdvanceComponentDefinition`. 2 routes.
- **Theme** (`@platform/theme`): `Theme`, `ThemeVersion`. `CreateTheme` (seeds from a real
  `@platform/design` preset — verified working end-to-end, including with the renamed Morbeh
  `#635BFF` tokens), `AdvanceTheme`, `UpdateThemeVariables`. 3 routes. The only one of these 7
  with a genuine (non-stub) cross-package dependency.
- **Experience** (`@platform/experience`): `Experience` (Canvas→Section→Slot→ComponentInstance
  tree — a real, validated 4-level nested domain model, not scaffolding). `CreateExperience`,
  `AdvanceExperience`, `UpdateCanvas`. 3 routes. **`UpdateCanvas`'s own doc comment admits: "the
  persisted resulting tree powers the (out-of-scope) visual builder client"** — there is no
  drag/drop UI, no rendering engine, anywhere in the codebase. This is server-side tree storage
  with nothing to render it.
- **Pages** (`@platform/pages`): `Page`, `Template`. `CreatePage`, `AdvancePage`,
  `CreateTemplate`, `ArchiveTemplate`. 4 routes. **Verified: a published `Page`'s content is not
  retrievable through any HTTP surface, authenticated or not** — same gap as SEO's sitemap.

All 7 are wired into `apps/admin/src/composition.ts` and reach production via the standard
`createAdminHttpApi` indirection; none has a dedicated `apps/runtime` wiring; none has a
frontend route.

---

## Recommended productization order

Ranked by what should become real Morbeh product UI first, given verified backend readiness —
not aspiration. "Immediate" means buildable this sprint against what exists today; "needs
backend work" names the exact gap to close first.

### 1. Order detail workflow (view / mark paid / refund)

- **Why now:** Orders is the most production-real context in the platform outside Security —
  real read, real write, real durable persistence, and the only context with a live production
  consumer already wired (`PaymentCapturedConsumer`).
- **Backend readiness:** High. `GET /orders/:orderId` plus 7 write routes are live and
  RBAC-gated today.
- **Required integration work:** None to ship a detail page. One new `GET /orders` (list) route
  would unlock the Dashboard's existing "Recent Orders" mock table with real data — this is the
  single cheapest high-value fix in the whole inventory.
- **Required frontend work:** An order detail screen (status, items, actions) plus, once the
  list route exists, an orders table.
- **Dependencies:** none blocking; Payments' verification adapter is already real for the
  mark-paid path.
- **Can it ship now?** Detail/actions: yes. List view: needs the one route above first.

### 2. Storefront public catalog browsing

- **Why now:** the only capability with a real frontend today; extending it is additive, not
  new plumbing.
- **Backend readiness:** High for products/categories/collections/inventory reads; the fifth
  route (`getPrices`) exists but is unused.
- **Required integration work:** Wire the unused `getPrices()` call into the existing page so
  displayed products show a real price instead of nothing.
- **Required frontend work:** A product detail page and a collection page — the current page is
  a single-screen smoke test with no navigation between products.
- **Dependencies:** none.
- **Can it ship now?** Yes, incrementally.

### 3. Catalog product management (admin)

- **Why now:** real read+write API, Prisma-backed, the largest and most complete write surface
  in Commerce Foundation.
- **Backend readiness:** High for Products; **do not build a Variants editing panel before
  fixing CPI-1** (silent data loss on variant price/selection edits) — this is a confirmed
  critical defect, not a documentation gap.
- **Required integration work:** Fix CPI-1. Collections has no admin write route at all — a
  "manage collections" screen cannot be built without adding one first.
- **Required frontend work:** Product list/detail/edit; a separate, later effort for
  Collections once its route exists.
- **Dependencies:** none for Products; a new route for Collections.
- **Can it ship now?** Product CRUD (non-variant fields): yes. Variants: no, needs CPI-1 fixed
  first. Collections: no, needs a route.

### 4. Cart (once one route is added)

- **Why now:** every write operation a cart page needs already exists (add/remove/change-
  quantity/merge/lock/checkout) — this is the cheapest "needs backend work first" item in the
  inventory, not a redesign.
- **Backend readiness:** Write side complete; read side is the _only_ gap — there is no
  `GetCart`/`ListCarts` use case anywhere in the package.
- **Required integration work:** Add one `GetCart` use case + one `GET /carts/:cartId` route.
  Small, well-scoped, no cross-context dependency.
- **Required frontend work:** A cart page/drawer, once the read route exists.
- **Dependencies:** none.
- **Can it ship now?** No — needs the read route first, but it is a small, isolated backend
  addition, not a redesign.

### 5. Pricing & Inventory admin visibility

- **Why now:** merchants need to see current prices/stock even before deeper editing UI exists;
  the write APIs already support creating/adjusting both.
- **Backend readiness:** Medium — writes are real; there is no admin read route for either
  (only the public, margin-safe read exists for Pricing; Inventory's public read excludes live
  reservations).
- **Required integration work:** Add `ListPrices` and `ListInventoryItems` admin routes
  (`CheckAvailability` too, if a "can this order be fulfilled" check is wanted — it currently
  has no route of any kind). Consider fixing CPI-3 (concurrent-publish race) before exposing
  price editing broadly.
- **Required frontend work:** Price list/detail, stock list/detail.
- **Dependencies:** none blocking, but CPI-3 is a real correctness risk worth closing first.
- **Can it ship now?** No — needs the admin read routes first; this is squarely "backend work
  first," but narrow and well-understood.

### 6. Everything else in this document

Every remaining capability — Checkout, Payments admin UI, Fulfillment/Shipping/Returns,
Identity, Growth/CX (Promotions/Coupons/Loyalty/Wishlist/Reviews/Search/Recommendations),
Intelligence/Ops/SaaS (Reporting/Feature Flags/Experimentation/Automation/Analytics/Finance/
Licensing/Platform Console), and the entire Experience Platform — requires either a missing
read route, a stubbed cross-context integration becoming real, a deployment/config fix
(Payments/Licensing boot gates), or a wiring fix (Identity's Customer vertical, Media's
Phase-1 slice) before it is a defensible product UI candidate. None of these should be built
as a feature page yet; each one's dossier above names its specific blocker precisely so the
next phase can be scoped without guessing.

---

## Report

**File:** `docs/ui/PLATFORM_FEATURE_INVENTORY.md`

**43 capabilities traced across 39 bounded contexts. 3 rated P0, 3 P1, 33 P2, 4 P3.**

The headline finding is structural, not a list of bugs: **27 of 39 bounded contexts expose no
read endpoint at all**, and **every declared cross-context port in the platform — at least 25
of them — resolves to an in-memory stub in every composition path, including the one that
serves production traffic.** Those two facts, not missing features, are why almost nothing
clears the bar for P0. The backend is broad and, where it has been checked end-to-end (Orders,
Payments' PSP layer, Security's Kratos/Keto wiring), genuinely solid — but it was built
write-first and cross-context-stubbed throughout, so a product UI on top of it today would
either have nothing to read or be reading fake data underneath a real-looking write.

Three things are ready now: **Order detail/mark-paid/refund**, **storefront catalog browsing**,
and **Catalog product management** (with one confirmed critical defect, CPI-1, to fix before
touching variants). The single highest-leverage next step is adding a `GET /orders` list
route — it is the one gap standing between the existing (currently mock-data) Dashboard and a
real one.
