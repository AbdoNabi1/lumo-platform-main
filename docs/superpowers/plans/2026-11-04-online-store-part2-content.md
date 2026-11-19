# Online Store — Part 2: Navigation and Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant edits the header and footer menus (two levels, linking to the shop's own collections, products, pages, policies, home, search and safe web addresses), writes the five Shopify policies from bilingual templates, gives pages such as "About us" real content at `/pages/<handle>`, and the storefront renders all of it — menus in the shell, `/policies/*` (reachable while locked, without the shop chrome), `/pages/*`, `robots.txt` and `sitemap.xml` — cached per shop and revalidated on save.

**Architecture:** `@platform/storefront-content` gains the "Morbeh text" rich-text parser (a linear-time, restricted-Markdown parser producing a typed AST), one renderer over an injected `createElement`, the link rules (`safeHref`, `normalizeExternalUrl`), the menu validator and `LinkRef`, the policy types and slugs, and three new theme-document fields (`header.menuHandle`, `footer.menuHandle`, `footer.showPolicyLinks`). `services/online-store` gains two RLS-forced tables (`menus`, `policies`), menus with virtual `main-menu`/`footer` defaults, policies with code-resident ar/en templates, a `LinkTargetsPort` (collections, products, pages, resolved by id in one batched read per kind) and a shell that carries resolved menus. `services/pages` gains title/body/meta/`publishedAt`, `UpdatePageContent`, an Unpublish transition and published reads. `apps/admin` wires closure-only adapters (catalog gains `GetCollectionsByIds`) and the routes of spec 2.6. The storefront renders menus (CSS-only dropdowns, one client drawer), `<RichText>`, `/policies/[handle]`, `/pages/[handle]`, `robots.ts` and `sitemap.ts`, and opens exactly those five policy URLs plus robots and sitemap on a locked store. admin-web adds Online Store → Navigation, Settings → Policies and the page editor.

**Tech Stack:** TypeScript, Prisma 6 / PostgreSQL (hand-written SQL migration, RLS), zod routes on `@platform/http` (Fastify), Vitest, Next.js 15 App Router + React 19 (admin-web and storefront), Tailwind v4 (logical utilities), `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-27-online-store-customization-design.md` — Part 2 (§2.1–§2.9), "Where the code lives", "Permissions (all parts)", "Global constraints", "Anti-goals", "Security and multi-tenancy", "Review Focus" (items 3, 4, 5, 7, 11, 13), "Delivery order", Decisions 34, 35, 37–45. Read the spec and this plan together. The branch `morbeh/storefront-customization` is at `b9afe058` with Part 1 complete (`docs/superpowers/plans/2026-10-27-online-store-part1-identity.md`, ledger `.superpowers/sdd/2026-10-27-online-store-part1-identity/progress.md`). Part 1's code is the ground truth wherever this plan and the spec differ; where they differ, a Ruling below says so.

## Rulings (decided on the owner's behalf; the spec is silent, ambiguous, or wrong against the code)

The owner delegated every decision. Each ruling is binding for the tasks that follow.

1. **No new permission strings.** Part 1 already put `online_store:manage_menus`, `online_store:manage_policies` and `pages:update_page` in `scripts/ops/seed-ory-network.mjs`, and `online_store`/`pages` are in `SHOP_RESOURCES`, so operators hold them and `role-table-access-control.test.ts` already asserts them. Part 2 only uses them.
2. **New theme-document fields are optional on write and on read.** `header.menuHandle` (default `"main-menu"`), `footer.menuHandle` (default `"footer"`) and `footer.showPolicyLinks` (default `true`) are filled in by the reader and the validator when absent, so Part 1 drafts, published documents and releases keep reading identically (`canonicalDocumentJson` of a Part 1 document equals that of the same document with the defaults written out, so `hasUnpublishedChanges` does not flip on deploy). In the TypeScript type they are required. The validator checks the handle's format only; a handle with no menu renders no menu.
3. **One cache tag per shop.** Every Part 2 storefront cache entry (policies, pages, sitemap) is tagged `os:<shopId>`, with its own key parts (`["online-store", shopId, "policy", type]`, `[…, "page", handle]`, `["online-store", shopId, "sitemap"]`). The spec's `pages:<shopId>`/`sitemap:<shopId>` tags and the `{ shopId, tags: ["pages"] }` body do not exist in Part 1's `/api/revalidate` (it takes `{ shopId }` and touches only `os:<shopId>`); they are folded into the one tag, and the route and `revalidateStorefront()` stay unchanged.
4. **Only found content is cached.** A policy or page read that answers 404 (or fails) throws inside `unstable_cache`, so nothing is stored; a flood of random `/pages/<x>` URLs cannot grow the cache.
5. **The locked view.** Middleware marks a request it lets through only because the route is reachable while locked (`reachWhileLocked(...) === "reachable"`) with the internal request header `x-morbeh-locked-view: 1`; client-sent copies are stripped like `x-shop-id`. The `(store)` layout and the root `not-found.tsx` render `LockedFrame` (store name, the page, a link to the password page; no menus, search, cart, footer or preview banner) for such requests. `LOCKED_REACHABLE_ROUTES` is exactly the five policy URLs, `/robots.txt` and `/sitemap.xml` (no `[a-z0-9-]+` wildcard), so an unknown `/policies/<x>` is gated, not a 404 in the shop chrome.
6. **Policy pages of a locked store are reachable but `noindex`.** Part 1's root `generateMetadata` gives every locked live page `robots: noindex` (Decision 35), and spec 2.8 makes robots `Disallow: /` while locked. Spec Review Focus 5's "policy pages stay indexable" contradicts both; gateways review policies by visiting them, which works. Decision 35 wins.
7. **Policy route naming.** The route is `app/(store)/policies/[handle]/page.tsx` (Part 1's carry name). The handle maps to a type through `policyTypeOfSlug`, an exact match against the five slugs (never an object lookup by the untrusted string), so `constructor`, `__proto__`, `refund` and a decoded `../x` are all `notFound()` before any Runtime call.
8. **Morbeh text line rules.** Inside a paragraph every single newline is a hard line break (merchants type in a plain textarea and expect what they see). Inline markup (`**`, `*`, `[..](..)`) opens and closes on one line, which keeps the parser linear and the reported line numbers exact.
9. **Unsafe links.** A well-formed `[label](url)` whose URL fails `safeHref` renders its label as plain text (the URL is dropped). The API answers 422 with `{ field: "body.<locale>", message: "UNSAFE_LINK" }` (the top message is Part 1's `INVALID_CONTENT: …`); `FieldIssue` has no line, so the editor shows line numbers from the same `validateRichText` it runs locally.
10. **One renderer for both apps.** `renderRichText(document, h, classes)` lives in `@platform/storefront-content` over an injected `createElement` (the package stays dependency-free), so the tag allow-list (`h2 h3 p strong em ul ol li a hr br`) and the link attributes exist once. Each app passes `React.createElement` and its own Tailwind class map (Tailwind does not scan workspace packages; class drift is cosmetic, not a boundary).
11. **`LinkTargetsPort` covers collections, products and pages.** Home, search, URL and policy links resolve inside `services/online-store` (a policy link is live when the policy is set). Live ("published") means: a collection whose status is `published`; a product whose state is sellable (`published` or `unlisted`, exactly what `/products/<slug>` serves); a page that is `published` and whose route path is `/pages/<handle>`.
12. **Virtual defaults and the policy row.** Virtual items carry fixed ids (`00000000-0000-4000-8000-0000000000NN`). The default `footer` is Search plus one item per policy that is set, computed at read time. The storefront's policy-links row skips any policy whose URL the footer menu already links, so the default never lists a policy twice.
13. **Menu limits and deletion.** At most 50 menus per shop (`MENU_LIMIT`, 409). The handle `new` is reserved (admin-web's `/online-store/navigation/new`). `DELETE` takes no version (spec 2.6 gives it no body) and is refused only by `MENU_PROTECTED`, `MENU_IN_USE` and 404.
14. **No domain events for menus, policies or page content.** Nothing consumes them, and each would need a new Kafka topic. Storefront freshness is admin-web's revalidation call plus the 60 s TTL.
15. **Pages can be unpublished.** `published → draft` joins the transition table (Shopify's "Hidden"); `archived` stays terminal. Without it, hiding "About us" would archive it forever and keep `/pages/about` taken (route paths are unique per shop). It emits `pages.page.draft` (owner provisions topic `pages.page.draft.v1`). `publishedAt` is set on the first publish only.
16. **Page title fallback.** An empty `title` displays `name` (as a one-locale text). No cross-context read of the shop's default language: `pickText` shows a one-locale text in both languages anyway.
17. **Page DTOs.** `POST /pages` accepts optional `title`, `body` and `metaDescription`, so "Add page" is one call. `PageDto` gains `title`, `body`, `metaDescription`, `publishedAt` (spec) and `version`, `updatedAt` (needed for `expectedVersion` and "Last updated"). `GET /pages` list items omit `body` (100 pages × 200 KB would be a 20 MB list).
18. **The in-memory page repository versions like Prisma.** Create stores version 1, every save +1, a stale save throws `ConcurrencyError`, so `UpdatePageContent`'s version guard is testable without a database.
19. **Route path from a title.** admin-web slugifies a Latin title (`[a-z0-9]` runs joined by `-`, ≤ 60); anything else (an Arabic-only title) becomes `page-<4 random a-z0-9>`. No transliteration table. The field stays editable; the API's 409 on a taken path is shown on it.
20. **Template prefill without new routes.** Operators cannot read `settings:read` routes (store settings and shipping zones are admin-only). The policies page prefills the store name from `GET /online-store/preferences` (`online_store:read`) and the contact email from `GET /store/settings` only when that read succeeds (admins); otherwise the email starts blank. "Ships outside the country" starts "no" and cash on delivery "yes" (the zone list cannot say which country is home). The merchant edits every input before generating.
21. **Template rules.** A merchant value never starts a line (tested over the template sources), every value is escaped with `escapeRichText`, a line containing an empty value is dropped, and `{contact}` is the given channels joined by " or " / " أو ", or "our store" / "متجرنا" when none (the templates already say "contact us at" / "تواصل معنا عبر").
22. **Public pages list.** `GET /public/pages` returns published pages whose route path is `/pages/<handle>`, ordered by handle, at most 500 (`first` defaults to and is capped at 500).
23. **Sitemap sources.** Set policies come from the five cached `GET /public/policies/:type` reads (no list route). Products and collections are paged 100 at a time, at most 60 calls in all, and the whole sitemap stops at 5,000 URLs. Absolute URLs use the request `Host` (strictly validated) with `https:`, `http:` only for `localhost`/`127.0.0.1` in development; an invalid host gives an empty sitemap and no `Sitemap:` line.
24. **`services/pages` copies `CODE:` into `body.code`.** Its presenter learns Part 1's Ruling 9 (`present` copies a message prefix `CODE:` into `body.code`), so admin-web reads `VERSION_CONFLICT`, `PAGE_ARCHIVED` and the 422 codes the same way as for the Online Store.
25. **Menu URL normalisation.** `https:` is stored as `URL.href`; `mailto:` must be exactly one address with no query; `tel:` accepts digits with spaces, dashes, dots and brackets and is stored as `tel:` + optional `+` + 3–20 digits. Anything else, and any whitespace, control, zero-width or bidi character anywhere, is `INVALID_URL`.
26. **Shell degradation.** A failed link-target read in the public shell drops only the collection/product/page items (logged), like Part 1's images; home, search, policy and URL items still render. Admin reads let the failure surface (a blip must not look like a broken link).
27. **`fake-prisma` learns `startsWith`.** `ListPublishedPages` filters `routePath: { startsWith: "/pages/" }`; the test fake throws on unknown operators, so Task 4 adds that one operator.
28. **Policy titles live in the package.** `POLICY_TITLES` (spec 2.3's table, MSA and English) is exported by `@platform/storefront-content`; the service uses it for the default footer labels and the storefront for page titles and the policy row, so the two never disagree.
29. **`GET /online-store/menus` adds `topLabels`.** The list row shows "Home, Search"; the DTO carries the first five top-level labels (`LocalizedText[]`) besides spec 2.6's fields.
30. **Settings → Policies is open to viewers (read-only) and operators.** Middleware gets `["/settings/policies", "viewer"]` (a longer prefix than `/settings`); the API refuses viewers' writes and the screen disables them. The Settings index stays admin-only, so the screen is also linked from Online Store → Pages ("Store policies") and Online Store → Navigation's policy picker.

## Global Constraints

Copied from the spec and Part 1's binding lessons; every task's requirements include them.

1. **Migrations:** hand-written, additive SQL `packages/db/prisma/schema/migrations/20261027010000_online_store_content/migration.sql`, with the matching Prisma models in `packages/db/prisma/schema/online-store.prisma` and the new `Page` columns in `pages.prisma`. Every new table: `tenant_id TEXT NOT NULL`, then `ENABLE` + `FORCE ROW LEVEL SECURITY`, then `DROP POLICY IF EXISTS tenant_isolation …; CREATE POLICY tenant_isolation … FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));` exactly as `20261027000000_online_store_identity`. **Never run `prisma migrate`, `db push`, or any SQL against any database.** `prisma validate` / `prisma generate` with dummy URLs and `schema-migration-consistency.test.ts` are the checks. **Task 3.**
2. **Per-request tenant (ADR-0014):** repositories take `tenantId` per call; reads go through `runReadScoped(prisma, tenantId, fn)` or the caller's `tx`; writes go through the unit of work. No object field named `tenantId` (or `defaultTenantId` / `pinnedTenantId`) anywhere on `WiredAdmin` outside the `tenancy` key — cross-context seams are closures and parameters (`publicReads.pages`, the link-target adapter). Every Prisma `findFirst/findMany/updateMany/deleteMany/count` names `tenantId` in a literal `where` (checked by `node scripts/dev/check-prisma-tenant-where.mjs`). No raw SQL. Each Prisma repository gets a `tenant-isolation.test.ts` case. **Tasks 3, 4, 6, 7.**
3. **The unit of work commits on an `err` Result.** `PrismaUnitOfWork.run` only rolls back on a throw. Validate everything (menu items, rich text, handles, versions, limits, references) **before the first write** inside `unitOfWork.run`; never write and then return `err`. Lost races throw `ConcurrencyError` (rollback) and are answered 409 `VERSION_CONFLICT` outside `run`. **Tasks 4, 5, 6.**
4. **Error codes travel in the envelope:** every specific 404/409/422 message is `"CODE: text"`; the presenter copies `CODE` into `body.code`; field issues carry the code as the field message (`{ field: "body.ar", message: "UNSAFE_LINK" }`). **Tasks 4, 5, 6, 7.**
5. **Guarded writes:** optimistic `version` on menus, policies and pages (`expectedVersion`); one idempotency key per submit; the template route is **not** idempotent (it is pure and returns text). **Tasks 5, 6, 7, 10, 11.**
6. **Rich text and links (anti-goals):** no raw HTML stored or rendered; no `dangerouslySetInnerHTML`; merchant text becomes React elements only through `renderRichText`; link URLs only `https:`, `mailto:`, `tel:` and single-slash relative paths in rich text, and only `https:`, `mailto:`, `tel:` in menu URLs; external (`https:`) links render `target="_blank" rel="noopener noreferrer nofollow"`; the storefront re-validates every href and label it receives. **Tasks 1, 2, 8, 9, 11.**
7. **admin-web:** the runtime API is called only from server code; client components never value-import `@/lib/api/*` or `@/lib/auth/*` (type imports only; verified by the client-bundle grep in Final verification). Every string goes in `messages/en.ts` and `messages/ar.ts` (**Egyptian** Arabic, brand "مربح"). Logical CSS. New pages get `ROUTE_ROLE_REQUIREMENTS` entries. Saves that change the live storefront call `revalidateStorefront()` (`lib/storefront-revalidate.ts`) and report `liveDelayed` when it fails. **Tasks 10, 11.**
8. **Storefront:** server components and server actions only; no browser-side runtime-API calls; the mobile drawer is the only new client component. Copy in `messages/{en,ar}.ts` (**Modern Standard Arabic**), parity enforced by `Dictionary`. RTL-first. Merchant text rendered with `dir="auto"` (and `<bdi>` for inline labels). Dates formatted for the locale (`Intl.DateTimeFormat(locale)`). **Tasks 8, 9.**
9. **Locked store:** only the routes in `LOCKED_REACHABLE_ROUTES` render without access, for GET and HEAD only, without the shop chrome (Ruling 5); robots is `Disallow: /` and the sitemap is empty while locked. Do not add a catch-all route (`[...slug]`): WHATWG normalises `%2e%2e` for middleware but Next's router does not. **Task 9.**
10. **Cache:** every cached entry has the shop id in its key parts and the tag `os:<shopId>`; preview reads stay `no-store`; nothing is shared between shops. **Tasks 8, 9.**
11. **Brand:** **مربح** / **Morbeh**; no "موربيه" anywhere in `apps/`. **Tasks 8–11.**
12. **Anti-goals (verbatim):** no raw HTML stored or rendered from merchant input, no `dangerouslySetInnerHTML` on merchant content; no merchant-typed string reaches a CSS block, a `<script>`, a `style` attribute or a font URL; no draft content without a valid, unexpired preview token for that shop; no cached storefront response or data entry shared between two shops; no new construction-time `tenantId`; no behaviour change to `POST /media/uploads`.

Part 2 numbers (spec, verbatim): migration `20261027010000_online_store_content`; menu handle `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 60, title ≤ 100, label ≤ 60 per locale (at least one locale), depth 2, ≤ 30 top-level items, ≤ 30 children per item, ≤ 150 items in total; menu URL ≤ 2,000, `https:`/`mailto:`/`tel:` only, no `user:pass@`; link picker ≤ 20 results; rich text ≤ 100,000 characters per locale for policies and pages, 5,000 for section bodies (Part 3); page title ≤ 255, meta description ≤ 320; policy URLs `/policies/refund-policy`, `/policies/shipping-policy`, `/policies/privacy-policy`, `/policies/terms-of-service`, `/policies/contact-information`; template return window default 14 days, delivery 2–5 days; public pages list ≤ 500; content cache 60 s, sitemap cache 1 hour, ≤ 5,000 URLs; tag `os:<shopId>`; robots locked `Disallow: /`, unlocked disallows `/cart`, `/checkout`, `/account`, `/c/`, `/password`.

Plan-level numbers (Rulings): `MENU_LIMIT = 50` menus per shop; menu item JSON ≤ 512 KiB (`MENU_TOO_LARGE`); reserved handle `new`; link-target query ≤ 100 characters; sitemap ≤ 60 Runtime calls; policy row deduplicated against footer menu hrefs.

Permissions used (spec table, verbatim; all already granted, Ruling 1):

| Permission                                              | Roles                                    | Used by                                      |
| ------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| `online_store:read`                                     | viewer, operator, admin                  | menus, link targets, policies (read)         |
| `online_store:manage_menus`                             | operator, admin                          | create, update and delete menus              |
| `online_store:manage_policies`                          | operator, admin                          | edit policies, generate templates            |
| `pages:update_page`                                     | operator, admin                          | page title, body and meta description (2.4)  |
| `pages:create_page`, `pages:advance_page`, `pages:read` | as today (operator writes, viewer reads) | create with content, publish/unpublish, read |

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in lower case, body lines ≤ 100 characters, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never `--no-verify`. Stage only the task's own files (`git add <paths>`), never `.superpowers/` or `.claude/`. The pre-commit hook can take minutes: commit in the foreground and wait. Files are CRLF in the owner's checkout (`core.autocrlf`); keep each file's line endings, and discard unrelated prettier reformatting of files the task did not mean to change (`git checkout -- <file>`). Tools may turn `\uXXXX` escapes into raw characters: write invisible and bidi characters in source as `String.fromCharCode(0x202e)` or as escapes, and check the bytes (`LC_ALL=C.UTF-8 grep -nP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]' <file>` prints nothing).

## Review Focus

The five failure modes the spec implies but its own test list does not pin, most likely first. Each names the task whose test pins it.

1. **A locked store leaks through the reachable routes.** `/policies/constructor`, `/policies/..%2Fproducts%2Fx`, `/policies/refund-policy/`, a POST to `/policies/refund-policy`, or a 404 under a reachable path must never render the shop's header, menus, footer or catalogue; a client-sent `x-morbeh-locked-view` must be stripped. Pinned in **Task 9** (`locked-routes.test.ts` "exactly seven routes", `middleware.test.ts` "the locked view header is set only by the gate", `layout.test.tsx` "a locked view renders LockedFrame, never StoreChrome", `policies/[handle]/page.test.tsx` "unknown handles are notFound with no Runtime call").
2. **The catalogue is down while the shell renders.** A failing link-target read must not blank or 500 the storefront: catalogue-linked items disappear, the rest of the menu and the page stay. Pinned in **Task 6** (`shell.use-case.test.ts` "link targets down → only catalogue items are dropped, logged") and **Task 8** (`online-store.test.ts` "a shell without menus parses as empty menus").
3. **A Part 1 document after the upgrade.** A stored draft or release without `menuHandle`/`showPolicyLinks` must read with the defaults, save again unchanged, and keep `hasUnpublishedChanges` false when draft equals live. Pinned in **Task 2** (`theme-document.test.ts` "a Part 1 document reads, validates and canonicalises as before") and **Task 6** (`shell.use-case.test.ts` "a Part 1 published document still renders the default menus").
4. **Two tabs create the footer menu at once.** Both start from the virtual default (`expectedVersion: 0`); one insert wins, the other must answer `VERSION_CONFLICT` and write nothing, never a second row or a 500. Pinned in **Task 6** (`menus.use-cases.test.ts` "a lost first insert is VERSION_CONFLICT") and **Task 3** (`prisma-repositories.test.ts` "a duplicate first insert throws ConcurrencyError").
5. **A random or hostile page handle floods the storefront.** `/pages/<anything>` with 404s must not be cached, must not reach the Runtime for a malformed handle, and two shops must never share an entry. Pinned in **Task 8** (`content.test.ts` "a 404 is never cached", "two shops, two keys", `pages/[handle]/page.test.tsx` "a malformed handle is notFound without a read").

---

## File Structure

**packages/storefront-content** (`@platform/storefront-content`)

- `src/links.ts` (new) — `LINK_URL_MAX`, `normalizeExternalUrl`, `isSafeRelativePath`, `safeHref`, and the URL character rules moved from `theme-document.ts`.
- `src/rich-text.ts` (new) — the AST types, `parseRichText`, `validateRichText`, `escapeRichText`, `renderRichText`, `RICH_TEXT_TAGS`, `RICH_TEXT_MAX`.
- `src/policies.ts` (new) — `POLICY_TYPES`, `PolicyType`, `POLICY_SLUGS`, `POLICY_TITLES`, `isPolicyType`, `policyTypeOfSlug`, `policyPath`.
- `src/menus.ts` (new) — `LinkRef`, `MenuItem`, `ResolvedMenuItem`, limits, `isMenuHandle`, `validateMenuItems`, `readResolvedMenu`, `linkRefTargetsOf`.
- `src/theme-document.ts` — `header.menuHandle`, `footer.menuHandle`, `footer.showPolicyLinks`, `menuHandlesOf`.
- `src/index.ts`; tests beside each file.

**packages/db**

- `prisma/schema/migrations/20261027010000_online_store_content/migration.sql`
- `prisma/schema/online-store.prisma` (+ `OnlineStoreMenu`, `OnlineStorePolicy`), `prisma/schema/pages.prisma` (`Page` + 4 columns, index)
- `src/schema-migration-consistency.test.ts` (one `describe`)
- `src/testing/fake-prisma.ts` (`startsWith`, Ruling 27)

**services/online-store**

- `src/domain/menu.ts`, `default-menus.ts`, `store-policy.ts`, `repositories.ts` (+ `MenuRepository`, `PolicyRepository`), `errors.ts` (+ codes)
- `src/domain/policy-templates/template-inputs.ts`, `en.ts`, `ar.ts`, `render.ts`
- `src/application/ports.ts` (+ `LinkTargetsPort`), `deps.ts`, `policies.use-cases.ts`, `menus.use-cases.ts`, `menu-resolution.ts`, `link-targets.use-case.ts`, `shell.use-case.ts`
- `src/infrastructure/in-memory-repositories.ts`, `prisma-repositories.ts` (+ menus, policies), `tenant-isolation.test.ts`
- `src/interfaces/online-store.controller.ts`, `src/composition.ts`, `src/index.ts`, `src/testing/fakes.ts`

**services/pages**

- `src/domain/page.ts`, `page-content.ts` (new), `repositories.ts`
- `src/application/pages.use-cases.ts` (+ `UpdatePageContent`, content on create), `public-pages.use-cases.ts` (new)
- `src/infrastructure/mappers.ts`, `in-memory-repositories.ts`, `prisma-repositories.ts`, `pages-event-translator.ts`, `tenant-isolation.test.ts` (new)
- `src/interfaces/pages.controller.ts`, `presenter.ts`, `src/composition.ts`, `src/index.ts`, `package.json`

**services/catalog** — `GetCollectionsByIds` (`application/get-collections-by-ids.use-case.ts`), `CollectionRepository.findByIds`, `CollectionController.getByIds`, `composition.ts`.

**apps/admin**

- `src/infrastructure/cross-context/online-store-link-targets.adapter.ts` (+ test)
- `src/composition.ts` (`linkTargets`, `publicReads.pages`)
- `src/interfaces/online-store.admin-controller.ts`, `pages.admin-controller.ts`
- `src/http/online-store-routes.ts`, `public-online-store-routes.ts`, `public-pages-routes.ts` (new), `pages-routes.ts`, `admin-routes.ts`
- tests: `online-store-routes.test.ts`, `public-online-store-routes.test.ts`, `public-pages-routes.test.ts`, `pages-routes.test.ts`, `src/tenant-mode-guard.test.ts`

**apps/storefront**

- `src/lib/online-store.ts` (menus in the shell), `content.ts` (new), `sitemap.ts` (new), `site-origin.ts` (new), `locked-routes.ts`, `request-locale.ts`, `runtime-api.ts` (paged reads)
- `src/components/rich-text.tsx`, `site-nav.tsx`, `mobile-menu.tsx`, `locked-frame.tsx` (new), `site-header.tsx`, `site-footer.tsx`
- `src/app/(store)/pages/[handle]/page.tsx`, `src/app/(store)/policies/[handle]/page.tsx`, `src/app/(store)/layout.tsx`, `src/app/not-found.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`
- `src/middleware.ts`, `src/messages/en.ts`, `ar.ts`; tests beside each file

**apps/admin-web**

- `src/lib/api/online-store.ts` (menus, link targets, policies, template), `src/lib/api/pages.ts` (content)
- `src/app/online-store/navigation/page.tsx`, `new/page.tsx`, `[handle]/page.tsx`, `actions.ts`
- `src/app/settings/policies/page.tsx`, `actions.ts`; `src/app/settings/page.tsx`
- `src/app/pages/page.tsx`, `new/page.tsx`, `[pageId]/page.tsx`, `actions.ts`
- `src/components/online-store/menu-editor.tsx`, `menu-item-dialog.tsx`, `link-picker.tsx`, `rich-text-editor.tsx`, `policy-card.tsx`, `policy-template-dialog.tsx`, `customize-panels.tsx`, `customize-editor.tsx`
- `src/components/pages/page-content-form.tsx` (new), `pages-table.tsx`; `src/lib/pages/route-path.ts` (new), `src/lib/pages-lifecycle.ts`, `src/lib/online-store/save-errors.ts`
- `src/components/navigation.ts`, `src/middleware.ts`, `src/messages/en.ts`, `ar.ts`; tests beside each file

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`. Admin lint needs memory:
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` (same variable for `admin-web`).
- Packages: `@platform/storefront-content`, `@platform/db`, `@platform/online-store`, `@platform/pages`, `@platform/catalog`, `@platform/admin`, `admin-web`, `storefront`.
- After editing a `package.json` (Task 4 adds `@platform/storefront-content` to `@platform/pages`), run `pnpm install`. No new external dependency in Part 2. If `node_modules` is being installed in the background, wait and retry; never delete `node_modules` or the lockfile.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after the schema change. **Never `prisma migrate`, `db push`, or any SQL against any database.**
- Tenant-filter guard: `node scripts/dev/check-prisma-tenant-where.mjs`. `packages/db/src/prisma-tenant-where.guard.test.ts` cannot load from a path with a space, so run the script directly. On this base it reports ONE known finding, `apps/admin/src/interfaces/discounts/discounts.admin-controller.ts:166: promotions.update has no where`; any other finding is yours to fix.
- Route contract (admin-web ⇄ admin route table), from the app directory: `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`.
- `next build` fails with `EPERM` on this machine — do not rely on it; `typecheck`, `lint` and `test` are the gates for admin-web and storefront.
- Integration tests run only with `DATABASE_URL_TEST` set (skipped otherwise; never point it at a real database).
- Client-bundle grep (admin-web):
  `grep -rlE '^"use client"' apps/admin-web/src | xargs grep -nE 'from "@/lib/(api|auth)/' | grep -v 'import type'`
  It matches the closing line of multi-line imports too, so inspect every hit. On this base it prints exactly three pre-existing, pure-constant imports: `components/finance/finance-model-picker.tsx` (`finance-read-models`), `components/security/audit-actions.tsx` and `components/security/identity-actions.tsx` (`security-transitions`). Nothing under `components/online-store`, `components/pages`, `app/online-store`, `app/settings/policies` or `app/pages` may appear.
- Invisible-character check on files you wrote: `LC_ALL=C.UTF-8 grep -rnP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]' <paths>` prints nothing.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: `@platform/storefront-content` — link rules and Morbeh text (parser, validator, renderer)

Model tier: **strong** (a security boundary and a linear-time parser).

**Files:**

- Create: `packages/storefront-content/src/links.ts`, `links.test.ts`
- Create: `packages/storefront-content/src/rich-text.ts`, `rich-text.test.ts`, `rich-text.xss.test.ts`
- Modify: `packages/storefront-content/src/theme-document.ts` (import `URL_CONTROLS` and `URL_INVISIBLES` from `./links` instead of declaring them; nothing else changes)
- Modify: `packages/storefront-content/src/index.ts` (`export * from "./links"; export * from "./rich-text";`)

**Interfaces:**

- Consumes: nothing new.
- Produces (all exported from `@platform/storefront-content`):
  - `LINK_URL_MAX = 2000`; `URL_CONTROLS: RegExp`, `URL_INVISIBLES: RegExp` (moved, unchanged).
  - `normalizeExternalUrl(raw: unknown): string | null` — `https:`/`mailto:`/`tel:` normalised (Ruling 25), else null.
  - `isSafeRelativePath(raw: string): boolean` — one leading `/`, never `//` or `/\`, no whitespace, backslash, control or invisible character, ≤ `LINK_URL_MAX`.
  - `safeHref(raw: unknown): { readonly href: string; readonly external: boolean } | null` — a safe relative path (`external: false`) or `normalizeExternalUrl`'s result (`external` true for `https:` only).
  - `type RichInline = { type: "text"; value: string } | { type: "strong" | "em"; children: readonly RichInline[] } | { type: "link"; href: string; external: boolean; children: readonly RichInline[] } | { type: "break" }` (all fields `readonly`).
  - `type RichBlock = { type: "paragraph"; children: readonly RichInline[] } | { type: "heading"; level: 2 | 3; children: readonly RichInline[] } | { type: "list"; ordered: boolean; items: readonly (readonly RichInline[])[] } | { type: "rule" }`.
  - `interface RichTextDocument { readonly blocks: readonly RichBlock[] }`.
  - `parseRichText(text: string): { readonly document: RichTextDocument; readonly unsafeLinkLines: readonly number[] }` — never throws; line numbers 1-based, ascending, each line once.
  - `RICH_TEXT_MAX = { body: 100_000, section: 5_000 } as const`.
  - `interface RichTextIssue { readonly code: "TOO_LONG" | "UNSAFE_LINK"; readonly line: number }` (`TOO_LONG` has `line: 0`).
  - `validateRichText(text: string, max: number): readonly RichTextIssue[]`.
  - `escapeRichText(value: string): string` — backslash before every `\`, `*`, `[`, `]`, `#`, `` ` ``.
  - `RICH_TEXT_TAGS = ["h2", "h3", "p", "strong", "em", "ul", "ol", "li", "a", "hr", "br"] as const`, `type RichTextTag`.
  - `interface RichTextProps { readonly key: string; readonly className?: string; readonly dir?: "auto"; readonly href?: string; readonly target?: "_blank"; readonly rel?: string }`.
  - `type CreateElement<E> = (tag: RichTextTag, props: RichTextProps, ...children: (E | string)[]) => E`.
  - `renderRichText<E>(document: RichTextDocument, h: CreateElement<E>, classes?: Partial<Readonly<Record<RichTextTag, string>>>): E[]`.

- [ ] **Step 1: Write the failing link tests** — `packages/storefront-content/src/links.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isSafeRelativePath, LINK_URL_MAX, normalizeExternalUrl, safeHref } from "./links";

const ch = (code: number) => String.fromCharCode(code);

describe("normalizeExternalUrl (spec 2.2, Ruling 25)", () => {
  it.each([
    ["https://example.com/a?b=1#c", "https://example.com/a?b=1#c"],
    ["HTTPS://Example.COM", "https://example.com/"],
    ["https://wa.me/201001234567", "https://wa.me/201001234567"],
    ["mailto:hello@Shop.Example", "mailto:hello@shop.example"],
    ["tel:+20 100 123 4567", "tel:+201001234567"],
    ["tel:(02) 2345-6789", "tel:0223456789"],
    ["TEL:19999", "tel:19999"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeExternalUrl(input)).toBe(expected);
  });

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:msgbox(1)",
    "ftp://example.com",
    "//evil.example",
    "/relative",
    "https:evil.example",
    "https://user:pass@evil.example",
    "https://user@evil.example",
    "https://exa mple.com",
    "https://example.com/\n",
    "tel:+20abc",
    "tel:12",
    "tel:" + "1".repeat(21),
    "mailto:",
    "mailto:a@b.example?subject=x",
    "mailto:a@b.example,c@d.example",
    "",
    `https://example.com/${"a".repeat(LINK_URL_MAX)}`,
  ])("refuses %j", (input) => {
    expect(normalizeExternalUrl(input)).toBeNull();
  });

  it("refuses zero-width, bidi, no-break and control characters anywhere", () => {
    for (const code of [0x00, 0x1f, 0x7f, 0xa0, 0x200b, 0x200e, 0x202e, 0x2066, 0x2069, 0xfeff]) {
      expect(normalizeExternalUrl(`https://exa${ch(code)}mple.com`), code.toString(16)).toBeNull();
      expect(normalizeExternalUrl(`tel:+20${ch(code)}1001234567`), code.toString(16)).toBeNull();
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 1, {}, ["https://a.example"]]) {
      expect(normalizeExternalUrl(value)).toBeNull();
    }
  });
});

