# WP-8 — Storefront: SEO output and CMS rendering

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Safe to run in parallel with:** WP-1, WP-6.
> **Conflicts with:** WP-2, WP-7 (`apps/storefront/src`) and WP-4, WP-5, WP-6, WP-9 (`admin-routes.ts`).
> **Closes:** G-50, G-51.

## Why this exists

Four bounded contexts manage content and SEO, and **no customer can see any of it.**

Verify before starting:

```bash
grep -rn "generateMetadata\|ld+json\|application/ld" apps/storefront/src ; echo "exit=$?"
ls apps/storefront/src/app/sitemap.ts apps/storefront/src/app/robots.ts 2>&1
grep -rhoE 'path: "/public[^"]*"' apps/admin/src/http/*.ts | grep -iE "page|content|theme"
```

All three come back empty. Concretely:

- **SEO.** `services/seo` owns `SeoProfile`, `Redirect`, `RobotsPolicy` and `Sitemap` aggregates,
  with 15 admin routes and four admin screens. The storefront emits **no** `<title>`, no meta
  description, no canonical, no Open Graph, no JSON-LD, no `sitemap.xml`, no `robots.txt`. Brief
  §25 lists eleven SEO features; zero reach a crawler. For a commerce platform this is not a missing
  feature, it is a missing acquisition channel.
- **CMS.** `services/pages` (Page, Template, `RoutePath`), `services/components`
  (ComponentDefinition), `services/content` (ContentBlock) and `services/theme` all exist with admin
  CRUD. There is **no `/public/pages` route**, and `apps/storefront/src/app/page.tsx` is hardcoded
  markup. Brief §5's `Page → Section → Block` tree is modelled in the backend and rendered nowhere.

## Part A — SEO

- [ ] **T8.1 — Read the source of truth.**
      `services/seo/src/domain/` in full — `seo-profile.ts`, `redirect.ts`, `robots-policy.ts`,
      `sitemap.ts`, `value-objects/seo.ts`. The field names and semantics are already decided; the
      storefront renders what these define. Also read the four `seo/*` admin screens to see what an
      operator can already configure, because everything they can set must reach the page.

- [ ] **T8.2 — Public SEO reads.**
      A `/public/seo/...` route (shape copied from `public-catalog-routes.ts`) returning the
      resolved SEO profile for a given route path — DTO-mapped, unguarded, published-only.
      **Cache it.** This is on the render path of every page; `packages/redis` provides the `Cache`
      port. Invalidate on `seo.changed` (the event already exists —
      `services/seo/src/domain/events/seo-changed.event.ts`). Note G-30 (cache/tag invalidation) is
      an open gap; if there is no invalidation mechanism to reuse, a short TTL is the honest
      fallback — say so in a comment rather than implying correctness you did not build.

- [ ] **T8.3 — `generateMetadata` on every storefront route.**
      Title, description, canonical, Open Graph, Twitter card — resolved from the SEO profile with
      a sensible fallback derived from the entity (product name, collection name) when no profile
      exists. Every route: home, PLP, PDP, collections, search, account, cart, checkout.
      Search and account pages must be `noindex`.

- [ ] **T8.4 — JSON-LD.**
      `Product` (with `Offer`: price in the correct currency, availability from inventory — and
      **never a price the client supplied**), `BreadcrumbList`, `Organization`, `WebSite` with
      `SearchAction`, and `ItemList` on collections. Render as `<script type="application/ld+json">`.
      Emit only fields you can actually populate — a schema with invented `aggregateRating` is worse
      than no schema, and rule 4 ("never fabricate data") covers structured data too.

- [ ] **T8.5 — `sitemap.ts` and `robots.ts`.**
      Next.js App Router conventions, at `apps/storefront/src/app/`. The sitemap is generated from
      published products, collections and CMS pages, with `lastModified` from real timestamps.
      Paginate: a single sitemap file is capped at 50,000 URLs and 50 MB — use a sitemap index above
      that threshold rather than discovering the cap in production.
      `robots.ts` reads `services/seo`'s `RobotsPolicy` rather than hardcoding rules.

- [ ] **T8.6 — Redirects.**
      Honour `services/seo`'s `Redirect` aggregate in storefront middleware. 301 for permanent, 302
      for temporary. Guard against redirect loops and cap chain length — an operator can create a
      cycle through the admin UI and the storefront must not hang because of it.

## Part B — CMS rendering

- [ ] **T8.7 — Read the content model.**
      `services/pages/src/domain/page.ts`, `template.ts`, `value-objects/route-path.ts`;
      `services/components/src/domain/component-definition.ts`;
      `services/content/src/domain/`; `services/theme/src/domain/`. Understand how a page composes
      sections and blocks **before** designing the renderer — the model exists and the renderer
      conforms to it, not the reverse.

- [ ] **T8.8 — Public CMS routes.**
      `GET /public/pages/:routePath` returning a published page with its resolved section/block
      tree, plus the routes needed for theme tokens and content blocks. Published-only — a draft
      page must be unreachable without a preview token. DTO-mapped; the block tree is data, and the
      Page aggregate must not go on the wire.

- [ ] **T8.9 — The block renderer.**
      A registry mapping block type → React component, in `apps/storefront/src/components/cms/`.
      Requirements:

      - **An unknown block type renders nothing and logs** — never throws. An operator publishing
                a block the deployed storefront does not know about must not white-screen the page.
              - **Block content is untrusted input.** It is authored in an admin UI and rendered into a
                public page. Any rich-text/HTML block must be sanitised; never `dangerouslySetInnerHTML`
                with unsanitised content.
              - Server components where possible, so CMS content is server-rendered and indexable.

- [ ] **T8.10 — A dynamic CMS route and a CMS-driven homepage.**
      `apps/storefront/src/app/[...slug]/page.tsx` resolving a CMS page by route path, 404 when
      absent. Then convert the homepage: it renders a CMS page when one is published for `/`, and
      falls back to today's hardcoded layout when none is. **Keep the fallback** — do not leave a
      merchant with a blank home page because they have not authored one.

- [ ] **T8.11 — Preview.**
      A signed, expiring preview token that lets an operator view a draft page. Do not reuse the
      guest `sessionRef` cookie — `docs/plans/PHASE-5-6-backlog.md` T5.16 records explicitly that it
      is an anonymous cart token, not an identity, and that rule applies here too.

## Definition of done

- [ ] Every storefront route emits a title, description and canonical from `services/seo`, with a
      sensible fallback.
- [ ] A product page carries valid `Product` + `Offer` JSON-LD; validate the output against a
      structured-data validator and record the result.
- [ ] `/sitemap.xml` and `/robots.txt` respond, driven by real data and the `RobotsPolicy`.
- [ ] A redirect configured in the admin takes effect on the storefront; a cycle does not hang it.
- [ ] A page authored in the admin renders on the storefront at its route path.
- [ ] An unknown block type degrades silently instead of breaking the page.
- [ ] A draft page is not publicly reachable, and is reachable with a valid preview token.
- [ ] G-50 and G-51 closed. Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **A page-level SEO fetch on every render will dominate your TTFB.** Cache it, and measure before
  and after.
- **`generateMetadata` and the page body both fetch.** Next.js dedupes identical fetches within a
  render — make sure yours actually are identical (same URL, same options), or you will double every
  request.
- **Do not put an unpublished product in the sitemap.** Same class of leak as the draft-price bug
  Phase 0 fixed.
- **Do not build a visual page builder in this WP.** Rendering is the gap; authoring already has a
  form. A builder is its own project and would consume this WP's entire budget.