describe("isSafeRelativePath", () => {
  it.each(["/", "/pages/about", "/collections/new?sort=price#top", "/search?q=%D8%A7"])(
    "accepts %s",
    (path) => expect(isSafeRelativePath(path)).toBe(true),
  );
  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/a\nb",
    "/ a",
    "/a\\b",
    "pages/about",
    "",
    `/${"a".repeat(LINK_URL_MAX)}`,
  ])("refuses %j", (path) => expect(isSafeRelativePath(path)).toBe(false));
  it("refuses an invisible character", () => {
    expect(isSafeRelativePath(`/pa${ch(0x202e)}ges`)).toBe(false);
  });
});

describe("safeHref", () => {
  it("a same-site path is internal; https is external; mailto and tel are neither", () => {
    expect(safeHref("/pages/about")).toEqual({ href: "/pages/about", external: false });
    expect(safeHref("https://shop.example")).toEqual({
      href: "https://shop.example/",
      external: true,
    });
    expect(safeHref("mailto:a@b.example")).toEqual({ href: "mailto:a@b.example", external: false });
    expect(safeHref("tel:19999")).toEqual({ href: "tel:19999", external: false });
  });
  it("everything else is null", () => {
    for (const value of ["javascript:x", "//evil.example", "http://x.example", 3, null]) {
      expect(safeHref(value)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/links.test.ts`
Expected: FAIL — `Cannot find module './links'`.

- [ ] **Step 3: Implement `links.ts`**

Move `URL_CONTROLS` and `URL_INVISIBLES` verbatim from `theme-document.ts` into `links.ts` (exported), and import them back in `theme-document.ts` (`socialUrlAt` keeps its own behaviour). Then:

- `normalizeExternalUrl(raw)`: not a string, longer than `LINK_URL_MAX`, or containing a `URL_CONTROLS`/`URL_INVISIBLES` character → `null`. Then by prefix (case-insensitive):
  - `https://` → `new URL(raw)`; require `protocol === "https:"`, empty `username` and `password`, non-empty `hostname`; return `url.href` if it is ≤ `LINK_URL_MAX`.
  - `mailto:` → match `/^mailto:([A-Za-z0-9.!#$%&'*+=^_{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/i`; return `mailto:<local>@<domain lower-cased>`.
  - `tel:` → match `/^tel:(\+?)([0-9 ().-]+)$/i`; keep the digits; 3–20 digits → `tel:<plus><digits>`.
  - anything else → `null`.
- `isSafeRelativePath(raw)`: `raw.length <= LINK_URL_MAX`, `/^\/(?![\/\\])[^\s\\]*$/.test(raw)`, and no `URL_CONTROLS`/`URL_INVISIBLES` character.
- `safeHref(raw)`: a string that `isSafeRelativePath` → `{ href: raw, external: false }`; else `normalizeExternalUrl(raw)` → `{ href, external: href.startsWith("https:") }`; else `null`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/links.test.ts src/theme-document.test.ts`
Expected: PASS (the theme-document suite is unchanged by the move).

- [ ] **Step 5: Write the failing rich-text tests** — `packages/storefront-content/src/rich-text.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  escapeRichText,
  parseRichText,
  renderRichText,
  RICH_TEXT_MAX,
  validateRichText,
  type CreateElement,
  type RichBlock,
} from "./rich-text";

const blocks = (text: string): readonly RichBlock[] => parseRichText(text).document.blocks;
const inline = (text: string) => (blocks(text)[0] as { children: unknown }).children;
const t = (value: string) => ({ type: "text", value }) as const;
const br = { type: "break" } as const;

describe("parseRichText — blocks (spec 2.1)", () => {
  it("separates paragraphs by blank lines; one newline is a hard break (Ruling 8)", () => {
    expect(blocks("one\ntwo\n\n\nthree")).toEqual([
      { type: "paragraph", children: [t("one"), br, t("two")] },
      { type: "paragraph", children: [t("three")] },
    ]);
  });

  it("normalises CRLF and a lone CR first", () => {
    expect(blocks("a\r\nb\rc")).toEqual(blocks("a\nb\nc"));
  });

  it("only ## and ### are headings; #, ####, ##x and an empty heading stay text", () => {
    expect(blocks("## Returns\n### Refunds\n# Big\n#### Small\n##Tight\n## ")).toEqual([
      { type: "heading", level: 2, children: [t("Returns")] },
      { type: "heading", level: 3, children: [t("Refunds")] },
      {
        type: "paragraph",
        children: [t("# Big"), br, t("#### Small"), br, t("##Tight"), br, t("##")],
      },
    ]);
  });

  it("- and 1. make one-level lists; indentation is flattened; the kinds never mix", () => {
    expect(blocks("- a\n  - b\n1. c\n12. d\n-e")).toEqual([
      { type: "list", ordered: false, items: [[t("a")], [t("b")]] },
      { type: "list", ordered: true, items: [[t("c")], [t("d")]] },
      { type: "paragraph", children: [t("-e")] },
    ]);
  });

  it("--- (or longer) is a rule, also right under a paragraph line", () => {
    expect(blocks("text\n---\n-----")).toEqual([
      { type: "paragraph", children: [t("text")] },
      { type: "rule" },
      { type: "rule" },
    ]);
  });

  it("an empty or blank text has no blocks", () => {
    expect(blocks("")).toEqual([]);
    expect(blocks(" \n\n \t")).toEqual([]);
  });
});

describe("parseRichText — inline", () => {
  it("bold, italic, and the two nested either way", () => {
    expect(inline("**b** and *i*")).toEqual([
      { type: "strong", children: [t("b")] },
      t(" and "),
      { type: "em", children: [t("i")] },
    ]);
    expect(inline("**bold *both***")).toEqual([
      { type: "strong", children: [t("bold "), { type: "em", children: [t("both")] }] },
    ]);
    expect(inline("*a **b** c*")).toEqual([
      { type: "em", children: [t("a "), { type: "strong", children: [t("b")] }, t(" c")] },
    ]);
  });

  it("unclosed markers are literal text, merged into one text node", () => {
    expect(inline("**open and *half")).toEqual([t("**open and *half")]);
  });

  it("markup never spans lines (Ruling 8)", () => {
    expect(inline("**a\nb**")).toEqual([t("**a"), br, t("b**")]);
  });

  it("links: https is external; a same-site path, mailto and tel are not", () => {
    expect(
      inline("[Shop](https://shop.example/a) [About](/pages/about) [Call](tel:+201001234567)"),
    ).toEqual([
      { type: "link", href: "https://shop.example/a", external: true, children: [t("Shop")] },
      t(" "),
      { type: "link", href: "/pages/about", external: false, children: [t("About")] },
      t(" "),
      { type: "link", href: "tel:+201001234567", external: false, children: [t("Call")] },
    ]);
  });

  it("link text may carry emphasis but never another link", () => {
    expect(inline("[**Big** sale](/collections/sale)")).toEqual([
      {
        type: "link",
        href: "/collections/sale",
        external: false,
        children: [{ type: "strong", children: [t("Big")] }, t(" sale")],
      },
    ]);
    expect(inline("[a [b](/x) c](/y)")).toEqual([
      { type: "link", href: "/y", external: false, children: [t("a b c")] },
    ]);
  });

  it("an unsafe link renders its label as text and is reported at its line (Ruling 9)", () => {
    const parsed = parseRichText("ok\n[x](javascript:alert(1)) and [y](//evil.example)");
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t("ok"), br, t("x) and y")] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([2]);
  });

  it("whitespace in the url or an empty url is not a link at all", () => {
    expect(inline("[a](https://x.example/a b) [c]()")).toEqual([
      t("[a](https://x.example/a b) [c]()"),
    ]);
  });

  it("![image](url) stays literal text (no images)", () => {
    expect(inline("![logo](https://cdn.example/a.png)")).toEqual([
      t("![logo](https://cdn.example/a.png)"),
    ]);
  });

  it("a backslash escapes punctuation; HTML and backticks are plain text", () => {
    expect(inline("\\*not\\* \\[x\\](y) <b>hi</b> `code`")).toEqual([
      t("*not* [x](y) <b>hi</b> `code`"),
    ]);
  });

  it("Arabic and mixed text keep every character", () => {
    expect(blocks("## سياسة الاسترجاع\n**مهم:** خلال 14 يوم — within 14 days")).toEqual([
      { type: "heading", level: 2, children: [t("سياسة الاسترجاع")] },
      {
        type: "paragraph",
        children: [{ type: "strong", children: [t("مهم:")] }, t(" خلال 14 يوم — within 14 days")],
      },
    ]);
  });
});

describe("parseRichText — hostile sizes run in linear time", () => {
  const timed = (text: string) => {
    const start = performance.now();
    parseRichText(text);
    return performance.now() - start;
  };
  it.each([
    ["100k unclosed **", "**".repeat(50_000)],
    ["100k [", "[".repeat(100_000)],
    ["25k [a](", "[a](".repeat(25_000)],
    ["50k ](", "](".repeat(50_000)],
    ["alternating * and **", "*a **b ".repeat(14_000)],
    ["one 100k line", "x".repeat(100_000)],
    ["50k lines", "a\n".repeat(50_000)],
    ["50k list items", "- a\n1. b\n".repeat(12_500)],
  ])("%s parses in under 400 ms", (_name, text) => {
    expect(timed(text)).toBeLessThan(400);
  });
});

describe("validateRichText", () => {
  it("over the limit is TOO_LONG at line 0", () => {
    expect(validateRichText("a".repeat(11), 10)).toEqual([{ code: "TOO_LONG", line: 0 }]);
    expect(validateRichText("a".repeat(10), 10)).toEqual([]);
  });
  it("every line with an unsafe link is reported once, in order", () => {
    expect(
      validateRichText(
        "[a](http://x.example) [b](javascript:x)\n\n[c](https://x.example)\n[d](data:text/html,x)",
        RICH_TEXT_MAX.body,
      ),
    ).toEqual([
      { code: "UNSAFE_LINK", line: 1 },
      { code: "UNSAFE_LINK", line: 4 },
    ]);
  });
  it("the limits are 100,000 for bodies and 5,000 for sections", () => {
    expect(RICH_TEXT_MAX).toEqual({ body: 100_000, section: 5_000 });
  });
});

describe("escapeRichText (template substitution, spec 2.3)", () => {
  it("a value with markup and a link stays one plain text node", () => {
    const hostile = "Shop](javascript:alert(1)) [x](javascript:y) **b** # `c` \\";
    const parsed = parseRichText(`Welcome to ${escapeRichText(hostile)}`);
    expect(parsed.document.blocks).toEqual([
      { type: "paragraph", children: [t(`Welcome to ${hostile}`)] },
    ]);
    expect(parsed.unsafeLinkLines).toEqual([]);
  });
});

type Node = { tag: string; props: Record<string, unknown>; children: (Node | string)[] };
const h: CreateElement<Node> = (tag, props, ...children) => ({
  tag,
  props: { ...props },
  children,
});

describe("renderRichText (Ruling 10)", () => {
  it("maps blocks to the allowed tags, with dir=auto on text blocks and the caller's classes", () => {
    const out = renderRichText(
      parseRichText("## T\nx **b** *i* [s](https://s.example)\n- one\n1. two\n---").document,
      h,
      { p: "prose-p" },
    );
    expect(out.map((n) => n.tag)).toEqual(["h2", "p", "ul", "ol", "hr"]);
    expect(out[0]?.props).toMatchObject({ dir: "auto" });
    expect(out[1]?.props).toMatchObject({ dir: "auto", className: "prose-p" });
    const link = out[1]?.children.find((c): c is Node => typeof c !== "string" && c.tag === "a");
    expect(link?.props).toMatchObject({
      href: "https://s.example/",
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    });
    expect(out[2]?.children.every((c) => typeof c !== "string" && c.tag === "li")).toBe(true);
  });

  it("an internal, mailto or tel link gets no target and no rel; sibling keys are unique", () => {
    const out = renderRichText(parseRichText("[a](/x) [b](mailto:a@b.example) c\nd").document, h);
    const links = out[0]!.children.filter((c): c is Node => typeof c !== "string" && c.tag === "a");
    for (const link of links) {
      expect(link.props["target"]).toBeUndefined();
      expect(link.props["rel"]).toBeUndefined();
    }
    const keys = out[0]!.children.flatMap((c) => (typeof c === "string" ? [] : [c.props["key"]]));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/rich-text.test.ts`
Expected: FAIL — `Cannot find module './rich-text'`.

- [ ] **Step 7: Implement `rich-text.ts`**

The signatures and tests leave the algorithm open; it must be this one (linear, no backtracking regex on unbounded input):

1. `text.replace(/\r\n?/g, "\n").split("\n")`; line `n` (1-based) is `lines[n - 1]`.
2. **Blocks**, one pass over the lines with `trimmed = line.trim()`. Keep at most one open paragraph or list.
   - `trimmed === ""` closes it.
   - `/^-{3,}$/` closes it and pushes `{ type: "rule" }`.
   - `/^(#{2,3}) +(.+)$/` (non-empty after the marker) closes it and pushes a heading of that level over the inline parse of the rest.
   - `/^- +(.+)$/` is an unordered item, `/^\d{1,9}\. +(.+)$/` an ordered one: appended to an open list of the same kind, else it closes what is open and opens a new list.
   - Anything else is a paragraph line: appended to the open paragraph after a `{ type: "break" }`, else it closes an open list and opens a paragraph.
3. **Inline**, per line, over `s`:
   - Precompute, right to left in one pass, `nextClose[i]` (index of the next `)` at or after `i`, or −1) and `nextSpace[i]` (next whitespace, or `s.length`).
   - Keep a stack of frames `{ kind: "root" | "strong" | "em" | "link"; opener: string; children: RichInline[] }` and a count per kind.
   - `\` followed by an ASCII punctuation character appends that character as text (skip 2).
   - A run of `*` of length `n` is consumed greedily: while `n > 0`, if the top frame is `em` close it (1); else if the top is `strong` and `n ≥ 2` close it (2); else if `n ≥ 2` then close the nearest `strong` when one is open, otherwise open one (2); else (`n === 1`) close the nearest `em` when one is open, otherwise open one.
   - `[` opens a link frame unless the previous character is an unescaped `!`.
   - `]` at `j` with `s[j + 1] === "("`, `c = nextClose[j + 2] > j + 2` and `nextSpace[j + 2] > c` is a link closer when a link frame is open: `url = s.slice(j + 2, c)`; close the nearest link frame; if `safeHref(url)` is not null emit `{ type: "link", href, external, children }` with any link in `children` replaced by its own children, else emit the children inline and record line `n` as unsafe; continue at `c + 1`. With no link frame open, `]` is text.
   - Closing the nearest frame of a kind first flattens every frame above it into its parent as literal text (`opener` then its children). At the end of the line every open frame is flattened the same way. Every frame is pushed once and popped once, so the line is linear.
   - Adjacent text nodes are merged and empty ones dropped.
4. `validateRichText(text, max)`: `text.length > max` → `[{ code: "TOO_LONG", line: 0 }]` (no parse); else one `UNSAFE_LINK` issue per entry of `unsafeLinkLines`.
5. `escapeRichText(value)`: `value.replace(/[\\*[\]#`]/g, "\\$&")`.
6. `renderRichText(doc, h, classes = {})`: `paragraph → p`, `heading → h2|h3`, `list → ul|ol` of `li`, `rule → hr`, `break → br`, `strong`, `em`, `link → a`. `p`, `h2`, `h3`, `ul`, `ol`, `li` get `dir: "auto"`; every element gets `key: String(indexAmongSiblings)` and `className` when `classes[tag]` is set; an external link gets `target: "_blank"` and `rel: "noopener noreferrer nofollow"`. Text is passed as a string child (React escapes it). No other prop is ever produced.

- [ ] **Step 8: Write the XSS and property tests** — `packages/storefront-content/src/rich-text.xss.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { safeHref } from "./links";
import { parseRichText, renderRichText, RICH_TEXT_TAGS, type CreateElement } from "./rich-text";

type Node = { tag: string; props: Record<string, unknown>; children: (Node | string)[] };
const h: CreateElement<Node> = (tag, props, ...children) => ({
  tag,
  props: { ...props },
  children,
});
const ALLOWED_PROPS = new Set(["key", "className", "dir", "href", "target", "rel"]);

function assertSafe(nodes: readonly (Node | string)[]): void {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    expect(RICH_TEXT_TAGS).toContain(node.tag);
    for (const [name, value] of Object.entries(node.props)) {
      expect(ALLOWED_PROPS.has(name), name).toBe(true);
      expect(String(value).toLowerCase()).not.toMatch(/javascript:|data:|vbscript:/);
    }
    if (node.tag === "a") {
      const href = node.props["href"];
      expect(safeHref(href)?.href).toBe(href);
    }
    assertSafe(node.children);
  }
}

const render = (text: string) => renderRichText(parseRichText(text).document, h);

const HOSTILE = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '"><svg onload=alert(1)>',
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java&#x73;cript:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](%6Aavascript:alert(1))",
  "[x](  javascript:alert(1))",
  "[x](//evil.example)",
  "[x](/\\evil.example)",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](vbscript:msgbox(1))",
  "[x](http://plain.example)",
  "[x](https://user:pass@evil.example)",
  '[x](https://ok.example" onmouseover="alert(1))',
  "[[x](javascript:a)](https://ok.example)",
  "[x]([y](javascript:z))",
  `${"**".repeat(5_000)}[x](javascript:y)`,
];

describe("Morbeh text XSS corpus (spec 2.9, Review Focus 3)", () => {
  it.each(HOSTILE)("%j renders allow-listed tags, safe hrefs and no handler props", (input) => {
    assertSafe(render(input));
  });

  it("markup-looking text survives as text, never as an element", () => {
    const out = render("<script>alert(1)</script>");
    expect(out).toEqual([
      { tag: "p", props: { key: "0", dir: "auto" }, children: ["<script>alert(1)</script>"] },
    ]);
  });
});

/** A small seeded PRNG, so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: render output never leaves the allow-list", () => {
  it("2,000 random strings over the syntax alphabet", () => {
    const random = mulberry32(20261104);
    const alphabet = [
      ..."*[]()!\\#-.1 \n`<>\"'&:/a",
      "https://",
      "javascript:",
      "mailto:",
      "tel:",
      "//",
      "---",
      "## ",
    ];
    for (let i = 0; i < 2_000; i += 1) {
      const length = Math.floor(random() * 120);
      let text = "";
      for (let j = 0; j < length; j += 1) text += alphabet[Math.floor(random() * alphabet.length)];
      assertSafe(render(text));
    }
  });
});
```

- [ ] **Step 9: Run the package suite, typecheck and lint**

Run: `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/storefront-content lint`
Expected: PASS, no type or lint errors. Then the invisible-character check on the new files prints nothing.

- [ ] **Step 10: Commit**

```bash
git add packages/storefront-content/src/links.ts packages/storefront-content/src/links.test.ts \
  packages/storefront-content/src/rich-text.ts packages/storefront-content/src/rich-text.test.ts \
  packages/storefront-content/src/rich-text.xss.test.ts packages/storefront-content/src/theme-document.ts \
  packages/storefront-content/src/index.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): add morbeh text and the link rules

A restricted Markdown subset parsed in linear time into a typed AST and rendered through an
injected createElement, plus the https/mailto/tel and same-site link rules both apps share.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `@platform/storefront-content` — menus, policies and the theme document's menu fields

Model tier: **standard** (pure TypeScript; every rule is below).

**Files:**

- Create: `packages/storefront-content/src/policies.ts`, `policies.test.ts`
- Create: `packages/storefront-content/src/menus.ts`, `menus.test.ts`
- Modify: `packages/storefront-content/src/theme-document.ts`, `theme-document.test.ts`, `theme-document.hardening.test.ts` (expectations that spell out `header`/`footer`)
- Modify: `packages/storefront-content/src/index.ts`
- Modify (type fixes only, the literals gain the new fields): `services/online-store/src/infrastructure/prisma-repositories.test.ts:89`, `prisma-repositories.integration.test.ts:116`, `tenant-isolation.test.ts:132` — write `header: { ...DEFAULT_THEME_DOCUMENT.header, sticky: true }` and `footer: { ...DEFAULT_THEME_DOCUMENT.footer, note: { en: marker } }`.

**Interfaces:**

- Consumes: `normalizeLocalizedText`, `ContentIssue`, `LocalizedText`, `MAX_ISSUES`, `pathSegment` (package internals); `normalizeExternalUrl`, `safeHref`, `LINK_URL_MAX` (Task 1).
- Produces:
  - `POLICY_TYPES = ["refund", "shipping", "privacy", "terms", "contact"] as const`, `type PolicyType`, `isPolicyType(value: unknown): value is PolicyType`.
  - `POLICY_SLUGS: Readonly<Record<PolicyType, string>>` = `refund-policy`, `shipping-policy`, `privacy-policy`, `terms-of-service`, `contact-information`.
  - `POLICY_TITLES: Readonly<Record<PolicyType, { readonly ar: string; readonly en: string }>>` = spec 2.3's table verbatim (Ruling 28).
  - `policyTypeOfSlug(slug: string): PolicyType | null`, `policyPath(type: PolicyType): string` (`/policies/<slug>`).
  - `MENU_HANDLE_MAX = 60`, `MENU_TITLE_MAX = 100`, `MENU_LABEL_MAX = 60`, `MENU_LIMITS = { topLevel: 30, children: 30, total: 150 } as const`, `MENU_MAX_BYTES = 524_288`, `DEFAULT_MENU_HANDLES = ["main-menu", "footer"] as const`, `type DefaultMenuHandle`, `RESERVED_MENU_HANDLES = ["new"] as const`.
  - `type LinkRef = { type: "home" } | { type: "search" } | { type: "collection" | "product" | "page"; id: string } | { type: "policy"; policy: PolicyType } | { type: "url"; url: string }` (readonly).
  - `interface MenuItem { readonly id: string; readonly label: LocalizedText; readonly link: LinkRef; readonly children: readonly MenuItem[] }`.
  - `interface ResolvedMenuItem { readonly label: LocalizedText; readonly href: string; readonly external: boolean; readonly children: readonly ResolvedMenuItem[] }`.
  - `isMenuHandle(value: unknown): value is string` (format and length only), `isDefaultMenuHandle(value: string): value is DefaultMenuHandle`.
  - `validateMenuItems(raw: unknown): ValidationOutcome<readonly MenuItem[]>` — issue paths start at `items`.
  - `linkRefTargetsOf(items: readonly MenuItem[]): { readonly collection: string[]; readonly product: string[]; readonly page: string[] }` — distinct ids per kind across both levels.
  - `readResolvedMenu(raw: unknown): readonly ResolvedMenuItem[]` — the storefront's tolerant reader.
  - `ThemeDocument["header"] = { sticky: boolean; menuHandle: string }`, `ThemeDocument["footer"] = { note: LocalizedText; showSocial: boolean; menuHandle: string; showPolicyLinks: boolean }`; `DEFAULT_THEME_DOCUMENT` carries `"main-menu"`, `"footer"`, `true`; `menuHandlesOf(doc: ThemeDocument): readonly string[]` (distinct, header first).

- [ ] **Step 1: Write the failing policy and menu tests**

`packages/storefront-content/src/policies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  POLICY_SLUGS,
  POLICY_TITLES,
  POLICY_TYPES,
  policyPath,
  policyTypeOfSlug,
} from "./policies";

describe("policies (spec 2.3)", () => {
  it("the five types sit at Shopify's URLs", () => {
    expect(POLICY_TYPES.map(policyPath)).toEqual([
      "/policies/refund-policy",
      "/policies/shipping-policy",
      "/policies/privacy-policy",
      "/policies/terms-of-service",
      "/policies/contact-information",
    ]);
  });
  it("the titles are the spec's table", () => {
    expect(POLICY_TITLES.refund).toEqual({ ar: "سياسة الاسترجاع", en: "Refund policy" });
    expect(POLICY_TITLES.contact).toEqual({ ar: "معلومات التواصل", en: "Contact information" });
  });
  it("maps a slug back to its type, and nothing else (Ruling 7)", () => {
    for (const type of POLICY_TYPES) expect(policyTypeOfSlug(POLICY_SLUGS[type])).toBe(type);
    for (const slug of [
      "refund",
      "Refund-Policy",
      "refund-policy/",
      "../refund-policy",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "",
    ]) {
      expect(policyTypeOfSlug(slug), slug).toBeNull();
    }
  });
});
```

`packages/storefront-content/src/menus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isMenuHandle,
  linkRefTargetsOf,
  MENU_LIMITS,
  readResolvedMenu,
  validateMenuItems,
} from "./menus";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, link: unknown = { type: "home" }, children: unknown[] = []) => ({
  id: ID(n),
  label: { en: `Item ${n}` },
  link,
  children,
});
const issuesOf = (raw: unknown) => {
  const out = validateMenuItems(raw);
  return out.ok ? [] : out.issues;
};
const ch = (code: number) => String.fromCharCode(code);

describe("isMenuHandle", () => {
  it("lower-case words joined by single hyphens, at most 60", () => {
    for (const ok of ["main-menu", "footer", "a", "sale-2026"]) expect(isMenuHandle(ok)).toBe(true);
    for (const bad of ["Main", "-a", "a-", "a--b", "a_b", "", "a".repeat(61), 1]) {
      expect(isMenuHandle(bad), String(bad)).toBe(false);
    }
  });
});

describe("validateMenuItems (spec 2.2)", () => {
  it("accepts every link type and normalises labels and urls", () => {
    const out = validateMenuItems([
      item(1, { type: "home" }),
      item(2, { type: "search" }),
      item(3, { type: "collection", id: "col-1" }, [
        item(4, { type: "product", id: "p-1" }),
        item(5, { type: "page", id: "pg-1" }),
      ]),
      item(6, { type: "policy", policy: "refund" }),
      {
        id: ID(7),
        label: { ar: "  واتساب  " },
        link: { type: "url", url: "HTTPS://WA.ME/201001234567" },
      },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toHaveLength(5);
    expect(out.value[4]).toEqual({
      id: ID(7),
      label: { ar: "واتساب" },
      link: { type: "url", url: "https://wa.me/201001234567" },
      children: [],
    });
    expect(linkRefTargetsOf(out.value)).toEqual({
      collection: ["col-1"],
      product: ["p-1"],
      page: ["pg-1"],
    });
  });

  it("a child with children is MENU_TOO_DEEP", () => {
    expect(
      issuesOf([item(1, { type: "home" }, [item(2, { type: "home" }, [item(3)])])]),
    ).toContainEqual({
      path: "items.0.children.0.children",
      code: "MENU_TOO_DEEP",
    });
  });

  it("over 30 top-level, 30 children or 150 in all is TOO_MANY_ITEMS; a huge array is MENU_TOO_LARGE", () => {
    expect(issuesOf(Array.from({ length: 31 }, (_, i) => item(i + 1)))).toEqual([
      { path: "items", code: "TOO_MANY_ITEMS" },
    ]);
    expect(issuesOf(Array.from({ length: 1_000 }, (_, i) => item(i + 1)))).toEqual([
      { path: "items", code: "TOO_MANY_ITEMS" },
    ]);
    const wide = item(
      1,
      { type: "home" },
      Array.from({ length: 31 }, (_, i) => item(i + 2)),
    );
    expect(issuesOf([wide])).toContainEqual({ path: "items.0.children", code: "TOO_MANY_ITEMS" });
    const total = Array.from({ length: 6 }, (_, top) =>
      item(
        1000 + top,
        { type: "home" },
        Array.from({ length: 25 }, (_, c) => item(top * 100 + c + 1)),
      ),
    );
    expect(issuesOf(total)).toContainEqual({ path: "items", code: "TOO_MANY_ITEMS" });
    expect(MENU_LIMITS).toEqual({ topLevel: 30, children: 30, total: 150 });
    expect(issuesOf(Array.from({ length: 200_000 }, () => ({})))).toEqual([
      { path: "items", code: "MENU_TOO_LARGE" },
    ]);
  });

  it("ids are uuids, unique across the whole tree", () => {
    expect(issuesOf([{ ...item(1), id: "1" }])).toContainEqual({
      path: "items.0.id",
      code: "INVALID_VALUE",
    });
    expect(issuesOf([item(1, { type: "home" }, [item(1)])])).toContainEqual({
      path: "items.0.children.0.id",
      code: "DUPLICATE_ITEM_ID",
    });
  });

  it("a label needs one locale; whitespace or bidi controls alone are LABEL_REQUIRED; > 60 is TOO_LONG", () => {
    expect(
      issuesOf([{ ...item(1), label: { ar: " ", en: `${ch(0x202e)}${ch(0x2066)}` } }]),
    ).toContainEqual({
      path: "items.0.label",
      code: "LABEL_REQUIRED",
    });
    expect(issuesOf([{ ...item(1), label: { en: "a".repeat(61) } }])).toContainEqual({
      path: "items.0.label.en",
      code: "TOO_LONG",
    });
  });

  it.each([
    "JAVASCRIPT:alert(1)",
    "javascript:alert(1)",
    "https://user:pass@evil.example",
    "http://plain.example",
    "tel:call-me",
    "data:text/html,x",
    "//evil.example",
    "/pages/about",
    `https://shop.example/${ch(0)}`,
    ` https://shop.example`,
  ])("a url link %j is INVALID_URL", (url) => {
    expect(issuesOf([item(1, { type: "url", url })])).toContainEqual({
      path: "items.0.link.url",
      code: "INVALID_URL",
    });
  });

  it("a menu can only link to resources: menu and item links do not exist (no loops)", () => {
    expect(issuesOf([item(1, { type: "menu", handle: "main-menu" })])).toContainEqual({
      path: "items.0.link.type",
      code: "INVALID_LINK",
    });
    expect(issuesOf([item(1, { type: "policy", policy: "cookies" })])).toContainEqual({
      path: "items.0.link.policy",
      code: "INVALID_VALUE",
    });
    expect(issuesOf([item(1, { type: "collection", id: "x".repeat(65) })])).toContainEqual({
      path: "items.0.link.id",
      code: "INVALID_VALUE",
    });
  });

  it("unknown keys and a non-array are refused", () => {
    expect(issuesOf([{ ...item(1), extra: 1 }])).toContainEqual({
      path: "items.0.extra",
      code: "UNKNOWN_KEY",
    });
    expect(issuesOf({})).toEqual([{ path: "items", code: "INVALID_VALUE" }]);
  });
});

describe("readResolvedMenu (storefront re-validation)", () => {
  it("keeps safe items, drops unsafe hrefs and empty labels, recomputes external, ignores grandchildren", () => {
    const menu = readResolvedMenu([
      { label: { en: "Home" }, href: "/", external: true, children: [] },
      { label: { en: "X" }, href: "javascript:alert(1)", external: false, children: [] },
      { label: { en: " " }, href: "/search", external: false, children: [] },
      {
        label: { ar: "تسوق" },
        href: "https://shop.example",
        external: false,
        children: [
          {
            label: { en: "Sale" },
            href: "/collections/sale",
            children: [{ label: { en: "deep" }, href: "/" }],
          },
          { label: { en: "Evil" }, href: "//evil.example" },
        ],
      },
    ]);
    expect(menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
      {
        label: { ar: "تسوق" },
        href: "https://shop.example/",
        external: true,
        children: [
          { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
        ],
      },
    ]);
  });
  it("anything that is not an array is an empty menu; the caps hold", () => {
    expect(readResolvedMenu(null)).toEqual([]);
    const many = Array.from({ length: 40 }, () => ({ label: { en: "a" }, href: "/" }));
    expect(readResolvedMenu(many)).toHaveLength(30);
  });
});
```

Append to `packages/storefront-content/src/theme-document.test.ts`:

```ts
describe("Part 2 menu fields (Ruling 2, Review Focus 3)", () => {
  const partOne = () => {
    const doc = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    doc.header = { sticky: true };
    doc.footer = { note: { ar: "أهلاً" }, showSocial: false };
    return doc;
  };

  it("a Part 1 document reads, validates and canonicalises as before", () => {
    const read = readThemeDocument(partOne());
    expect(read.header).toEqual({ sticky: true, menuHandle: "main-menu" });
    expect(read.footer).toEqual({
      note: { ar: "أهلاً" },
      showSocial: false,
      menuHandle: "footer",
      showPolicyLinks: true,
    });
    const valid = validateThemeDocument(partOne());
    expect(valid.ok && valid.value.header.menuHandle).toBe("main-menu");
    const explicit = { ...partOne(), header: read.header, footer: read.footer };
    expect(canonicalDocumentJson(partOne())).toBe(canonicalDocumentJson(explicit));
  });

  it("the defaults are main-menu, footer and policy links on", () => {
    expect(DEFAULT_THEME_DOCUMENT.header.menuHandle).toBe("main-menu");
    expect(DEFAULT_THEME_DOCUMENT.footer.menuHandle).toBe("footer");
    expect(DEFAULT_THEME_DOCUMENT.footer.showPolicyLinks).toBe(true);
  });

  it("a malformed handle or a non-boolean flag is refused on write and defaulted on read", () => {
    const doc = partOne();
    doc.header.menuHandle = "Main Menu";
    doc.footer.showPolicyLinks = "yes";
    const out = validateThemeDocument(doc);
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "header.menuHandle", code: "INVALID_VALUE" },
        { path: "footer.showPolicyLinks", code: "INVALID_VALUE" },
      ]),
    );
    expect(readThemeDocument(doc).header.menuHandle).toBe("main-menu");
  });

  it("menuHandlesOf lists each handle once, header first", () => {
    expect(menuHandlesOf(DEFAULT_THEME_DOCUMENT)).toEqual(["main-menu", "footer"]);
    const same = readThemeDocument({
      ...partOne(),
      footer: { ...partOne().footer, menuHandle: "main-menu" },
    });
    expect(menuHandlesOf(same)).toEqual(["main-menu"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/policies.test.ts src/menus.test.ts src/theme-document.test.ts`
Expected: FAIL — missing modules and `menuHandlesOf`.

- [ ] **Step 3: Implement `policies.ts`**

`POLICY_TITLES` (MSA): `refund` "سياسة الاسترجاع" / "Refund policy", `shipping` "سياسة الشحن" / "Shipping policy", `privacy` "سياسة الخصوصية" / "Privacy policy", `terms` "شروط الخدمة" / "Terms of service", `contact` "معلومات التواصل" / "Contact information". `policyTypeOfSlug` scans `POLICY_TYPES` for `POLICY_SLUGS[type] === slug` (no object lookup by the untrusted string).

- [ ] **Step 4: Implement `menus.ts`**

- `validateMenuItems(raw)`, in this order, each check returning at once with one issue at `items`: not an array → `INVALID_VALUE`; the UTF-8 length of `JSON.stringify(raw)` (or a throw) over `MENU_MAX_BYTES` → `MENU_TOO_LARGE`; length > 30 → `TOO_MANY_ITEMS`; top-level length plus every child array's length (arrays only) > 150 → `TOO_MANY_ITEMS`. Then per item at `items.<i>` (and `items.<i>.children.<j>`): an object with keys `id`, `label`, `link` and optional `children` (unknown keys `UNKNOWN_KEY`, missing `MISSING`); `id` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` (`INVALID_VALUE`) and is unique in the tree (`DUPLICATE_ITEM_ID`, lower-cased compare); `label` through `normalizeLocalizedText(raw, { path, max: MENU_LABEL_MAX }, issues)`, empty → `LABEL_REQUIRED` at `…label`; `link` through `validateLinkRef` (below); `children` absent → `[]`, not an array → `INVALID_VALUE`, length > 30 → `TOO_MANY_ITEMS` at `…children`; a child whose own `children` is a non-empty array → `MENU_TOO_DEEP` at `…children.<j>.children`. Issues stop at `MAX_ISSUES`.
- `validateLinkRef(raw, path, issues)` (module-private): an object whose `type` is one of `home`, `search`, `collection`, `product`, `page`, `policy`, `url` (else `INVALID_LINK` at `<path>.type`), with exactly the keys that type needs (`UNKNOWN_KEY` / `MISSING`); `id` matches `/^[A-Za-z0-9_-]{1,64}$/` (`INVALID_VALUE`); `policy` passes `isPolicyType` (`INVALID_VALUE`); `url`: a string longer than `LINK_URL_MAX` is `TOO_LONG`, otherwise `normalizeExternalUrl(url)` must not be null (`INVALID_URL`); the normalised URL is what is returned.
- `readResolvedMenu(raw)`: `[]` for a non-array; at most 30 top-level items, 30 children each, 150 in all; per item: `href` through `safeHref` (null → the item and its children are dropped), `external` taken from `safeHref`, never from the input; `label` through `normalizeLocalizedText(…, { path: "", max: MENU_LABEL_MAX }, [])` and cut to 60 code units, empty → dropped; children read the same way with `children: []` (grandchildren ignored).

- [ ] **Step 5: Extend `theme-document.ts`**

- `objectAt(raw, path, keys, issues, optional: readonly string[] = [])`: keys in `optional` are not reported `MISSING`.
- `readHeaderAt`: keys `["sticky", "menuHandle"]`, optional `["menuHandle"]`; absent `menuHandle` → `"main-menu"`; present and not `isMenuHandle` → `INVALID_VALUE` at `header.menuHandle`.
- `readFooterAt`: keys `["note", "showSocial", "menuHandle", "showPolicyLinks"]`, optional the last two; defaults `"footer"` and `true`; `showPolicyLinks` through `booleanAt`.
- `DEFAULT_THEME_DOCUMENT.header = { sticky: false, menuHandle: "main-menu" }`, `.footer = { note: {}, showSocial: true, menuHandle: "footer", showPolicyLinks: true }`; the two Part 2 comments in the `ThemeDocument` interface are replaced by the fields.
- `menuHandlesOf(doc)`: `[...new Set([doc.header.menuHandle, doc.footer.menuHandle])]`.
- Update the literals in `theme-document.test.ts`/`theme-document.hardening.test.ts` that spell out `header`/`footer` to include the new fields (no behaviour change), and the three `services/online-store` test literals listed under Files.

- [ ] **Step 6: Run the package suite and the online-store suite, typecheck and lint**

Run: `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/storefront-content lint && pnpm --filter @platform/online-store test && pnpm --filter @platform/online-store typecheck`
Expected: PASS. (`apps/admin` and the storefront still typecheck: they spread the document or read it through the reader.)

- [ ] **Step 7: Commit**

```bash
git add packages/storefront-content/src/policies.ts packages/storefront-content/src/policies.test.ts \
  packages/storefront-content/src/menus.ts packages/storefront-content/src/menus.test.ts \
  packages/storefront-content/src/theme-document.ts packages/storefront-content/src/theme-document.test.ts \
  packages/storefront-content/src/theme-document.hardening.test.ts packages/storefront-content/src/index.ts \
  services/online-store/src/infrastructure/prisma-repositories.test.ts \
  services/online-store/src/infrastructure/prisma-repositories.integration.test.ts \
  services/online-store/src/infrastructure/tenant-isolation.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): add menus, policies and the theme's menu fields

Two-level menus with id links validated in one place, the five Shopify policies with their
slugs and titles, and header/footer menu handles that Part 1 documents read as defaults.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The content migration, and the online-store menu and policy aggregates with their repositories

Model tier: **standard**.

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261027010000_online_store_content/migration.sql`
- Modify: `packages/db/prisma/schema/online-store.prisma` (two models), `packages/db/prisma/schema/pages.prisma` (`Page` + 4 fields + index)
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (one `describe`)
- Create: `services/online-store/src/domain/menu.ts`, `menu.test.ts`, `default-menus.ts`, `store-policy.ts`, `store-policy.test.ts`
- Modify: `services/online-store/src/domain/repositories.ts`, `src/infrastructure/in-memory-repositories.ts`, `prisma-repositories.ts`, `prisma-repositories.test.ts`, `tenant-isolation.test.ts`, `src/index.ts`

**Interfaces:**

- Consumes: `MenuItem`, `validateMenuItems`, `DefaultMenuHandle`, `DEFAULT_MENU_HANDLES`, `PolicyType`, `POLICY_TYPES`, `POLICY_TITLES`, `LocalizedText`, `Locale` (Task 2); `localizedTextOf`, `json`, `isUniqueViolation` (`infrastructure/rows.ts`).
- Produces:
  - `domain/menu.ts`: `MENU_LIMIT = 50`; `interface MenuSnapshot { readonly id: string | null; readonly handle: string; readonly title: string; readonly items: readonly MenuItem[]; readonly version: number; readonly updatedAt: Date | null; readonly persisted: boolean }`; `class Menu` with `static create(input: { id: string; handle: string; title: string; items: readonly MenuItem[]; now: Date }): Menu`, `static reconstitute(s: MenuSnapshot): Menu`, `update(title: string, items: readonly MenuItem[], now: Date): void`, `snapshot(): MenuSnapshot`, `get nextVersion(): number`, `get isDefault(): boolean`.
  - `domain/default-menus.ts`: `DEFAULT_ITEM_IDS` (`home` …`0001`, `search` …`0002`, `refund` …`0101`, `shipping` …`0102`, `privacy` …`0103`, `terms` …`0104`, `contact` …`0105`, all `00000000-0000-4000-8000-0000000000NN`), `DEFAULT_MENU_TITLES = { "main-menu": "Main menu", footer: "Footer menu" }`, `virtualDefaultMenu(handle: DefaultMenuHandle, setPolicies: readonly PolicyType[]): Menu` (id `null`, version 0, not persisted).
  - `domain/store-policy.ts`: `interface PolicySnapshot { readonly type: PolicyType; readonly body: LocalizedText; readonly updatedAt: Date | null; readonly updatedBy: string | null; readonly version: number; readonly persisted: boolean }`; `class StorePolicy` with `static empty(type)`, `static reconstitute(s)`, `update(body: LocalizedText, by: string, now: Date): void`, `get isSet(): boolean`, `get locales(): readonly Locale[]`, `snapshot()`, `get nextVersion(): number`.
  - `domain/repositories.ts`:

    ```ts
    export interface MenuRepository {
      /** Persisted menus only, ordered by handle. */
      list(tenantId: string, tx?: unknown): Promise<readonly Menu[]>;
      get(handle: string, tenantId: string, tx?: unknown): Promise<Menu | null>;
      /** First save inserts (a duplicate handle throws ConcurrencyError); later saves are version-guarded. */
      save(menu: Menu, tenantId: string, tx: unknown): Promise<void>;
      /** True when a row went. */
      remove(handle: string, tenantId: string, tx: unknown): Promise<boolean>;
    }
    export interface PolicyRepository {
      /** All five, in POLICY_TYPES order; an absent row is `StorePolicy.empty(type)`. */
      list(tenantId: string, tx?: unknown): Promise<readonly StorePolicy[]>;
      get(type: PolicyType, tenantId: string, tx?: unknown): Promise<StorePolicy>;
      save(policy: StorePolicy, tenantId: string, tx: unknown): Promise<void>;
    }
    ```

  - `InMemoryMenuRepository`, `InMemoryPolicyRepository`, `PrismaMenuRepository`, `PrismaPolicyRepository` (same constructor shapes as Part 1's), exported from `index.ts` with `Menu`, `StorePolicy`, `MENU_LIMIT`, `virtualDefaultMenu`.

- [ ] **Step 1: Write the failing schema test** — append to `packages/db/src/schema-migration-consistency.test.ts`

```ts
describe("online_store content — menus, policies and page bodies (Project 4 Part 2)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");
  const normalized = allSql.replace(/\r\n/g, "\n");

  const tables: Record<string, readonly string[]> = {
    menus: ["id", "tenant_id", "handle", "title", "items", "version", "created_at", "updated_at"],
    policies: ["tenant_id", "type", "body", "updated_by", "version", "updated_at"],
  };

  for (const [table, columns] of Object.entries(tables)) {
    it(`${table} has exactly the model's columns`, () => {
      expect([...columnsEverAddedTo("online_store", table, allSql)].sort()).toEqual(
        [...columns].sort(),
      );
    });
    it(`${table} is RLS-forced with the tenant_isolation policy`, () => {
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(normalized).toContain(
        `CREATE POLICY tenant_isolation ON "online_store"."${table}" FOR ALL\n` +
          `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
          `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
      );
    });
  }

  it("has the checks and indexes the spec names", () => {
    expect(allSql).toContain(
      `CONSTRAINT "menus_handle_format_check" CHECK ("handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "menus_tenant_id_handle_key" ON "online_store"."menus" ("tenant_id", "handle");',
    );
    expect(allSql).toContain(
      `CONSTRAINT "policies_type_check" CHECK ("type" IN ('refund', 'shipping', 'privacy', 'terms', 'contact'))`,
    );
    expect(allSql).toContain(
      'CREATE INDEX "pages_tenant_id_status_idx" ON "pages"."pages" ("tenant_id", "status");',
    );
  });

  it("pages.pages gains the four content columns and keeps an explicit tenant policy", () => {
    const columns = columnsEverAddedTo("pages", "pages", allSql);
    for (const column of ["title", "body", "meta_description", "published_at"]) {
      expect(columns.has(column), column).toBe(true);
    }
    expect(normalized).toContain(
      `CREATE POLICY tenant_isolation ON "pages"."pages" FOR ALL\n` +
        `  USING (tenant_id = current_setting('app.tenant_id', true))\n` +
        `  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));`,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — no `menus`/`policies` tables.

- [ ] **Step 3: Write the migration and the models**

`migration.sql` (header comment in Part 1's style: hand-written, not applied by the agent, owner deploys BEFORE the release, additive, no backfill; `pages.pages` already has its policy from the reconstructed `20260823000000_rls_tenant_isolation` loop — the table predates it — and this migration re-asserts it idempotently because that file has never been executed anywhere):

```sql
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "online_store";

CREATE TABLE "online_store"."menus" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "handle"     TEXT         NOT NULL,
  "title"      TEXT         NOT NULL,
  "items"      JSONB        NOT NULL DEFAULT '[]',
  "version"    INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menus_handle_format_check" CHECK ("handle" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX "menus_tenant_id_handle_key" ON "online_store"."menus" ("tenant_id", "handle");
ALTER TABLE "online_store"."menus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."menus" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."menus";
CREATE POLICY tenant_isolation ON "online_store"."menus" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."policies" (
  "tenant_id"  TEXT         NOT NULL,
  "type"       TEXT         NOT NULL,
  "body"       JSONB        NOT NULL DEFAULT '{}',
  "updated_by" TEXT,
  "version"    INTEGER      NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policies_pkey" PRIMARY KEY ("tenant_id", "type"),
  CONSTRAINT "policies_type_check" CHECK ("type" IN ('refund', 'shipping', 'privacy', 'terms', 'contact'))
);
ALTER TABLE "online_store"."policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."policies";
CREATE POLICY tenant_isolation ON "online_store"."policies" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "pages"."pages" ADD COLUMN "title"            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "body"             JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "meta_description" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "published_at"     TIMESTAMP(3);
CREATE INDEX "pages_tenant_id_status_idx" ON "pages"."pages" ("tenant_id", "status");
ALTER TABLE "pages"."pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pages"."pages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pages"."pages";
CREATE POLICY tenant_isolation ON "pages"."pages" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

`online-store.prisma`:

```prisma
model OnlineStoreMenu {
  id        String   @id @db.Uuid
  tenantId  String   @map("tenant_id")
  handle    String
  title     String
  items     Json     @default("[]")
  version   Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  @@unique([tenantId, handle])
  @@map("menus")
  @@schema("online_store")
}

model OnlineStorePolicy {
  tenantId  String   @map("tenant_id")
  type      String // refund | shipping | privacy | terms | contact (CHECK + domain)
  body      Json     @default("{}")
  updatedBy String?  @map("updated_by")
  version   Int      @default(0)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  @@id([tenantId, type])
  @@map("policies")
  @@schema("online_store")
}
```

`pages.prisma` `Page` gains `title Json @default("{}")`, `body Json @default("{}")`, `metaDescription Json @default("{}") @map("meta_description")`, `publishedAt DateTime? @map("published_at")` and `@@index([tenantId, status])`.

- [ ] **Step 4: Run it, validate and generate**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`, then `prisma validate` and `prisma generate` with the dummy URLs (Commands).
Expected: PASS; "The schema … is valid"; client generated.

- [ ] **Step 5: Write the failing domain tests**

`services/online-store/src/domain/menu.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ITEM_IDS, virtualDefaultMenu } from "./default-menus";
import { Menu } from "./menu";

const now = new Date("2026-11-04T10:00:00.000Z");

describe("Menu", () => {
  it("is created unpersisted at version 0 and saves as version 1", () => {
    const menu = Menu.create({ id: "m-1", handle: "sale", title: "Sale", items: [], now });
    expect(menu.snapshot()).toMatchObject({
      id: "m-1",
      version: 0,
      persisted: false,
      updatedAt: now,
    });
    expect(menu.nextVersion).toBe(1);
    expect(menu.isDefault).toBe(false);
  });

  it("update replaces the title and the items and stamps the time", () => {
    const menu = Menu.reconstitute({
      id: "m-1",
      handle: "footer",
      title: "Footer menu",
      items: [],
      version: 3,
      updatedAt: null,
      persisted: true,
    });
    const later = new Date("2026-11-04T11:00:00.000Z");
    menu.update("Bottom", [], later);
    expect(menu.snapshot()).toMatchObject({ title: "Bottom", version: 3, updatedAt: later });
    expect(menu.nextVersion).toBe(4);
    expect(menu.isDefault).toBe(true);
  });
});

describe("virtualDefaultMenu (spec 2.2, Ruling 12)", () => {
  it("main-menu is Home then Search with fixed ids", () => {
    const s = virtualDefaultMenu("main-menu", ["refund"]).snapshot();
    expect(s).toMatchObject({
      id: null,
      handle: "main-menu",
      title: "Main menu",
      version: 0,
      persisted: false,
    });
    expect(s.items).toEqual([
      {
        id: DEFAULT_ITEM_IDS.home,
        label: { ar: "الرئيسية", en: "Home" },
        link: { type: "home" },
        children: [],
      },
      {
        id: DEFAULT_ITEM_IDS.search,
        label: { ar: "البحث", en: "Search" },
        link: { type: "search" },
        children: [],
      },
    ]);
  });

  it("footer is Search then one item per SET policy, in policy order", () => {
    const s = virtualDefaultMenu("footer", ["terms", "refund"]).snapshot();
    expect(s.items.map((i) => i.link)).toEqual([
      { type: "search" },
      { type: "policy", policy: "refund" },
      { type: "policy", policy: "terms" },
    ]);
    expect(s.items[1]).toMatchObject({
      id: DEFAULT_ITEM_IDS.refund,
      label: { ar: "سياسة الاسترجاع", en: "Refund policy" },
    });
  });
});
```

`services/online-store/src/domain/store-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StorePolicy } from "./store-policy";

const now = new Date("2026-11-04T10:00:00.000Z");

describe("StorePolicy (spec 2.3)", () => {
  it("an empty policy is not set and has no locales", () => {
    const p = StorePolicy.empty("refund");
    expect(p.isSet).toBe(false);
    expect(p.locales).toEqual([]);
    expect(p.snapshot()).toMatchObject({
      type: "refund",
      version: 0,
      persisted: false,
      updatedBy: null,
    });
  });
  it("one locale is enough to be set; update records who and when", () => {
    const p = StorePolicy.empty("shipping");
    p.update({ ar: "نص" }, "staff-1", now);
    expect(p.isSet).toBe(true);
    expect(p.locales).toEqual(["ar"]);
    expect(p.snapshot()).toMatchObject({
      body: { ar: "نص" },
      updatedBy: "staff-1",
      updatedAt: now,
    });
    expect(p.nextVersion).toBe(1);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/domain/menu.test.ts src/domain/store-policy.test.ts`
Expected: FAIL — missing modules.

- [ ] **Step 7: Implement the domain**

Same shape as `StorefrontPreferences` (private state, `snapshot()`, `nextVersion` = persisted ? version + 1 : 1). `Menu.isDefault` is `isDefaultMenuHandle(handle)`. `virtualDefaultMenu` builds items from `DEFAULT_ITEM_IDS`, the labels above and `POLICY_TITLES`, the title from `DEFAULT_MENU_TITLES`, and returns `Menu.reconstitute({ id: null, …, version: 0, updatedAt: null, persisted: false })`. `StorePolicy.locales` lists `LOCALES` whose text is non-empty; `isSet` is `locales.length > 0`.

- [ ] **Step 8: Write the failing repository tests** — append to `prisma-repositories.test.ts`, and extend `tenant-isolation.test.ts`

```ts
describe("Prisma menu and policy repositories (fake client)", () => {
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const items = [
    { id: ID(1), label: { en: "Home" }, link: { type: "home" as const }, children: [] },
  ];

  it("inserts version 1, then guards on the version; lists by handle", async () => {
    const fake = createFakePrisma();
    const tx = fake.database as unknown as TransactionClient;
    const menus = new PrismaMenuRepository({ prisma: fake.database });
    await menus.save(Menu.create({ id: ID(9), handle: "zeta", title: "Z", items, now }), "t-1", tx);
    await menus.save(
      Menu.create({ id: ID(8), handle: "alpha", title: "A", items: [], now }),
      "t-1",
      tx,
    );
    expect((await menus.list("t-1")).map((m) => m.snapshot().handle)).toEqual(["alpha", "zeta"]);
    const zeta = (await menus.get("zeta", "t-1"))!;
    expect(zeta.snapshot()).toMatchObject({ version: 1, persisted: true, items });
    const stale = (await menus.get("zeta", "t-1"))!;
    zeta.update("Z2", [], now);
    await menus.save(zeta, "t-1", tx);
    stale.update("lost", [], now);
    await expect(menus.save(stale, "t-1", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(await menus.remove("zeta", "t-1", tx)).toBe(true);
    expect(await menus.remove("zeta", "t-1", tx)).toBe(false);
  });

  it("a duplicate first insert throws ConcurrencyError (two tabs, Review Focus 4)", async () => {
    const menus = new PrismaMenuRepository({ prisma: createFakePrisma().database });
    await expect(
      menus.save(
        Menu.create({ id: ID(1), handle: "footer", title: "F", items, now }),
        "t-1",
        failingCreate(p2002),
      ),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it("a corrupted stored item list reads as an empty menu, never a throw", async () => {
    const fake = createFakePrisma();
    const tx = fake.database as unknown as TransactionClient;
    await tx.onlineStoreMenu.create({
      data: {
        id: ID(1),
        tenantId: "t-1",
        handle: "x",
        title: "X",
        items: [{ id: "bad" }],
        version: 1,
      },
    });
    const menus = new PrismaMenuRepository({ prisma: fake.database });
    expect((await menus.get("x", "t-1"))!.snapshot().items).toEqual([]);
  });

  it("policies: all five in order, absent ones empty; save inserts then guards", async () => {
    const fake = createFakePrisma();
    const tx = fake.database as unknown as TransactionClient;
    const policies = new PrismaPolicyRepository({ prisma: fake.database });
    const refund = await policies.get("refund", "t-1");
    refund.update({ en: "30 days" }, "staff-1", now);
    await policies.save(refund, "t-1", tx);
    const list = await policies.list("t-1");
    expect(list.map((p) => [p.snapshot().type, p.isSet])).toEqual([
      ["refund", true],
      ["shipping", false],
      ["privacy", false],
      ["terms", false],
      ["contact", false],
    ]);
    const stale = await policies.get("refund", "t-1");
    const fresh = await policies.get("refund", "t-1");
    fresh.update({ en: "14 days" }, "staff-1", now);
    await policies.save(fresh, "t-1", tx);
    stale.update({ en: "lost" }, "staff-2", now);
    await expect(policies.save(stale, "t-1", tx)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});
```

(`failingCreate` gains `onlineStoreMenu` and `onlineStorePolicy` models.) In `tenant-isolation.test.ts`, the `Repos` interface gains `menus` and `policies` built in both layers, and two stores join the loop: `["menus", menuStore]` (the key maps to a handle `m-<n>` like `releaseStore`'s numbers; the marker is the title; `remove` deletes by handle) and `["policies", policyStore]` (the key maps to the next `POLICY_TYPES` entry; the marker is `body.en`; `update` re-saves with a new marker). Policies are one row per `(shop, type)`, so the "cannot count" case applies.

- [ ] **Step 9: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/infrastructure`
Expected: FAIL — the new repositories do not exist.

- [ ] **Step 10: Implement the repositories**

- Prisma, with Part 1's `read`, `requireTx`, `stampedAt` and `guardedWrite`: `list` = `onlineStoreMenu.findMany({ where: { tenantId } })` sorted by handle in code; `get` = `findFirst({ where: { tenantId, handle } })`; `save` inserts `{ id, tenantId, handle, title, items: json(items), version: 1, …stampedAt }` or `updateMany({ where: { tenantId, handle, version }, data: { title, items, version: { increment: 1 }, …stampedAt } })`; `remove` = `deleteMany({ where: { tenantId, handle } })` → `count > 0`. Items are read through `validateMenuItems` (invalid → `[]`).
- Policies: `list` = one `findMany({ where: { tenantId } })` mapped onto `POLICY_TYPES` (absent → `StorePolicy.empty`); `get` = `findFirst({ where: { tenantId, type } })`; `save` inserts `{ tenantId, type, body, updatedBy, version: 1 }` or `updateMany({ where: { tenantId, type, version }, … })`; body read with `localizedTextOf`.
- In-memory repositories keyed `${tenantId}|${handle}` / `${tenantId}|${type}`, storing snapshots (never the live object), with the same version guard and duplicate-insert `ConcurrencyError`.

- [ ] **Step 11: Run the service suite and the guard script**

Run: `pnpm --filter @platform/online-store test && pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/online-store lint && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS; the script prints only the one known finding.

- [ ] **Step 12: Commit**

```bash
git add packages/db/prisma/schema/migrations/20261027010000_online_store_content \
  packages/db/prisma/schema/online-store.prisma packages/db/prisma/schema/pages.prisma \
  packages/db/src/schema-migration-consistency.test.ts services/online-store/src/domain \
  services/online-store/src/infrastructure services/online-store/src/index.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): add menu and policy storage with the content migration

Menus and policies get RLS-forced tables, aggregates with virtual defaults and version-guarded
repositories; pages gain title, body, meta description and published_at columns.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `services/pages` — page content, unpublish, and published reads

Model tier: **standard**.

**Files:**

- Create: `services/pages/src/domain/page-content.ts`, `page-content.test.ts`
- Modify: `services/pages/src/domain/page.ts`, `pages.test.ts`, `repositories.ts`
- Modify: `services/pages/src/application/pages.use-cases.ts`; Create: `public-pages.use-cases.ts`, `pages-content.use-cases.test.ts`
- Modify: `services/pages/src/infrastructure/mappers.ts`, `in-memory-repositories.ts`, `in-memory-repositories.test.ts`, `prisma-repositories.ts`, `pages-event-translator.ts`; Create: `tenant-isolation.test.ts`
- Modify: `services/pages/src/interfaces/pages.controller.ts`, `presenter.ts`, `src/composition.ts`, `src/index.ts`, `package.json` (`@platform/storefront-content`)
- Modify: `packages/db/src/testing/fake-prisma.ts` (`startsWith`, Ruling 27)

**Interfaces:**

- Consumes: `normalizeLocalizedText`, `validateRichText`, `RICH_TEXT_MAX`, `LocalizedText`, `ContentIssue` (Tasks 1–2).
- Produces:
  - `domain/page-content.ts`: `PAGE_TITLE_MAX = 255`, `PAGE_META_MAX = 320`, `interface PageContent { readonly title: LocalizedText; readonly body: LocalizedText; readonly metaDescription: LocalizedText }`, `EMPTY_PAGE_CONTENT`, `validatePageContent(raw: { title?: unknown; body?: unknown; metaDescription?: unknown }): { ok: true; value: PageContent } | { ok: false; issues: readonly ContentIssue[] }` (absent fields are `{}`; issue paths `title.ar`, `body.en`, `metaDescription.ar`; codes `TOO_LONG`, `UNSAFE_LINK`, `INVALID_VALUE`, `UNKNOWN_KEY`), `pageHandleOf(routePath: string): string | null` (`/^\/pages\/([a-z0-9_-]+)$/`).
  - `Page`: getters `title`, `body`, `metaDescription` (`LocalizedText`), `publishedAt`, `updatedAt` (`Date | null`); `updateContent(content: PageContent, now: Date): void` (throws `BusinessRuleError("PAGE_ARCHIVED: …")` on an archived page); `Page.create(id, name, routePath, extra, content = EMPTY_PAGE_CONTENT, now: Date | null = null)`; `Page.reconstitute(id, name, routePath, status, version, extra, state: { content: PageContent; publishedAt: Date | null; updatedAt: Date | null } = …)`; transitions `draft → published|archived`, `published → draft|archived` (Ruling 15); a transition to `published` sets `publishedAt` only when it is null; every transition and content update sets `updatedAt`.
  - `PageRepository` gains `findByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly Page[]>` and `listPublished(tenantId: string, limit: number, tx?: unknown): Promise<readonly Page[]>` (status `published`, route path under `/pages/`, ordered by route path).
  - Use cases: `CreatePageInput` gains `title?`, `body?`, `metaDescription?: unknown`; `UpdatePageContent` (`{ pageId, title, body, metaDescription: unknown; expectedVersion: number; tenantId }` → `{ pageId: string; version: number }`); `GetPublishedPageByPath` (`{ routePath, tenantId }` → `Page | null`), `ListPublishedPages` (`{ tenantId, first?: number }` → `readonly Page[]`, `first` clamped to 1–500, default 500), `GetPagesByIds` (`{ ids, tenantId }` → `readonly Page[]`).
  - `PagesController` gains `updatePageContent(input)` (200), `publishedPageByPath(input)` (200 `Page` | 404 `PAGE_NOT_FOUND`), `listPublishedPages(input)` (200 `readonly Page[]`), `getByIds(input)` (200 `readonly Page[]`).
  - Error messages: `PAGE_NOT_FOUND: Page not found`, `VERSION_CONFLICT: This page was changed in another window. Reload to continue.`, `PAGE_ARCHIVED: An archived page cannot be edited.`; the presenter copies the `CODE:` prefix into `body.code` (Ruling 24).
  - `PAGES_PUBLISHED_EVENTS` gains `"pages.page.draft"`.

- [ ] **Step 1: Write the failing tests**

Append to `services/pages/src/domain/pages.test.ts`:

```ts
describe("Page content and visibility (spec 2.4, Ruling 15)", () => {
  const at = (h: number) => new Date(`2026-11-04T${String(h).padStart(2, "0")}:00:00.000Z`);
  const route = RoutePath.create("/pages/about");
  const make = () =>
    Page.create(UniqueEntityId.from("p-1"), "About", (route as { value: RoutePath }).value);

  it("publish sets publishedAt once; unpublish and republish keep the first date", () => {
    const page = make();
    page.publish("e1", at(1));
    page.transition("draft", "e2", at(2));
    page.publish("e3", at(3));
    expect(page.status).toBe("published");
    expect(page.publishedAt).toEqual(at(1));
    expect(page.updatedAt).toEqual(at(3));
  });

  it("archived stays terminal and cannot take content", () => {
    const page = make();
    page.archive("e1", at(1));
    expect(() => page.transition("draft", "e2", at(2))).toThrow();
    expect(() => page.updateContent(EMPTY_PAGE_CONTENT, at(2))).toThrow(/PAGE_ARCHIVED/);
  });

  it("content updates on draft and published pages stamp updatedAt", () => {
    const page = make();
    page.updateContent(
      { title: { en: "About us" }, body: { en: "Hi" }, metaDescription: {} },
      at(4),
    );
    page.publish("e1", at(5));
    page.updateContent({ title: { ar: "من نحن" }, body: {}, metaDescription: {} }, at(6));
    expect(page.title).toEqual({ ar: "من نحن" });
    expect(page.updatedAt).toEqual(at(6));
  });
});
```

`services/pages/src/domain/page-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pageHandleOf, validatePageContent } from "./page-content";

describe("validatePageContent (spec 2.4)", () => {
  it("normalises; absent fields are empty", () => {
    expect(validatePageContent({ title: { en: "  About  " } })).toEqual({
      ok: true,
      value: { title: { en: "About" }, body: {}, metaDescription: {} },
    });
  });
  it("keeps body newlines and enforces every limit per locale", () => {
    const ok = validatePageContent({ body: { ar: "سطر\nسطر" } });
    expect(ok.ok && ok.value.body.ar).toBe("سطر\nسطر");
    const out = validatePageContent({
      title: { en: "t".repeat(256) },
      metaDescription: { ar: "m".repeat(321) },
      body: { en: "b".repeat(100_001) },
    });
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "title.en", code: "TOO_LONG" },
        { path: "metaDescription.ar", code: "TOO_LONG" },
        { path: "body.en", code: "TOO_LONG" },
      ]),
    );
  });
  it("an unsafe link in a body is UNSAFE_LINK on that locale", () => {
    const out = validatePageContent({ body: { en: "[x](javascript:alert(1))" } });
    expect(out.ok ? [] : out.issues).toEqual([{ path: "body.en", code: "UNSAFE_LINK" }]);
  });
});

describe("pageHandleOf (spec 2.4)", () => {
  it("only /pages/<handle> is served", () => {
    expect(pageHandleOf("/pages/about-us")).toBe("about-us");
    for (const path of ["/about", "/pages", "/pages/a/b", "/pages/:slug", "/products/x"]) {
      expect(pageHandleOf(path), path).toBeNull();
    }
  });
});
```

`services/pages/src/application/pages-content.use-cases.test.ts` (drive `wirePages` in-memory, as `pages.e2e.test.ts` does):

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePages } from "../composition";
import type { Page } from "../domain/page";

const T = "t-1";
function setup() {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const clock: Clock = { now: () => new Date("2026-11-04T10:00:00.000Z") };
  return wirePages({ serializer: new InMemoryEventSerializer(), idGenerator, clock }).pages;
}
const create = async (pages: ReturnType<typeof setup>, routePath: string, content = {}) =>
  (
    (await pages.createPage({ name: "About", routePath, tenantId: T, ...content })).body as {
      pageId: string;
    }
  ).pageId;

describe("page content (spec 2.4)", () => {
  it("creates with content in one call and versions like the database (Rulings 17, 18)", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about", {
      title: { ar: "من نحن" },
      body: { ar: "مرحباً" },
    });
    const page = (await pages.getPage({ pageId: id, tenantId: T })).body as Page;
    expect(page.title).toEqual({ ar: "من نحن" });
    expect(page.version).toBe(1);
  });

  it("updates a draft and a published page; a stale version is VERSION_CONFLICT", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const first = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: { en: "About" },
      body: {},
      metaDescription: {},
    });
    expect(first).toMatchObject({ status: 200, body: { pageId: id, version: 2 } });
    await pages.advancePage({ pageId: id, toStatus: "published", tenantId: T });
    const live = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 3,
      title: { en: "About us" },
      body: {},
      metaDescription: {},
    });
    expect(live.status).toBe(200);
    const stale = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: {},
      body: {},
      metaDescription: {},
    });
    expect(stale).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
  });

  it("validates before writing: 422 with the field and the code, nothing saved", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const res = await pages.updatePageContent({
      pageId: id,
      tenantId: T,
      expectedVersion: 1,
      title: {},
      body: { en: "[x](javascript:y)" },
      metaDescription: {},
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual([
      { field: "body.en", message: "UNSAFE_LINK" },
    ]);
    expect(((await pages.getPage({ pageId: id, tenantId: T })).body as Page).version).toBe(1);
  });

  it("an unknown page is PAGE_NOT_FOUND; another shop's page is unknown", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const res = await pages.updatePageContent({
      pageId: id,
      tenantId: "t-2",
      expectedVersion: 1,
      title: {},
      body: {},
      metaDescription: {},
    });
    expect(res).toMatchObject({ status: 404, body: { code: "PAGE_NOT_FOUND" } });
  });
});

describe("published reads (spec 2.4, Ruling 22)", () => {
  it("by path only when published; the list is /pages/* published, by handle, capped", async () => {
    const pages = setup();
    const about = await create(pages, "/pages/about");
    const faq = await create(pages, "/pages/faq");
    await create(pages, "/pages/draft-only");
    const other = await create(pages, "/landing");
    for (const id of [about, faq, other]) {
      await pages.advancePage({ pageId: id, toStatus: "published", tenantId: T });
    }
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/draft-only", tenantId: T })).status,
    ).toBe(404);
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/about", tenantId: "t-2" })).status,
    ).toBe(404);
    expect(
      (await pages.publishedPageByPath({ routePath: "/pages/about", tenantId: T })).status,
    ).toBe(200);
    const list = (await pages.listPublishedPages({ tenantId: T })).body as Page[];
    expect(list.map((p) => p.routePath.value)).toEqual(["/pages/about", "/pages/faq"]);
    const one = (await pages.listPublishedPages({ tenantId: T, first: 1 })).body as Page[];
    expect(one).toHaveLength(1);
    await pages.advancePage({ pageId: faq, toStatus: "draft", tenantId: T });
    expect(((await pages.listPublishedPages({ tenantId: T })).body as Page[]).length).toBe(1);
  });

  it("by ids is tenant-scoped and skips unknown ids", async () => {
    const pages = setup();
    const id = await create(pages, "/pages/about");
    const mine = (await pages.getByIds({ ids: [id, "nope"], tenantId: T })).body as Page[];
    expect(mine.map((p) => p.id.toString())).toEqual([id]);
    expect((await pages.getByIds({ ids: [id], tenantId: "t-2" })).body).toEqual([]);
  });
});
```

`services/pages/src/infrastructure/tenant-isolation.test.ts`: the `tenantRowIsolationCases` harness (as in `services/online-store`) over two layers (in-memory, `PrismaPageRepository` on `createFakePrisma()`), one store whose key maps to a route path `/pages/k-<n>`, marker in `title.en`; `find` = `findByIds([id])`, `list` = `listPublished` after publishing each inserted page. Plus one direct case: `listPublished("t-2", 500)` never returns `t-1`'s rows on the fake client.

Create `packages/db/src/testing/fake-prisma.test.ts` (there is none): `findMany({ where: { routePath: { startsWith: "/pages/" } } })` returns only matching rows, and an unknown operator still throws.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/pages test`
Expected: FAIL — missing `updateContent`, `page-content`, controller methods.

- [ ] **Step 3: Implement**

- `fake-prisma.ts`: `case "startsWith": return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);`.
- `page-content.ts`: `normalizeLocalizedText` with `{ path: "title", max: PAGE_TITLE_MAX }`, `{ path: "metaDescription", max: PAGE_META_MAX }`, `{ path: "body", max: RICH_TEXT_MAX.body, multiline: true }`; then for each body locale without a `TOO_LONG` issue, `validateRichText(text, RICH_TEXT_MAX.body)` adds `{ path: "body.<locale>", code: "UNSAFE_LINK" }` once.
- `page.ts`: new props; `TRANSITIONS.published = ["draft", "archived"]`.
- `pages.use-cases.ts`: `CreatePage` validates content (with name and route path) before `unitOfWork.run`; `UpdatePageContent` validates, then inside `run` finds the page (`PAGE_NOT_FOUND`), compares `page.version` with `expectedVersion` (`VERSION_CONFLICT`), calls `updateContent` (a thrown `PAGE_ARCHIVED` `BusinessRuleError` is returned as `err`), saves, and returns `{ pageId, version: page.version + 1 }`; a `ConcurrencyError` thrown by `save` is caught **outside** `run` and answered `VERSION_CONFLICT`. Messages as in Interfaces.
- `public-pages.use-cases.ts`: the three reads over the repository.
- `mappers.ts`: read `title`/`body`/`metaDescription` with a tolerant `{ ar?, en? }` reader (strings only), `publishedAt`, `updatedAt`; write them in `toRow`.
- `prisma-repositories.ts`: `save` updates `status`, `title`, `body`, `metaDescription`, `publishedAt`, `updatedAt` with the version guard; `findByIds` filters ids through a UUID pattern (a non-uuid in `in` fails the query, as in Catalog) and uses `findMany({ where: { tenantId, id: { in } } })`; `listPublished` uses `findMany({ where: { tenantId, status: "published", routePath: { startsWith: "/pages/" } }, orderBy: { routePath: "asc" }, take: limit })` and sorts again in code (the fake ignores `orderBy`), then keeps only `pageHandleOf(...) !== null`.
- `in-memory-repositories.ts` (Ruling 18): store a reconstituted copy; a save with `version` 0 stores version 1, a later save requires the stored version to equal the page's and stores +1, else `ConcurrencyError`.
- `presenter.ts`: copy `online-store`'s `CODE_PATTERN` logic into `present`.
- `pages-event-translator.ts`: add `"pages.page.draft"`.

- [ ] **Step 4: Run, typecheck, lint, guard**

Run: `pnpm install && pnpm --filter @platform/pages test && pnpm --filter @platform/pages typecheck && pnpm --filter @platform/pages lint && pnpm --filter @platform/db test && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS; one known finding.

- [ ] **Step 5: Commit**

```bash
git add services/pages packages/db/src/testing/fake-prisma.ts pnpm-lock.yaml
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(pages): give pages content, an unpublish step and published reads

Title, body and meta description per locale in morbeh text, version-guarded edits on draft and
live pages, published reads by path and for the sitemap, and a published-to-draft transition.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(Stage `packages/db/src/testing/fake-prisma.test.ts` too.)

---

### Task 5: `services/online-store` — policies, templates and the public policy read

Model tier: **standard** (the template copy is fixed below).

**Files:**

- Create: `services/online-store/src/domain/policy-templates/template-inputs.ts`, `en.ts`, `ar.ts`, `render.ts`, `render.test.ts`
- Create: `services/online-store/src/application/policies.use-cases.ts`, `policies.use-cases.test.ts`
- Modify: `services/online-store/src/domain/errors.ts`, `src/application/deps.ts`, `src/composition.ts`, `src/interfaces/online-store.controller.ts`, `src/index.ts`, `src/testing/fakes.ts`

**Interfaces:**

- Consumes: `PolicyRepository`, `StorePolicy` (Task 3); `POLICY_TYPES`, `PolicyType`, `isPolicyType`, `normalizeLocalizedText`, `normalizePlainText`, `validateRichText`, `escapeRichText`, `RICH_TEXT_MAX`, `LocalizedText`, `Locale` (Tasks 1–2); `inUnitOfWork`, `iso` (`application/guarded.ts`), `invalidContent`, `versionConflict` (`domain/errors.ts`).
- Produces:
  - `template-inputs.ts`: `interface PolicyTemplateInputs { readonly storeName: string; readonly contactEmail: string; readonly contactPhone: string; readonly businessAddress: string; readonly returnWindowDays: number; readonly returnShippingPaidBy: "customer" | "store"; readonly refundMethod: "original" | "store_credit" | "cash"; readonly cashOnDelivery: boolean; readonly deliveryDays: { readonly min: number; readonly max: number }; readonly shipsInternationally: boolean }`, `DEFAULT_TEMPLATE_INPUTS` (empty strings, 14, `"customer"`, `"original"`, `true`, `{ min: 2, max: 5 }`, `false`), `readTemplateInputs(raw: unknown): ValidationOutcome<PolicyTemplateInputs>` (absent keys take the defaults; `storeName` ≤ 120, `contactEmail` ≤ 254, `contactPhone` ≤ 30, `businessAddress` ≤ 500 after `normalizePlainText`, `TOO_LONG`; `returnWindowDays` integer 0–365, `deliveryDays.min` 1–60, `max` `min`–90, else `OUT_OF_RANGE`; enums and booleans `INVALID_VALUE`; unknown keys `UNKNOWN_KEY`; paths `inputs.<key>`).
  - `render.ts`: `renderPolicyTemplate(type: PolicyType, locale: Locale, inputs: PolicyTemplateInputs): string`.
  - `en.ts`/`ar.ts`: `TEMPLATES: Readonly<Record<PolicyType, string>>` and `SENTENCES` (below).
  - Use cases (all `execute` → `Result<…, DomainError>` unless noted):
    - `ListPolicies({ tenantId })` → `{ policies: { type: PolicyType; set: boolean; locales: Locale[]; updatedAt: string | null }[] }` (five, `POLICY_TYPES` order).
    - `GetPolicy({ type, tenantId })` → `PolicyView = { type; body: LocalizedText; updatedAt: string | null; version: number }`.
    - `UpdatePolicy({ type, body: unknown; expectedVersion: number; by: string; tenantId })` → `PolicyView`.
    - `GeneratePolicyTemplate({ type, locale: Locale; inputs: unknown })` → `{ body: string }` (pure; no tenant, no repository).
    - `GetPublicPolicy({ type, tenantId })` → `Promise<{ type; body: LocalizedText; updatedAt: string | null } | null>` (null when not set).
  - `OnlineStoreController` gains `listPolicies`, `getPolicy`, `updatePolicy`, `generatePolicyTemplate` (200 each) and `publicPolicy(input)` (200, or 404 `POLICY_NOT_FOUND`); `OnlineStorePublicReads` gains `policy: (tenantId: string, type: PolicyType) => Promise<ControllerResponse>`.
  - `errors.ts` gains `policyNotFound = () => new NotFoundError("POLICY_NOT_FOUND: This policy is not set.")`.
  - `OnlineStoreRepos`/`OnlineStoreDeps` gain `policies: PolicyRepository` (both branches of `wireOnlineStore` build it).

- [ ] **Step 1: Write the failing tests**

`services/online-store/src/domain/policy-templates/render.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCALES,
  parseRichText,
  POLICY_TYPES,
  RICH_TEXT_MAX,
  validateRichText,
} from "@platform/storefront-content";
import { renderPolicyTemplate } from "./render";
import {
  DEFAULT_TEMPLATE_INPUTS,
  readTemplateInputs,
  type PolicyTemplateInputs,
} from "./template-inputs";

const inputs = (over: Partial<PolicyTemplateInputs> = {}): PolicyTemplateInputs => ({
  ...DEFAULT_TEMPLATE_INPUTS,
  storeName: "Nour",
  contactEmail: "hello@nour.example",
  contactPhone: "+20 100 123 4567",
  businessAddress: "12 Tahrir St, Cairo",
  ...over,
});

describe("policy templates (spec 2.3)", () => {
  it.each(POLICY_TYPES.flatMap((type) => LOCALES.map((locale) => [type, locale] as const)))(
    "%s/%s renders clean Morbeh text with no placeholder left",
    (type, locale) => {
      const body = renderPolicyTemplate(type, locale, inputs());
      expect(body.length).toBeGreaterThan(80);
      expect(body).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(validateRichText(body, RICH_TEXT_MAX.body)).toEqual([]);
    },
  );

  it("the refund window defaults to 14 days and follows the input", () => {
    expect(renderPolicyTemplate("refund", "en", inputs())).toContain("within 14 days");
    expect(renderPolicyTemplate("refund", "ar", inputs({ returnWindowDays: 30 }))).toContain("30");
  });

  it("a store name with markup and a link stays text (Review Focus 3)", () => {
    for (const locale of LOCALES) {
      const body = renderPolicyTemplate(
        "privacy",
        locale,
        inputs({ storeName: "Evil](javascript:alert(1)) **x** #" }),
      );
      const doc = JSON.stringify(parseRichText(body).document);
      expect(doc).not.toContain('"type":"link"');
      expect(doc).toContain("Evil](javascript:alert(1)) **x** #");
    }
  });

  it("a line with an empty value is dropped; {contact} falls back to the store (Ruling 21)", () => {
    const contact = renderPolicyTemplate(
      "contact",
      "en",
      inputs({ contactEmail: "", businessAddress: "" }),
    );
    expect(contact).not.toContain("Email:");
    expect(contact).not.toContain("Address:");
    expect(contact).toContain("+20 100 123 4567");
    const refund = renderPolicyTemplate(
      "refund",
      "ar",
      inputs({ contactEmail: "", contactPhone: "" }),
    );
    expect(refund).toContain("عبر متجرنا");
  });

  it("the conditional sentences follow the inputs", () => {
    expect(renderPolicyTemplate("shipping", "en", inputs({ cashOnDelivery: false }))).toContain(
      "Orders are paid online at checkout.",
    );
    expect(
      renderPolicyTemplate("shipping", "en", inputs({ shipsInternationally: true })),
    ).toContain("We also ship outside the country.");
    expect(
      renderPolicyTemplate(
        "refund",
        "en",
        inputs({ refundMethod: "store_credit", returnShippingPaidBy: "store" }),
      ),
    ).toMatch(
      /store credit[\s\S]*We pay the cost of return shipping|We pay the cost of return shipping[\s\S]*store credit/,
    );
  });

  it("no merchant value ever starts a line in the template sources (Ruling 21)", () => {
    for (const file of ["en.ts", "ar.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf-8");
      for (const line of source.split(/\r?\n/)) {
        expect(line, `${file}: ${line}`).not.toMatch(
          /^\s*\{(?:storeName|email|phone|address|contact)\}/,
        );
      }
    }
  });
});

describe("readTemplateInputs", () => {
  it("absent keys take the defaults", () => {
    expect(readTemplateInputs({})).toEqual({ ok: true, value: DEFAULT_TEMPLATE_INPUTS });
  });
  it("refuses out-of-range numbers, bad enums, long text and unknown keys", () => {
    const out = readTemplateInputs({
      returnWindowDays: 366,
      deliveryDays: { min: 5, max: 2 },
      refundMethod: "bitcoin",
      storeName: "n".repeat(121),
      extra: true,
    });
    expect(out.ok ? [] : out.issues).toEqual(
      expect.arrayContaining([
        { path: "inputs.returnWindowDays", code: "OUT_OF_RANGE" },
        { path: "inputs.deliveryDays.max", code: "OUT_OF_RANGE" },
        { path: "inputs.refundMethod", code: "INVALID_VALUE" },
        { path: "inputs.storeName", code: "TOO_LONG" },
        { path: "inputs.extra", code: "UNKNOWN_KEY" },
      ]),
    );
  });
});
```

`services/online-store/src/application/policies.use-cases.test.ts` (Part 1's `harness()` from `src/testing/fakes.ts`):

```ts
import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("policies (spec 2.3, 2.6)", () => {
  it("lists all five, unset, in order", async () => {
    const { controller } = harness();
    const res = await controller.listPolicies({ tenantId: T });
    expect(res.status).toBe(200);
    expect((res.body as { policies: unknown[] }).policies).toEqual(
      ["refund", "shipping", "privacy", "terms", "contact"].map((type) => ({
        type,
        set: false,
        locales: [],
        updatedAt: null,
      })),
    );
  });

  it("saves one locale, then is set with that locale; the version guards a stale save", async () => {
    const { controller } = harness();
    const saved = await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "staff-1",
      expectedVersion: 0,
      body: { ar: "## الاسترجاع\nخلال 14 يوماً" },
    });
    expect(saved).toMatchObject({
      status: 200,
      body: { type: "refund", version: 1, body: { ar: "## الاسترجاع\nخلال 14 يوماً" } },
    });
    const stale = await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: {},
    });
    expect(stale).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    const list = (await controller.listPolicies({ tenantId: T })).body as {
      policies: { set: boolean; locales: string[] }[];
    };
    expect(list.policies[0]).toMatchObject({ set: true, locales: ["ar"] });
  });

  it("TOO_LONG and UNSAFE_LINK per locale, validated before any write", async () => {
    const { controller, repos } = harness();
    const res = await controller.updatePolicy({
      tenantId: T,
      type: "terms",
      by: "s",
      expectedVersion: 0,
      body: { ar: "x".repeat(100_001), en: "[x](javascript:alert(1))" },
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual(
      expect.arrayContaining([
        { field: "body.ar", message: "TOO_LONG" },
        { field: "body.en", message: "UNSAFE_LINK" },
      ]),
    );
    expect((await repos.policies.get("terms", T)).snapshot().persisted).toBe(false);
  });

  it("text that normalises to nothing leaves the policy not set; the public read is then 404", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "privacy",
      by: "s",
      expectedVersion: 0,
      body: { en: "  \n " },
    });
    expect(await controller.publicPolicy({ tenantId: T, type: "privacy" })).toMatchObject({
      status: 404,
      body: { code: "POLICY_NOT_FOUND" },
    });
  });

  it("the public read serves a one-locale policy as stored, and never another shop's", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "shipping",
      by: "s",
      expectedVersion: 0,
      body: { en: "2–5 days" },
    });
    expect(await controller.publicPolicy({ tenantId: T, type: "shipping" })).toEqual({
      status: 200,
      body: { type: "shipping", body: { en: "2–5 days" }, updatedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect((await controller.publicPolicy({ tenantId: "t-2", type: "shipping" })).status).toBe(404);
  });

  it("generating a template is pure: nothing is saved", async () => {
    const { controller, repos } = harness();
    const res = await controller.generatePolicyTemplate({
      type: "refund",
      locale: "en",
      inputs: { storeName: "Nour" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { body: string }).body).toContain("within 14 days");
    expect((await repos.policies.get("refund", T)).snapshot().persisted).toBe(false);
    const bad = await controller.generatePolicyTemplate({
      type: "refund",
      locale: "en",
      inputs: { returnWindowDays: -1 },
    });
    expect(bad).toMatchObject({ status: 422 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/domain/policy-templates src/application/policies.use-cases.test.ts`
Expected: FAIL — missing modules and controller methods.

- [ ] **Step 3: Write the template copy (fixed text)**

`render.ts`: `renderPolicyTemplate` takes `TEMPLATES[type]` of the locale, builds the value map (every merchant string through `escapeRichText(normalizePlainText(value))`; numbers as `String(n)`; `{contact}` = the non-empty of email and phone joined by `SENTENCES.or`, else `SENTENCES.throughStore`; the sentence placeholders from `SENTENCES`), drops every line containing a placeholder whose value is `""`, substitutes the rest with one `replace(/\{([a-zA-Z]+)\}/g, …)`, and collapses three or more newlines into two. Placeholders: `{storeName}`, `{email}`, `{phone}`, `{address}`, `{contact}`, `{returnWindowDays}`, `{deliveryMin}`, `{deliveryMax}`, `{returnShipping}`, `{refundMethod}`, `{cod}`, `{international}`.

`en.ts`:

```ts
export const SENTENCES = {
  or: " or ",
  throughStore: "our store",
  returnShipping: {
    customer:
      "The customer pays the cost of return shipping, unless the item arrived defective or is not what was ordered.",
    store: "We pay the cost of return shipping.",
  },
  refundMethod: {
    original: "Approved refunds are paid back to the original payment method.",
    store_credit: "Approved refunds are given as store credit you can use on your next order.",
    cash: "For cash on delivery orders, approved refunds are paid in cash or by bank or wallet transfer.",
  },
  cod: {
    yes: "You can pay in cash when your order is delivered.",
    no: "Orders are paid online at checkout.",
  },
  international: {
    yes: "We also ship outside the country. Delivery times and costs for international orders are shown at checkout.",
    no: "We currently ship within the country only.",
  },
} as const;

export const TEMPLATES = {
  refund: `## Returns

You can return an item within {returnWindowDays} days of delivery. It must be unused, in its original packaging, with proof of purchase.

## How to request a return

Contact us at {contact} with your order number and the reason for the return.

## Return shipping

{returnShipping}

## Refunds

Once we receive and inspect the item, we will tell you whether your refund is approved. {refundMethod}

## Items that cannot be returned

- Items that were used, damaged after delivery, or are missing parts.
- Personalised or made-to-order items, unless they arrived defective.

## Defective or wrong items

If your item arrived defective or is not what you ordered, contact us within {returnWindowDays} days of delivery and we will replace or refund it at no cost to you.`,
  shipping: `## Delivery times

We deliver within {deliveryMin} to {deliveryMax} business days after your order is confirmed.

## Shipping costs

Shipping costs are calculated at checkout and shown before you pay.

## Paying on delivery

{cod}

## Shipping outside the country

{international}

## Questions

For any question about your delivery, contact us at {contact}.`,
  privacy: `## What we collect

When you order from {storeName}, we collect your name, phone number, email address, delivery address and order details.

## How we use it

We use your information to process and deliver your orders, to contact you about them, and to improve our store. We do not sell your personal information.

## Who we share it with

We share only what is needed with the delivery companies and payment providers that complete your order.

## Your choices

You can ask us to see, correct or delete your information by contacting us at {contact}.`,
  terms: `## About these terms

These terms apply to every purchase from {storeName}. By placing an order you agree to them.

## Orders and prices

Prices are shown in the store's currency. We may cancel an order if an item is out of stock or a price was shown in error, and we will refund anything you paid.

## Delivery, returns and refunds

Delivery is covered by our shipping policy, and returns and refunds by our refund policy.

## Contact

For any question about these terms, contact us at {contact}.`,
  contact: `## Contact {storeName}

- Address: {address}
- Email: {email}
- Phone / WhatsApp: {phone}`,
} as const;
```

`ar.ts` (Modern Standard Arabic, customer-facing):

```ts
export const SENTENCES = {
  or: " أو ",
  throughStore: "متجرنا",
  returnShipping: {
    customer: "يتحمّل العميل تكلفة شحن الإرجاع، إلا إذا وصل المنتج معيباً أو مختلفاً عن الطلب.",
    store: "نتحمّل نحن تكلفة شحن الإرجاع.",
  },
  refundMethod: {
    original: "يُردّ المبلغ المعتمد إلى وسيلة الدفع الأصلية.",
    store_credit: "يُردّ المبلغ المعتمد في صورة رصيد في المتجر تستخدمه في طلبك القادم.",
    cash: "في طلبات الدفع عند الاستلام، يُردّ المبلغ المعتمد نقداً أو بتحويل بنكي أو عبر المحفظة الإلكترونية.",
  },
  cod: {
    yes: "يمكنك الدفع نقداً عند استلام طلبك.",
    no: "يُدفع ثمن الطلبات إلكترونياً عند إتمام الشراء.",
  },
  international: {
    yes: "نشحن أيضاً إلى خارج البلاد، وتظهر مدة التوصيل وتكلفته للطلبات الدولية عند إتمام الشراء.",
    no: "نشحن حالياً داخل البلاد فقط.",
  },
} as const;

export const TEMPLATES = {
  refund: `## الإرجاع

يمكنك إرجاع المنتج خلال {returnWindowDays} يوماً من تاريخ الاستلام، على أن يكون غير مستخدم وفي عبوته الأصلية ومعه ما يثبت الشراء.

## كيفية طلب الإرجاع

تواصل معنا عبر {contact} مع ذكر رقم الطلب وسبب الإرجاع.

## شحن الإرجاع

{returnShipping}

## استرداد المبلغ

بعد استلام المنتج وفحصه نبلغك بقبول الاسترداد أو رفضه. {refundMethod}

## منتجات لا يمكن إرجاعها

- المنتجات المستخدمة، أو التي تلفت بعد الاستلام، أو الناقصة.
- المنتجات المخصّصة أو المصنوعة حسب الطلب، إلا إذا وصلت معيبة.

## المنتجات المعيبة أو المختلفة

إذا وصلك المنتج معيباً أو مختلفاً عمّا طلبت، تواصل معنا خلال {returnWindowDays} يوماً من الاستلام وسنستبدله أو نردّ ثمنه دون أي تكلفة عليك.`,
  shipping: `## مدة التوصيل

نوصّل الطلبات خلال {deliveryMin} إلى {deliveryMax} أيام عمل من تأكيد الطلب.

## تكلفة الشحن

تُحسب تكلفة الشحن عند إتمام الشراء وتظهر لك قبل الدفع.

## الدفع عند الاستلام

{cod}

## الشحن خارج البلاد

{international}

## الاستفسارات

لأي استفسار عن التوصيل، تواصل معنا عبر {contact}.`,
  privacy: `## البيانات التي نجمعها

عند الطلب من {storeName} نجمع اسمك ورقم هاتفك وبريدك الإلكتروني وعنوان التوصيل وتفاصيل الطلب.

## كيف نستخدمها

نستخدم بياناتك لتنفيذ طلباتك وتوصيلها والتواصل معك بشأنها وتحسين متجرنا، ولا نبيع بياناتك الشخصية.

## مع من نشاركها

نشارك فقط ما يلزم مع شركات التوصيل ومزوّدي الدفع الذين يُتمّون طلبك.

## حقوقك

يمكنك أن تطلب الاطلاع على بياناتك أو تصحيحها أو حذفها بالتواصل معنا عبر {contact}.`,
  terms: `## عن هذه الشروط

تسري هذه الشروط على كل عملية شراء من {storeName}، وبإتمام الطلب فإنك توافق عليها.

## الطلبات والأسعار

تُعرض الأسعار بعملة المتجر. يحق لنا إلغاء الطلب إذا نفد المنتج أو ظهر سعره خطأً، وعندها نردّ إليك كل ما دفعته.

## التوصيل والإرجاع والاسترداد

تنظّم سياسة الشحن التوصيل، وتنظّم سياسة الاسترجاع الإرجاع واسترداد المبلغ.

## التواصل

لأي استفسار عن هذه الشروط، تواصل معنا عبر {contact}.`,
  contact: `## التواصل مع {storeName}

- العنوان: {address}
- البريد الإلكتروني: {email}
- الهاتف / واتساب: {phone}`,
} as const;
```

- [ ] **Step 4: Implement the use cases, controller and wiring**

- `UpdatePolicy`: `isPolicyType(type)` was checked by the route; normalise `body` with `normalizeLocalizedText(raw, { path: "body", max: RICH_TEXT_MAX.body, multiline: true }, issues)`; for each locale without a `TOO_LONG` issue, a `validateRichText` `UNSAFE_LINK` adds `{ path: "body.<locale>", code: "UNSAFE_LINK" }`; any issue → `err(invalidContent(issues))` (its message prefix is the first issue's code when the path is `""`, else `INVALID_CONTENT` — keep Part 1's helper; admin-web maps field codes). Then `inUnitOfWork`: `get(type, tenantId, tx)`, version check (`versionConflict`), `update(body, by, now)`, `save`, return the view with `version: policy.nextVersion` read **before** `save` (as `UpdatePreferences` does).
- `GetPublicPolicy` returns `null` for a policy that is not set.
- Controller: `publicPolicy` → `null` ⇒ `present(err(policyNotFound()), 200)`; `generatePolicyTemplate` → `readTemplateInputs` failures are 422 through `invalidContent`.
- `publicReadsOf` gains `policy: (tenantId, type) => controller.publicPolicy({ tenantId, type })`.
- `fakes.ts` `harness()` builds `policies: new InMemoryPolicyRepository()` in `repos`.

- [ ] **Step 5: Run the service suite, typecheck, lint**

Run: `pnpm --filter @platform/online-store test && pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/online-store lint && pnpm --filter @platform/admin typecheck`
Expected: PASS (apps/admin only consumes the widened public-reads type).

- [ ] **Step 6: Commit**

```bash
git add services/online-store/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): add store policies with bilingual templates

Five policies stored per locale in morbeh text with version-guarded saves, a public read that
404s an unset policy, and ar/en starting templates that escape every merchant value.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Menus, link targets and the shell's menus — online-store use cases, Catalog's by-ids read, and the apps/admin wiring

Model tier: **strong** (cross-context resolution, degradation and the first-insert race).

**Files:**

- Create: `services/online-store/src/application/menu-resolution.ts`, `menus.use-cases.ts`, `menus.use-cases.test.ts`, `link-targets.use-case.ts`
- Modify: `services/online-store/src/application/ports.ts`, `deps.ts`, `shell.use-case.ts`, `shell.use-case.test.ts`, `src/domain/errors.ts`, `src/composition.ts`, `src/composition.test.ts`, `src/interfaces/online-store.controller.ts`, `src/index.ts`, `src/testing/fakes.ts`
- Create: `services/catalog/src/application/get-collections-by-ids.use-case.ts`, `get-collections-by-ids.use-case.test.ts`
- Modify: `services/catalog/src/domain/collection-repository.ts`, `src/infrastructure/in-memory-collection-repository.ts`, `prisma-catalog-repositories.ts`, `src/interfaces/collection.controller.ts`, `src/composition.ts`, `src/application/list-collection-products.use-case.test.ts` (its `stubCollections` gains `findByIds`)
- Create: `apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.ts`, `online-store-link-targets.adapter.test.ts`
- Modify: `apps/admin/src/composition.ts` (`linkTargets`), `src/tenant-mode-guard.test.ts` (one case), `src/http/public-online-store-routes.test.ts` (the shell's field list and header/footer expectations)

**Interfaces:**

- Consumes: `Menu`, `virtualDefaultMenu`, `MENU_LIMIT`, `MenuRepository`, `PolicyRepository` (Task 3); `validateMenuItems`, `linkRefTargetsOf`, `isMenuHandle`, `isDefaultMenuHandle`, `RESERVED_MENU_HANDLES`, `MENU_TITLE_MAX`, `menuHandlesOf`, `policyPath`, `POLICY_TITLES`, `POLICY_TYPES`, `normalizePlainText`, `pickText` (Tasks 1–2); `GetPagesByIds` via `PagesController.getByIds`, `Page.title/name/routePath/status` (Task 4); `ProductController.getByIds` and `list` (existing).
- Produces:
  - `ports.ts`:

    ```ts
    export type CatalogLinkType = "collection" | "product" | "page";
    export interface LinkTarget {
      readonly href: string;
      readonly title: string;
      readonly published: boolean;
    }
    export interface LinkTargetChoice {
      readonly id: string;
      readonly title: string;
      readonly subtitle: string;
    }
    export type LinkTargetMap = Readonly<
      Record<CatalogLinkType, Readonly<Record<string, LinkTarget>>>
    >;
    /** Collections, products and pages by id (one batched read per kind), and the picker's search. */
    export interface LinkTargetsPort {
      resolve(
        ids: Readonly<Record<CatalogLinkType, readonly string[]>>,
        tenantId: string,
      ): Promise<LinkTargetMap>;
      search(
        type: CatalogLinkType,
        query: string,
        tenantId: string,
      ): Promise<readonly LinkTargetChoice[]>;
    }
    ```

  - `OnlineStoreWiringDeps` and `OnlineStoreDeps` gain `linkTargets: LinkTargetsPort` (listed, never spread); `OnlineStoreRepos` gains `menus: MenuRepository`.
  - `menu-resolution.ts`: `interface MenuItemView extends Omit<MenuItem, "children"> { readonly broken: boolean; readonly targetTitle: string | null; readonly children: readonly MenuItemView[] }`; `loadTargets(deps, items: readonly MenuItem[], tenantId: string): Promise<LinkTargetMap>` (one `resolve` call; empty kinds skipped); `resolveItems(items, targets, setPolicies: ReadonlySet<PolicyType>): ResolvedMenuItem[]` (drops a broken item with its children); `itemViews(items, targets, setPolicies): MenuItemView[]`.
  - Use cases and their DTOs:
    - `ListMenus({ tenantId })` → `{ menus: { id: string | null; handle: string; title: string; itemCount: number; isDefault: boolean; topLabels: LocalizedText[] }[] }` — the two defaults first (saved or virtual), then the rest by handle; `itemCount` counts both levels; `topLabels` ≤ 5 (Ruling 29).
    - `GetMenu({ handle, tenantId })` → `MenuView = { id: string | null; handle; title; isDefault: boolean; version: number; items: readonly MenuItemView[] }`; 404 `MENU_NOT_FOUND`.
    - `CreateMenu({ handle, title: unknown; items: unknown; tenantId })` → `MenuView` (201).
    - `UpdateMenu({ handle, title: unknown; items: unknown; expectedVersion: number; tenantId })` → `MenuView` (upsert for the two defaults).
    - `DeleteMenu({ handle, tenantId })` → `{ handle }`.
    - `SearchLinkTargets({ type: CatalogLinkType | "policy"; q: string; tenantId })` → `{ targets: LinkTargetChoice[] }` (≤ 20; `policy` answered here: id = type, title = `POLICY_TITLES[type].en`, subtitle = `policyPath(type)`, matched case-insensitively against the slug and both titles).
  - `errors.ts`: `menuNotFound` (404 `MENU_NOT_FOUND`), `menuHandleTaken` (409 `MENU_HANDLE_TAKEN`), `menuProtected` (409 `MENU_PROTECTED`), `menuInUse` (409 `MENU_IN_USE`), `menuLimit` (409 `MENU_LIMIT`), `invalidHandle` (422 `INVALID_HANDLE`, field `handle`), `titleRequired` (422, field `title` message `TITLE_REQUIRED`).
  - `PublicShellView.header = { sticky: boolean; menu: readonly ResolvedMenuItem[] }`, `PublicShellView.footer = { note; showSocial; menu: readonly ResolvedMenuItem[]; policies: readonly PolicyType[] }` (`policies` = the set policies in `POLICY_TYPES` order when `showPolicyLinks`, else `[]`).
  - Controller: `listMenus`, `getMenu`, `createMenu` (201), `updateMenu`, `deleteMenu`, `searchLinkTargets` (200).
  - Catalog: `CollectionRepository.findByIds(ids: readonly string[], tenantId: string, tx?: unknown): Promise<readonly Collection[]>`; `GetCollectionsByIds({ ids, tenantId })` → `readonly Collection[]`; `CollectionController.getByIds(input)` (200).
  - apps/admin: `onlineStoreLinkTargets(reads: LinkTargetReads): LinkTargetsPort` where

    ```ts
    export interface LinkTargetReads {
      readonly products: (ids: readonly string[], tenantId: string) => Promise<Response>;
      readonly collections: (ids: readonly string[], tenantId: string) => Promise<Response>;
      readonly pages: (ids: readonly string[], tenantId: string) => Promise<Response>;
      readonly searchProducts: (query: string, tenantId: string) => Promise<Response>;
      readonly searchCollections: (query: string, tenantId: string) => Promise<Response>;
      readonly listPages: (tenantId: string) => Promise<Response>;
    }
    ```

    (`Response = { status: number; body: unknown }`). Non-200 answers throw. Hrefs: `/collections/<slug>`, `/products/<slug>`, `/pages/<handle>` (each segment `encodeURIComponent`); `published` per Ruling 11; a page title is `pickText(title, "en") ?? pickText(title, "ar") ?? name`.

- [ ] **Step 1: Write the failing use-case tests**

Extend `src/testing/fakes.ts` `harness()` with options `targets?: Readonly<Record<string, Partial<Record<CatalogLinkType, Record<string, LinkTarget>>>>>` and `linkTargetsFail?: boolean` (read per call), a `linkTargets` port over them (`search` filters the shop's targets of that kind by title, case-insensitively, and answers `{ id, title, subtitle: href }`), `resolveCalls: number[]` (the number of ids per call), and `menus: new InMemoryMenuRepository()` in `repos`.

`services/online-store/src/application/menus.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { harness } from "../testing/fakes";

const T = "t-1";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const link = (n: number, target: unknown, children: unknown[] = []) => ({
  id: ID(n),
  label: { en: `L${n}` },
  link: target,
  children,
});
const TARGETS = {
  [T]: {
    collection: {
      "c-live": { href: "/collections/sale", title: "Sale", published: true },
      "c-draft": { href: "/collections/soon", title: "Soon", published: false },
    },
    product: { "p-live": { href: "/products/lamp", title: "Lamp", published: true } },
  },
};

describe("menus (spec 2.2, 2.6)", () => {
  it("lists the two virtual defaults before any save", async () => {
    const { controller } = harness();
    const res = await controller.listMenus({ tenantId: T });
    expect(res.body).toEqual({
      menus: [
        {
          id: null,
          handle: "main-menu",
          title: "Main menu",
          itemCount: 2,
          isDefault: true,
          topLabels: [
            { ar: "الرئيسية", en: "Home" },
            { ar: "البحث", en: "Search" },
          ],
        },
        {
          id: null,
          handle: "footer",
          title: "Footer menu",
          itemCount: 1,
          isDefault: true,
          topLabels: [{ ar: "البحث", en: "Search" }],
        },
      ],
    });
  });

  it("the default footer gains one item per set policy", async () => {
    const { controller } = harness();
    await controller.updatePolicy({
      tenantId: T,
      type: "refund",
      by: "s",
      expectedVersion: 0,
      body: { en: "x" },
    });
    const footer = (await controller.getMenu({ tenantId: T, handle: "footer" })).body as {
      items: { link: unknown }[];
    };
    expect(footer.items.map((i) => i.link)).toEqual([
      { type: "search" },
      { type: "policy", policy: "refund" },
    ]);
  });

  it("creates, reads with broken flags and target titles, updates and deletes a menu", async () => {
    const { controller } = harness({ targets: TARGETS });
    const created = await controller.createMenu({
      tenantId: T,
      handle: "sale",
      title: "  Sale  ",
      items: [
        link(1, { type: "collection", id: "c-live" }, [link(2, { type: "product", id: "p-live" })]),
        link(3, { type: "collection", id: "c-draft" }),
        link(4, { type: "product", id: "p-gone" }),
        link(5, { type: "policy", policy: "terms" }),
      ],
    });
    expect(created.status).toBe(201);
    const menu = (await controller.getMenu({ tenantId: T, handle: "sale" })).body as {
      title: string;
      version: number;
      items: { broken: boolean; targetTitle: string | null; children: { broken: boolean }[] }[];
    };
    expect(menu.title).toBe("Sale");
    expect(menu.version).toBe(1);
    expect(menu.items.map((i) => [i.broken, i.targetTitle])).toEqual([
      [false, "Sale"],
      [true, "Soon"],
      [true, null],
      [true, "terms"],
    ]);
    expect(menu.items[0]?.children[0]?.broken).toBe(false);
    const updated = await controller.updateMenu({
      tenantId: T,
      handle: "sale",
      title: "Deals",
      items: [],
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ status: 200, body: { title: "Deals", version: 2 } });
    expect(await controller.deleteMenu({ tenantId: T, handle: "sale" })).toMatchObject({
      status: 200,
    });
    expect((await controller.getMenu({ tenantId: T, handle: "sale" })).status).toBe(404);
  });

  it("refuses bad handles, taken handles, defaults, the reserved handle and the 51st menu", async () => {
    const { controller } = harness();
    const make = (handle: string) =>
      controller.createMenu({ tenantId: T, handle, title: "M", items: [] });
    expect(await make("Bad Handle")).toMatchObject({
      status: 422,
      body: { code: "INVALID_HANDLE" },
    });
    expect(await make("new")).toMatchObject({ status: 422, body: { code: "INVALID_HANDLE" } });
    expect(await make("main-menu")).toMatchObject({
      status: 409,
      body: { code: "MENU_HANDLE_TAKEN" },
    });
    expect((await make("a")).status).toBe(201);
    expect(await make("a")).toMatchObject({ status: 409, body: { code: "MENU_HANDLE_TAKEN" } });
    for (let n = 1; n < 50; n += 1) expect((await make(`m-${n}`)).status).toBe(201);
    expect(await make("one-more")).toMatchObject({ status: 409, body: { code: "MENU_LIMIT" } });
  });

  it("validates title and items before any write", async () => {
    const { controller, repos } = harness();
    const res = await controller.createMenu({
      tenantId: T,
      handle: "x",
      title: " ",
      items: [link(1, { type: "url", url: "javascript:alert(1)" })],
    });
    expect(res.status).toBe(422);
    expect((res.body as { fields: unknown[] }).fields).toEqual(
      expect.arrayContaining([
        { field: "title", message: "TITLE_REQUIRED" },
        { field: "items.0.link.url", message: "INVALID_URL" },
      ]),
    );
    expect(await repos.menus.get("x", T)).toBeNull();
  });

  it("the first save of a default inserts it; a lost first insert is VERSION_CONFLICT (Review Focus 4)", async () => {
    const { controller, repos } = harness();
    const first = await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Footer",
      items: [],
      expectedVersion: 0,
    });
    expect(first).toMatchObject({ status: 200, body: { version: 1, isDefault: true } });
    expect((first.body as { id: string | null }).id).not.toBeNull();
    const second = await controller.updateMenu({
      tenantId: T,
      handle: "footer",
      title: "Other",
      items: [],
      expectedVersion: 0,
    });
    expect(second).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect((await repos.menus.list(T)).length).toBe(1);
  });

  it("updating an unknown non-default menu is MENU_NOT_FOUND", async () => {
    const { controller } = harness();
    expect(
      await controller.updateMenu({
        tenantId: T,
        handle: "nope",
        title: "x",
        items: [],
        expectedVersion: 0,
      }),
    ).toMatchObject({ status: 404, body: { code: "MENU_NOT_FOUND" } });
  });

  it("the defaults cannot be deleted; a menu the draft or live theme uses cannot either", async () => {
    const { controller } = harness();
    expect(await controller.deleteMenu({ tenantId: T, handle: "footer" })).toMatchObject({
      status: 409,
      body: { code: "MENU_PROTECTED" },
    });
    await controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const doc = {
      ...DEFAULT_THEME_DOCUMENT,
      header: { ...DEFAULT_THEME_DOCUMENT.header, menuHandle: "alt" },
    };
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc });
    expect(await controller.deleteMenu({ tenantId: T, handle: "alt" })).toMatchObject({
      status: 409,
      body: { code: "MENU_IN_USE" },
    });
    expect(await controller.deleteMenu({ tenantId: T, handle: "missing" })).toMatchObject({
      status: 404,
      body: { code: "MENU_NOT_FOUND" },
    });
  });

  it("menus are per shop", async () => {
    const { controller } = harness();
    await controller.createMenu({ tenantId: T, handle: "sale", title: "Sale", items: [] });
    expect((await controller.getMenu({ tenantId: "t-2", handle: "sale" })).status).toBe(404);
  });

  it("link-target search: policies here, the rest through the port, at most 20, query trimmed", async () => {
    const { controller } = harness({ targets: TARGETS });
    const policies = (
      await controller.searchLinkTargets({ tenantId: T, type: "policy", q: " refund " })
    ).body;
    expect(policies).toEqual({
      targets: [{ id: "refund", title: "Refund policy", subtitle: "/policies/refund-policy" }],
    });
    const collections = (
      await controller.searchLinkTargets({ tenantId: T, type: "collection", q: "sa" })
    ).body as {
      targets: unknown[];
    };
    expect(collections.targets).toEqual([
      { id: "c-live", title: "Sale", subtitle: "/collections/sale" },
    ]);
  });
});
```

Append to `shell.use-case.test.ts` (and update its first test's expected `header`/`footer`):

```ts
describe("the shell's menus (spec 2.2, 2.6)", () => {
  const TARGETS = {
    [T]: { collection: { "c-1": { href: "/collections/sale", title: "Sale", published: true } } },
  };
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("an untouched shop serves the default menus resolved, and no policy links", async () => {
    const body = (await harness().controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([
      { label: { ar: "الرئيسية", en: "Home" }, href: "/", external: false, children: [] },
      { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
    ]);
    expect(body.footer.menu).toEqual([
      { label: { ar: "البحث", en: "Search" }, href: "/search", external: false, children: [] },
    ]);
    expect(body.footer.policies).toEqual([]);
  });

  it("drops missing, unpublished and unset targets with their children; one batched read", async () => {
    const h = harness({ targets: TARGETS });
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        {
          id: ID(1),
          label: { en: "Sale" },
          link: { type: "collection", id: "c-1" },
          children: [
            {
              id: ID(2),
              label: { en: "Gone" },
              link: { type: "product", id: "p-x" },
              children: [],
            },
          ],
        },
        {
          id: ID(3),
          label: { en: "Old" },
          link: { type: "collection", id: "c-gone" },
          children: [{ id: ID(4), label: { en: "Kid" }, link: { type: "home" }, children: [] }],
        },
        {
          id: ID(5),
          label: { en: "Terms" },
          link: { type: "policy", policy: "terms" },
          children: [],
        },
        {
          id: ID(6),
          label: { en: "WhatsApp" },
          link: { type: "url", url: "https://wa.me/20100" },
          children: [],
        },
      ],
    });
    h.resolveCalls.splice(0); // the save's own view resolved too
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header.menu).toEqual([
      { label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] },
      { label: { en: "WhatsApp" }, href: "https://wa.me/20100", external: true, children: [] },
    ]);
    expect(h.resolveCalls).toEqual([3]);
  });

  it("link targets down: only catalogue items are dropped, logged; the shell still answers (Review Focus 2)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const options = { targets: TARGETS, linkTargetsFail: false };
    const h = harness(options);
    await h.controller.updateMenu({
      tenantId: T,
      handle: "main-menu",
      title: "Main",
      expectedVersion: 0,
      items: [
        { id: ID(1), label: { en: "Sale" }, link: { type: "collection", id: "c-1" }, children: [] },
        { id: ID(2), label: { en: "Home" }, link: { type: "home" }, children: [] },
      ],
    });
    options.linkTargetsFail = true; // read per call, as Part 1's ...Fails options
    const res = await h.controller.shell({ tenantId: T });
    expect(res.status).toBe(200);
    expect((res.body as Doc).header.menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "storefront shell: link targets unavailable",
      expect.anything(),
    );
  });

  it("policy links: the set ones when showPolicyLinks, none when off; preview uses the draft's handles", async () => {
    const h = harness();
    await h.controller.updatePolicy({
      tenantId: T,
      type: "privacy",
      by: "s",
      expectedVersion: 0,
      body: { ar: "نص" },
    });
    expect(((await h.controller.shell({ tenantId: T })).body as Doc).footer.policies).toEqual([
      "privacy",
    ]);
    await h.controller.createMenu({ tenantId: T, handle: "alt", title: "Alt", items: [] });
    const draft = {
      ...DEFAULT_THEME_DOCUMENT,
      header: { ...DEFAULT_THEME_DOCUMENT.header, menuHandle: "alt" },
      footer: { ...DEFAULT_THEME_DOCUMENT.footer, showPolicyLinks: false },
    };
    await h.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    const token = (
      (await h.controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    const preview = (await h.controller.shell({ tenantId: T, previewToken: token })).body as Doc;
    expect(preview.header.menu).toEqual([]);
    expect(preview.footer.policies).toEqual([]);
    expect(((await h.controller.shell({ tenantId: T })).body as Doc).header.menu).toHaveLength(2);
  });

  it("a Part 1 published document still renders the default menus (Review Focus 3)", async () => {
    const h = harness();
    const partOne = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    partOne.header = { sticky: true };
    partOne.footer = { note: {}, showSocial: true };
    await h.controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: partOne });
    await h.controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "s" });
    const body = (await h.controller.shell({ tenantId: T })).body as Doc;
    expect(body.header).toMatchObject({ sticky: true });
    expect(body.header.menu).toHaveLength(2);
  });
});
```

`services/catalog/src/application/get-collections-by-ids.use-case.test.ts`: over `InMemoryCollectionRepository`, two collections in `t-1` and one in `t-2`; `execute({ ids: [a, foreign, "missing"], tenantId: "t-1" })` returns only `a`; an empty `ids` returns `[]` without reading; a deleted collection is skipped.

`apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.test.ts` (fake aggregates with the getters the adapter reads):

```ts
it("maps catalogue and pages by id, with Ruling 11's published rules", async () => {
  const port = onlineStoreLinkTargets(readsOver({
    products: [
      product("p-1", "Lamp", "lamp", "published"),
      product("p-2", "Hidden", "hidden", "unlisted"),
      product("p-3", "Soon", "soon", "draft"),
    ],
    collections: [collection("c-1", "Sale", "sale", "published"), collection("c-2", "New", "new", "draft")],
    pages: [
      page("g-1", "About", "/pages/about", "published", { ar: "من نحن" }),
      page("g-2", "Landing", "/landing", "published", {}),
    ],
  }));
  const map = await port.resolve(
    { product: ["p-1", "p-2", "p-3"], collection: ["c-1", "c-2"], page: ["g-1", "g-2"] }, "t-1",
  );
  expect(map.product).toEqual({
    "p-1": { href: "/products/lamp", title: "Lamp", published: true },
    "p-2": { href: "/products/hidden", title: "Hidden", published: true },
    "p-3": { href: "/products/soon", title: "Soon", published: false },
  });
  expect(map.collection["c-2"]).toEqual({ href: "/collections/new", title: "New", published: false });
  expect(map.page["g-1"]).toEqual({ href: "/pages/about", title: "من نحن", published: true });
  expect(map.page["g-2"]).toMatchObject({ published: false });
});
it("a failed read throws (the shell degrades, admin reads surface it)", async () => { … status 500 → rejects … });
it("is closures only: no controller hangs off the port (Ruling 13 of Part 1)", () => {
  const port = onlineStoreLinkTargets(readsOver({ products: [], collections: [], pages: [] }));
  for (const value of Object.values(port)) expect(typeof value).toBe("function");
});
it("search maps each kind to { id, title, subtitle } and asks for at most 20", async () => { … });
```

`apps/admin/src/tenant-mode-guard.test.ts` gains: "the link-target adapter adds no construction-time tenant" — `findConstructionTimeTenants(pinnedProductionShapedGraph(), [])` has no path containing `linkTargets`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/application && pnpm --filter @platform/catalog exec vitest run src/application/get-collections-by-ids.use-case.test.ts && pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/online-store-link-targets.adapter.test.ts`
Expected: FAIL — missing use cases, port, catalog read and adapter.

- [ ] **Step 3: Implement the menus, resolution and shell**

- `menu-resolution.ts`: a link resolves to `{ href, title, live }`: `home` → `/`, `search` → `/search`, `url` → the URL (title = URL, always live), `policy` → `policyPath` (title = the type, live iff set), catalogue kinds → the target map (missing → `href: null`, live false). `resolveItems` keeps live items with a non-empty label and their live children; `external` = `href.startsWith("https:")`.
- `menus.use-cases.ts`:
  - Handle checks (create): `isMenuHandle` and not in `RESERVED_MENU_HANDLES` else `invalidHandle()`; a default handle or an existing row → `menuHandleTaken()`.
  - Title: `normalizePlainText`, empty → `titleRequired`, > `MENU_TITLE_MAX` → `TOO_LONG` at `title`. Items: `validateMenuItems`; issues are merged with the title's into one `invalidContent`.
  - Create counts `menus.list` before the unit of work: `>= MENU_LIMIT` → `menuLimit()`. Inside `inUnitOfWork`: re-read by handle (taken → `err` before any write), `Menu.create({ id: idGenerator.generate(), … })`, `save`.
  - Update: validate, then inside the unit of work: row present → version check → `update` → `save`; row absent and default → `expectedVersion !== 0` is `versionConflict()`, else `Menu.create` + `save` (a lost insert throws `ConcurrencyError` from the repository and becomes `VERSION_CONFLICT`); row absent and not default → `menuNotFound()`.
  - Delete: default → `menuProtected()`; `menuHandlesOf(draft)` or `menuHandlesOf(published)` contains it → `menuInUse()`; then `remove` in the unit of work, `false` → `menuNotFound()`.
  - Reads: `GetMenu` and `ListMenus` read policies once for the virtual footer; `GetMenu` uses `loadTargets` (strict) and `itemViews`.
  - Create and Update answer a `MenuView`: its policies and `loadTargets` are read from the validated items **before** `inUnitOfWork`, and the view is built purely afterwards (Part 1's Task 3 lesson: once the unit of work commits, the use case cannot fail; a catalogue blip fails the save before anything is written).
- `shell.use-case.ts`: after the existing reads, `menuHandlesOf(doc)` → for each handle the saved menu, else `virtualDefaultMenu` for a default handle, else an empty item list; `setPolicies` from one `policies.list`; one `loadTargets` over both menus' items inside `try` (failure → empty map + `logger.warn("storefront shell: link targets unavailable", { tenantId, error })`); `header.menu`, `footer.menu` via `resolveItems`; `footer.policies` per Interfaces.
- `link-targets.use-case.ts`: `q = q.trim().slice(0, 100)`; policy branch as in Interfaces; other kinds → `linkTargets.search(type, q, tenantId)`, first 20.
- `composition.ts`: list `linkTargets` in the deps object; both branches build `menus` repositories.

- [ ] **Step 4: Implement Catalog's by-ids read and the adapter, and wire it**

- Catalog: in-memory `findByIds` = the tenant's non-deleted collections among `ids`; Prisma = UUID-filtered ids, `collection.findMany({ where: { tenantId, deletedAt: null, id: { in: wanted } }, include: { items: true } })`; `GetCollectionsByIds` returns `[]` for empty `ids`; `getCollectionsByIds: new GetCollectionsByIds({ collections })` in `composition.ts` next to `getCollectionBySlug`.
- Adapter: one closure per port method; `resolve` calls only the kinds with ids, in parallel; `search` calls `searchProducts`/`searchCollections` (catalogue `list` with `first: 20` and `query` when non-empty) or `listPages` (first 100, filtered by the query against name, titles and route path, first 20); subtitle is the href.
- `apps/admin/src/composition.ts`, inside `wireOnlineStore({...})`:

  ```ts
  linkTargets: onlineStoreLinkTargets({
    products: (ids, tenantId) => catalog.products.getByIds({ ids, tenantId }),
    collections: (ids, tenantId) => catalog.collections.getByIds({ ids, tenantId }),
    pages: (ids, tenantId) => pages.pages.getByIds({ ids, tenantId }),
    searchProducts: (query, tenantId) =>
      catalog.products.list({ ...(query === "" ? {} : { query }), first: 20, tenantId }),
    searchCollections: (query, tenantId) =>
      catalog.collections.list({ ...(query === "" ? {} : { query }), first: 20, tenantId }),
    listPages: (tenantId) => pages.pages.listPages({ first: 100, tenantId }),
  }),
  ```

- Update `public-online-store-routes.test.ts`'s "lists exactly the spec's fields" and the `header`/`footer` expectations to the Part 2 shapes (the untouched shop's menus from the shell test above).

- [ ] **Step 5: Run every touched suite, the guard and typecheck**

Run: `pnpm --filter @platform/online-store test && pnpm --filter @platform/catalog test && pnpm --filter @platform/admin test && pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS; one known guard finding.

- [ ] **Step 6: Commit**

```bash
git add services/online-store/src services/catalog/src \
  apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.ts \
  apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.test.ts \
  apps/admin/src/composition.ts apps/admin/src/tenant-mode-guard.test.ts \
  apps/admin/src/http/public-online-store-routes.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): add menus resolved by id into the storefront shell

Menus with virtual main-menu and footer defaults, delete protections and a first-insert guard;
links resolve through one batched catalogue and pages read, and broken targets drop out live.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: apps/admin — the Part 2 admin and public routes

Model tier: **standard**.

**Files:**

- Modify: `apps/admin/src/http/online-store-routes.ts`, `online-store-routes.test.ts`
- Modify: `apps/admin/src/http/public-online-store-routes.ts`, `public-online-store-routes.test.ts`
- Create: `apps/admin/src/http/public-pages-routes.ts`, `public-pages-routes.test.ts`
- Modify: `apps/admin/src/http/pages-routes.ts`, `pages-routes.test.ts`, `admin-routes.ts`
- Modify: `apps/admin/src/interfaces/online-store.admin-controller.ts`, `pages.admin-controller.ts`
- Modify: `apps/admin/src/composition.ts` (`publicReads.pages`)

**Interfaces:**

- Consumes: the controller methods of Tasks 4–6; `POLICY_TYPES`, `pageHandleOf`.
- Produces (spec 2.6 rows; exact paths, methods and permissions):

| Route                                        | Permission                     | Idempotent | Body / query                                                                    | Success                                                                                     |
| -------------------------------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /online-store/menus`                    | `online_store:read`            | —          | —                                                                               | 200 list                                                                                    |
| `GET /online-store/menus/:handle`            | `online_store:read`            | —          | `handle` ≤ 60                                                                   | 200 `MenuView`                                                                              |
| `POST /online-store/menus`                   | `online_store:manage_menus`    | yes        | `{ handle: string ≤ 60, title: string ≤ 400, items: unknown }` strict           | 201                                                                                         |
| `PUT /online-store/menus/:handle`            | `online_store:manage_menus`    | yes        | `{ title, items, expectedVersion }` strict                                      | 200                                                                                         |
| `DELETE /online-store/menus/:handle`         | `online_store:manage_menus`    | yes        | —                                                                               | 200 `{ handle }`                                                                            |
| `GET /online-store/link-targets`             | `online_store:read`            | —          | `type: collection\|product\|page\|policy`, `q?: string ≤ 100`                   | 200                                                                                         |
| `GET /online-store/policies`                 | `online_store:read`            | —          | —                                                                               | 200                                                                                         |
| `GET /online-store/policies/:type`           | `online_store:read`            | —          | `type` enum                                                                     | 200 `PolicyView`                                                                            |
| `PUT /online-store/policies/:type`           | `online_store:manage_policies` | yes        | `{ body: { ar?: string ≤ 120,000; en?: … }, expectedVersion }` strict           | 200                                                                                         |
| `POST /online-store/policies/:type/template` | `online_store:manage_policies` | **no**     | `{ locale: "ar"\|"en", inputs: unknown }` strict                                | 200 `{ body }`                                                                              |
| `PUT /pages/:pageId/content`                 | `pages:update_page`            | yes        | `{ title, body, metaDescription: localized ≤ 120,000, expectedVersion }` strict | 200 `{ pageId, version }`                                                                   |
| `GET /pages/:pageId`                         | `pages:read`                   | —          | —                                                                               | 200 `PageDto` (+ `title`, `body`, `metaDescription`, `publishedAt`, `version`, `updatedAt`) |
| `GET /pages`                                 | `pages:read`                   | —          | as today                                                                        | 200 page of `PageDto` **without** `body` (Ruling 17)                                        |
| `POST /pages`                                | `pages:create_page`            | yes        | today's body + optional `title`, `body`, `metaDescription`                      | 201                                                                                         |
| `GET /public/policies/:type`                 | public                         | —          | `type` enum                                                                     | 200 `{ type, body, updatedAt }` / 404                                                       |
| `GET /public/pages/:handle`                  | public                         | —          | `handle` `^[a-z0-9_-]{1,100}$`                                                  | 200 `{ handle, title, body, metaDescription, updatedAt }` / 404                             |
| `GET /public/pages`                          | public                         | —          | —                                                                               | 200 `{ pages: { handle, updatedAt }[] }`                                                    |

- `OnlineStoreAdminController` gains `listMenus`, `getMenu`, `searchLinkTargets`, `listPolicies`, `getPolicy` (`online_store:read`); `createMenu`, `updateMenu`, `deleteMenu` (`online_store:manage_menus`); `updatePolicy`, `generatePolicyTemplate` (`online_store:manage_policies`). `PagesAdminController.updatePageContent` (`pages:update_page`).
- `WiredAdmin.publicReads.pages: { readonly byHandle: (tenantId: string, handle: string) => Promise<ControllerResponse>; readonly list: (tenantId: string) => Promise<ControllerResponse> }` — closures over `pages.pages.publishedPageByPath({ routePath: \`/pages/${handle}\`, tenantId })`and`listPublishedPages({ tenantId })`.
- Public DTOs: the page's `title` falls back to `{ en: name }` when empty (Ruling 16); `updatedAt` is ISO or null; no `id`, `status`, `version`, `routePath` or tenant.

- [ ] **Step 1: Write the failing route tests**

In `online-store-routes.test.ts` (Part 1's `caller(app)` helper; a module-level `app` from `buildOnlineStoreApp`; `wired()` is `wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock })`, as the file's route-table test builds it):

```ts
describe("menus routes (spec 2.6)", () => {
  const call = caller(() => app);
  const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("viewers read; operators write; viewers are refused every write", async () => {
    expect((await call("viewer", "GET", "/online-store/menus")).statusCode).toBe(200);
    expect((await call("viewer", "GET", "/online-store/menus/main-menu")).statusCode).toBe(200);
    expect(
      (await call("viewer", "POST", "/online-store/menus", { handle: "v", title: "V", items: [] }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "POST", "/online-store/menus", {
          handle: "sale",
          title: "Sale",
          items: [],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call("operator", "PUT", "/online-store/menus/sale", {
          title: "S",
          items: [],
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/v1/online-store/menus/sale",
          headers: headersFor("viewer", idem()),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/v1/online-store/menus/sale",
          headers: headersFor("operator", idem()),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("the menu DTO carries no tenant and no internals", async () => {
    const res = await call("admin", "PUT", "/online-store/menus/main-menu", {
      title: "Main",
      expectedVersion: 0,
      items: [{ id: ID(1), label: { en: "Home" }, link: { type: "home" }, children: [] }],
    });
    expect(Object.keys(res.json()).sort()).toEqual([
      "handle",
      "id",
      "isDefault",
      "items",
      "title",
      "version",
    ]);
    expect(JSON.stringify(res.json())).not.toContain("t-1");
  });

  it("refuses unknown keys and a bad link-target type", async () => {
    expect(
      (
        await call("admin", "POST", "/online-store/menus", {
          handle: "a",
          title: "A",
          items: [],
          x: 1,
        })
      ).statusCode,
    ).toBe(422);
    expect((await call("viewer", "GET", "/online-store/link-targets?type=menu")).statusCode).toBe(
      422,
    );
    expect(
      (await call("viewer", "GET", `/online-store/link-targets?type=policy&q=${"a".repeat(101)}`))
        .statusCode,
    ).toBe(422);
  });
});

describe("policies routes (spec 2.6)", () => {
  const call = caller(() => app);
  it("operators save; viewers read and are refused writes; a bad type is refused", async () => {
    expect(
      (
        await call("viewer", "PUT", "/online-store/policies/refund", {
          body: { en: "x" },
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "PUT", "/online-store/policies/refund", {
          body: { en: "x" },
          expectedVersion: 0,
        })
      ).json(),
    ).toMatchObject({ type: "refund", version: 1 });
    expect((await call("viewer", "GET", "/online-store/policies/refund")).statusCode).toBe(200);
    expect((await call("viewer", "GET", "/online-store/policies/cookies")).statusCode).toBe(422);
  });

  it("the template route is not idempotent and stores nothing", async () => {
    const route = onlineStoreRoutes(wired()).find(
      (r) => r.path === "/online-store/policies/:type/template",
    );
    expect(route?.idempotent).not.toBe(true);
    const res = await call("operator", "POST", "/online-store/policies/shipping/template", {
      locale: "ar",
      inputs: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toContain("2");
    expect((await call("viewer", "GET", "/online-store/policies/shipping")).json().version).toBe(0);
  });

  it("an unsafe link is 422 UNSAFE_LINK on the locale's field", async () => {
    const res = await call("operator", "PUT", "/online-store/policies/terms", {
      body: { ar: "[x](javascript:alert(1))" },
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().fields).toEqual([{ field: "body.ar", message: "UNSAFE_LINK" }]);
  });
});
```

`public-pages-routes.test.ts` and additions to `public-online-store-routes.test.ts`:

```ts
describe("public content routes (spec 2.6)", () => {
  it("are the three public, non-idempotent rows", () => {
    const rows = [...publicPagesRoutes(admin), ...publicOnlineStoreRoutes(admin)]
      .filter((r) => r.path.startsWith("/public/pages") || r.path.startsWith("/public/policies"))
      .map((r) => [r.method, r.path, r.public, r.idempotent ?? false]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["GET", "/public/policies/:type", true, false],
        ["GET", "/public/pages/:handle", true, false],
        ["GET", "/public/pages", true, false],
      ]),
    );
  });

  it("a policy: 404 until set, then exactly type, body and updatedAt", async () => { … });

  it("a page: only published and under /pages/; the DTO leaks nothing", async () => {
    // create /pages/about (draft) and /landing (published) through the admin routes, publish about
    expect((await anon("/public/pages/landing")).statusCode).toBe(404);
    const res = await anon("/public/pages/about");
    expect(Object.keys(res.json()).sort()).toEqual(["body", "handle", "metaDescription", "title", "updatedAt"]);
    expect((await anon("/public/pages/About")).statusCode).toBe(422);
    expect((await anon("/public/pages")).json()).toEqual({ pages: [{ handle: "about", updatedAt: expect.any(String) }] });
  });

  it("another shop's page is a 404 (x-tenant-id t-2)", async () => { … });
});
```

In `pages-routes.test.ts`: "content update needs `pages:update_page`; the DTO gains the content fields and the version; the list omits body; create accepts content".

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/http/online-store-routes.test.ts src/http/public-online-store-routes.test.ts src/http/public-pages-routes.test.ts src/http/pages-routes.test.ts`
Expected: FAIL — 404s for the new routes.

- [ ] **Step 3: Implement the routes, controllers and `publicReads.pages`**

`updatePolicy` passes `by: context.principal.id` (as `publishTheme` does). zod shapes: `handleParams = z.object({ handle: z.string().min(1).max(60) })` (the domain decides the format); `typeParams = z.object({ type: z.enum(POLICY_TYPES) })`; `localizedBody = z.object({ ar: z.string().max(120_000).optional(), en: z.string().max(120_000).optional() }).strict()`; `linkTargetsQuery = z.object({ type: z.enum(["collection", "product", "page", "policy"]), q: z.string().max(100).optional() }).strict()`; `publicHandle = z.object({ handle: z.string().regex(/^[a-z0-9_-]{1,100}$/) })`. The template route has no `idempotent: true` (comment: pure, returns text, nothing to replay). `DELETE` uses the same `idempotent: true` as the other writes. Register `publicPagesRoutes(admin)` in `admin-routes.ts` next to `publicOnlineStoreRoutes`. `toPageDto` reads the new getters; `toPageListItemDto` omits `body`.

- [ ] **Step 4: Run, typecheck, lint, guard**

Run: `pnpm --filter @platform/admin test && pnpm --filter @platform/admin typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && node scripts/dev/check-prisma-tenant-where.mjs && cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`
Expected: PASS (the route contract still matches: admin-web calls nothing new yet).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/http apps/admin/src/interfaces/online-store.admin-controller.ts \
  apps/admin/src/interfaces/pages.admin-controller.ts apps/admin/src/composition.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): add menu, policy, page-content and public content routes

Guarded admin routes for menus, link targets, policies and templates, page content edits, and
anonymous reads of set policies and published /pages/* pages for the storefront.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Storefront — menus in the shell, header navigation, the mobile drawer, footer columns, `<RichText>` and `/pages/[handle]`

Model tier: **standard**.

**Files:**

- Modify: `apps/storefront/src/lib/online-store.ts`, `online-store.test.ts`
- Create: `apps/storefront/src/lib/shell-menus.ts`, `shell-menus.test.ts`
- Create: `apps/storefront/src/components/menu-link.tsx`, `site-nav.tsx`, `mobile-menu.tsx`, `mobile-menu.test.tsx`
- Modify: `apps/storefront/src/components/site-header.tsx`, `site-header.test.tsx`, `site-footer.tsx`, `site-footer.test.tsx`
- Create: `apps/storefront/src/components/rich-text.tsx`, `rich-text.test.tsx`
- Create: `apps/storefront/src/lib/content.ts`, `content.test.ts`
- Create: `apps/storefront/src/app/(store)/pages/[handle]/page.tsx`, `page.test.tsx`
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes: `ResolvedMenuItem`, `readResolvedMenu`, `PolicyType`, `isPolicyType`, `POLICY_TYPES`, `POLICY_TITLES`, `policyPath`, `parseRichText`, `renderRichText`, `RichTextTag`, `pickText`, `normalizeLocalizedText` (Tasks 1–2); `GET /public/online-store` (Task 6 shape), `GET /public/pages/:handle` (Task 7); Part 1's `withPreview`, `shellTag`, `currentShopId`, `RUNTIME_API_URL`, `getRequestShell`, `getRequestLocale`, `getPreviewToken`, `StatePanel`.
- Produces:
  - `StorefrontShell.header = { sticky: boolean; menu: readonly ResolvedMenuItem[] }`, `StorefrontShell.footer = { note: LocalizedText; showSocial: boolean; menu: readonly ResolvedMenuItem[]; policies: readonly PolicyType[] }`; `FALLBACK_SHELL` has empty menus and policies.
  - `lib/shell-menus.ts`: `interface MenuEntry { readonly label: string; readonly href: string; readonly external: boolean; readonly children: readonly MenuEntry[] }`; `menuEntries(menu: readonly ResolvedMenuItem[], locale: Locale): MenuEntry[]` (labels through `pickText`, unlabelled skipped); `footerColumns(menu, locale, linksTitle: string): { readonly title: string; readonly links: readonly MenuEntry[] }[]` (each top-level item with children is a column titled by it, holding its children; childless items gather in one trailing column titled `linksTitle`); `footerPolicyLinks(policies: readonly PolicyType[], menu: readonly ResolvedMenuItem[], locale: Locale): MenuEntry[]` (skips a policy whose `policyPath` the menu already links at either level, Ruling 12).
  - `<MenuLink entry previewToken className>` — internal `/…` → `next/link` with `withPreview`; `https:` → `<a target="_blank" rel="noopener noreferrer nofollow">`; `mailto:`/`tel:` → plain `<a>`. Label inside `<bdi dir="auto">`.
  - `<SiteNav entries previewToken label>` — server, `hidden md:block`; an entry with children is `<details>`/`<summary>` whose list starts with the parent's own link.
  - `<MobileMenu entries previewToken openLabel closeLabel title>` — `"use client"`, `md:hidden`; the only client component of this part.
  - `<RichText text className?>` — server; `renderRichText(parseRichText(text).document, createElement, PROSE_CLASSES)` inside a `<div>`.
  - `lib/content.ts`: `type ContentRead<T> = { status: "ok"; value: T } | { status: "not-found" } | { status: "error" }`; `PAGE_HANDLE = /^[a-z0-9_-]{1,100}$/`; `interface PolicyContent { type: PolicyType; body: LocalizedText; updatedAt: string | null }`; `interface PageContent { handle: string; title: LocalizedText; body: LocalizedText; metaDescription: LocalizedText; updatedAt: string | null }`; `getPolicy(type: PolicyType): Promise<ContentRead<PolicyContent>>`; `getPage(handle: string): Promise<ContentRead<PageContent>>`. Cached with `unstable_cache`: keys `["online-store", shopId, "policy", type]` / `["online-store", shopId, "page", handle]`, tag `shellTag(shopId)`, `revalidate: 60`; a 404 or failure throws inside the cached function (never stored, Ruling 4); 3 s timeout; bodies re-normalised (body ≤ 100,000 multiline, title ≤ 255, meta ≤ 320, updatedAt a valid ISO date or null).
  - Dictionary keys (both locales): `nav.menu`, `nav.closeMenu`, `footer.links`, `footer.policies`, `content.lastUpdated` (`{date}`), `content.unavailable`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/storefront/src/lib/online-store.test.ts`:

```ts
describe("menus in the shell (spec 2.6, 2.8)", () => {
  const withMenus = (header: unknown, footer: unknown) => ({
    ...liveBody,
    header: { sticky: false, menu: header },
    footer: {
      note: {},
      showSocial: true,
      menu: footer,
      policies: ["terms", "refund", "terms", "cookies"],
    },
  });

  it("re-validates every item: unsafe hrefs and empty labels go, external is recomputed", () => {
    const shell = parseShell(
      withMenus(
        [
          { label: { en: "Home" }, href: "/", external: true, children: [] },
          { label: { en: "X" }, href: "javascript:alert(1)", external: false, children: [] },
          { label: { en: "Evil" }, href: "//evil.example", external: false, children: [] },
          { label: { en: "Data" }, href: "data:text/html,x", external: false, children: [] },
          { label: { en: "Shop" }, href: "https://shop.example", external: false, children: [] },
        ],
        [],
      ),
      "live",
    );
    expect(shell?.header.menu).toEqual([
      { label: { en: "Home" }, href: "/", external: false, children: [] },
      { label: { en: "Shop" }, href: "https://shop.example/", external: true, children: [] },
    ]);
  });

  it("policies are the known ones, once each, in policy order", () => {
    expect(parseShell(withMenus([], []), "live")?.footer.policies).toEqual(["refund", "terms"]);
  });

  it("a shell without menus parses as empty menus (Review Focus 2)", () => {
    const shell = parseShell(liveBody, "live");
    expect(shell?.header.menu).toEqual([]);
    expect(shell?.footer).toMatchObject({ menu: [], policies: [] });
  });
});
```

`apps/storefront/src/lib/shell-menus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { footerColumns, footerPolicyLinks, menuEntries } from "./shell-menus";

const item = (label: Record<string, string>, href: string, children: unknown[] = []) =>
  ({ label, href, external: href.startsWith("https:"), children }) as never;

describe("menuEntries", () => {
  it("picks the locale, falls back to the other, skips an unlabelled item", () => {
    expect(
      menuEntries(
        [
          item({ ar: "الرئيسية", en: "Home" }, "/"),
          item({ ar: "تخفيضات" }, "/collections/sale"),
          item({}, "/x"),
        ],
        "en",
      ),
    ).toEqual([
      { label: "Home", href: "/", external: false, children: [] },
      { label: "تخفيضات", href: "/collections/sale", external: false, children: [] },
    ]);
  });
});

describe("footerColumns (spec 2.8)", () => {
  it("parents become columns; childless items gather under Links, last", () => {
    const columns = footerColumns(
      [
        item({ en: "Search" }, "/search"),
        item({ en: "Shop" }, "/collections/all", [item({ en: "Sale" }, "/collections/sale")]),
        item({ en: "About" }, "/pages/about"),
      ],
      "en",
      "Links",
    );
    expect(columns.map((c) => [c.title, c.links.map((l) => l.label)])).toEqual([
      ["Shop", ["Sale"]],
      ["Links", ["Search", "About"]],
    ]);
  });
});

describe("footerPolicyLinks (Ruling 12)", () => {
  it("skips policies the footer menu already links; titles come from POLICY_TITLES", () => {
    const links = footerPolicyLinks(
      ["refund", "privacy", "contact"],
      [item({ en: "Help" }, "/pages/help", [item({ en: "Returns" }, "/policies/refund-policy")])],
      "ar",
    );
    expect(links).toEqual([
      { label: "سياسة الخصوصية", href: "/policies/privacy-policy", external: false, children: [] },
      {
        label: "معلومات التواصل",
        href: "/policies/contact-information",
        external: false,
        children: [],
      },
    ]);
  });
});
```

Append to `site-header.test.tsx`:

```ts
describe("header navigation (spec 2.8)", () => {
  const shell = {
    ...FALLBACK_SHELL,
    header: {
      sticky: false,
      menu: [
        { label: { en: "Home", ar: "الرئيسية" }, href: "/", external: false, children: [] },
        {
          label: { en: "Shop" }, href: "/collections/all", external: false,
          children: [{ label: { en: "Sale" }, href: "/collections/sale", external: false, children: [] }],
        },
        { label: { en: "WhatsApp" }, href: "https://wa.me/20100", external: true, children: [] },
      ],
    },
  };

  it("desktop: links, a details dropdown for children, and safe external links", () => {
    render(<SiteHeader t={en} locale="en" shell={shell} previewToken={null} />);
    const nav = screen.getByRole("navigation", { name: en.nav.menu });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    const summary = within(nav).getByText("Shop").closest("summary");
    expect(summary?.parentElement?.tagName).toBe("DETAILS");
    expect(within(nav).getByRole("link", { name: "Sale" })).toHaveAttribute("href", "/collections/sale");
    const wa = within(nav).getByRole("link", { name: "WhatsApp" });
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("internal links keep the preview token; external ones never carry it", () => {
    render(<SiteHeader t={en} locale="en" shell={shell} previewToken={"T".repeat(43)} />);
    const nav = screen.getByRole("navigation", { name: en.nav.menu });
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("href")).toContain("preview=");
    expect(within(nav).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe("https://wa.me/20100");
  });

  it("Arabic labels render isolated; an empty menu renders no navigation", () => {
    render(<SiteHeader t={ar} locale="ar" shell={shell} previewToken={null} />);
    expect(screen.getAllByText("الرئيسية")[0]?.closest("bdi")).toHaveAttribute("dir", "auto");
    cleanup();
    render(<SiteHeader t={en} locale="en" shell={FALLBACK_SHELL} previewToken={null} />);
    expect(screen.queryByRole("navigation", { name: en.nav.menu })).toBeNull();
  });
});
```

`apps/storefront/src/components/mobile-menu.test.tsx`:

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileMenu } from "./mobile-menu";

const entries = [
  { label: "Home", href: "/", external: false, children: [] },
  { label: "Shop", href: "/collections/all", external: false,
    children: [{ label: "Sale", href: "/collections/sale", external: false, children: [] }] },
];

describe("MobileMenu (spec 2.8)", () => {
  it("opens and closes with the button and Escape, moving focus in and back", () => {
    render(<MobileMenu entries={entries} previewToken={null} openLabel="Open" closeLabel="Close" title="Menu" />);
    const trigger = screen.getByRole("button", { name: "Open" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("children are a nested disclosure; following a link closes the drawer", () => {
    render(<MobileMenu entries={entries} previewToken={null} openLabel="Open" closeLabel="Close" title="Menu" />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Shop").closest("summary")?.parentElement?.tagName).toBe("DETAILS");
    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing for an empty menu", () => {
    const { container } = render(
      <MobileMenu entries={[]} previewToken={null} openLabel="Open" closeLabel="Close" title="Menu" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to `site-footer.test.tsx` (and add `menu: [], policies: []` to its existing `footer` literals):

```ts
it("renders the menu as columns, then the policy links not already in the menu (spec 2.8)", () => {
  render(
    <SiteFooter
      t={en}
      locale="en"
      shell={{
        ...FALLBACK_SHELL,
        footer: {
          note: {}, showSocial: false,
          menu: [
            { label: { en: "Search" }, href: "/search", external: false, children: [] },
            { label: { en: "Returns" }, href: "/policies/refund-policy", external: false, children: [] },
          ],
          policies: ["refund", "privacy"],
        },
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  expect(screen.getAllByRole("link", { name: /Return|Refund/ })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/policies/privacy-policy");
});
```

`apps/storefront/src/components/rich-text.test.tsx`:

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RichText } from "./rich-text";

describe("<RichText> (spec 2.8)", () => {
  it("renders the allowed elements with dir=auto", () => {
    const { container } = render(
      <RichText text={"## Returns\n**14** days, [contact us](/pages/contact)\n- one\n---"} />,
    );
    expect([...container.querySelectorAll("*")].map((e) => e.tagName.toLowerCase())).toEqual(
      expect.arrayContaining(["h2", "p", "strong", "a", "ul", "li", "hr"]),
    );
    expect(container.querySelector("h2")).toHaveAttribute("dir", "auto");
    expect(container.querySelector("a")).toHaveAttribute("href", "/pages/contact");
  });

  it("hostile input is text: no script, no handler, no javascript href", () => {
    const { container } = render(
      <RichText text={'<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))'} />,
    );
    expect(container.querySelector("script, img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/href="javascript|onerror=/i);
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
```

`apps/storefront/src/lib/content.test.ts` (the `unstable_cache` and `headers` mocks of `online-store.test.ts`):

```ts
describe("content reads (spec 2.8, Rulings 3 and 4)", () => {
  it("a page is cached per shop and handle with the shop's tag", async () => {
    answer(200, {
      handle: "about",
      title: { en: "About" },
      body: { en: "Hi" },
      metaDescription: {},
      updatedAt: "2026-11-04T10:00:00.000Z",
    });
    expect(await getPage("about")).toMatchObject({
      status: "ok",
      value: { handle: "about", title: { en: "About" } },
    });
    expect(cacheCalls).toEqual([
      {
        keyParts: ["online-store", "shop-a", "page", "about"],
        tags: ["os:shop-a"],
        revalidate: 60,
      },
    ]);
  });

  it("two shops, two keys (Review Focus 5)", async () => {
    answer(200, pageBody);
    await getPage("about");
    requestHeaders.set("x-shop-id", "shop-b");
    await getPage("about");
    expect(cacheCalls.map((c) => c.keyParts[1])).toEqual(["shop-a", "shop-b"]);
  });

  it("a 404 is never cached; a failure is an error, never cached", async () => {
    answer(404, { code: "PAGE_NOT_FOUND" });
    expect(await getPage("nope")).toEqual({ status: "not-found" });
    answer(503, {});
    expect(await getPage("about")).toEqual({ status: "error" });
    expect(cacheOutcomes).toEqual(["threw", "threw"]);
  });

  it("a hostile body is re-normalised and capped", async () => {
    answer(200, {
      ...pageBody,
      title: { en: "t".repeat(300) },
      updatedAt: "not a date",
      body: { en: 5 },
    });
    const read = await getPage("about");
    expect(read.status === "ok" && read.value.title.en?.length).toBe(255);
    expect(read.status === "ok" && read.value.updatedAt).toBeNull();
    expect(read.status === "ok" && read.value.body).toEqual({});
  });

  it("a policy uses its own key, and the Runtime path is /public/policies/<type>", async () => {
    answer(200, { type: "refund", body: { ar: "نص" }, updatedAt: null });
    expect(await getPolicy("refund")).toMatchObject({ status: "ok", value: { type: "refund" } });
    expect(lastUrl()).toMatch(/\/api\/v1\/public\/policies\/refund$/);
    expect(cacheCalls[0]?.keyParts).toEqual(["online-store", "shop-a", "policy", "refund"]);
  });
});
```

(`answer(status, body)` sets the stubbed `fetch`'s next response; `lastUrl()` returns its last URL; host routing is on with `x-shop-id: shop-a`.)

`apps/storefront/src/app/(store)/pages/[handle]/page.test.tsx` (mock `@/lib/content`, `@/lib/request-locale`, and `next/navigation`'s `notFound` to throw `NOT_FOUND`):

```ts
it("a malformed handle is notFound without a read (Review Focus 5)", async () => {
  for (const handle of ["About", "a/b", "..", "a".repeat(101), "%2e%2e"]) {
    await expect(Page({ params: Promise.resolve({ handle }) })).rejects.toThrow("NOT_FOUND");
  }
  expect(content.getPage).not.toHaveBeenCalled();
});
it("a 404 read is notFound; a failed read is the unavailable panel", async () => { … });
it("renders the title as h1 (dir=auto) and the body through RichText; the other locale fills in", async () => { … });
it("metadata: '<title> | <store>', the meta description, nothing for a 404", async () => {
  // shell.storeName "Nour", page title { en: "About" }, meta { en: "Who we are" }
  expect(await generateMetadata({ params: Promise.resolve({ handle: "about" }) })).toEqual({
    title: { absolute: "About | Nour" },
    description: "Who we are",
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib src/components "src/app/(store)/pages"`
Expected: FAIL — missing modules, fields and route.

- [ ] **Step 3: Implement the shell, helpers and components**

- `parseShell`: `header.menu = readResolvedMenu(obj(o.header).menu)`, `footer.menu` likewise, `footer.policies = POLICY_TYPES.filter((type) => Array.isArray(raw) && raw.includes(type))`.
- `site-header.tsx`: compute `entries = menuEntries(shell.header.menu, locale)`. Mobile: the `MobileMenu` trigger sits at the inline start of the top row (`md:hidden`, before the logo). Desktop: a second row under the top row, `<SiteNav entries … label={t.nav.menu} />` (`hidden md:block`), horizontal, `gap-6`, wrapping; `<details>` uses `group` and `group-open:` utilities to rotate a `ChevronDownIcon`, the dropdown is `absolute start-0 top-full` with `min-w-48`, `z-40`, so it opens toward the inline end in both directions. No `SiteNav` and no trigger when `entries` is empty.
- `mobile-menu.tsx`: `useState(open)`; the panel is `role="dialog" aria-modal="true" aria-labelledby` a heading with `title`, `fixed inset-y-0 start-0 w-80 max-w-[85vw]`, with an overlay button behind it that closes; `useEffect` on open focuses the close button and adds a `keydown` listener for `Escape`; on close, focus returns to the trigger (`useRef`); a link click closes. Entries with children render `<details><summary>`.
- `site-footer.tsx`: between the note and the social row, a `grid gap-6 sm:grid-cols-2 md:grid-cols-4` of columns (`<h2 className="text-foreground text-sm font-medium">` title + `<ul>` of `MenuLink`s), then a `<nav aria-label={t.footer.policies}>` row of `footerPolicyLinks(...)` (`flex flex-wrap gap-x-4 gap-y-2`).
- `rich-text.tsx`: `PROSE_CLASSES` — `h2: "mt-8 mb-3 text-xl font-semibold"`, `h3: "mt-6 mb-2 text-lg font-semibold"`, `p: "my-3 leading-7"`, `ul: "my-3 list-disc ps-6"`, `ol: "my-3 list-decimal ps-6"`, `li: "my-1"`, `a: "text-primary underline underline-offset-4"`, `hr: "border-border my-8"`. Only the package renderer produces elements; no `dangerouslySetInnerHTML`.

- [ ] **Step 4: Implement `lib/content.ts` and the page route**

`fetchJson(path)` = `fetch(\`${RUNTIME_API_URL}/api/v1${path}\`, { headers: { "x-tenant-id": shopId }, cache: "no-store", signal: AbortSignal.timeout(3_000) })`. Inside the cached function: 200 with a usable body → the sanitised value; 404 → `throw new ContentNotFound()`; anything else (or a throw) → `throw new Error(...)`. Outside: `ContentNotFound`→`{ status: "not-found" }`, any other error → `{ status: "error" }`. `getPage`refuses a handle that fails`PAGE_HANDLE`with`not-found` before any read.

`app/(store)/pages/[handle]/page.tsx`: `params: Promise<{ handle: string }>`; `PAGE_HANDLE` check → `notFound()`; `getPage`; `not-found` → `notFound()`; `error` → `<StatePanel>` with `t.content.unavailable`; ok → `<main className="mx-auto w-full max-w-3xl px-4 py-10">` with `<h1 className="text-3xl font-semibold" dir="auto"><bdi>{title}</bdi></h1>` and `<RichText text={body} />` when a body exists. `generateMetadata` returns `{ title: { absolute: name === "" ? title : \`${title} | ${name}\` }, description? }`(Part 1's`metadataFor`strips`%`from the store name; do the same), and`{}` for a non-ok read.

- [ ] **Step 5: Dictionaries (Modern Standard Arabic)**

| Key                   | en                                                          | ar                                               |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `nav.menu`            | Menu                                                        | القائمة                                          |
| `nav.closeMenu`       | Close navigation                                            | إغلاق القائمة                                    |
| `footer.links`        | Links                                                       | روابط                                            |
| `footer.policies`     | Policies                                                    | السياسات                                         |
| `content.lastUpdated` | Last updated {date}                                         | آخر تحديث {date}                                 |
| `content.unavailable` | This page is unavailable right now. Please try again later. | هذه الصفحة غير متاحة الآن. يرجى المحاولة لاحقاً. |

- [ ] **Step 6: Run the storefront suite, typecheck and lint**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint`
Expected: PASS. `grep -rn "dangerouslySetInnerHTML" apps/storefront/src` prints nothing new.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/src/lib/online-store.ts apps/storefront/src/lib/online-store.test.ts \
  apps/storefront/src/lib/shell-menus.ts apps/storefront/src/lib/shell-menus.test.ts \
  apps/storefront/src/lib/content.ts apps/storefront/src/lib/content.test.ts \
  apps/storefront/src/components/menu-link.tsx apps/storefront/src/components/site-nav.tsx \
  apps/storefront/src/components/mobile-menu.tsx apps/storefront/src/components/mobile-menu.test.tsx \
  apps/storefront/src/components/site-header.tsx apps/storefront/src/components/site-header.test.tsx \
  apps/storefront/src/components/site-footer.tsx apps/storefront/src/components/site-footer.test.tsx \
  apps/storefront/src/components/rich-text.tsx apps/storefront/src/components/rich-text.test.tsx \
  "apps/storefront/src/app/(store)/pages" apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): render the shop's menus and its pages

Header menus with CSS-only dropdowns and a mobile drawer, footer columns with policy links, a
rich-text renderer over the shared parser, and /pages/<handle> read through a per-shop cache.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Storefront — the locked-reachable routes: `/policies/[handle]`, the locked view, `robots.txt` and `sitemap.xml`

Model tier: **strong** (the lock gate's exemptions).

**Files:**

- Modify: `apps/storefront/src/lib/locked-routes.ts`, `locked-routes.test.ts`
- Modify: `apps/storefront/src/middleware.ts`, `middleware.test.ts`
- Modify: `apps/storefront/src/lib/request-locale.ts`
- Create: `apps/storefront/src/components/locked-frame.tsx`
- Modify: `apps/storefront/src/app/(store)/layout.tsx`, `layout.test.tsx`, `apps/storefront/src/app/not-found.tsx`, `not-found.test.tsx`
- Create: `apps/storefront/src/app/(store)/policies/[handle]/page.tsx`, `page.test.tsx`
- Create: `apps/storefront/src/lib/site-origin.ts`, `site-origin.test.ts`, `apps/storefront/src/lib/sitemap.ts`, `sitemap.test.ts`
- Create: `apps/storefront/src/app/robots.ts`, `robots.test.ts`, `apps/storefront/src/app/sitemap.ts`, `sitemap.test.ts`
- Modify: `apps/storefront/src/lib/runtime-api.ts` (export `getProductsPage(after?: string)` and `getCollectionsPage(after?: string)` over the existing private `fetchPage`, `first: 100`)
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes: `policyTypeOfSlug`, `POLICY_SLUGS`, `POLICY_TITLES`, `policyPath`, `POLICY_TYPES` (Task 2); `getPolicy`, `RichText` (Task 8); `GET /public/pages` (Task 7); Part 1's `reachWhileLocked`, `getRequestShell`, `getRequestLocale`, `shellTag`, `currentShopId`.
- Produces:
  - `LOCKED_REACHABLE_ROUTES` = `^/policies/(refund-policy|shipping-policy|privacy-policy|terms-of-service|contact-information)$`, `^/robots\.txt$`, `^/sitemap\.xml$` (the policy alternation built from `POLICY_SLUGS`); `LOCKED_VIEW_HEADER = "x-morbeh-locked-view"`.
  - `getLockedView(): Promise<boolean>` in `request-locale.ts` (`cache`d; true only when the header is exactly `"1"`).
  - `<LockedFrame shell locale>{children}</LockedFrame>` — the store name, the page, and a "Enter using password" link to `/password`; no menus, search, cart, locale switch, footer or preview banner.
  - `siteOrigin(rawHost: string | null, nodeEnv: string | undefined): string | null` — `rawHost` lower-cased must match `/^[a-z0-9.-]+(:\d{1,5})?$/` with no `..`; `http://` only for `localhost`/`127.0.0.1` when `nodeEnv === "development"`, else `https://`.
  - `lib/sitemap.ts`: `SITEMAP_MAX_URLS = 5_000`, `SITEMAP_MAX_CALLS = 60`, `interface SitemapPath { readonly path: string; readonly lastModified?: string }`, `collectSitemapPaths(reads: SitemapReads): Promise<readonly SitemapPath[]>` (pure over injected reads), `getSitemapPaths(): Promise<readonly SitemapPath[]>` (cached: key `["online-store", shopId, "sitemap"]`, tag `shellTag(shopId)`, `revalidate: 3600`; a failure throws inside and is not stored); `interface SitemapReads { products(after?: string): Promise<Page<{ slug: string; status: string }> | null>; collections(after?: string): Promise<Page<{ slug: string; status: string }> | null>; pages(): Promise<readonly { handle: string; updatedAt: string | null }[] | null>; policy(type: PolicyType): Promise<ContentRead<{ readonly updatedAt: string | null }>> }` (a `null` page or list, or an `error` policy read, throws; a `not-found` policy is skipped).
  - `app/robots.ts` default export `robots(): Promise<MetadataRoute.Robots>`; `app/sitemap.ts` default export `sitemap(): Promise<MetadataRoute.Sitemap>`.
  - Dictionary: `locked.enter` ("Enter using password" / "الدخول بكلمة المرور"), `policies.lastUpdated` reuse `content.lastUpdated`.

- [ ] **Step 1: Write the failing tests**

Replace the Part 1 cases in `locked-routes.test.ts`:

```ts
describe("LOCKED_REACHABLE_ROUTES (Decision 34, Ruling 5)", () => {
  it("is exactly seven routes: the five policies, robots and the sitemap", () => {
    expect(LOCKED_REACHABLE_ROUTES).toHaveLength(3);
    for (const path of [
      "/policies/refund-policy",
      "/policies/shipping-policy",
      "/policies/privacy-policy",
      "/policies/terms-of-service",
      "/policies/contact-information",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(reachWhileLocked(path, "GET", LOCKED_REACHABLE_ROUTES), path).toBe("reachable");
      expect(reachWhileLocked(path, "POST", LOCKED_REACHABLE_ROUTES), path).toBe("forbidden");
    }
  });
  it("everything near them stays gated (Review Focus 1)", () => {
    for (const path of [
      "/policies/refund",
      "/policies/constructor",
      "/policies/__proto__",
      "/policies/refund-policy/",
      "/policies/Refund-Policy",
      "/policies/refund-policy/x",
      "/policies/..%2Fproducts%2Fx",
      "/policies/refund%2Dpolicy",
      "/policies",
      "/robots.txt/x",
      "/sitemap.xml.gz",
      "/sitemap-0.xml",
      "/password/x",
    ]) {
      expect(reachWhileLocked(path, "GET", LOCKED_REACHABLE_ROUTES), path).toBe("gated");
    }
  });
});
```

In `middleware.test.ts`, replace "paths with no real route yet are gated…" with:

```ts
it("the reachable routes pass a locked store for reads, marked as the locked view (Ruling 5)", async () => {
  access["shop-a"] = { locked: true, accessVersion: 1 };
  for (const path of ["/policies/refund-policy", "/robots.txt", "/sitemap.xml"]) {
    const res = await run(path);
    expect(res.headers.get("location"), path).toBeNull();
    expect(forwarded(res, "x-morbeh-locked-view"), path).toBe("1");
  }
  expect((await run("/policies/refund-policy", { method: "POST" })).status).toBe(403);
  expect((await run("/policies/refund")).status).toBe(302);
  expect((await run("/password/x")).status).toBe(302);
});

it("the locked view header is set only by the gate: stripped from clients, absent with access", async () => {
  const sent = { headers: { "x-morbeh-locked-view": "1" } };
  expect(forwarded(await run("/", sent), "x-morbeh-locked-view")).toBeNull(); // unlocked shop
  access["shop-a"] = { locked: true, accessVersion: 2 };
  vi.resetModules();
  const cookie = await cookieFor("shop-a", 2);
  expect(
    forwarded(await run("/policies/refund-policy", { ...sent, cookie }), "x-morbeh-locked-view"),
  ).toBeNull();
  expect(
    forwarded(await run(`/policies/refund-policy?preview=${TOKEN}`), "x-morbeh-locked-view"),
  ).toBeNull();
});
```

(`forwarded` reads `x-middleware-request-<name>`; when the header is deleted Next does not emit it, so `null`.) Also update the "look-alikes" case to keep `/policiesx/a` and `/robots.txt/x` at 302 (unchanged), and the "listed route allows only GET and HEAD" case to drop its `vi.doMock` (the real list now names the route).

`layout.test.tsx` and `not-found.test.tsx`:

```ts
it("a locked view renders LockedFrame, never StoreChrome (Review Focus 1)", async () => {
  request.lockedView = true;
  request.shell = { ...FALLBACK_SHELL, locked: true, storeName: "Nour" };
  const element = await StoreLayout({ children: <p>policy</p> });
  expect(isValidElement(element) && element.type === LockedFrame).toBe(true);
});
```

(the `@/lib/request-locale` mock gains `getLockedView`; the not-found test asserts the same for `NotFound()`, so a 404 under a reachable path never shows the chrome.)

`apps/storefront/src/app/(store)/policies/[handle]/page.test.tsx`:

```ts
it("unknown handles are notFound with no Runtime call (Ruling 7, Review Focus 1)", async () => {
  for (const handle of ["refund", "constructor", "__proto__", "toString", "../products/x", "Refund-Policy", ""]) {
    await expect(PolicyPage({ params: Promise.resolve({ handle }) })).rejects.toThrow("NOT_FOUND");
  }
  expect(content.getPolicy).not.toHaveBeenCalled();
});
it("a policy that is not set is notFound", async () => { content.getPolicy.mockResolvedValue({ status: "not-found" }); … });
it("renders the fixed title, the locale's last-updated date and the body", async () => {
  content.getPolicy.mockResolvedValue({ status: "ok", value: { type: "refund", body: { en: "## Returns\nWithin 14 days" }, updatedAt: "2026-11-04T10:00:00.000Z" } });
  render(await PolicyPage({ params: Promise.resolve({ handle: "refund-policy" }) }));
  expect(screen.getByRole("heading", { level: 1, name: "Refund policy" })).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Last updated ${new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date("2026-11-04T10:00:00.000Z"))}`))).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "Returns" })).toBeInTheDocument();
});
it("an Arabic-only body shows in English too; the title follows the locale", async () => { … });
it("metadata: '<policy> | <store>'", async () => {
  expect(await generateMetadata({ params: Promise.resolve({ handle: "terms-of-service" }) })).toEqual({
    title: { absolute: "Terms of service | Nour" },
  });
});
```

`site-origin.test.ts`:

```ts
it.each([
  ["shop.example", "production", "https://shop.example"],
  ["Shop.Example:8443", "production", "https://shop.example:8443"],
  ["localhost:3000", "development", "http://localhost:3000"],
  ["localhost:3000", "production", "https://localhost:3000"],
])("%s in %s → %s", (host, env, origin) => expect(siteOrigin(host, env)).toBe(origin));
it.each([
  null,
  "",
  "evil.example/x",
  "a b",
  "evil..example",
  "shop.example:99999999",
  "user@shop.example",
])("refuses %j", (host) => expect(siteOrigin(host as string | null, "production")).toBeNull());
```

`lib/sitemap.test.ts` (pure collector over fake reads):

```ts
it("home, search, published collections, listed products, pages and set policies (spec 2.8)", async () => {
  const paths = await collectSitemapPaths(
    reads({
      collections: [
        [
          { slug: "sale", status: "published" },
          { slug: "soon", status: "draft" },
        ],
      ],
      products: [
        [
          { slug: "lamp", status: "published" },
          { slug: "hidden", status: "unlisted" },
        ],
      ],
      pages: [{ handle: "about", updatedAt: "2026-11-01T00:00:00.000Z" }],
      policies: { refund: "2026-11-02T00:00:00.000Z" },
    }),
  );
  expect(paths).toEqual([
    { path: "/" },
    { path: "/search" },
    { path: "/collections/sale" },
    { path: "/products/lamp" },
    { path: "/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
    { path: "/policies/refund-policy", lastModified: "2026-11-02T00:00:00.000Z" },
  ]);
});
it("pages through products until the cap: 5,000 URLs, at most 60 Runtime calls", async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ slug: `p-${i}`, status: "published" }));
  const r = reads({ products: Array.from({ length: 80 }, () => many), endless: true });
  const paths = await collectSitemapPaths(r);
  expect(paths).toHaveLength(SITEMAP_MAX_URLS);
  expect(r.calls()).toBeLessThanOrEqual(SITEMAP_MAX_CALLS);
});
it("a failed read throws (the cached function stores nothing)", async () => {
  await expect(collectSitemapPaths(reads({ productsFail: true }))).rejects.toThrow();
});
```

`app/robots.test.ts` and `app/sitemap.test.ts` (mock `@/lib/request-locale` `getRequestShell`, `next/headers` `headers()` with a host, and `@/lib/sitemap` `getSitemapPaths`):

```ts
it("locked: Disallow everything and no sitemap line (Decision 35)", async () => {
  shell.locked = true;
  expect(await robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
});
it("unlocked: allow /, disallow the private paths, and point at the sitemap on this host", async () => {
  expect(await robots()).toEqual({
    rules: [{ userAgent: "*", allow: "/", disallow: ["/cart", "/checkout", "/account", "/c/", "/password"] }],
    sitemap: "https://shop.example/sitemap.xml",
  });
});
it("an invalid host gives no sitemap line", async () => { host = "evil.example/x"; … not.toHaveProperty("sitemap") });

it("sitemap: locked is empty and never reads (Decision 35)", async () => {
  shell.locked = true;
  expect(await sitemap()).toEqual([]);
  expect(getSitemapPaths).not.toHaveBeenCalled();
});
it("sitemap: absolute URLs on the request host, with lastModified where known", async () => {
  getSitemapPaths.mockResolvedValue([{ path: "/" }, { path: "/pages/about", lastModified: "2026-11-01T00:00:00.000Z" }]);
  expect(await sitemap()).toEqual([
    { url: "https://shop.example/" },
    { url: "https://shop.example/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
  ]);
});
it("sitemap: a failed read or an invalid host is empty, not an error", async () => { … });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/locked-routes.test.ts src/middleware.test.ts src/lib/site-origin.test.ts src/lib/sitemap.test.ts src/app`
Expected: FAIL.

- [ ] **Step 3: Implement the gate and the locked view**

- `locked-routes.ts`: the three regexes (policy slugs escaped and joined from `POLICY_SLUGS`), `LOCKED_VIEW_HEADER`, and the comment updated (no catch-all; why the list is exact).
- `middleware.ts`: `headers.delete(LOCKED_VIEW_HEADER)` beside the other two strips; in the locked branch, `if (reach === "reachable") { headers.set(LOCKED_VIEW_HEADER, "1"); return pass(null); }`. Nothing else changes.
- `request-locale.ts`: `getLockedView = cache(async () => (await headers()).get(LOCKED_VIEW_HEADER) === "1")`.
- `(store)/layout.tsx` and `not-found.tsx`: read `getLockedView()` first; when true render `<LockedFrame shell locale>{children}</LockedFrame>` (the not-found page puts its `StatePanel` inside) and skip `StoreChrome`.
- `locked-frame.tsx`: `<div className="flex min-h-dvh flex-col">` with a top bar (`<bdi dir="auto">` store name or `t.brand`, and a `Link` to `/password` labelled `t.locked.enter`), the children, and nothing else.

- [ ] **Step 4: Implement the policy route**

`app/(store)/policies/[handle]/page.tsx`: `const type = policyTypeOfSlug(handle)`; null → `notFound()`; `getPolicy(type)`; `not-found` → `notFound()`; `error` → `StatePanel` (`t.content.unavailable`); ok → `<main className="mx-auto w-full max-w-3xl px-4 py-10">`, `<h1 className="text-3xl font-semibold">{POLICY_TITLES[type][locale]}</h1>`, `<p className="text-muted-foreground mt-2 text-sm">` with `t.content.lastUpdated` and `Intl.DateTimeFormat(locale, { dateStyle: "long" })` when `updatedAt` is set, then `<RichText text={pickText(body, locale) ?? ""} />`. `generateMetadata`: `{ title: { absolute: \`${POLICY_TITLES[type][locale]} | ${name}\` } }`(just the policy title when the name is empty),`{}` for an unknown handle. The route has no server action.

- [ ] **Step 5: Implement robots and the sitemap**

- `robots.ts`: `const shell = await getRequestShell()`; locked → `{ rules: [{ userAgent: "*", disallow: "/" }] }`; else the unlocked rules, plus `sitemap: \`${origin}/sitemap.xml\``when`siteOrigin((await headers()).get("host"), process.env.NODE_ENV)` is not null.
- `lib/sitemap.ts`: `collectSitemapPaths` pushes `/` and `/search`; then collections (`status === "published"`), products (`status === "published"`), each paged while `pageInfo.hasNextPage` and a call budget of `SITEMAP_MAX_CALLS` remains and the list is under `SITEMAP_MAX_URLS`; then `/pages/<handle>` (from `GET /public/pages`, handles re-checked with `PAGE_HANDLE`); then each `POLICY_TYPES` whose `policy(type)` read is `ok`; every step is skipped once the list holds `SITEMAP_MAX_URLS`, and the result is cut there. A `null` list read or an `error` policy read throws. `getSitemapPaths` wraps it in `unstable_cache` with the real reads (`getProductsPage`, `getCollectionsPage`, a `GET /public/pages` fetch with the 3 s timeout, and `getPolicy` from Task 8).
- `app/sitemap.ts`: locked → `[]` without reading; else `getSitemapPaths()` (a throw → `[]`) mapped to `{ url: origin + path, lastModified? }`; an invalid origin → `[]`.

- [ ] **Step 6: Dictionaries**

`locked.enter`: "Enter using password" / "الدخول بكلمة المرور".

- [ ] **Step 7: Run the storefront suite, typecheck and lint**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint`
Expected: PASS. `find apps/storefront/src/app -name "[[]...*"` prints nothing (no catch-all route).

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/lib/locked-routes.ts apps/storefront/src/lib/locked-routes.test.ts \
  apps/storefront/src/middleware.ts apps/storefront/src/middleware.test.ts \
  apps/storefront/src/lib/request-locale.ts apps/storefront/src/components/locked-frame.tsx \
  "apps/storefront/src/app/(store)/layout.tsx" "apps/storefront/src/app/(store)/layout.test.tsx" \
  apps/storefront/src/app/not-found.tsx apps/storefront/src/app/not-found.test.tsx \
  "apps/storefront/src/app/(store)/policies" apps/storefront/src/lib/site-origin.ts \
  apps/storefront/src/lib/site-origin.test.ts apps/storefront/src/lib/sitemap.ts \
  apps/storefront/src/lib/sitemap.test.ts apps/storefront/src/app/robots.ts \
  apps/storefront/src/app/robots.test.ts apps/storefront/src/app/sitemap.ts \
  apps/storefront/src/app/sitemap.test.ts apps/storefront/src/lib/runtime-api.ts \
  apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): serve policies, robots and a sitemap, also while locked

The five policy URLs, robots.txt and sitemap.xml stay reachable on a locked store for reads
only and render without the shop's chrome; robots and the sitemap close up while locked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: admin-web — Online Store → Navigation (menu list, menu editor, link picker) and the theme's menu settings

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/lib/api/online-store.ts`, `online-store.test.ts`
- Create: `apps/admin-web/src/lib/online-store/menu-tree.ts`, `menu-tree.test.ts`
- Modify: `apps/admin-web/src/lib/online-store/save-errors.ts`, `save-errors.test.ts`
- Create: `apps/admin-web/src/app/online-store/navigation/page.tsx`, `new/page.tsx`, `[handle]/page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/components/online-store/menu-editor.tsx`, `menu-editor.test.tsx`, `menu-item-dialog.tsx`, `link-picker.tsx`, `link-picker.test.tsx`
- Modify: `apps/admin-web/src/components/online-store/customize-panels.tsx` (`FooterPanel`), `customize-editor.tsx` (`menus` prop), `customize-editor.test.tsx`, `apps/admin-web/src/app/online-store/themes/customize/page.tsx`
- Modify: `apps/admin-web/src/components/navigation.ts`, `navigation.test.tsx`, `apps/admin-web/src/middleware.ts`, `middleware.test.ts`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes: Task 7's routes; `MenuItem`, `LinkRef`, `LocalizedText`, `validateMenuItems`, `normalizeExternalUrl`, `isMenuHandle`, `POLICY_TITLES`, `isPolicyType`, `pickText`, `MENU_LIMITS` (type and value imports from the package are allowed in client components); Part 1's `getAdminApi`, `mutateAdminApi`, `newIdempotencyKey`, `LiveSaveState`, `saveErrorState`, `revalidateStorefront`, `LocalizedTextField`, `NativeSelect`, `Switch`, `Dialog*`.
- Produces:
  - `lib/api/online-store.ts`: `MenuSummaryDto`, `MenuItemViewDto` (`MenuItem` + `broken`, `targetTitle`, recursive `children`), `MenuDto`, `LinkTargetDto`, `type LinkTargetType = "collection" | "product" | "page" | "policy"`; `fetchMenus(): Promise<ApiResult<readonly MenuSummaryDto[]>>`, `fetchMenu(handle: string): Promise<ApiResult<MenuDto>>`, `createMenu(body: { handle: string; title: string; items: readonly MenuItem[] }, key: string): Promise<MutationResult<MenuDto>>`, `updateMenu(handle: string, body: { title: string; items: readonly MenuItem[]; expectedVersion: number }, key: string): Promise<MutationResult<MenuDto>>`, `deleteMenu(handle: string, key: string): Promise<MutationResult<{ handle: string }>>`, `searchLinkTargets(type: LinkTargetType, q: string): Promise<ApiResult<readonly LinkTargetDto[]>>`.
  - `lib/online-store/menu-tree.ts` (pure, client-safe): `type EditableItem = MenuItem & { readonly broken?: boolean; readonly targetTitle?: string | null; readonly children: readonly EditableItem[] }`; `addItem(items, item: EditableItem, parentId?: string): EditableItem[]` (a parent must be top-level; otherwise unchanged); `replaceItem(items, id, next: EditableItem): EditableItem[]`; `removeItem(items, id): EditableItem[]`; `moveItem(items, id, delta: -1 | 1): EditableItem[]` (within its own level, clamped); `toMenuItems(items): MenuItem[]` (drops `broken`/`targetTitle`).
  - `app/online-store/navigation/actions.ts` (`"use server"`): `saveMenuAction(input: { handle: string; title: string; items: readonly MenuItem[]; expectedVersion: number }): Promise<MenuSaveState>`, `createMenuAction(input: { handle: string; title: string; items: readonly MenuItem[] }): Promise<MenuSaveState>` (redirects to the new menu on success), `deleteMenuAction(handle: string): Promise<MenuSaveState>` (redirects to the list), `searchLinkTargetsAction(type: LinkTargetType, q: string): Promise<readonly LinkTargetDto[]>` (`[]` on failure); `type MenuSaveState = LiveSaveState | { readonly status: "success"; readonly menu: MenuDto; readonly liveDelayed?: true }`.
  - `FooterPanel` props gain `menus: readonly { handle: string; title: string }[]`; `CustomizeEditor` gains `menus` and passes it down.
  - `ONLINE_STORE_NAV.children` gains `{ id: "online-store-navigation", label: (t) => t.nav.navigation, href: "/online-store/navigation", Icon: MenuIcon }` after Pages; `ROUTE_ROLE_REQUIREMENTS` gains `["/online-store/navigation/new", "operator"]` (the rest is covered by `["/online-store", "viewer"]`).

- [ ] **Step 1: Write the failing tests**

`apps/admin-web/src/lib/online-store/menu-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addItem,
  moveItem,
  removeItem,
  replaceItem,
  toMenuItems,
  type EditableItem,
} from "./menu-tree";

const item = (id: string, children: EditableItem[] = []): EditableItem => ({
  id,
  label: { en: id },
  link: { type: "home" },
  children,
});

describe("menu tree (spec 2.7)", () => {
  it("adds at the top level, or under a top-level parent only", () => {
    const one = addItem([], item("a"));
    const two = addItem(one, item("b"), "a");
    expect(two[0]?.children.map((c) => c.id)).toEqual(["b"]);
    expect(addItem(two, item("c"), "b")).toEqual(two);
  });
  it("moves within a level and clamps at the ends", () => {
    const list = [item("a"), item("b"), item("c", [item("x"), item("y")])];
    expect(moveItem(list, "c", -1).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, "a", -1).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, "x", 1)[2]?.children.map((i) => i.id)).toEqual(["y", "x"]);
  });
  it("removing a parent removes its children; replace swaps one item", () => {
    const list = [item("a", [item("b")]), item("c")];
    expect(removeItem(list, "a").map((i) => i.id)).toEqual(["c"]);
    expect(replaceItem(list, "b", item("z"))[0]?.children[0]?.id).toBe("z");
  });
  it("toMenuItems strips the view-only fields", () => {
    expect(toMenuItems([{ ...item("a"), broken: true, targetTitle: "Sale" }])).toEqual([
      { id: "a", label: { en: "a" }, link: { type: "home" }, children: [] },
    ]);
  });
});
```

`apps/admin-web/src/app/online-store/navigation/actions.test.ts` (Part 1's mocking pattern from `preferences/actions.test.ts`; `next/navigation` `redirect` throws `REDIRECT:<to>`):

```ts
describe("menu actions", () => {
  it("save sends title, items and the version with one key, then revalidates the storefront", async () => {
    api.updateMenu.mockResolvedValue({ outcome: "ok", data: menuDto });
    const state = await saveMenuAction({ handle: "main-menu", title: "Main", items, expectedVersion: 2 });
    expect(api.updateMenu).toHaveBeenCalledWith("main-menu", { title: "Main", items, expectedVersion: 2 }, expect.any(String));
    expect(state).toEqual({ status: "success", menu: menuDto });
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
    expect(revalidate.revalidatePath).toHaveBeenCalledWith("/online-store/navigation");
  });
  it("a refused revalidation still saves, with liveDelayed", async () => { … });
  it("maps MENU_IN_USE, MENU_PROTECTED and VERSION_CONFLICT to their copy", async () => {
    api.deleteMenu.mockResolvedValue({ outcome: "conflict", message: "MENU_IN_USE: …" });
    expect(await deleteMenuAction("alt")).toEqual({ status: "error", message: en.onlineStoreNavigation.inUse, fieldErrors: {} });
  });
  it("maps an INVALID_URL item field to the web-address copy", async () => {
    api.updateMenu.mockResolvedValue({
      outcome: "invalid", message: "INVALID_CONTENT: …", fields: [{ field: "items.0.link.url", message: "INVALID_URL" }],
    });
    const state = await saveMenuAction({ handle: "footer", title: "F", items, expectedVersion: 1 });
    expect(state).toMatchObject({ fieldErrors: { "items.0.link.url": en.onlineStoreNavigation.urlError } });
  });
  it("create redirects to the new menu", async () => {
    api.createMenu.mockResolvedValue({ outcome: "ok", data: { ...menuDto, handle: "sale" } });
    await expect(createMenuAction({ handle: "sale", title: "Sale", items: [] })).rejects.toThrow("REDIRECT:/online-store/navigation/sale");
  });
  it("link-target search never throws: a failure is an empty list", async () => {
    api.searchLinkTargets.mockResolvedValue({ outcome: "error", message: "down" });
    expect(await searchLinkTargetsAction("collection", "sa")).toEqual([]);
  });
});
```

`apps/admin-web/src/components/online-store/menu-editor.test.tsx` (mock `@/app/online-store/navigation/actions`):

```ts
describe("MenuEditor (spec 2.7)", () => {
  it("adds an item through the dialog and saves the tree with the version", async () => {
    render(<MenuEditor t={en} locale="en" menu={footerMenu} canEdit />);
    await user.click(screen.getByRole("button", { name: en.onlineStoreNavigation.addItem }));
    await user.type(screen.getByLabelText(en.onlineStoreNavigation.labelEn), "Home");
    await user.selectOptions(screen.getByLabelText(en.onlineStoreNavigation.link), "home");
    await user.click(screen.getByRole("button", { name: en.onlineStoreNavigation.done }));
    expect(screen.getByText(en.onlineStoreNavigation.unsaved)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.onlineStoreNavigation.save }));
    expect(actions.saveMenuAction).toHaveBeenCalledWith({
      handle: "footer", title: footerMenu.title, expectedVersion: footerMenu.version,
      items: [...footerItems, { id: expect.any(String), label: { en: "Home" }, link: { type: "home" }, children: [] }],
    });
  });

  it("offers Add sub-item on top-level rows only, and Move up/Move down by keyboard", async () => { … });

  it("shows the broken badge on a removed target", () => {
    render(<MenuEditor t={en} locale="en" menu={{ ...footerMenu, items: [{ ...footerItems[0]!, broken: true, targetTitle: null }] }} canEdit />);
    expect(screen.getByText(en.onlineStoreNavigation.broken)).toBeInTheDocument();
  });

  it("refuses an unsafe web address inline, in the admin's language", async () => {
    render(<MenuEditor t={ar} locale="ar" menu={footerMenu} canEdit />);
    await user.click(screen.getByRole("button", { name: ar.onlineStoreNavigation.addItem }));
    await user.selectOptions(screen.getByLabelText(ar.onlineStoreNavigation.link), "url");
    await user.type(screen.getByLabelText(ar.onlineStoreNavigation.webAddress), "javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: ar.onlineStoreNavigation.done }));
    expect(screen.getByText("مسموح بلينكات https:// و mailto: و tel: بس")).toBeInTheDocument();
  });

  it("Discard restores the saved tree; a viewer sees it read-only", async () => { … });
});
```

`apps/admin-web/src/components/online-store/link-picker.test.tsx`:

```ts
it("searches the chosen kind and picks a result", async () => {
  actions.searchLinkTargetsAction.mockResolvedValue([{ id: "c-1", title: "Sale", subtitle: "/collections/sale" }]);
  const onChange = vi.fn();
  render(<LinkPicker t={en} locale="en" value={{ type: "home" }} onChange={onChange} />);
  await user.selectOptions(screen.getByLabelText(en.onlineStoreNavigation.link), "collection");
  await user.type(screen.getByRole("searchbox"), "sa");
  await user.click(await screen.findByRole("option", { name: /Sale/ }));
  expect(actions.searchLinkTargetsAction).toHaveBeenLastCalledWith("collection", "sa");
  expect(onChange).toHaveBeenLastCalledWith({ type: "collection", id: "c-1" });
});
it("policies show the shop's language titles", async () => {
  actions.searchLinkTargetsAction.mockResolvedValue([{ id: "refund", title: "Refund policy", subtitle: "/policies/refund-policy" }]);
  render(<LinkPicker t={ar} locale="ar" value={{ type: "home" }} onChange={vi.fn()} />);
  await user.selectOptions(screen.getByLabelText(ar.onlineStoreNavigation.link), "policy");
  expect(await screen.findByRole("option", { name: /سياسة الاسترجاع/ })).toBeInTheDocument();
});
```

Additions: `lib/api/online-store.test.ts` (each new function's path, method and guard; `deleteMenu` is `DELETE /api/v1/online-store/menus/<encoded handle>` with a key; `searchLinkTargets` encodes `q`); `customize-editor.test.tsx` ("the header and footer menu selects list the shop's menus and write `menuHandle`; Show policy links writes `showPolicyLinks`"); `navigation.test.tsx` (Navigation sits after Pages); `middleware.test.ts` (the existing "viewers reach every sidebar link" case now covers Navigation; add: a viewer is refused `/online-store/navigation/new`, an operator reaches it); `save-errors.test.ts` (the new codes map to copy).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter admin-web exec vitest run src/lib/online-store src/lib/api/online-store.test.ts src/app/online-store/navigation src/components/online-store src/components/navigation.test.tsx src/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the API client, tree helpers, actions and error copy**

- API functions follow Part 1's `fetchPreferences`/`updatePreferences` (shape guards; `encodeURIComponent(handle)`; `searchLinkTargets` builds `?type=&q=` with `URLSearchParams`).
- `save-errors.ts`: `invalidCopy` gains `LABEL_REQUIRED`, `MENU_TOO_DEEP`, `TOO_MANY_ITEMS`, `DUPLICATE_ITEM_ID`, `INVALID_LINK`, `MENU_TOO_LARGE`, `INVALID_HANDLE`, `TITLE_REQUIRED`, and `INVALID_URL` → `onlineStoreNavigation.urlError` when the field ends in `.link.url` (keep Part 1's social-URL copy for other fields); `conflictCopy` gains `MENU_PROTECTED`, `MENU_IN_USE`, `MENU_HANDLE_TAKEN`, `MENU_LIMIT`.
- Actions: one `newIdempotencyKey()` per call; on success `revalidatePath("/online-store/navigation")` (and the menu's own path), then `revalidateStorefront()` → `liveDelayed` when false; `createMenuAction` and `deleteMenuAction` `redirect` after revalidating.

- [ ] **Step 4: Implement the screens and components**

- `/online-store/navigation` (server, `AppShell activeNavId="online-store-navigation"`): `fetchMenus()`; a `Table` (title — for `isDefault && id === null` the localized `defaultMain`/`defaultFooter` name —, items summary = `topLabels` through `pickText` joined with ", " or `noItems`, and a link to `/online-store/navigation/<handle>`); **Add menu** for operators and admins (`highestRole(session.roles)` as in Part 1's customize page).
- `/online-store/navigation/new`: `MenuEditor` with `menu={null}` (handle and title fields shown; handle checked with `isMenuHandle` and not `new` before submit).
- `/online-store/navigation/[handle]`: `fetchMenu(handle)`; `not_found` → the Part 1 not-found panel pattern; `MenuEditor` with `canEdit = role !== "viewer"`.
- `MenuEditor` (`"use client"`): state `title`, `items: EditableItem[]`, `saved` snapshot for **Discard**; rows (`<ul>` with nested `<ul>` for children) show `pickText(label)` (both labels in `<bdi dir="auto">`), the target chip (`targetTitle` or the link kind; a `Badge variant="destructive"` with `broken` copy when `broken`), and buttons **Edit**, **Add sub-item** (top level only), **Move up**/**Move down** (disabled at the ends, `aria-label` with the item's label), **Delete**. The save bar ("Unsaved changes", **Discard**, **Save**) appears when the state differs from `saved`; Save calls `saveMenuAction` (or `createMenuAction` for a new menu) and on success replaces `saved` and the items with the returned `MenuDto` (fresh broken flags); a 409 shows the message and keeps the edits. Delete menu (non-default, existing) asks `window.confirm` then calls `deleteMenuAction`. A client-side `validateMenuItems(toMenuItems(items))` disables Save and lists issues before a request is sent.
- `MenuItemDialog`: label ar/en (`Input`, `dir="auto"`, max 60), `LinkPicker`, and for `url` a web-address input checked with `normalizeExternalUrl` on **Done** (inline `urlError`); requires one label (`labelRequired`). New items get `crypto.randomUUID()`.
- `LinkPicker`: a `NativeSelect` labelled `link` with options `home`, `search`, `collection`, `product`, `page`, `policy`, `url` (labelled by the group names); for the four searchable kinds a `type="search"` input and a `role="listbox"` of `role="option"` buttons filled by `searchLinkTargetsAction(type, q)` on each change (the latest response wins: keep a request counter); policy options show `POLICY_TITLES[id][locale]`; the current target shows as a chip.
- `FooterPanel`: before the sticky switch, a `NativeSelect` "Header menu" bound to `doc.header.menuHandle`; after the social switch, "Footer menu" bound to `doc.footer.menuHandle` and a `Switch` "Show policy links" bound to `doc.footer.showPolicyLinks`. Options are `menus` plus the current value when it is missing from the list.
- `themes/customize/page.tsx`: `fetchMenus()` in the same `Promise.all`; on failure pass the two defaults.

- [ ] **Step 5: Dictionaries (admin-web Arabic is Egyptian)**

`nav.navigation`: "Navigation" / "القوائم". New `onlineStoreNavigation`:

| Key                            | en                                                                | ar                                                                |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `title`                        | Navigation                                                        | القوائم                                                           |
| `subtitle`                     | Menus for your store's header and footer.                         | قوايم الهيدر والفوتر في متجرك.                                    |
| `addMenu`                      | Add menu                                                          | إضافة قائمة                                                       |
| `defaultMain`                  | Main menu                                                         | القائمة الرئيسية                                                  |
| `defaultFooter`                | Footer menu                                                       | الفوتر                                                            |
| `columnMenu` / `columnItems`   | Menu / Menu items                                                 | القائمة / العناصر                                                 |
| `noItems`                      | No items                                                          | مفيش عناصر                                                        |
| `handle` / `handleHelp`        | Handle / Lower-case letters, numbers and hyphens.                 | المعرّف / حروف إنجليزي صغيرة وأرقام وشرطة بس.                     |
| `menuTitle`                    | Title                                                             | العنوان                                                           |
| `addItem` / `addSubItem`       | Add menu item / Add sub-item                                      | إضافة عنصر / إضافة عنصر فرعي                                      |
| `edit` / `delete` / `done`     | Edit / Delete / Done                                              | تعديل / حذف / تمام                                                |
| `moveUp` / `moveDown`          | Move {label} up / Move {label} down                               | طلّع {label} لفوق / نزّل {label} لتحت                             |
| `labelAr` / `labelEn`          | Label (Arabic) / Label (English)                                  | الاسم (عربي) / الاسم (إنجليزي)                                    |
| `link`                         | Link                                                              | الرابط                                                            |
| `kinds.home` … `kinds.url`     | Home, Search, Collections, Products, Pages, Policies, Web address | الرئيسية، البحث، المجموعات، المنتجات، الصفحات، السياسات، رابط ويب |
| `webAddress`                   | Web address                                                       | رابط الويب                                                        |
| `searchPlaceholder`            | Search…                                                           | دوّر…                                                             |
| `urlError`                     | Only https://, mailto: and tel: links are allowed                 | مسموح بلينكات https:// و mailto: و tel: بس                        |
| `labelRequired`                | Write the label in Arabic or English.                             | اكتب الاسم بالعربي أو الإنجليزي.                                  |
| `broken`                       | Link target removed                                               | الرابط اتشال                                                      |
| `unsaved` / `discard` / `save` | Unsaved changes / Discard / Save                                  | في تغييرات مش متسجلة / تجاهل / حفظ                                |
| `deleteMenu` / `confirmDelete` | Delete menu / Delete this menu? This can't be undone.             | حذف القائمة / تحذف القائمة دي؟ مش هتعرف ترجعها.                   |
| `protected`                    | The main menu and the footer can't be deleted.                    | القائمة الرئيسية والفوتر مينفعش يتحذفوا.                          |
| `inUse`                        | Your theme uses this menu. Pick another menu in the theme first.  | الثيم بيستخدم القائمة دي. اختار قائمة تانية في الثيم الأول.       |
| `taken`                        | A menu with this handle already exists.                           | فيه قائمة بنفس المعرّف.                                           |
| `limit`                        | You've reached 50 menus.                                          | وصلت لـ 50 قائمة.                                                 |
| `tooDeep`                      | A sub-item can't have its own sub-items.                          | العنصر الفرعي مينفعش يبقى ليه عناصر فرعية.                        |
| `tooMany`                      | A menu holds up to 30 items per level and 150 in all.             | القائمة تشيل لحد 30 عنصر في كل مستوى و150 في المجموع.             |
| `readOnly`                     | You can view menus but not change them.                           | تقدر تشوف القوايم بس مش تعدّلها.                                  |

`onlineStoreCustomize` gains `headerMenu` ("Header menu" / "قائمة الهيدر"), `footerMenu` ("Footer menu" / "قائمة الفوتر"), `showPolicyLinks` ("Show policy links" / "إظهار روابط السياسات"). The `en`/`ar` parity test (`lib/i18n.test.ts`) must stay green.

- [ ] **Step 6: Run, typecheck, lint, route contract, client-bundle grep**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, then `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`, then the client-bundle grep (Commands).
Expected: PASS; the grep prints only the three known hits.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/lib/api/online-store.ts apps/admin-web/src/lib/api/online-store.test.ts \
  apps/admin-web/src/lib/online-store apps/admin-web/src/app/online-store/navigation \
  apps/admin-web/src/components/online-store/menu-editor.tsx \
  apps/admin-web/src/components/online-store/menu-editor.test.tsx \
  apps/admin-web/src/components/online-store/menu-item-dialog.tsx \
  apps/admin-web/src/components/online-store/link-picker.tsx \
  apps/admin-web/src/components/online-store/link-picker.test.tsx \
  apps/admin-web/src/components/online-store/customize-panels.tsx \
  apps/admin-web/src/components/online-store/customize-editor.tsx \
  apps/admin-web/src/components/online-store/customize-editor.test.tsx \
  apps/admin-web/src/app/online-store/themes/customize/page.tsx \
  apps/admin-web/src/components/navigation.ts apps/admin-web/src/components/navigation.test.tsx \
  apps/admin-web/src/middleware.ts apps/admin-web/src/middleware.test.ts \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add online store navigation and the theme's menu settings

A menu list and a two-level menu editor with a link picker over the shop's collections,
products, pages and policies, and header/footer menu choices in the customize editor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: admin-web — the Morbeh text editor, Settings → Policies and the page editor

Model tier: **standard**.

**Files:**

- Modify: `apps/admin-web/src/lib/api/online-store.ts`, `online-store.test.ts` (policies, template), `apps/admin-web/src/lib/api/pages.ts`, create `pages.test.ts`
- Create: `apps/admin-web/src/lib/online-store/markup.ts`, `markup.test.ts`
- Create: `apps/admin-web/src/components/online-store/rich-text-editor.tsx`, `rich-text-editor.test.tsx`, `rich-text-preview.tsx`, `policy-card.tsx`, `policy-template-dialog.tsx`, `policy-template-dialog.test.tsx`
- Create: `apps/admin-web/src/app/settings/policies/page.tsx`, `actions.ts`, `actions.test.ts`; Modify: `apps/admin-web/src/app/settings/page.tsx`
- Create: `apps/admin-web/src/lib/pages/route-path.ts`, `route-path.test.ts`; Modify: `apps/admin-web/src/lib/pages-lifecycle.ts`, `pages-lifecycle.test.ts`
- Create: `apps/admin-web/src/components/pages/page-content-form.tsx`, `page-content-form.test.tsx`, `apps/admin-web/src/app/pages/actions.test.ts`
- Modify: `apps/admin-web/src/app/pages/page.tsx`, `new/page.tsx`, `[pageId]/page.tsx`, `actions.ts`, `apps/admin-web/src/components/pages/page-create-form.tsx`, `pages-table.tsx`, `page-lifecycle-actions.tsx`
- Modify: `apps/admin-web/src/middleware.ts`, `middleware.test.ts`, `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes: Task 7's routes; `parseRichText`, `renderRichText`, `validateRichText`, `RICH_TEXT_MAX`, `POLICY_TYPES`, `POLICY_TITLES`, `policyPath`, `pickText`, `LocalizedText`; Part 1's `LocalizedTextField`, `saveErrorState`, `revalidateStorefront`, `fetchPreferences`; `fetchStoreSettings` (`lib/api/store-settings.ts`).
- Produces:
  - `lib/api/online-store.ts`: `PolicySummaryDto { type: PolicyType; set: boolean; locales: ("ar" | "en")[]; updatedAt: string | null }`, `PolicyDto { type; body: LocalizedText; updatedAt: string | null; version: number }`, `PolicyTemplateInputsDto` (the Task 5 shape); `fetchPolicies()`, `fetchPolicy(type)`, `updatePolicy(type, body: { body: LocalizedText; expectedVersion: number }, key)`, `generatePolicyTemplate(type, body: { locale: "ar" | "en"; inputs: PolicyTemplateInputsDto }): Promise<MutationResult<{ body: string }>>` (**no** idempotency key).
  - `lib/api/pages.ts`: `PageDto` gains `title`, `metaDescription` (`LocalizedText`), `body?: LocalizedText` (absent on list items, Ruling 17), `publishedAt`, `updatedAt` (`string | null`), `version: number`; `CreatePageInput` gains optional `title`, `body`, `metaDescription`; `updatePageContent(pageId, body: { title: LocalizedText; body: LocalizedText; metaDescription: LocalizedText; expectedVersion: number }, key): Promise<MutationResult<{ pageId: string; version: number }>>`.
  - `lib/online-store/markup.ts`: `type MarkupKind = "h2" | "h3" | "bold" | "italic" | "bullets" | "numbers" | "link"`; `applyMarkup(text: string, selection: { start: number; end: number }, kind: MarkupKind): { text: string; selection: { start: number; end: number } }`.
  - `<RichTextEditor t locale name label value max disabled errors onChange>` (`"use client"`): ar/en tabs, each with **Write**/**Preview**, the toolbar, a counter, and local issues from `validateRichText` ("Line N: …").
  - `<RichTextPreview text>`: `renderRichText(parseRichText(text).document, createElement, ADMIN_PROSE_CLASSES)`.
  - `app/settings/policies/actions.ts`: `savePolicyAction(type: PolicyType, input: { body: LocalizedText; expectedVersion: number }): Promise<LiveSaveState & { version?: number }>`, `generatePolicyTemplateAction(type: PolicyType, locale: "ar" | "en", inputs: PolicyTemplateInputsDto): Promise<{ status: "ok"; body: string } | { status: "error"; message: string }>`.
  - `app/pages/actions.ts` gains `savePageContentAction(pageId: string, input: { title: LocalizedText; body: LocalizedText; metaDescription: LocalizedText; expectedVersion: number }): Promise<LiveSaveState & { version?: number }>`; `createPageAction` reads `title.ar`, `title.en`, `body.ar`, `body.en`, `routePath` and sends `name` = the first non-empty title; `advancePageAction` also calls `revalidateStorefront()`.
  - `lib/pages/route-path.ts`: `routePathFromTitle(title: LocalizedText, random?: () => string): string` (Ruling 19), `isStorefrontPagePath(path: string): boolean` (`/^\/pages\/[a-z0-9_-]+$/`).
  - `PAGE_LIFECYCLE_TRANSITIONS.published = ["draft", "archived"]` (hand copy of Ruling 15).
  - `ROUTE_ROLE_REQUIREMENTS` gains `["/settings/policies", "viewer"]`; Settings index lists Policies; Online Store → Pages links "Store policies".

- [ ] **Step 1: Write the failing tests**

`apps/admin-web/src/lib/online-store/markup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyMarkup } from "./markup";

describe("applyMarkup (spec 2.7 toolbar)", () => {
  it("bold and italic wrap the selection and keep it selected", () => {
    expect(applyMarkup("a big sale", { start: 2, end: 5 }, "bold")).toEqual({
      text: "a **big** sale",
      selection: { start: 4, end: 7 },
    });
    expect(applyMarkup("x", { start: 0, end: 1 }, "italic").text).toBe("*x*");
  });
  it("headings prefix the current line; lists prefix every selected line", () => {
    expect(applyMarkup("one\ntwo", { start: 5, end: 5 }, "h2").text).toBe("one\n## two");
    expect(applyMarkup("a\nb\nc", { start: 0, end: 3 }, "bullets").text).toBe("- a\n- b\nc");
    expect(applyMarkup("a\nb", { start: 0, end: 3 }, "numbers").text).toBe("1. a\n2. b");
  });
  it("link wraps the selection and selects the url placeholder", () => {
    const out = applyMarkup("call us", { start: 0, end: 7 }, "link");
    expect(out.text).toBe("[call us](https://)");
    expect(out.text.slice(out.selection.start, out.selection.end)).toBe("https://");
  });
});
```

`apps/admin-web/src/components/online-store/rich-text-editor.test.tsx`:

```ts
it("reports an unsafe link with its line, in the admin's language (Ruling 9)", async () => {
  render(<Harness t={ar} locale="ar" initial={{ ar: "سطر\n[x](javascript:alert(1))" }} />);
  expect(screen.getByText(/سطر 2/)).toBeInTheDocument();
});
it("the Preview tab renders headings and links as the storefront does", async () => {
  render(<Harness t={en} locale="en" initial={{ en: "## Returns\n[Contact](/pages/contact)" }} />);
  await user.click(screen.getByRole("tab", { name: en.richText.preview }));
  expect(screen.getByRole("heading", { level: 2, name: "Returns" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/pages/contact");
});
it("the toolbar inserts Morbeh text at the selection", async () => { … bold button → value contains "**" … });
it("counts characters against the limit and flags TOO_LONG", async () => { … max 10, 11 chars → tooLong copy … });
it("hostile text in Preview is text, never markup", async () => {
  render(<Harness t={en} locale="en" initial={{ en: "<img src=x onerror=alert(1)>" }} />);
  await user.click(screen.getByRole("tab", { name: en.richText.preview }));
  expect(document.querySelector("img")).toBeNull();
});
```

`apps/admin-web/src/components/online-store/policy-template-dialog.test.tsx`:

```ts
it("generates into the chosen locale, shows the reminder, and never saves", async () => {
  actions.generatePolicyTemplateAction.mockResolvedValue({ status: "ok", body: "## Returns\n…" });
  const onGenerated = vi.fn();
  render(<PolicyTemplateDialog t={en} locale="en" type="refund" defaults={defaults} open onOpenChange={vi.fn()} onGenerated={onGenerated} />);
  expect(screen.getByLabelText(en.policies.returnWindow)).toHaveValue(14);
  await user.selectOptions(screen.getByLabelText(en.policies.templateLocale), "ar");
  await user.click(screen.getByRole("button", { name: en.policies.generate }));
  expect(actions.generatePolicyTemplateAction).toHaveBeenCalledWith("refund", "ar", expect.objectContaining({ returnWindowDays: 14, storeName: "Nour" }));
  expect(onGenerated).toHaveBeenCalledWith("ar", "## Returns\n…");
  expect(actions.savePolicyAction).not.toHaveBeenCalled();
});
```

And in a `PolicyCard` case: after generating into a tab that already has text, the card asks `window.confirm(replaceConfirm)` first, and then shows the reminder "This is a starting template, not legal advice. Review it for your business." above the editor (Egyptian: "ده نموذج مبدئي مش استشارة قانونية — راجعه حسب نشاطك").

`apps/admin-web/src/app/settings/policies/actions.test.ts`:

```ts
it("save sends the body and the version with one key, then revalidates the storefront", async () => {
  api.updatePolicy.mockResolvedValue({ outcome: "ok", data: { type: "refund", body: {}, updatedAt: null, version: 2 } });
  expect(await savePolicyAction("refund", { body: { ar: "نص" }, expectedVersion: 1 })).toEqual({ status: "success", version: 2 });
  expect(api.updatePolicy).toHaveBeenCalledWith("refund", { body: { ar: "نص" }, expectedVersion: 1 }, expect.any(String));
  expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
});
it("UNSAFE_LINK and TOO_LONG land on the locale's field", async () => { … fieldErrors["body.en"] === en.richText.unsafeLinkSaved … });
it("the template action sends no idempotency key and returns the text", async () => {
  api.generatePolicyTemplate.mockResolvedValue({ outcome: "ok", data: { body: "x" } });
  expect(await generatePolicyTemplateAction("shipping", "en", inputs)).toEqual({ status: "ok", body: "x" });
  expect(api.generatePolicyTemplate).toHaveBeenCalledWith("shipping", { locale: "en", inputs });
});
```

`apps/admin-web/src/lib/pages/route-path.test.ts`:

```ts
it("slugifies a Latin title; an Arabic-only title gets page-<random> (Ruling 19)", () => {
  expect(routePathFromTitle({ en: "About Us!  2026" })).toBe("/pages/about-us-2026");
  expect(routePathFromTitle({ ar: "من نحن", en: "" }, () => "k3x9")).toBe("/pages/page-k3x9");
  expect(routePathFromTitle({ en: "a".repeat(80) })).toBe(`/pages/${"a".repeat(60)}`);
  expect(isStorefrontPagePath("/pages/about")).toBe(true);
  expect(isStorefrontPagePath("/landing")).toBe(false);
});
```

`apps/admin-web/src/app/pages/actions.test.ts`:

```ts
it("create sends the title as the name, the content and the route path in one call", async () => { … });
it("saving content sends the version with one key and revalidates the storefront", async () => { … });
it("publishing or hiding a page revalidates the storefront", async () => { … });
it("VERSION_CONFLICT and PAGE_ARCHIVED map to their copy", async () => { … });
```

`apps/admin-web/src/components/pages/page-content-form.test.tsx`:

```ts
it("labels a page outside /pages/ as not on the storefront, and links a published one", () => { … });
it("offers Hide for a published page and Publish for a draft (Ruling 15)", () => { … });
it("is read-only for a viewer", () => { … });
```

`middleware.test.ts`: a viewer reaches `/settings/policies` and is still refused `/settings/general`; `pages-lifecycle.test.ts`: published → `["draft", "archived"]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter admin-web exec vitest run src/lib src/components/online-store src/components/pages src/app/settings src/app/pages src/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the API client, markup helpers, editor and preview**

- API functions in Part 1's style; `generatePolicyTemplate` passes no `idempotencyKey` (like `issuePreviewToken`); `updatePageContent` is `PUT /api/v1/pages/<id>/content`.
- `RichTextEditor` keeps the `LocalizedTextField` tab pattern (both locales mounted) with a `Textarea` (`dir="auto"`, `rows={16}`), a toolbar of seven icon buttons with `aria-label`s that call `applyMarkup` on the textarea's selection and restore it, a Write/Preview `Tabs` per locale, the counter (`Intl.NumberFormat(locale)`), and issues from `validateRichText(text, max)`: `TOO_LONG` → `richText.tooLong`, each `UNSAFE_LINK` → `richText.unsafeLink` with `{line}`. Server field errors (`body.ar`) show under their tab.
- `RichTextPreview`: `ADMIN_PROSE_CLASSES` equal to the storefront's `PROSE_CLASSES` (Task 8); no `dangerouslySetInnerHTML`.

- [ ] **Step 4: Implement Settings → Policies**

- `page.tsx` (server, `AppShell activeNavId="settings"`): `fetchPolicies()` and the five `fetchPolicy(type)` reads in parallel; `fetchPreferences()` for the store name; `fetchStoreSettings()` for the contact email (a non-ok result leaves it blank, Ruling 20); `highestRole` → `canEdit`. One `PolicyCard` per type with `POLICY_TITLES[type][locale]` as the title, "Set"/"Not set", "Last updated" and a "View on store" link (`STOREFRONT_URL` + `policyPath(type)`) when set.
- `PolicyCard` (`"use client"`): `RichTextEditor` over the body, **Create from template** (opens `PolicyTemplateDialog`), **Save** (`savePolicyAction` with the card's `version`, updated from the answer). A template result fills the chosen locale's tab (after `window.confirm(policies.replaceConfirm)` when it has text) and shows the reminder until the next save.
- `PolicyTemplateDialog`: inputs (store name, email, phone/WhatsApp, address, return window days, who pays return shipping, refund method, cash on delivery, delivery min/max days, ships outside the country) initialised from `defaults` (14, customer, original payment, COD yes, 2–5, no), a locale select, **Generate**; an `error` result shows its message.
- `settings/page.tsx`: append `{ href: "/settings/policies", Icon: ScrollTextIcon, title: (t) => t.settingsPage.policiesTitle, body: (t) => t.settingsPage.policiesBody }`.
- `middleware.ts`: `["/settings/policies", "viewer"]`.

- [ ] **Step 5: Implement the page editor**

- `/pages/new`: `PageCreateForm` becomes title (`LocalizedTextField`, max 255), content (`RichTextEditor`), and an editable "Page address" prefilled by `routePathFromTitle` until the merchant edits it; it posts to `createPageAction`. Hidden fields `templateRef` etc. are dropped from this form (still accepted by the API).
- `/pages/[pageId]`: header with `pickText(page.title) ?? page.name`, status badge, the route path, a "Not on your storefront" badge when `!isStorefrontPagePath(routePath)`, a "View on store" link (`STOREFRONT_URL` + route path) when published and served; `PageContentForm` (title, content, "Search engine listing" meta description, Save with `page.version`); `PageLifecycleActions` shows **Publish** (draft), **Hide** (published → draft), **Archive**, through the hand-copied table. The refs card moves under a collapsed `<details>` "Advanced".
- `/pages`: the table shows the title (fallback name) and the "Not on your storefront" badge; a "Store policies" button links `/settings/policies`.
- `actions.ts`: `savePageContentAction` per Interfaces (`revalidatePath("/pages/<id>")`, `revalidateStorefront()`); `advancePageAction` also calls `revalidateStorefront()`; error states through `saveErrorState` (`VERSION_CONFLICT`, `PAGE_ARCHIVED` → their copy, `UNSAFE_LINK`/`TOO_LONG` fields).

- [ ] **Step 6: Dictionaries (admin-web Arabic is Egyptian)**

| Key                                                                                                                                                                                                                                                             | en                                                                                                                                                                                                                                                                                                                          | ar                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `richText.write` / `preview`                                                                                                                                                                                                                                    | Write / Preview                                                                                                                                                                                                                                                                                                             | اكتب / معاينة                                                                                                                                                                                                                                                                                |
| `richText.h2` … `link`                                                                                                                                                                                                                                          | Heading, Subheading, Bold, Italic, Bulleted list, Numbered list, Link                                                                                                                                                                                                                                                       | عنوان، عنوان فرعي، عريض، مائل، قائمة نقط، قائمة أرقام، لينك                                                                                                                                                                                                                                  |
| `richText.unsafeLink`                                                                                                                                                                                                                                           | Line {line}: this link isn't allowed. Use https://, mailto:, tel: or a link that starts with /.                                                                                                                                                                                                                             | سطر {line}: اللينك ده مش مسموح. استخدم https:// أو mailto: أو tel: أو لينك بيبدأ بـ /.                                                                                                                                                                                                       |
| `richText.unsafeLinkSaved`                                                                                                                                                                                                                                      | A link here isn't allowed.                                                                                                                                                                                                                                                                                                  | فيه لينك هنا مش مسموح.                                                                                                                                                                                                                                                                       |
| `richText.tooLong`                                                                                                                                                                                                                                              | Too long: {count} of {max} characters.                                                                                                                                                                                                                                                                                      | طويل زيادة: {count} من {max} حرف.                                                                                                                                                                                                                                                            |
| `policies.title` / `subtitle`                                                                                                                                                                                                                                   | Policies / Your store's legal pages. Customers see them at the bottom of every page.                                                                                                                                                                                                                                        | السياسات / الصفحات القانونية لمتجرك. العملاء بيشوفوها تحت في كل صفحة.                                                                                                                                                                                                                        |
| `policies.set` / `notSet`                                                                                                                                                                                                                                       | Set / Not set                                                                                                                                                                                                                                                                                                               | متضافة / مش متضافة                                                                                                                                                                                                                                                                           |
| `policies.lastUpdated`                                                                                                                                                                                                                                          | Last updated {date}                                                                                                                                                                                                                                                                                                         | آخر تعديل {date}                                                                                                                                                                                                                                                                             |
| `policies.createFromTemplate`                                                                                                                                                                                                                                   | Create from template                                                                                                                                                                                                                                                                                                        | إنشاء من نموذج                                                                                                                                                                                                                                                                               |
| `policies.reminder`                                                                                                                                                                                                                                             | This is a starting template, not legal advice. Review it for your business.                                                                                                                                                                                                                                                 | ده نموذج مبدئي مش استشارة قانونية — راجعه حسب نشاطك                                                                                                                                                                                                                                          |
| `policies.replaceConfirm`                                                                                                                                                                                                                                       | Replace the text in this tab with the template?                                                                                                                                                                                                                                                                             | تستبدل النص اللي في التاب ده بالنموذج؟                                                                                                                                                                                                                                                       |
| `policies.generate` / `templateLocale`                                                                                                                                                                                                                          | Generate / Template language                                                                                                                                                                                                                                                                                                | إنشاء / لغة النموذج                                                                                                                                                                                                                                                                          |
| `policies.storeName`, `email`, `phone`, `address`, `returnWindow`, `returnShipping`, `returnShippingCustomer`, `returnShippingStore`, `refundMethod`, `refundOriginal`, `refundStoreCredit`, `refundCash`, `cod`, `deliveryMin`, `deliveryMax`, `international` | Store name, Contact email, Phone / WhatsApp, Business address, Return window (days), Who pays return shipping, The customer, The store, Refund method, Original payment method, Store credit, Cash (cash on delivery orders), Cash on delivery offered, Delivery from (days), Delivery to (days), Ships outside the country | اسم المتجر، إيميل التواصل، التليفون / واتساب، عنوان النشاط، مدة الإرجاع (بالأيام)، مين يدفع شحن الإرجاع، العميل، المتجر، طريقة رد الفلوس، نفس وسيلة الدفع، رصيد في المتجر، كاش (لطلبات الدفع عند الاستلام)، الدفع عند الاستلام متاح، التوصيل من (أيام)، التوصيل لحد (أيام)، بنشحن برّه البلد |
| `policies.viewOnStore`                                                                                                                                                                                                                                          | View on store                                                                                                                                                                                                                                                                                                               | شوفها في المتجر                                                                                                                                                                                                                                                                              |
| `settingsPage.policiesTitle` / `policiesBody`                                                                                                                                                                                                                   | Policies / Refund, shipping, privacy, terms and contact pages.                                                                                                                                                                                                                                                              | السياسات / صفحات الاسترجاع والشحن والخصوصية والشروط والتواصل.                                                                                                                                                                                                                                |
| `pageEditor.title`, `content`, `seo`, `metaDescription`, `address`, `notOnStorefront`, `viewOnStore`, `hide`, `advanced`, `storePolicies`                                                                                                                       | Title, Content, Search engine listing, Meta description, Page address, Not on your storefront, View on store, Hide, Advanced, Store policies                                                                                                                                                                                | العنوان، المحتوى، الظهور في محركات البحث، الوصف، عنوان الصفحة، مش ظاهرة في متجرك، شوفها في المتجر، إخفاء، إعدادات متقدمة، سياسات المتجر                                                                                                                                                      |

- [ ] **Step 7: Run, typecheck, lint, route contract, client-bundle grep**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, then `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`, then the client-bundle grep.
Expected: PASS; only the three known grep hits; `grep -rn "dangerouslySetInnerHTML" apps/admin-web/src/components/online-store apps/admin-web/src/components/pages` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/lib/api/online-store.ts apps/admin-web/src/lib/api/online-store.test.ts \
  apps/admin-web/src/lib/api/pages.ts apps/admin-web/src/lib/api/pages.test.ts \
  apps/admin-web/src/lib/online-store/markup.ts apps/admin-web/src/lib/online-store/markup.test.ts \
  apps/admin-web/src/lib/online-store/save-errors.ts apps/admin-web/src/lib/pages \
  apps/admin-web/src/lib/pages-lifecycle.ts apps/admin-web/src/lib/pages-lifecycle.test.ts \
  apps/admin-web/src/components/online-store/rich-text-editor.tsx \
  apps/admin-web/src/components/online-store/rich-text-editor.test.tsx \
  apps/admin-web/src/components/online-store/rich-text-preview.tsx \
  apps/admin-web/src/components/online-store/policy-card.tsx \
  apps/admin-web/src/components/online-store/policy-template-dialog.tsx \
  apps/admin-web/src/components/online-store/policy-template-dialog.test.tsx \
  apps/admin-web/src/app/settings/policies apps/admin-web/src/app/settings/page.tsx \
  apps/admin-web/src/app/pages apps/admin-web/src/components/pages \
  apps/admin-web/src/middleware.ts apps/admin-web/src/middleware.test.ts \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add settings policies and the page content editor

A morbeh text editor with a toolbar, preview and line-level link errors, the five policies
with ar/en starting templates, and page title, content and search listing with publish/hide.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 11)

- [ ] `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/online-store test && pnpm --filter @platform/pages test && pnpm --filter @platform/catalog test && pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
- [ ] `pnpm --filter @platform/admin test` and `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`
- [ ] `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint`
- [ ] `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, and `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`
- [ ] `pnpm typecheck` at the root (turbo) — every package green.
- [ ] `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` — valid. **No `migrate`, no `db push`, no SQL.**
- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` — exactly the one known finding (`discounts.admin-controller.ts:166`).
- [ ] Client-bundle grep (Commands) — only the three known pre-existing hits.
- [ ] `grep -rn "dangerouslySetInnerHTML" apps/storefront/src apps/admin-web/src/components/online-store apps/admin-web/src/components/pages` — nothing.
- [ ] `grep -rn "موربيه" apps packages services` — nothing. Invisible-character check over every file the tasks wrote — nothing.
- [ ] `find apps/storefront/src/app -name "[[]...*"` — nothing (no catch-all route).
- [ ] `git log --oneline b9afe058..HEAD` — eleven task commits; `git status` clean except `.superpowers/`/`.claude/` (never staged).
- [ ] Owed to the browser pass (as Part 1's: `next build` fails here with `EPERM`): header menu and drawer at 320/375/1280 px in ar and en (RTL dropdown direction, wide logos with a menu), footer columns, a locked store's `/policies/refund-policy` without chrome, `/robots.txt` and `/sitemap.xml` locked and unlocked, the menu editor and the policy editor's preview.
- [ ] Owner hand-off note (in the PR description, not code): deploy `20261027010000_online_store_content` from Railway's Console BEFORE this release (it adds two tables and four `pages.pages` columns); provision the Kafka topic `pages.page.draft.v1` (Ruling 15); no new secret or environment variable; no new permission string (Ruling 1).

## Self-review (done while writing this plan)

**1. Spec coverage (Part 2).** 2.1 rich text (syntax, links, limits, linear parser, one validator in API/editor/storefront) → Task 1 (+ Tasks 5, 4 for the API, 8 for the storefront, 11 for the editor). 2.2 menus (model, depth and counts, no loops, virtual defaults, resolution by id, broken targets, link-target picker, theme `menuHandle`/`showPolicyLinks`, live on save) → Tasks 2, 3, 6, 7, 10. 2.3 policies (types, URLs, titles, not-set 404, one-locale fallback, last updated, templates with inputs, escaping, MSA, editor reminder, 14 days) → Tasks 2, 3, 5, 7, 9, 11. 2.4 pages (title/body/meta/publishedAt, `UpdatePageContent` on draft and published, `GetPublishedPageByPath`, `ListPublishedPages`, `/pages/<handle>` via route path, "Not on your storefront", derived route path) → Tasks 3, 4, 7, 8, 11. 2.5 migration (verbatim, RLS, `pages.pages` policy verified and re-asserted) → Task 3. 2.6 API (all 16 rows) → Tasks 5–7. 2.7 admin-web (Navigation list and editor, link combobox, URL errors, broken badge, save bar, Settings → Policies with tabs/toolbar/preview/template dialog, middleware override, Settings index entry, page editor and new page, customize menu selects) → Tasks 10, 11. 2.8 storefront (header dropdown and drawer, footer columns and policy row, policy and page routes with metadata and caching, `<RichText>`, robots, sitemap) → Tasks 8, 9. 2.9 testing → each task's tests. Permissions → Ruling 1. Security (content, locked store, tenant scoping, concurrency) → Global Constraints + Tasks 1–9. Knowingly not done: hreflang and `services/seo` consumption (spec non-goals); scroll restore and section bodies (Part 3).

**2. Step scan.** No "TBD"/"similar to". Where a test is sketched with `…` (route permission matrices, panels), the named assertions and the neighbouring full test fix its content; every algorithm the signatures leave open (the parser, the shell resolution, the sitemap budget, the template substitution) is spelled out.

**3. Type consistency.** `ResolvedMenuItem` (Task 2) is what `PublicShellView` carries (Task 6), what `readResolvedMenu` re-reads (Task 2) and what `StorefrontShell` holds (Task 8). `LinkTargetsPort.resolve`/`search` (Task 6) ⇄ `onlineStoreLinkTargets` (Task 6) ⇄ `SearchLinkTargets` (Task 6) ⇄ `GET /online-store/link-targets` (Task 7) ⇄ `searchLinkTargets` (Task 10). `PolicyView`/`{ type, body, updatedAt }` (Task 5) ⇄ `PolicyDto` (Task 11) and `PolicyContent` (Task 8). `UpdatePageContent` → `{ pageId, version }` (Task 4) ⇄ `PUT /pages/:pageId/content` (Task 7) ⇄ `updatePageContent` (Task 11). `MenuView` (Task 6) ⇄ `MenuDto` (Task 10). `PAGE_HANDLE` (Task 8) matches the public route's handle regex (Task 7) and `pageHandleOf` (Task 4). `LOCKED_VIEW_HEADER` is set in middleware and read by `getLockedView` (Task 9).

**4. Review Focus.** Each of the five lines is pinned by named tests in its owning task (Tasks 9; 6 and 8; 2 and 6; 6 and 3; 8). The spec's own Review Focus items for Part 2 are covered too: XSS in rich text (Task 1 corpus and property test, Task 8 `<RichText>`, Task 11 preview), menu loops and abuse (Task 2 validator, Task 6 deleted target), locked store and bots (Task 9), cross-shop leakage (Tasks 3, 4, 6, 8 keys and isolation suites), bilingual gaps (Tasks 5 and 8 one-locale fallback), middleware exemptions (Task 9).

**5. Proportion.** The plan carries the spec's decisions, the rulings, the tests as code and the fixed copy (templates and dictionaries); implementation bodies appear only for the migration, the Prisma models and the template text.
