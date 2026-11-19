# Online Store — Part 1: Store Identity and the Storefront Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant brands the storefront (logo, favicon, six colours, two fonts, corners, social links, footer note) as a previewable draft that an admin publishes, sets the home title, description, share image and default language live, and can lock the shop behind a password; the storefront renders every page inside one shell (header, footer, metadata, per-shop CSS) driven by that data, cached per shop and revalidated on save.

**Architecture:** A new pure package `@platform/storefront-content` holds the theme-document types, the strict validator, colour/contrast rules, the font map and `brandToCssVars`; the same code runs in the API, admin-web and the storefront. A new bounded context `services/online-store` (Postgres schema `online_store`, five RLS-forced tables) owns preferences, the access lock, the theme (draft + published + 20 releases) and hashed preview tokens; every repository takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`. `services/media` gains a per-purpose `UploadImage` (logo, favicon, share image, section image) next to the unchanged product upload. `apps/admin` wires the context with closure-only cross-context adapters, a guarded `OnlineStoreAdminController`, admin routes, and `publicReads.onlineStore` closures behind three public routes (shell, access, rate-limited unlock). The storefront moves its pages into `app/(store)/` under a shell layout, adds `app/(gate)/password`, a middleware lock gate with an HMAC unlock cookie, `?preview=` handling, `unstable_cache` per shop with an `os:<shopId>` tag, and `POST /api/revalidate`. admin-web adds Online Store → Themes (current theme, release history, full-screen customize editor with autosave and live preview) and Online Store → Preferences.

**Tech Stack:** TypeScript, Prisma 6 / PostgreSQL (hand-written SQL migration, RLS), zod routes on `@platform/http` (Fastify), Vitest, Next.js 15 App Router + React 19 (admin-web and storefront), Tailwind v4 (logical utilities), `@testing-library/react`, Web Crypto (HMAC in Edge middleware), `@fontsource/*` (self-hosted fonts).

**Spec:** `docs/superpowers/specs/2026-10-27-online-store-customization-design.md` — Part 1 (§1.1–§1.13), "Where the code lives", "Permissions (all parts)", "Global constraints", "Anti-goals", "Security and multi-tenancy", "Review Focus", "Delivery order", Decisions 1–36. Read the spec and this plan together. The branch `morbeh/storefront-customization` sits on `origin/main` `d6196c48` (HEAD `4a8e63e6`, the spec commit), so the spec's "reset the branch" step is already done; Project 1 and Project 3 are not merged, so nothing here may assume their code (no `checkout_links`, no `/c/<token>` route, no sidebar-guard test).

## Rulings (decided on the owner's behalf; the spec is silent, ambiguous, or wrong against the code)

The owner delegated every decision. Each ruling is binding for the tasks that follow.

1. **No branch reset.** The branch already sits on `origin/main` (`d6196c48`); Projects 1 and 3 are unmerged. Part 1 is built on this base; their later merges reconcile the expected overlaps (storefront `messages/*`, `runtime-api.ts`, admin-web `navigation.ts`, `middleware.ts`, the role-table test, `seed-ory-network.mjs`).
2. **Preview tokens copy Plan 1C, not Project 3.** `checkout_links` does not exist on this base. The token shape copies `services/security/src/application/password-reset.ts` (`randomBytes(32).toString("base64url")`, `sha256` hex at rest). The spec's unique index on `token_hash` alone is kept (a 256-bit hash cannot collide across shops); lookups still filter by `tenantId` in the `where`.
3. **The 40-megapixel rule applies to the four new purposes only.** The spec says "for every purpose" and also "no behaviour change to the existing `POST /media/uploads`" (anti-goal). The anti-goal wins: `purpose: "product"` keeps today's exact outcomes. A pixel cap for products is a later, separately reviewed change.
4. **Radius overrides go through `--shop-radius-*`.** `@platform/design` declares `--radius-*` inside `@theme inline`, so Tailwind compiles `rounded-xl` to a literal `16px` and a runtime `--radius-xl` override does nothing. The storefront's own `globals.css` re-declares the radius scale as `@theme inline { --radius-xl: var(--shop-radius-xl, 16px); … }`; `brandToCssVars` emits `--shop-radius-*`. admin-web is untouched.
5. **The brand accent does not overwrite `--accent`.** In `@platform/design`, `--accent` is the neutral hover wash every dropdown and nav row uses. The merchant's accent pair is emitted as `--brand-accent` / `--brand-accent-foreground` (badges, sale, announcement); `--accent` is derived from background and foreground.
6. **The brand stylesheet is emitted only for a branded shop.** `PublicShellDto` gains `branded: boolean` (true in preview, or when a published document exists). An unbranded shop gets no `<style id="brand">`, keeps `ThemeToggle` and dark mode, and looks exactly as today (including Geist for Latin text and 14 px body). A branded shop renders light-only (`ThemeProvider forcedTheme="light"`, toggle hidden). The selector is `:root:root:root` so it beats `.dark` and `:root:lang(ar)` regardless of stylesheet order.
7. **Unpublished-changes is a content comparison.** `hasUnpublishedChanges = canonical(draft) !== canonical(published ?? DEFAULT_THEME_DOCUMENT)`, where `canonical` re-reads through the package reader (Postgres JSONB reorders keys). Publishing with no change is 409 `NOTHING_TO_PUBLISH`. Discard sets the draft to the live document (or the default) and still bumps `draftRevision`, so a publish bound to the discarded revision fails `DRAFT_CHANGED`.
8. **Revisions and versions.** No row ⇒ `version: 0`, `draftRevision: 0`. The first write inserts with `version: 1` (and `draft_revision: 1` for the theme). Every later write is a guarded `updateMany … where version = expected`, `version +1`. A lost race (0 rows, or a primary-key collision on the insert) throws `ConcurrencyError` inside the unit of work (rollback), and the use case answers 409 `VERSION_CONFLICT`.
9. **Error codes travel in the envelope.** `services/online-store` builds every 409/404/422 message as `"CODE: text"`; its presenter copies `CODE` into `body.code`. Field-level validation issues carry the code as the field message (`{ field: "brand.colors.primary", message: "INVALID_COLOR" }`). admin-web reads the `CODE:` prefix because `MutationResult` "conflict" only carries the message.
10. **Password field semantics.** `password` omitted, `null` or blank ⇒ keep the current hash. There is no "remove password" action (unlocking is the off switch). The hash is computed **before** the unit of work (scrypt is slow and must not hold a transaction open).
11. **Dummy-hash timing.** `VerifyStorefrontPassword` verifies against the stored hash, or against a dummy hash minted once per process with the same hasher (`hasher.hash("morbeh-unlock-dummy")`, memoised promise), so wrong password, no lock and no hash cost the same.
12. **`publishedByName` is `null` in Part 1.** This base has no staff-directory name read (`IdentityDirectoryPort` only answers `exists`). Releases store the principal id; admin-web shows "Staff" / "فريق العمل".
13. **Closures only across contexts.** The cross-context adapters (`online-store.adapters.ts`) are object literals of arrow functions that capture the tenancy and media controllers. No adapter holds a reference to `TenancyController`, so the tenant-mode guard never walks tenancy's pinned internals under the `onlineStore` key. A guard test asserts no failure path starts with `onlineStore` or `publicReads`.
14. **Store name stays pinned.** `StoreIdentityPort` reads `tenancy.getPublicStore()` and `ShopHostPort` reads `tenancy.listShopDomains({ shopId })`, both under the ADR-0014 8f exemption, exactly as the spec's "what stays pinned" says. No new pinned read.
15. **Preview is view-only by middleware.** Every `POST` carrying `?preview=` is refused with 403 in middleware, locked or not. (Next server actions post to the current URL, so a preview page's actions carry the parameter.) The language switch is therefore also disabled in preview. In addition, `AddToCartButton` is disabled and `/cart` and `/checkout` render "Not available in preview".
16. **Preview navigation.** Shell links (header, footer) go through `href(path)`; a client `PreviewLinkKeeper` (preview only) intercepts clicks on same-origin anchors in the capture phase and does a full navigation with `?preview=` appended (Next `<Link>` navigation would otherwise drop it); the header search form carries a hidden `preview` input.
17. **No scroll restore across reloads in Part 1.** The preview iframe is cross-origin, so its scroll position cannot be read; the editor reloads the iframe with `&v=<draftRevision>`. Part 3's postMessage channel adds focus and scroll.
18. **admin-web CSP gains `frame-src 'self' https: <STOREFRONT_URL origin>`.** Today `default-src 'self'` blocks the preview iframe. Preview runs on the shop's primary hostname, which can be any verified custom domain and cannot be listed at build time; the framed page's own `frame-ancestors` is the real control, and admin-web only frames URLs it built server-side. Like `MEDIA_PUBLIC_BASE_URL`, `STOREFRONT_URL` is read at build time here.
19. **Admin uploads are sent as-is.** `prepareImage` re-encodes to WebP, which the favicon (PNG only) and share image (JPEG/PNG only) refuse. The online-store upload field pre-checks type and size per purpose in the browser and sends the original bytes; the server sniffs and decides.
20. **`sendAdminBinary` learns 422.** It maps 422 to `{ outcome: "invalid", code, detail }` (dimension errors); `UploadProductImageResult` gains the same member (the product route never answers 422, so its behaviour is unchanged).
21. **Environment documentation goes in the root `.env.example`.** No app has its own `.env.example` on this base. Storefront production assertions run in `src/instrumentation.ts` `register()` (throw when `APP_ENV` is not `local`/`development` and a secret is missing or shorter than 32 bytes, or `ADMIN_ORIGIN` is unset). admin-web reads `STOREFRONT_REVALIDATE_SECRET` with `requireProdEnv` inside `revalidateStorefront`, whose failures are logged and swallowed (best effort; the 60 s TTL is the net).
22. **Default storefront language.** `DEFAULT_LOCALE` becomes `"ar"` and every page reads its locale through one `getRequestLocale()` (cookie, else `shell.defaultLocale`), replacing the 15 copies of the cookie lookup.
23. **`not-found.tsx` stays at the app root** (Next renders unmatched URLs there, outside any route group) and renders the same `StoreChrome` (header + footer) the `(store)` layout uses.
24. **Settings → General also revalidates.** The store name is part of the cached shell, so `saveStoreSettingsAction` calls `revalidateStorefront` after a successful save.
25. **The storefront account subtitles drop the platform name.** "Sign in to your Morbeh account" on a merchant's shop is wrong; en/ar become "Sign in to your account" / "سجّل الدخول إلى حسابك" and "Create an account to…" / "أنشئ حساباً لحفظ…". Together with `brand`, this removes every "موربيه" from the storefront; admin-web's three occurrences become "مربح".
26. **Plain-text normalisation.** Merchant plain text (titles, descriptions, footer note, visitor message) is trimmed, C0/C1 control characters are removed (newlines kept only in the visitor message and footer note), and Unicode bidi embedding/override/isolate characters (U+202A–U+202E, U+2066–U+2069) are removed. Lengths are counted in UTF-16 code units after normalisation. Rendering always uses `dir="auto"` inside `<bdi>`.
27. **Corners.** `square` = every radius 0; `rounded` = the design scale (4/6/8/12/16/20/28 px); `pill` = 8/12/16/20/24/28/32 px.
28. **Homepage sections in Part 1.** The document type carries `homepage.sections: readonly unknown[]`; the write validator accepts only `[]` (`SECTIONS_NOT_SUPPORTED`), the tolerant reader keeps whatever array it finds (never rendered in Part 1). Part 3 types it.
29. **Fonts in admin-web.** The customize route imports the six `@fontsource` families (400 and 700 only) so the font picker can show "مربح Morbeh 123" in each; `@font-face` downloads lazily, and the fonts are bundled (`font-src 'self'` already allows them).
30. **The permission "plan doc list" is not edited.** The only list the seed script mirrors is a historical plan (`2026-09-04-run-platform-on-supabase-and-production-readiness.md`); historical plans are not rewritten. The nine new strings go in `scripts/ops/seed-ory-network.mjs` only.
31. **Sidebar guard.** The "never sends an operator to /forbidden from a sidebar link" test exists only on the unmerged Project 3 branch. Task 10 adds its own `middleware.test.ts` case that every `ONLINE_STORE_NAV` href is reachable by a viewer and `/online-store/themes/customize` by an operator, and the role entries are added regardless.
32. **The shell carries `previewExpiresAt`.** Spec 1.12 wants the preview banner to show the expiry, but `PublicShellDto` has no field for it. `ResolvePreviewToken` returns the expiry (`Date | null`), and the shell adds `previewExpiresAt: string | null` (null when live). It is not a secret: the admin who minted the link already has it.
33. **`PreferencesDto` carries `version`.** `PUT /online-store/preferences` needs `expectedVersion`, but spec 1.9's GET shape omits it; the form could not save without it.
34. **`@platform/storefront-content` depends on `@platform/design`.** The spec calls the package "no runtime dependencies" and also requires `contrast.ts` and the design palette. Reading it as "no third-party dependencies": `@platform/design` is itself dependency-free, and a second contrast implementation would be the drift the package exists to prevent.
35. **Draft saves are guarded by `expectedVersion`.** Spec 1.8 writes the aggregate as `saveDraft(doc, expectedDraftRevision)`, spec 1.9's route takes `expectedVersion`. The route wins: the use case compares `version`, the aggregate's `saveDraft(doc, now)` only bumps the revision, and `expectedDraftRevision` binds publish alone.

## Global Constraints

Copied from the spec and the binding lessons; every task's requirements include them.

1. **Migrations:** hand-written, additive SQL `packages/db/prisma/schema/migrations/20261027000000_online_store_identity/migration.sql`, with the matching Prisma models in a new `packages/db/prisma/schema/online-store.prisma` and `"online_store"` appended to the datasource `schemas` list in `main.prisma`. The schema starts with `CREATE SCHEMA IF NOT EXISTS "online_store";`. Every table: `tenant_id TEXT NOT NULL`, then `ENABLE` + `FORCE ROW LEVEL SECURITY`, then `DROP POLICY IF EXISTS tenant_isolation …; CREATE POLICY tenant_isolation … FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));` exactly as `20261013000000_store_shipping_taxes`. **Never run `prisma migrate`, `db push`, or any SQL against any database.** `prisma validate` / `prisma generate` with dummy URLs and `schema-migration-consistency.test.ts` are the checks. **Task 2.**
2. **Per-request tenant (ADR-0014):** repositories take `tenantId` per call; reads go through `runReadScoped(prisma, tenantId, fn)` or the caller's `tx`; writes go through the unit of work. Outbox writes attach the tenant at write time (`{ ...context, tenantId }`). No object field named `tenantId` (or `defaultTenantId` / `pinnedTenantId`) anywhere on `WiredAdmin` outside the `tenancy` key — the tenant-mode guard walks objects, so cross-context seams are closures and parameters. Every Prisma `findFirst/findMany/updateMany/deleteMany/count` names `tenantId` in a literal `where` (checked by `node scripts/dev/check-prisma-tenant-where.mjs`). No raw SQL is added; if one ever is, it carries `"tenant_id" = ${tenantId}` in the statement. Each Prisma repository gets a `tenant-isolation.test.ts` case. **Tasks 2, 3, 5, 6.**
3. **Unit of work commits on an `err` Result.** `PrismaUnitOfWork.run` only rolls back on a throw. Validate everything (documents, image ownership, versions, revisions, password rules, hashing) **before the first write** inside `unitOfWork.run`; never write and then return `err`. Lost races throw `ConcurrencyError` (rollback) and are mapped to 409 outside `run`. **Tasks 3, 4.**
4. **Token-issuing routes are NOT idempotent.** `POST /online-store/preview-tokens` has no `idempotent: true`, so a token is never replayed from the response cache. Only `sha256(token)` hex is stored. The server logs route patterns only (`request.routeOptions.url`), and the token never appears in a log line, a DTO other than the 201 body, or a persisted URL. **Tasks 2, 3, 5.**
5. **Guarded writes:** optimistic `version` on preferences, access and theme; publish is bound to `expectedDraftRevision` (409 `DRAFT_CHANGED`); autosave sends one request at a time with `expectedVersion`. **Tasks 2, 3, 11.**
6. **Uploads:** content type and size are validated on the server, and the bytes decide (`sniffImage`); per-purpose type, size and dimension rules; 40 MP cap (new purposes, Ruling 3); never SVG; immutable server-made keys; the client file name is display-only. **Task 4.**
7. **admin-web:** the runtime API is called only from server code; client components never value-import `@/lib/api/*` or `@/lib/auth/*` (type imports only; verified by the client-bundle grep in Final verification). Every string goes in `messages/en.ts` and `messages/ar.ts` (**Egyptian** Arabic). Logical CSS. One idempotency key per submit (`newIdempotencyKey()`). New pages get `ROUTE_ROLE_REQUIREMENTS` entries. **Tasks 10, 11.**
8. **Storefront:** server components and server actions only; no browser-side runtime-API calls. Copy in `messages/{en,ar}.ts` (**Modern Standard Arabic**), parity enforced by `Dictionary`. RTL-first. Merchant text rendered with `dir="auto"` and bidi isolation (`<bdi>`). Numbers formatted for the locale (`Intl.NumberFormat(locale)`). **Tasks 7, 8, 9.**
9. **Brand:** the platform name is **مربح** / **Morbeh** everywhere; no "موربيه" remains in `apps/`. **Tasks 8, 10.**
10. **Permissions:** `online_store` joins `SHOP_RESOURCES`; `online_store_admin` does not. New strings are added to `scripts/ops/seed-ory-network.mjs`. **Task 2.**
11. **No client-supplied amounts** — none exist in Part 1, and none may be introduced (no route here accepts a price, rate or total).
12. **Anti-goals (verbatim):** no raw HTML stored or rendered from merchant input, no `dangerouslySetInnerHTML` on merchant content; no merchant-typed string reaches a CSS block, a `<script>`, a `style` attribute or a font URL (only validated hex colours, numbers and enum keys do); no password, hash, preview token or signing key in a DTO, log line, persisted URL or cookie (the unlock cookie carries an HMAC proof); no draft content without a valid, unexpired preview token for that shop; no cached storefront response or data entry shared between two shops; no new construction-time `tenantId`; no behaviour change to `POST /media/uploads`.

Part 1 numbers (spec, verbatim): migration `20261027000000_online_store_identity`; home title ≤ 70 per locale, meta description ≤ 320, visitor message ≤ 500, footer note ≤ 200; logo width 60–320 (default 140); base size small/medium/large = 14/15/16 px; social URL `https:` ≤ 500 characters; document ≤ 256 KB (`DOCUMENT_TOO_LARGE`); 20 releases kept; preview token 32 bytes base64url, 60-minute expiry, ≤ 100 characters on input; unlock rate limit `rl:${tenantId}:storefront-unlock`, 20 per 10 minutes; unlock cookie `morbeh-storefront-access`, `v1.<accessVersion>.<expUnix>.<base64url(HMAC-SHA256(secret, shopId|accessVersion|expUnix))>`, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, `Max-Age` 7 days; password 4–100 characters; secrets ≥ 32 bytes; shell cache `unstable_cache` key `["online-store", shopId, "shell"]`, tag `os:<shopId>`, `revalidate: 60`; middleware access cache 15 s, stale for 5 minutes on Runtime errors; revalidation call timeout 2 s; autosave 1 s after the last change.

Permissions (spec table, verbatim):

| Permission                         | Roles                   | Used by                                                                                                  |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `online_store:read`                | viewer, operator, admin | read preferences, access status (never the hash), theme, releases, menus, policies; mint a preview token |
| `online_store:update_preferences`  | operator, admin         | home title/description, share image, default language                                                    |
| `online_store:upload_image`        | operator, admin         | `POST /online-store/images`                                                                              |
| `online_store:edit_theme`          | operator, admin         | save or discard the theme draft                                                                          |
| `online_store:manage_menus`        | operator, admin         | (Part 2)                                                                                                 |
| `online_store:manage_policies`     | operator, admin         | (Part 2)                                                                                                 |
| `online_store_admin:publish_theme` | admin                   | publish the draft; restore a release into the draft                                                      |
| `online_store_admin:update_access` | admin                   | lock/unlock, set the password, edit the visitor message                                                  |
| `pages:update_page` (new action)   | operator, admin         | (Part 2)                                                                                                 |

Repository rules (from the owner): commit with
`git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`, Conventional Commits in lower case, body lines ≤ 100 characters, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never `--no-verify`. Stage only the task's own files (`git add <paths>`), never `.superpowers/` or `.claude/`. Files are CRLF in the owner's checkout (`core.autocrlf`); keep each file's line endings, and discard unrelated prettier reformatting of files the task did not mean to change (`git checkout -- <file>`).

## Review Focus

The five failure modes the spec implies that the spec's own test list does not pin, most likely first. Each names the task whose test pins it.

1. **A corrupted or hostile colour reaches CSS.** A stored row (or a preview draft) with `"#000000;}</style><script>"`, `"＃fff"`, `"red"` or a missing key must render the default palette, never the string. Pinned in **Task 1** (`brandStyleSheet` output never contains `<`, `;}` or a non-hex value for any input in the hostile table) and **Task 8** (`layout.test.tsx` "a corrupt brand renders the default palette").
2. **Shop A's unlock cookie or cache entry used on shop B.** The same storefront instance serves both; A's valid cookie on B's host must not unlock B, and two shops must produce two `unstable_cache` keys. Pinned in **Task 7** (`online-store.test.ts` "two shops, two cache entries") and **Task 9** (`access-cookie.test.ts` "a cookie for shop A never verifies for shop B", `middleware.test.ts` "A's cookie on B's request is redirected").
3. **A locked store with the Runtime down.** The middleware must answer 503 when access was never known and keep serving the last known state for up to 5 minutes; it must never fail open. Pinned in **Task 9** (`access-cache.test.ts` and `middleware.test.ts` "unknown access + failing Runtime → 503").
4. **A publish racing an autosave.** The operator's autosave lands between the admin's preview and Publish; Publish must answer `DRAFT_CHANGED` and the editor must say so instead of publishing the newer draft. Pinned in **Task 3** (`theme.use-cases.test.ts` "publish after another save → DRAFT_CHANGED, nothing written") and **Task 11** (`customize-editor.test.tsx` "a DRAFT_CHANGED publish shows the reload message").
5. **A favicon or share image that the bytes contradict.** A JPEG renamed `.png`, an animated GIF as favicon, a 20,000 × 20,000 PNG header in a 7.9 MB body, a WebP share image: each is refused by purpose with the right status, and nothing is stored. Pinned in **Task 4** (`upload-image.test.ts` table) and **Task 5** (`online-store-routes.test.ts` "favicon must be PNG").

---

## File Structure

**packages/storefront-content** (new, `@platform/storefront-content`; depends only on the dependency-free `@platform/design`)

- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/locale.ts` — `Locale`, `LOCALES`, `LocalizedText`, `pickText`, `normalizePlainText`, `normalizeLocalizedText`.
- `src/color.ts` — `HexColor`, `normalizeHex`, `mixHex`, `bestTextOn`.
- `src/fonts.ts` — `FONT_KEYS`, `FontKey`, `FONT_FAMILIES`, `fontStack`.
- `src/theme-document.ts` — `ThemeDocument` and its parts, `DEFAULT_THEME_DOCUMENT`, limits, `validateThemeDocument`, `readThemeDocument`, `readBrand`, `imageRefsOf`, `canonicalDocumentJson`.
- `src/contrast-rules.ts` — `checkBrandContrast`, `ContrastWarning`.
- `src/css-vars.ts` — `brandToCssVars`, `brandStyleSheet`, `RADIUS_SCALES`, `BASE_SIZE_PX`.
- `src/index.ts`; tests beside each file.

**packages/db**

- `prisma/schema/migrations/20261027000000_online_store_identity/migration.sql`
- `prisma/schema/online-store.prisma` (new), `prisma/schema/main.prisma` (`schemas` += `"online_store"`)
- `src/schema-migration-consistency.test.ts` (append a `describe`)

**packages/auth** — `src/role-table-access-control.ts` (`"online_store"` in `SHOP_RESOURCES`), `src/role-table-access-control.test.ts`.

**scripts/ops/seed-ory-network.mjs** — nine permission strings.

**services/online-store** (new, `@platform/online-store`)

- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/domain/errors.ts`, `storefront-preferences.ts`, `storefront-access.ts`, `storefront-theme.ts`, `preview-token.ts`, `events.ts`, `repositories.ts`
- `src/application/ports.ts`, `deps.ts`, `preferences.use-cases.ts`, `access.use-cases.ts`, `theme.use-cases.ts`, `preview.use-cases.ts`, `shell.use-case.ts`
- `src/infrastructure/in-memory-repositories.ts`, `in-memory-unit-of-work.ts`, `prisma-repositories.ts`, `rows.ts`, `event-translator.ts`
- `src/interfaces/presenter.ts`, `online-store.controller.ts`
- `src/composition.ts`, `src/index.ts`
- tests: `src/domain/*.test.ts`, `src/application/*.test.ts`, `src/infrastructure/prisma-repositories.test.ts`, `src/infrastructure/tenant-isolation.test.ts`, `src/testing/fakes.ts`

**services/media**

- `src/application/image-purposes.ts` (new) — the per-purpose policy table.
- `src/application/upload-image.use-case.ts` (new) — `UploadImage`; `UploadProductImage` re-expressed over it (unchanged outcomes).
- `src/application/upload-product-image.use-case.ts` — `StorageKeyBuilder.namespace` widened; `UploadProductImage` delegates.
- `src/interfaces/media-library.controller.ts` — `uploadImage`.
- `src/media-library.composition.ts`, `src/index.ts`; tests `upload-image.test.ts`.

**apps/admin**

- `src/infrastructure/cross-context/online-store.adapters.ts` (+ test)
- `src/interfaces/online-store.admin-controller.ts`, `src/interfaces/media-library.admin-controller.ts` (`uploadImage`)
- `src/http/online-store-routes.ts`, `src/http/public-online-store-routes.ts`, `src/http/admin-routes.ts`
- `src/composition.ts` (`onlineStore`, `publicReads.onlineStore`)
- `src/http/testing/online-store-harness.ts`; tests `online-store-routes.test.ts`, `public-online-store-routes.test.ts`, `src/tenant-mode-guard.test.ts` (one case)
- `package.json` (`@platform/online-store`)

**apps/storefront**

- `src/app/(store)/…` (moved: `page.tsx`, `account/**`, `cart/**`, `checkout/**`, `collections/**`, `products/**`, `search/**`), `src/app/(store)/layout.tsx` (new)
- `src/app/(gate)/layout.tsx`, `src/app/(gate)/password/page.tsx`, `actions.ts` (+ tests)
- `src/app/layout.tsx`, `src/app/layout.test.tsx` (replaces `layout.test.ts`), `src/app/not-found.tsx`, `src/app/globals.css`
- `src/app/api/revalidate/route.ts` (+ test)
- `src/components/site-header.tsx`, `site-footer.tsx`, `store-chrome.tsx`, `preview-banner.tsx`, `preview-link-keeper.tsx`, `preview-mode.tsx`, `add-to-cart-button.tsx`
- `src/lib/online-store.ts`, `access-cookie.ts`, `access-cache.ts`, `return-to.ts`, `request-locale.ts`, `preview-href.ts`, `storefront-env.ts`, `runtime-api.ts`, `i18n.ts` (+ tests)
- `src/middleware.ts` (+ `middleware.test.ts`), `src/instrumentation.ts`
- `src/messages/en.ts`, `ar.ts`; `package.json`, `next.config.ts`

**apps/admin-web**

- `packages/ui/src/components/ui/textarea.tsx`, `native-select.tsx`, `switch.tsx`, `color-field.tsx`, `form-controls.test.tsx`, `packages/ui/src/index.ts`
- `src/lib/api/online-store.ts` (+ test), `src/lib/api/client.ts` (422 on binary), `src/lib/api/media.ts`
- `src/lib/storefront-revalidate.ts` (+ test), `src/lib/online-store/autosave.ts` (+ test), `src/lib/online-store/codes.ts`
- `src/app/online-store/preferences/page.tsx`, `actions.ts` (+ test)
- `src/app/online-store/themes/page.tsx`, `actions.ts` (+ test), `src/app/online-store/themes/customize/page.tsx`, `layout.tsx`
- `src/components/online-store/*` — preferences form, image upload field, localized text field, theme card, release history, customize editor and its panels (+ tests)
- `src/components/navigation.ts`, `navigation.test.tsx`, `src/middleware.ts`, `middleware.test.ts`, `next.config.ts`, `src/next-config.test.ts`
- `src/app/settings/general/actions.ts` (revalidate)
- `src/messages/en.ts`, `ar.ts`; `package.json`

**Root** — `.env.example` (five variables).

## Commands

- Tests: `pnpm --filter <pkg> test`; one file: `pnpm --filter <pkg> exec vitest run <file>`.
- `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`. Admin lint needs memory:
  `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` (same variable for `admin-web`).
- Packages: `@platform/storefront-content`, `@platform/db`, `@platform/auth`, `@platform/online-store`, `@platform/media`, `@platform/admin`, `@platform/ui`, `admin-web`, `storefront`.
- New workspace packages: after creating a `package.json`, run `pnpm install` (no new external dependency except the `@fontsource/*` families in Tasks 8 and 11, added with `pnpm --filter <app> add`). If `node_modules` is still being installed in the background, wait and retry; never delete `node_modules` or the lockfile.
- Prisma (dummy URLs, never a real DB):
  `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate`
  and the same with `prisma generate` after the schema change. **Never `prisma migrate`, `db push`, or any SQL against any database.**
- Tenant-filter guard: `node scripts/dev/check-prisma-tenant-where.mjs`. `packages/db/src/prisma-tenant-where.guard.test.ts` cannot load from a path with a space, so run the script directly. On this base it reports ONE known finding, `apps/admin/src/interfaces/discounts/discounts.admin-controller.ts:166: promotions.update has no where`; any other finding is yours to fix.
- `next build` fails with `EPERM` on this machine — do not rely on it; `typecheck`, `lint` and `test` are the gates for admin-web and storefront.
- Integration tests run only with `DATABASE_URL_TEST` set (skipped otherwise; never point it at a real database).
- Client-bundle grep (admin-web):
  `grep -rlE '^"use client"' apps/admin-web/src | xargs grep -nE 'from "@/lib/(api|auth)/' | grep -v 'import type'`
  It matches the closing line of multi-line imports too, so inspect every hit. On this base it prints exactly three pre-existing, pure-constant imports: `components/finance/finance-model-picker.tsx` (`finance-read-models`), `components/security/audit-actions.tsx` and `components/security/identity-actions.tsx` (`security-transitions`). Nothing under `components/online-store` or `app/online-store` may appear.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: `@platform/storefront-content` — document types, strict validator, colours, contrast, fonts and CSS variables

Model tier: **standard** (pure TypeScript; every rule is below).

**Files:**

- Create: `packages/storefront-content/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/storefront-content/src/locale.ts`, `locale.test.ts`
- Create: `packages/storefront-content/src/color.ts`, `color.test.ts`
- Create: `packages/storefront-content/src/fonts.ts`, `fonts.test.ts`
- Create: `packages/storefront-content/src/theme-document.ts`, `theme-document.test.ts`
- Create: `packages/storefront-content/src/contrast-rules.ts`, `contrast-rules.test.ts`
- Create: `packages/storefront-content/src/css-vars.ts`, `css-vars.test.ts`
- Create: `packages/storefront-content/src/index.ts`

**Interfaces:**

- Consumes: `contrastRatio` and `colors` from `@platform/design`.
- Produces (all exported from `@platform/storefront-content`):
  - `LOCALES = ["ar", "en"]`, `type Locale`, `interface LocalizedText { ar?: string; en?: string }`, `pickText(text, locale): string | null`, `normalizePlainText(value: string, options?: { multiline?: boolean }): string`, `interface ContentIssue { path: string; code: string }`, `normalizeLocalizedText(raw: unknown, options: { path: string; max: number; multiline?: boolean }, issues: ContentIssue[]): LocalizedText`.
  - `type HexColor`, `normalizeHex(value: unknown): HexColor | null`, `mixHex(a: HexColor, b: HexColor, weightOfB: number): HexColor`, `bestTextOn(background: HexColor): "#000000" | "#ffffff"`.
  - `FONT_KEYS`, `type FontKey`, `FONT_FAMILIES: Record<FontKey, string>`, `fontStack(key: FontKey): string`.
  - `SOCIAL_NETWORKS`, `type SocialNetwork`, `BASE_SIZES`, `type BaseSize`, `CORNER_STYLES`, `type CornerStyle`, `COLOR_KEYS`, `type ColorKey`, `type BrandColors`, `interface ThemeBrand`, `interface ThemeDocument`, `type BrandStyle = Pick<ThemeBrand, "colors" | "typography" | "corners">`, `LOGO_WIDTH = { min: 60, max: 320, default: 140 }`, `FOOTER_NOTE_MAX = 200`, `SOCIAL_URL_MAX = 500`, `MAX_DOCUMENT_BYTES = 262144`, `DEFAULT_THEME_DOCUMENT`, `type ValidationOutcome<T> = { ok: true; value: T } | { ok: false; issues: readonly ContentIssue[] }`, `validateThemeDocument(raw: unknown): ValidationOutcome<ThemeDocument>`, `readThemeDocument(raw: unknown): ThemeDocument`, `readBrandStyle(raw: unknown): BrandStyle`, `readSocial(raw: unknown): ThemeBrand["social"]`, `imageRefsOf(doc: ThemeDocument): string[]`, `canonicalDocumentJson(raw: unknown): string`.
  - `interface ContrastWarning { pair: "foreground" | "primaryForeground" | "accentForeground"; ratio: number; minimum: 4.5 }`, `checkBrandContrast(colors: BrandColors): { blocking: ContentIssue[]; warnings: ContrastWarning[] }`.
  - `BASE_SIZE_PX`, `RADIUS_SCALES`, `brandToCssVars(style: BrandStyle): Readonly<Record<string, string>>`, `brandStyleSheet(raw: unknown): string`.

- [ ] **Step 1: Scaffold the package**

`packages/storefront-content/package.json`:

```json
{
  "name": "@platform/storefront-content",
  "version": "0.0.0",
  "private": true,
  "description": "Online Store content shared by the API, admin-web and the storefront: theme document, validators, colours, fonts and CSS variables (Project 4).",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@platform/design": "workspace:*"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig": "workspace:*",
    "@types/node": "^22.7.5",
    "@vitest/coverage-v8": "^2.1.4",
    "eslint": "^9.13.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`tsconfig.json` (copy of `packages/regions/tsconfig.json`):

```json
{
  "extends": "@platform/tsconfig/base.json",
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Run: `pnpm install` (links the new workspace package; no new external dependency).

- [ ] **Step 2: Write the failing tests for locale, colour and fonts**

`src/locale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeLocalizedText, normalizePlainText, pickText, type ContentIssue } from "./locale";

describe("pickText", () => {
  it("prefers the request locale, then the other one, then nothing", () => {
    expect(pickText({ ar: "مرحبا", en: "Hello" }, "en")).toBe("Hello");
    expect(pickText({ ar: "مرحبا" }, "en")).toBe("مرحبا");
    expect(pickText({ en: "Hello" }, "ar")).toBe("Hello");
    expect(pickText({}, "ar")).toBeNull();
    expect(pickText({ ar: "", en: "" }, "ar")).toBeNull();
  });
});

describe("normalizePlainText", () => {
  it("trims, removes control and bidi override characters, and flattens newlines on one line", () => {
    expect(normalizePlainText("  a\u0000b‮c⁦d\ne  ")).toBe("abcd e");
  });

  it("keeps single newlines in multi-line text and normalises CRLF", () => {
    expect(normalizePlainText("line 1\r\nline 2\u0007", { multiline: true })).toBe(
      "line 1\nline 2",
    );
  });
});

describe("normalizeLocalizedText", () => {
  it("drops empty locales and reports over-long ones by path", () => {
    const issues: ContentIssue[] = [];
    const value = normalizeLocalizedText(
      { ar: "   ", en: "x".repeat(71) },
      { path: "homeTitle", max: 70 },
      issues,
    );
    expect(value).toEqual({ en: "x".repeat(71) });
    expect(issues).toEqual([{ path: "homeTitle.en", code: "TOO_LONG" }]);
  });

  it("rejects unknown keys, non-strings and non-objects", () => {
    const issues: ContentIssue[] = [];
    normalizeLocalizedText({ fr: "x", ar: 3 }, { path: "note", max: 10 }, issues);
    normalizeLocalizedText("text", { path: "other", max: 10 }, issues);
    expect(issues).toEqual([
      { path: "note.fr", code: "UNKNOWN_KEY" },
      { path: "note.ar", code: "INVALID_VALUE" },
      { path: "other", code: "INVALID_VALUE" },
    ]);
  });

  it("a label made only of bidi controls or whitespace is empty", () => {
    const issues: ContentIssue[] = [];
    expect(normalizeLocalizedText({ ar: "‫ ‬" }, { path: "p", max: 5 }, issues)).toEqual({});
    expect(issues).toEqual([]);
  });
});
```

`src/color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bestTextOn, mixHex, normalizeHex } from "./color";

describe("normalizeHex", () => {
  it.each([
    ["#AABBCC", "#aabbcc"],
    ["#0f172a", "#0f172a"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each([
    "red",
    "#fff",
    "#ffffff80",
    "rgb(0,0,0)",
    "#000000;}</style><script>",
    "＃ffffff",
    "",
    " #ffffff",
    null,
    42,
  ])("refuses %j", (input) => {
    expect(normalizeHex(input)).toBeNull();
  });
});

describe("mixHex / bestTextOn", () => {
  it("mixes channel by channel and rounds", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#123456", "#ffffff", 0)).toBe("#123456");
    expect(mixHex("#123456", "#ffffff", 1)).toBe("#ffffff");
  });

  it("picks the readable text colour", () => {
    expect(bestTextOn("#ffffff")).toBe("#000000");
    expect(bestTextOn("#000000")).toBe("#ffffff");
    expect(bestTextOn("#635bff")).toBe("#ffffff");
  });
});
```

`src/fonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, FONT_KEYS, fontStack } from "./fonts";

describe("fonts", () => {
  it("maps every key to a fixed family, and nothing else", () => {
    expect([...FONT_KEYS].sort()).toEqual(Object.keys(FONT_FAMILIES).sort());
    expect(FONT_KEYS).toEqual([
      "ibm-plex-sans-arabic",
      "cairo",
      "tajawal",
      "almarai",
      "readex-pro",
      "amiri",
    ]);
  });

  it("builds a stack from the map only, with the platform fallbacks after it", () => {
    expect(fontStack("cairo")).toBe(
      '"Cairo", "IBM Plex Sans Arabic", var(--font-geist, "Geist"), ui-sans-serif, system-ui, sans-serif',
    );
    for (const key of FONT_KEYS) expect(fontStack(key)).not.toMatch(/[<>;{}]/);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/locale.test.ts src/color.test.ts src/fonts.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement locale, colour and fonts**

`src/locale.ts`:

```ts
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Merchant text in both storefront languages. Empty string never stored: absent means "not written". */
export interface LocalizedText {
  readonly ar?: string;
  readonly en?: string;
}

/** One problem found while reading merchant content. `code` is a stable machine code. */
export interface ContentIssue {
  readonly path: string;
  readonly code: string;
}

/** Shown in the request locale, else the other locale, else nothing (the element is omitted). */
export function pickText(text: LocalizedText, locale: Locale): string | null {
  const own = text[locale];
  if (own !== undefined && own.length > 0) return own;
  const other = text[locale === "ar" ? "en" : "ar"];
  return other !== undefined && other.length > 0 ? other : null;
}

// Unicode bidi embedding/override (U+202A–U+202E) and isolate (U+2066–U+2069) characters. Rendering
// isolates merchant text itself (`<bdi dir="auto">`); a stored override could flip the page around it.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
const LINE_BREAKS_AND_TABS = /[\t\n\v\f\r\u0085  ]+/g;
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** Plain text as the platform stores it: trimmed, no control or bidi override characters. */
export function normalizePlainText(
  value: string,
  options: { readonly multiline?: boolean } = {},
): string {
  let text = value.replace(BIDI_CONTROLS, "");
  if (options.multiline === true) {
    text = text.replace(/\r\n?/g, "\n").replace(CONTROLS, "");
  } else {
    text = text.replace(LINE_BREAKS_AND_TABS, " ").replace(CONTROLS, "");
  }
  return text.trim();
}

/** Reads `{ ar?, en? }` from untrusted input, normalising each value and reporting by path. */
export function normalizeLocalizedText(
  raw: unknown,
  options: { readonly path: string; readonly max: number; readonly multiline?: boolean },
  issues: ContentIssue[],
): LocalizedText {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path: options.path, code: "INVALID_VALUE" });
    return {};
  }
  const result: { ar?: string; en?: string } = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const path = `${options.path}.${key}`;
    if (key !== "ar" && key !== "en") {
      issues.push({ path, code: "UNKNOWN_KEY" });
      continue;
    }
    if (typeof value !== "string") {
      issues.push({ path, code: "INVALID_VALUE" });
      continue;
    }
    const text = normalizePlainText(
      value,
      options.multiline === undefined ? {} : { multiline: options.multiline },
    );
    if (text.length > options.max) issues.push({ path, code: "TOO_LONG" });
    if (text.length > 0) result[key] = text;
  }
  return result;
}
```

`src/color.ts`:

```ts
import { contrastRatio } from "@platform/design";

/** Exactly `#rrggbb`, lower case. Nothing else ever reaches CSS. */
export type HexColor = `#${string}`;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** The only colour parser: 6-digit hex, no whitespace, no alpha, no names. Stored lower case. */
export function normalizeHex(value: unknown): HexColor | null {
  if (typeof value !== "string" || !HEX6.test(value)) return null;
  return value.toLowerCase() as HexColor;
}

function channels(hex: HexColor): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

const toHex = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

/** `a` moved towards `b` by `weightOfB` (0 = a, 1 = b), per channel. */
export function mixHex(a: HexColor, b: HexColor, weightOfB: number): HexColor {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const w = Math.min(1, Math.max(0, weightOfB));
  return `#${toHex(ar + (br - ar) * w)}${toHex(ag + (bg - ag) * w)}${toHex(ab + (bb - ab) * w)}`;
}

/** Black or white, whichever reads better on `background` (the editor's "Auto-fix"). */
export function bestTextOn(background: HexColor): "#000000" | "#ffffff" {
  return contrastRatio("#000000", background) >= contrastRatio("#ffffff", background)
    ? "#000000"
    : "#ffffff";
}
```

`src/fonts.ts`:

```ts
/** The six bundled families; each has Arabic and Latin glyphs (spec 1.3). */
export const FONT_KEYS = [
  "ibm-plex-sans-arabic",
  "cairo",
  "tajawal",
  "almarai",
  "readex-pro",
  "amiri",
] as const;
export type FontKey = (typeof FONT_KEYS)[number];

/** The ONLY way a font name reaches CSS: a fixed key → family map. Merchant text never does. */
export const FONT_FAMILIES: Readonly<Record<FontKey, string>> = {
  "ibm-plex-sans-arabic": "IBM Plex Sans Arabic",
  cairo: "Cairo",
  tajawal: "Tajawal",
  almarai: "Almarai",
  "readex-pro": "Readex Pro",
  amiri: "Amiri",
};

const FALLBACK =
  '"IBM Plex Sans Arabic", var(--font-geist, "Geist"), ui-sans-serif, system-ui, sans-serif';

export function fontStack(key: FontKey): string {
  if (key === "ibm-plex-sans-arabic") return FALLBACK;
  return `"${FONT_FAMILIES[key]}", ${FALLBACK}`;
}

export function isFontKey(value: unknown): value is FontKey {
  return typeof value === "string" && (FONT_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/locale.test.ts src/color.test.ts src/fonts.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing document, contrast and CSS tests**

`src/theme-document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  imageRefsOf,
  MAX_DOCUMENT_BYTES,
  readBrandStyle,
  readThemeDocument,
  validateThemeDocument,
  type ThemeDocument,
} from "./theme-document";

const clone = (): Record<string, any> => JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
const issuesOf = (raw: unknown) => {
  const outcome = validateThemeDocument(raw);
  return outcome.ok ? [] : outcome.issues;
};

describe("DEFAULT_THEME_DOCUMENT", () => {
  it("is the design system's light palette, Plex for both fonts, medium, rounded, no logo", () => {
    expect(DEFAULT_THEME_DOCUMENT.brand.colors).toEqual({
      background: "#f8fafc",
      foreground: "#0f172a",
      primary: "#635bff",
      primaryForeground: "#ffffff",
      accent: "#f1f5f9",
      accentForeground: "#0f172a",
    });
    expect(DEFAULT_THEME_DOCUMENT.brand.typography).toEqual({
      headingFont: "ibm-plex-sans-arabic",
      bodyFont: "ibm-plex-sans-arabic",
      baseSize: "medium",
    });
    expect(DEFAULT_THEME_DOCUMENT.brand.corners).toBe("rounded");
    expect(DEFAULT_THEME_DOCUMENT.brand.logo).toEqual({ imageRef: null, widthPx: 140 });
    expect(DEFAULT_THEME_DOCUMENT.brand.social).toEqual({});
    expect(DEFAULT_THEME_DOCUMENT.homepage.sections).toEqual([]);
  });

  it("passes its own validator", () => {
    expect(validateThemeDocument(DEFAULT_THEME_DOCUMENT)).toEqual({
      ok: true,
      value: DEFAULT_THEME_DOCUMENT,
    });
  });
});

describe("validateThemeDocument", () => {
  it("normalises upper-case hex to lower case", () => {
    const raw = clone();
    raw.brand.colors.primary = "#AA00FF";
    const outcome = validateThemeDocument(raw);
    expect(outcome.ok && outcome.value.brand.colors.primary).toBe("#aa00ff");
  });

  it.each(["red", "#fff", "#ffffff80", "rgb(1,2,3)", "#000000;}</style><script>", "＃ffffff", ""])(
    "rejects the colour %j with INVALID_COLOR on that field",
    (value) => {
      const raw = clone();
      raw.brand.colors.accent = value;
      expect(issuesOf(raw)).toEqual([{ path: "brand.colors.accent", code: "INVALID_COLOR" }]);
    },
  );

  it("rejects unknown keys at every level", () => {
    const raw = clone();
    raw.extra = 1;
    raw.brand.logo.alt = "x";
    raw.brand.social.myspace = "https://myspace.com/x";
    expect(issuesOf(raw)).toEqual([
      { path: "extra", code: "UNKNOWN_KEY" },
      { path: "brand.logo.alt", code: "UNKNOWN_KEY" },
      { path: "brand.social.myspace", code: "UNKNOWN_KEY" },
    ]);
  });

  it("rejects missing keys and wrong types", () => {
    const raw = clone();
    delete raw.brand.colors.primary;
    raw.header.sticky = "yes";
    expect(issuesOf(raw)).toEqual([
      { path: "brand.colors.primary", code: "MISSING" },
      { path: "header.sticky", code: "INVALID_VALUE" },
    ]);
  });

  it("bounds the logo width, the fonts, the size and the corners to their enums", () => {
    const raw = clone();
    raw.brand.logo.widthPx = 59;
    raw.brand.typography.headingFont = "Comic Sans";
    raw.brand.typography.baseSize = "huge";
    raw.brand.corners = "round";
    expect(issuesOf(raw)).toEqual([
      { path: "brand.logo.widthPx", code: "OUT_OF_RANGE" },
      { path: "brand.typography.headingFont", code: "INVALID_VALUE" },
      { path: "brand.typography.baseSize", code: "INVALID_VALUE" },
      { path: "brand.corners", code: "INVALID_VALUE" },
    ]);
    raw.brand.logo.widthPx = 320.5;
    expect(issuesOf(raw)[0]).toEqual({ path: "brand.logo.widthPx", code: "OUT_OF_RANGE" });
  });

  it.each([
    ["http://facebook.com/shop", "INVALID_URL"],
    ["https://user:pass@evil.example/x", "INVALID_URL"],
    ["javascript:alert(1)", "INVALID_URL"],
    ["not a url", "INVALID_URL"],
    [`https://x.example/${"a".repeat(500)}`, "TOO_LONG"],
  ])("refuses the social link %s (%s)", (url, code) => {
    const raw = clone();
    raw.brand.social.instagram = url;
    expect(issuesOf(raw)).toEqual([{ path: "brand.social.instagram", code }]);
  });

  it("accepts any https host for social links (shorteners included)", () => {
    const raw = clone();
    raw.brand.social.tiktok = "https://vm.tiktok.com/ZM123/";
    expect(validateThemeDocument(raw).ok).toBe(true);
  });

  it("checks image refs are id-shaped, never paths or urls", () => {
    const raw = clone();
    raw.brand.logo.imageRef = "../tenants/x/brand-assets/a.png";
    raw.brand.favicon.imageRef = "0192f0aa-0000-7000-8000-000000000001";
    expect(issuesOf(raw)).toEqual([{ path: "brand.logo.imageRef", code: "INVALID_VALUE" }]);
  });

  it("caps the footer note at 200 per locale and keeps line breaks", () => {
    const raw = clone();
    raw.footer.note = { ar: "سطر\nسطر", en: "x".repeat(201) };
    expect(issuesOf(raw)).toEqual([{ path: "footer.note.en", code: "TOO_LONG" }]);
  });

  it("refuses homepage sections until Part 3, and an unknown schema version", () => {
    const raw = clone();
    raw.homepage.sections = [{ type: "hero" }];
    raw.schemaVersion = 2;
    expect(issuesOf(raw)).toEqual([
      { path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" },
      { path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" },
    ]);
  });

  it("refuses a document over 256 KB before reading it", () => {
    const raw = clone();
    raw.padding = "x".repeat(MAX_DOCUMENT_BYTES);
    expect(issuesOf(raw)).toEqual([{ path: "", code: "DOCUMENT_TOO_LARGE" }]);
  });

  it("refuses a non-object", () => {
    expect(issuesOf(null)).toEqual([{ path: "", code: "INVALID_VALUE" }]);
    expect(issuesOf([])).toEqual([{ path: "", code: "INVALID_VALUE" }]);
  });
});

describe("readThemeDocument (tolerant reader)", () => {
  it("falls back per section: a corrupt brand becomes the default brand, the rest survives", () => {
    const raw = clone();
    raw.brand.colors.primary = "#000000;}</style><script>";
    raw.header.sticky = true;
    const doc: ThemeDocument = readThemeDocument(raw);
    expect(doc.brand).toEqual(DEFAULT_THEME_DOCUMENT.brand);
    expect(doc.header.sticky).toBe(true);
  });

  it("never throws on garbage and keeps an unknown homepage array as it is", () => {
    expect(readThemeDocument("garbage")).toEqual(DEFAULT_THEME_DOCUMENT);
    const raw = clone();
    raw.homepage.sections = [{ type: "from-a-newer-build" }];
    raw.schemaVersion = 2;
    expect(readThemeDocument(raw).homepage.sections).toEqual([{ type: "from-a-newer-build" }]);
  });

  it("readBrandStyle falls back field group by field group", () => {
    const style = readBrandStyle({
      colors: { ...DEFAULT_THEME_DOCUMENT.brand.colors, primary: "red" },
      typography: { headingFont: "cairo", bodyFont: "tajawal", baseSize: "large" },
      corners: "pill",
    });
    expect(style.colors).toEqual(DEFAULT_THEME_DOCUMENT.brand.colors);
    expect(style.typography).toEqual({
      headingFont: "cairo",
      bodyFont: "tajawal",
      baseSize: "large",
    });
    expect(style.corners).toBe("pill");
  });
});

describe("helpers", () => {
  it("imageRefsOf lists the logo and favicon refs that are set", () => {
    const raw = clone();
    raw.brand.logo.imageRef = "img-1";
    expect(imageRefsOf(readThemeDocument(raw))).toEqual(["img-1"]);
  });

  it("canonicalDocumentJson ignores key order (JSONB reorders keys)", () => {
    const reordered = { homepage: { sections: [] }, ...clone() };
    expect(canonicalDocumentJson(reordered)).toBe(canonicalDocumentJson(DEFAULT_THEME_DOCUMENT));
  });
});
```

`src/contrast-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkBrandContrast } from "./contrast-rules";
import { DEFAULT_THEME_DOCUMENT } from "./theme-document";

const base = DEFAULT_THEME_DOCUMENT.brand.colors;

describe("checkBrandContrast", () => {
  it("passes the default palette with no warnings", () => {
    expect(checkBrandContrast(base)).toEqual({ blocking: [], warnings: [] });
  });

  it("blocks body text below 3:1 and only warns between 3:1 and 4.5:1", () => {
    const blocked = checkBrandContrast({ ...base, background: "#ffffff", foreground: "#cccccc" });
    expect(blocked.blocking).toEqual([
      { path: "brand.colors.foreground", code: "CONTRAST_TOO_LOW" },
    ]);
    const warned = checkBrandContrast({ ...base, background: "#ffffff", foreground: "#888888" });
    expect(warned.blocking).toEqual([]);
    expect(warned.warnings).toEqual([{ pair: "foreground", ratio: 3.54, minimum: 4.5 }]);
  });

  it("only warns for button and accent pairs, never blocks", () => {
    const result = checkBrandContrast({
      ...base,
      primary: "#ffff00",
      primaryForeground: "#ffffff",
      accent: "#000000",
      accentForeground: "#111111",
    });
    expect(result.blocking).toEqual([]);
    expect(result.warnings.map((w) => w.pair)).toEqual(["primaryForeground", "accentForeground"]);
  });
});
```

`src/css-vars.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { brandStyleSheet, brandToCssVars } from "./css-vars";
import { DEFAULT_THEME_DOCUMENT, readBrandStyle } from "./theme-document";

const defaults = readBrandStyle(DEFAULT_THEME_DOCUMENT.brand);

describe("brandToCssVars", () => {
  it("maps the default brand onto the design system's own values", () => {
    const vars = brandToCssVars(defaults);
    expect(vars["--background"]).toBe("#f8fafc");
    expect(vars["--foreground"]).toBe("#0f172a");
    expect(vars["--primary"]).toBe("#635bff");
    expect(vars["--primary-foreground"]).toBe("#ffffff");
    expect(vars["--brand-accent"]).toBe("#f1f5f9");
    expect(vars["--ring"]).toBe("#635bff");
    expect(vars["--shop-radius-xl"]).toBe("16px");
    expect(vars["--shop-base-size"]).toBe("15px");
    expect(vars).toMatchSnapshot();
  });

  it("derives sensible neighbours for pure black and pure white", () => {
    const dark = brandToCssVars({
      ...defaults,
      colors: { ...defaults.colors, background: "#000000", foreground: "#ffffff" },
    });
    expect(dark["--card"]).not.toBe("#000000");
    expect(dark["--border"]).not.toBe("#000000");
    const light = brandToCssVars({
      ...defaults,
      colors: { ...defaults.colors, background: "#ffffff", foreground: "#000000" },
    });
    expect(light["--card"]).toBe("#ffffff");
    expect(light["--muted-foreground"]).not.toBe("#000000");
  });

  it("square corners zero every radius; pill rounds more", () => {
    expect(brandToCssVars({ ...defaults, corners: "square" })["--shop-radius-3xl"]).toBe("0px");
    expect(brandToCssVars({ ...defaults, corners: "pill" })["--shop-radius-md"]).toBe("16px");
  });

  it("sets heading and body fonts from the key map", () => {
    const vars = brandToCssVars({
      ...defaults,
      typography: { headingFont: "amiri", bodyFont: "cairo", baseSize: "small" },
    });
    expect(vars["--font-heading"]).toMatch(/^"Amiri"/);
    expect(vars["--font-sans"]).toMatch(/^"Cairo"/);
    expect(vars["--font-arabic"]).toBe(vars["--font-sans"]);
    expect(vars["--shop-base-size"]).toBe("14px");
  });
});

describe("brandStyleSheet", () => {
  it.each([
    { colors: { background: "#000000;}</style><script>alert(1)</script>" } },
    { typography: { headingFont: "x;}body{display:none" } },
    "garbage",
    null,
    { corners: "</style>" },
  ])("never lets hostile input through: %j", (raw) => {
    const css = brandStyleSheet(raw);
    expect(css.startsWith(":root:root:root{")).toBe(true);
    expect(css).not.toMatch(/[<]|;\}|script|display:none/);
    expect(css).toContain("--background:#f8fafc");
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run`
Expected: FAIL — `theme-document`, `contrast-rules`, `css-vars` not found.

- [ ] **Step 8: Implement the document, contrast rules and CSS variables**

`src/theme-document.ts`:

```ts
import { colors as designColors } from "@platform/design";
import { normalizeHex, type HexColor } from "./color";
import { isFontKey, type FontKey } from "./fonts";
import { normalizeLocalizedText, type ContentIssue, type LocalizedText } from "./locale";

export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "snapchat",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const BASE_SIZES = ["small", "medium", "large"] as const;
export type BaseSize = (typeof BASE_SIZES)[number];
export const CORNER_STYLES = ["square", "rounded", "pill"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const COLOR_KEYS = [
  "background",
  "foreground",
  "primary",
  "primaryForeground",
  "accent",
  "accentForeground",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type BrandColors = { readonly [K in ColorKey]: HexColor };

export const LOGO_WIDTH = { min: 60, max: 320, default: 140 } as const;
export const FOOTER_NOTE_MAX = 200;
export const SOCIAL_URL_MAX = 500;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
const IMAGE_REF = /^[A-Za-z0-9-]{1,64}$/;

export interface ThemeBrand {
  readonly logo: { readonly imageRef: string | null; readonly widthPx: number };
  readonly favicon: { readonly imageRef: string | null };
  readonly colors: BrandColors;
  readonly typography: {
    readonly headingFont: FontKey;
    readonly bodyFont: FontKey;
    readonly baseSize: BaseSize;
  };
  readonly corners: CornerStyle;
  readonly social: Readonly<Partial<Record<SocialNetwork, string>>>;
}

export interface ThemeDocument {
  readonly schemaVersion: 1;
  readonly brand: ThemeBrand;
  /** Part 2 adds `menuHandle`; Part 3 adds `announcement`. */
  readonly header: { readonly sticky: boolean };
  /** Part 2 adds `menuHandle` and `showPolicyLinks`. */
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  /** Part 3 types the sections; Part 1 accepts only `[]` on write and never renders them. */
  readonly homepage: { readonly sections: readonly unknown[] };
}

export type BrandStyle = Pick<ThemeBrand, "colors" | "typography" | "corners">;
export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

const light = designColors.light;
const hex = (value: string): HexColor => {
  const parsed = normalizeHex(value);
  if (parsed === null) throw new Error(`design palette value is not 6-digit hex: ${value}`);
  return parsed;
};

/** The current light palette, Plex for both fonts, medium, rounded, no logo: today's storefront. */
export const DEFAULT_THEME_DOCUMENT: ThemeDocument = Object.freeze({
  schemaVersion: 1,
  brand: {
    logo: { imageRef: null, widthPx: LOGO_WIDTH.default },
    favicon: { imageRef: null },
    colors: {
      background: hex(light.background),
      foreground: hex(light.foreground),
      primary: hex(light.primary),
      primaryForeground: hex(light.primaryForeground),
      accent: hex(light.accent),
      accentForeground: hex(light.accentForeground),
    },
    typography: {
      headingFont: "ibm-plex-sans-arabic",
      bodyFont: "ibm-plex-sans-arabic",
      baseSize: "medium",
    },
    corners: "rounded",
    social: {},
  },
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  homepage: { sections: [] },
}) as ThemeDocument;

type Raw = Record<string, unknown>;

/** Reads an object with exactly `keys`; reports unknown and missing keys. `null` when not an object. */
function objectAt(
  raw: unknown,
  path: string,
  keys: readonly string[],
  issues: ContentIssue[],
): Raw | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  const join = (key: string) => (path === "" ? key : `${path}.${key}`);
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) issues.push({ path: join(key), code: "UNKNOWN_KEY" });
  }
  for (const key of keys) {
    if (!(key in raw)) issues.push({ path: join(key), code: "MISSING" });
  }
  return raw as Raw;
}

function enumAt<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ContentIssue[],
): T | null {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return null;
}

function booleanAt(value: unknown, path: string, issues: ContentIssue[]): boolean {
  if (typeof value === "boolean") return value;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return false;
}

function imageRefAt(value: unknown, path: string, issues: ContentIssue[]): string | null {
  if (value === null) return null;
  if (typeof value === "string" && IMAGE_REF.test(value)) return value;
  if (value !== undefined) issues.push({ path, code: "INVALID_VALUE" });
  return null;
}

function socialUrlAt(value: unknown, path: string, issues: ContentIssue[]): string | null {
  if (typeof value !== "string") {
    issues.push({ path, code: "INVALID_VALUE" });
    return null;
  }
  if (value.length > SOCIAL_URL_MAX) {
    issues.push({ path, code: "TOO_LONG" });
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ path, code: "INVALID_URL" });
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    issues.push({ path, code: "INVALID_URL" });
    return null;
  }
  return value;
}

function section<T>(read: (issues: ContentIssue[]) => T, issues: ContentIssue[]): T | null {
  const before = issues.length;
  const value = read(issues);
  return issues.length === before ? value : null;
}

function readColors(raw: unknown, path: string, issues: ContentIssue[]): BrandColors | null {
  return section((found) => {
    const obj = objectAt(raw, path, COLOR_KEYS, found);
    if (obj === null) return null;
    const result: Partial<Record<ColorKey, HexColor>> = {};
    for (const key of COLOR_KEYS) {
      if (!(key in obj)) continue;
      const parsed = normalizeHex(obj[key]);
      if (parsed === null) found.push({ path: `${path}.${key}`, code: "INVALID_COLOR" });
      else result[key] = parsed;
    }
    return result as BrandColors;
  }, issues);
}

function readTypography(
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): ThemeBrand["typography"] | null {
  return section((found) => {
    const obj = objectAt(raw, path, ["headingFont", "bodyFont", "baseSize"], found);
    if (obj === null) return null;
    const font = (key: string): FontKey | null => {
      const value = obj[key];
      if (isFontKey(value)) return value;
      if (value !== undefined) found.push({ path: `${path}.${key}`, code: "INVALID_VALUE" });
      return null;
    };
    const headingFont = font("headingFont");
    const bodyFont = font("bodyFont");
    const baseSize = enumAt(obj["baseSize"], BASE_SIZES, `${path}.baseSize`, found);
    return {
      headingFont: headingFont ?? "ibm-plex-sans-arabic",
      bodyFont: bodyFont ?? "ibm-plex-sans-arabic",
      baseSize: baseSize ?? "medium",
    };
  }, issues);
}

/** A missing `corners` is reported once, by the enclosing `objectAt` (MISSING); callers default it. */
function readCorners(raw: unknown, path: string, issues: ContentIssue[]): CornerStyle | null {
  return enumAt(raw, CORNER_STYLES, path, issues);
}

function readSocialAt(
  raw: unknown,
  path: string,
  issues: ContentIssue[],
): ThemeBrand["social"] | null {
  return section((found) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      found.push({ path, code: "INVALID_VALUE" });
      return null;
    }
    const result: Partial<Record<SocialNetwork, string>> = {};
    for (const [key, value] of Object.entries(raw as Raw)) {
      if (!(SOCIAL_NETWORKS as readonly string[]).includes(key)) {
        found.push({ path: `${path}.${key}`, code: "UNKNOWN_KEY" });
        continue;
      }
      const url = socialUrlAt(value, `${path}.${key}`, found);
      if (url !== null) result[key as SocialNetwork] = url;
    }
    return result;
  }, issues);
}

function readBrandAt(raw: unknown, path: string, issues: ContentIssue[]): ThemeBrand | null {
  return section((found) => {
    const obj = objectAt(
      raw,
      path,
      ["logo", "favicon", "colors", "typography", "corners", "social"],
      found,
    );
    if (obj === null) return null;
    let logo: ThemeBrand["logo"] = DEFAULT_THEME_DOCUMENT.brand.logo;
    const logoRaw = objectAt(obj["logo"], `${path}.logo`, ["imageRef", "widthPx"], found);
    if (logoRaw !== null) {
      const width = logoRaw["widthPx"];
      const widthOk =
        typeof width === "number" &&
        Number.isInteger(width) &&
        width >= LOGO_WIDTH.min &&
        width <= LOGO_WIDTH.max;
      if (!widthOk && width !== undefined)
        found.push({ path: `${path}.logo.widthPx`, code: "OUT_OF_RANGE" });
      logo = {
        imageRef: imageRefAt(logoRaw["imageRef"], `${path}.logo.imageRef`, found),
        widthPx: widthOk ? (width as number) : LOGO_WIDTH.default,
      };
    }
    const faviconRaw = objectAt(obj["favicon"], `${path}.favicon`, ["imageRef"], found);
    const favicon = {
      imageRef:
        faviconRaw === null
          ? null
          : imageRefAt(faviconRaw["imageRef"], `${path}.favicon.imageRef`, found),
    };
    const colors = readColors(obj["colors"], `${path}.colors`, found);
    const typography = readTypography(obj["typography"], `${path}.typography`, found);
    const corners = readCorners(obj["corners"], `${path}.corners`, found);
    const social = readSocialAt(obj["social"], `${path}.social`, found);
    return {
      logo,
      favicon,
      colors: colors ?? DEFAULT_THEME_DOCUMENT.brand.colors,
      typography: typography ?? DEFAULT_THEME_DOCUMENT.brand.typography,
      corners: corners ?? DEFAULT_THEME_DOCUMENT.brand.corners,
      social: social ?? {},
    };
  }, issues);
}

function readHeaderAt(raw: unknown, issues: ContentIssue[]): ThemeDocument["header"] | null {
  return section((found) => {
    const obj = objectAt(raw, "header", ["sticky"], found);
    return obj === null ? null : { sticky: booleanAt(obj["sticky"], "header.sticky", found) };
  }, issues);
}

function readFooterAt(raw: unknown, issues: ContentIssue[]): ThemeDocument["footer"] | null {
  return section((found) => {
    const obj = objectAt(raw, "footer", ["note", "showSocial"], found);
    if (obj === null) return null;
    const note =
      obj["note"] === undefined
        ? {}
        : normalizeLocalizedText(
            obj["note"],
            { path: "footer.note", max: FOOTER_NOTE_MAX, multiline: true },
            found,
          );
    return { note, showSocial: booleanAt(obj["showSocial"], "footer.showSocial", found) };
  }, issues);
}

function byteLength(raw: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(raw) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** The write-path validator (API, editor): strict, every issue reported with a path and a code. */
export function validateThemeDocument(raw: unknown): ValidationOutcome<ThemeDocument> {
  if (byteLength(raw) > MAX_DOCUMENT_BYTES)
    return { ok: false, issues: [{ path: "", code: "DOCUMENT_TOO_LARGE" }] };
  const issues: ContentIssue[] = [];
  const obj = objectAt(raw, "", ["schemaVersion", "brand", "header", "footer", "homepage"], issues);
  if (obj === null) return { ok: false, issues };
  if (obj["schemaVersion"] !== 1 && "schemaVersion" in obj)
    issues.push({ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" });
  const brand = readBrandAt(obj["brand"], "brand", issues);
  const header = readHeaderAt(obj["header"], issues);
  const footer = readFooterAt(obj["footer"], issues);
  const homepage = objectAt(obj["homepage"], "homepage", ["sections"], issues);
  if (homepage !== null) {
    const sections = homepage["sections"];
    if (!Array.isArray(sections)) issues.push({ path: "homepage.sections", code: "INVALID_VALUE" });
    else if (sections.length > 0)
      issues.push({ path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" });
  }
  // Issues are reported in document order: top-level unknown keys first (objectAt above), then fields.
  issues.sort((a, b) => order(a.path) - order(b.path));
  if (issues.length > 0 || brand === null || header === null || footer === null)
    return { ok: false, issues };
  return {
    ok: true,
    value: { schemaVersion: 1, brand, header, footer, homepage: { sections: [] } },
  };
}

const TOP_ORDER = ["", "schemaVersion", "brand", "header", "footer", "homepage"];
function order(path: string): number {
  const top = path.split(".")[0] ?? "";
  const index = TOP_ORDER.indexOf(top);
  return index === -1 ? -1 : index;
}

/** The read-path reader (storefront, admin reads, upcasting): never throws, falls back per section. */
export function readThemeDocument(raw: unknown): ThemeDocument {
  const ignored: ContentIssue[] = [];
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Raw) : {};
  const homepage = obj["homepage"];
  const sections =
    typeof homepage === "object" &&
    homepage !== null &&
    Array.isArray((homepage as Raw)["sections"])
      ? ((homepage as Raw)["sections"] as unknown[])
      : [];
  return {
    schemaVersion: 1,
    brand: readBrandAt(obj["brand"], "brand", ignored) ?? readPartialBrand(obj["brand"]),
    header: readHeaderAt(obj["header"], ignored) ?? DEFAULT_THEME_DOCUMENT.header,
    footer: readFooterAt(obj["footer"], ignored) ?? DEFAULT_THEME_DOCUMENT.footer,
    homepage: { sections },
  };
}

/** A brand that failed validation as a whole: the default brand (a broken palette never half-applies). */
function readPartialBrand(_raw: unknown): ThemeBrand {
  return DEFAULT_THEME_DOCUMENT.brand;
}

/** For the storefront's defence in depth: each group falls back to its default independently. */
export function readBrandStyle(raw: unknown): BrandStyle {
  const obj = typeof raw === "object" && raw !== null ? (raw as Raw) : {};
  const ignored: ContentIssue[] = [];
  return {
    colors: readColors(obj["colors"], "colors", ignored) ?? DEFAULT_THEME_DOCUMENT.brand.colors,
    typography:
      readTypography(obj["typography"], "typography", ignored) ??
      DEFAULT_THEME_DOCUMENT.brand.typography,
    corners:
      readCorners(obj["corners"], "corners", ignored) ?? DEFAULT_THEME_DOCUMENT.brand.corners,
  };
}

export function readSocial(raw: unknown): ThemeBrand["social"] {
  const result: Partial<Record<SocialNetwork, string>> = {};
  if (typeof raw !== "object" || raw === null) return result;
  for (const network of SOCIAL_NETWORKS) {
    const url = socialUrlAt((raw as Raw)[network], network, []);
    if (url !== null && (raw as Raw)[network] !== undefined) result[network] = url;
  }
  return result;
}

export function imageRefsOf(doc: ThemeDocument): string[] {
  return [doc.brand.logo.imageRef, doc.brand.favicon.imageRef].filter(
    (id): id is string => id !== null,
  );
}

/** Stable JSON for equality: the reader rebuilds keys in one order whatever the storage did. */
export function canonicalDocumentJson(raw: unknown): string {
  return JSON.stringify(readThemeDocument(raw));
}
```

Note for the implementer: the `issues` ordering in the tests is document order (top-level unknown keys, then `schemaVersion`, `brand.*`, `header.*`, `footer.*`, `homepage.*`); `Array.prototype.sort` is stable, so fields inside one top-level key keep the order they were found in. Run `pnpm --filter @platform/storefront-content exec prettier --write src` before committing (the snippets above are compressed for the plan).

`src/contrast-rules.ts`:

```ts
import { contrastRatio } from "@platform/design";
import type { ContentIssue } from "./locale";
import type { BrandColors } from "./theme-document";

export interface ContrastWarning {
  readonly pair: "foreground" | "primaryForeground" | "accentForeground";
  readonly ratio: number;
  readonly minimum: 4.5;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Spec 1.3: only body text under 3:1 blocks a save; every pair under 4.5:1 warns. */
export function checkBrandContrast(colors: BrandColors): {
  readonly blocking: ContentIssue[];
  readonly warnings: ContrastWarning[];
} {
  const blocking: ContentIssue[] = [];
  const warnings: ContrastWarning[] = [];
  const body = contrastRatio(colors.foreground, colors.background);
  if (body < 3) blocking.push({ path: "brand.colors.foreground", code: "CONTRAST_TOO_LOW" });
  else if (body < 4.5) warnings.push({ pair: "foreground", ratio: round2(body), minimum: 4.5 });
  const pairs = [
    ["primaryForeground", colors.primaryForeground, colors.primary],
    ["accentForeground", colors.accentForeground, colors.accent],
  ] as const;
  for (const [pair, text, fill] of pairs) {
    const ratio = contrastRatio(text, fill);
    if (ratio < 4.5) warnings.push({ pair, ratio: round2(ratio), minimum: 4.5 });
  }
  return { blocking, warnings };
}
```

`src/css-vars.ts`:

```ts
import { contrastRatio } from "@platform/design";
import { mixHex, type HexColor } from "./color";
import { fontStack } from "./fonts";
import { readBrandStyle, type BaseSize, type BrandStyle, type CornerStyle } from "./theme-document";

export const BASE_SIZE_PX: Readonly<Record<BaseSize, number>> = {
  small: 14,
  medium: 15,
  large: 16,
};

const STEPS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
export const RADIUS_SCALES: Readonly<Record<CornerStyle, readonly number[]>> = {
  square: [0, 0, 0, 0, 0, 0, 0],
  rounded: [4, 6, 8, 12, 16, 20, 28],
  pill: [8, 12, 16, 20, 24, 28, 32],
};

const WHITE: HexColor = "#ffffff";
const BLACK: HexColor = "#000000";

/**
 * Spec 1.3 "Derived tokens": every semantic var the storefront paints with, computed from the six
 * colours, the fonts, the size and the corners. Values are hex, px or fixed font stacks only.
 */
export function brandToCssVars(style: BrandStyle): Readonly<Record<string, string>> {
  const {
    background: bg,
    foreground: fg,
    primary,
    primaryForeground,
    accent,
    accentForeground,
  } = style.colors;
  // A light canvas lifts its cards towards white; a dark one lifts them towards the text colour.
  const darkCanvas = contrastRatio(bg, WHITE) > contrastRatio(bg, BLACK);
  const card = darkCanvas ? mixHex(bg, fg, 0.08) : mixHex(bg, WHITE, 0.75);
  const vars: Record<string, string> = {
    "--background": bg,
    "--foreground": fg,
    "--card": card,
    "--card-foreground": fg,
    "--popover": card,
    "--popover-foreground": fg,
    "--surface": mixHex(bg, fg, 0.04),
    "--surface-foreground": fg,
    "--muted": mixHex(bg, fg, 0.05),
    "--muted-foreground": mixHex(fg, bg, 0.35),
    "--subtle-foreground": mixHex(fg, bg, 0.5),
    "--secondary": mixHex(bg, fg, 0.05),
    "--secondary-foreground": fg,
    "--accent": mixHex(bg, fg, 0.06),
    "--accent-foreground": fg,
    "--border": mixHex(bg, fg, 0.12),
    "--border-strong": mixHex(bg, fg, 0.2),
    "--input": mixHex(bg, fg, 0.45),
    "--ring": primary,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--primary-hover": mixHex(primary, BLACK, 0.12),
    "--primary-active": mixHex(primary, BLACK, 0.22),
    "--primary-subtle": mixHex(bg, primary, 0.12),
    "--primary-subtle-foreground": mixHex(primary, BLACK, 0.3),
    "--brand-accent": accent,
    "--brand-accent-foreground": accentForeground,
    "--font-sans": fontStack(style.typography.bodyFont),
    "--font-arabic": fontStack(style.typography.bodyFont),
    "--font-heading": fontStack(style.typography.headingFont),
    "--shop-base-size": `${BASE_SIZE_PX[style.typography.baseSize]}px`,
  };
  const scale = RADIUS_SCALES[style.corners];
  STEPS.forEach((step, index) => {
    vars[`--shop-radius-${step}`] = `${scale[index] ?? 0}px`;
  });
  return vars;
}

/** The `<style id="brand">` body. Re-validates first, so a corrupt row renders the defaults. */
export function brandStyleSheet(raw: unknown): string {
  const vars = brandToCssVars(readBrandStyle(raw));
  return `:root:root:root{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(";")}}`;
}
```

`src/index.ts`:

```ts
export * from "./locale";
export * from "./color";
export * from "./fonts";
export * from "./theme-document";
export * from "./contrast-rules";
export * from "./css-vars";
```

Note: `brandStyleSheet`'s output contains `;` between declarations and ends in `}`; the test's `;\}` pattern is a `;` immediately followed by `}`, which the join never produces (there is no trailing `;`).

- [ ] **Step 9: Run the package suite, typecheck and lint**

Run: `pnpm --filter @platform/storefront-content test` (first run writes `src/__snapshots__/css-vars.test.ts.snap`; open it and confirm every value is hex, px or a font stack)
Run: `pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/storefront-content lint`
Expected: PASS, no errors. If the `ratio: 3.54` expectation is off by rounding, recompute with `contrastRatio("#888888", "#ffffff")` and fix the TEST constant, never the rule.

- [ ] **Step 10: Commit**

```bash
git add packages/storefront-content pnpm-lock.yaml
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): add the shared theme document, validators and css variables

One package for the API, admin-web and the storefront: strict ThemeDocument validator, tolerant
reader, 6-digit hex colours, contrast rules, the six-font map and brandToCssVars (Project 4 Part 1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Storage, permissions, and the `services/online-store` domain with its repositories

Model tier: **standard** (SQL must match the Prisma models exactly; the guarded writes are fully specified).

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261027000000_online_store_identity/migration.sql`
- Create: `packages/db/prisma/schema/online-store.prisma`
- Modify: `packages/db/prisma/schema/main.prisma` (append `"online_store"` to `schemas`)
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append a `describe`)
- Modify: `packages/auth/src/role-table-access-control.ts` (`"online_store"` in `SHOP_RESOURCES`)
- Modify: `packages/auth/src/role-table-access-control.test.ts` (append one `it` in `describe("RoleTableAccessControl")`)
- Modify: `scripts/ops/seed-ory-network.mjs` (nine strings in `PERMISSIONS`)
- Create: `services/online-store/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `services/online-store/src/domain/errors.ts`, `storefront-preferences.ts`, `storefront-access.ts`, `storefront-theme.ts`, `preview-token.ts`, `events.ts`, `repositories.ts`
- Create: `services/online-store/src/domain/storefront-access.test.ts`, `storefront-theme.test.ts`, `preview-token.test.ts`
- Create: `services/online-store/src/infrastructure/rows.ts`, `in-memory-repositories.ts`, `in-memory-unit-of-work.ts`, `prisma-repositories.ts`
- Create: `services/online-store/src/infrastructure/prisma-repositories.test.ts`, `tenant-isolation.test.ts`, `prisma-repositories.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 (`ThemeDocument`, `DEFAULT_THEME_DOCUMENT`, `readThemeDocument`, `canonicalDocumentJson`, `LocalizedText`, `Locale`, `ContentIssue`); `runReadScoped`, `Database`, `TransactionClient`, `Prisma` (`@platform/db`); `createFakePrisma` (`@platform/db/testing`); `tenantRowIsolationCases` (`@platform/messaging/testing`); `ConcurrencyError`, `ConflictError`, `BusinessRuleError`, `NotFoundError`, `ValidationError` (`@platform/utils`); `ok`, `err`, `Result` (`@platform/types`); `DomainEvent`, `UniqueEntityId` (`@platform/domain`).
- Produces:
  - Prisma delegates `onlineStorePreferences`, `onlineStoreAccess`, `onlineStoreTheme`, `onlineStoreThemeRelease`, `onlineStorePreviewToken`.
  - `errors.ts`: `versionConflict()`, `draftChanged()`, `nothingToPublish()`, `releaseNotFound()`, `passwordRequired()`, `imageNotFound(field)`, `invalidContent(issues)`, `CODE_PATTERN = /^([A-Z][A-Z_]+):/`.
  - `StorefrontPreferences` (`defaults()`, `reconstitute(s)`, `update(input, now)`, `snapshot()`, `nextVersion`), `HOME_TITLE_MAX = 70`, `HOME_DESCRIPTION_MAX = 320`, `PreferencesSnapshot`.
  - `StorefrontAccess` (`defaults()`, `reconstitute(s)`, `apply({ locked, newPasswordHash, message, now }): Result<void, DomainError>`, `snapshot()`, `nextVersion`), `VISITOR_MESSAGE_MAX = 500`, `PASSWORD_MIN = 4`, `PASSWORD_MAX = 100`, `parsePasswordInput(raw: string | null | undefined): { kind: "keep" } | { kind: "set"; password: string } | { kind: "invalid" }`, `AccessSnapshot`.
  - `StorefrontTheme` (`initial()`, `reconstitute(s)`, `hasUnpublishedChanges()`, `saveDraft(doc, now)`, `publish({ expectedDraftRevision, by, releaseId, now }): Result<ThemeRelease, DomainError>`, `discardDraft(now)`, `restoreRelease(release, now)`, `snapshot()`, `nextVersion`), `RELEASES_KEPT = 20`, `ThemeSnapshot`, `ThemeRelease`.
  - `preview-token.ts`: `PREVIEW_TOKEN_TTL_MS = 3_600_000`, `PREVIEW_TOKEN_MAX_LENGTH = 100`, `mintPreviewToken()`, `hashPreviewToken(token)`, `isWellFormedPreviewToken(value): value is string`, `PreviewTokenRecord`.
  - `events.ts`: `ThemePublished { releaseNumber }`, `AccessChanged { locked }`, `PreferencesUpdated {}`, `ONLINE_STORE_PUBLISHED_EVENTS`.
  - `repositories.ts`: `PreferencesRepository`, `AccessRepository`, `ThemeRepository`, `ThemeReleaseRepository`, `PreviewTokenRepository` (signatures below).
  - `InMemory*Repository` ×5, `Prisma*Repository` ×5 (each `{ prisma: Database }`), `InMemoryUnitOfWork`.

- [ ] **Step 1: Write the failing storage and permission tests**

Append to `packages/db/src/schema-migration-consistency.test.ts`:

```ts
describe("online_store — migration history matches the Prisma models (Project 4 Part 1)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => readFileSync(join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n");

  const tables: Record<string, readonly string[]> = {
    storefront_preferences: [
      "tenant_id",
      "home_title",
      "home_meta_description",
      "share_image_ref",
      "default_locale",
      "version",
      "updated_at",
    ],
    storefront_access: [
      "tenant_id",
      "locked",
      "password_hash",
      "password_updated_at",
      "message",
      "access_version",
      "version",
      "updated_at",
    ],
    storefront_themes: [
      "tenant_id",
      "draft",
      "draft_revision",
      "draft_saved_at",
      "published",
      "published_draft_revision",
      "release_number",
      "published_at",
      "published_by",
      "version",
      "created_at",
      "updated_at",
    ],
    storefront_theme_releases: [
      "id",
      "tenant_id",
      "release_number",
      "document",
      "published_at",
      "published_by",
    ],
    preview_tokens: ["id", "tenant_id", "token_hash", "expires_at", "created_by", "created_at"],
  };

  it("creates the schema before its tables", () => {
    expect(allSql).toContain('CREATE SCHEMA IF NOT EXISTS "online_store";');
  });

  for (const [table, columns] of Object.entries(tables)) {
    it(`${table} has exactly the model's columns`, () => {
      expect([...columnsEverAddedTo("online_store", table, allSql)].sort()).toEqual(
        [...columns].sort(),
      );
    });

    it(`${table} is RLS-forced with the tenant_isolation policy`, () => {
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" ENABLE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(`ALTER TABLE "online_store"."${table}" FORCE ROW LEVEL SECURITY;`);
      expect(allSql).toContain(
        `DROP POLICY IF EXISTS tenant_isolation ON "online_store"."${table}";`,
      );
      expect(allSql).toContain(
        `CREATE POLICY tenant_isolation ON "online_store"."${table}" FOR ALL`,
      );
    });
  }

  it("has the checks and indexes the spec names", () => {
    expect(allSql).toContain(
      `CONSTRAINT "storefront_preferences_default_locale_check" CHECK ("default_locale" IN ('ar', 'en'))`,
    );
    expect(allSql).toContain(
      `CONSTRAINT "storefront_access_locked_needs_password_check" CHECK (NOT "locked" OR "password_hash" IS NOT NULL)`,
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "storefront_theme_releases_tenant_id_release_number_key" ON "online_store"."storefront_theme_releases" ("tenant_id", "release_number");',
    );
    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "online_store"."preview_tokens" ("token_hash");',
    );
    expect(allSql).toContain(
      'CREATE INDEX "preview_tokens_tenant_id_expires_at_idx" ON "online_store"."preview_tokens" ("tenant_id", "expires_at");',
    );
  });

  it("is registered in the datasource schemas list", () => {
    const main = readFileSync(join(migrationsDir, "..", "main.prisma"), "utf-8");
    expect(main).toMatch(/schemas\s*=\s*\[[^\]]*"online_store"/);
  });
});
```

Append inside `describe("RoleTableAccessControl", …)` of `packages/auth/src/role-table-access-control.test.ts`:

```ts
it("online store: viewers read, operators edit, only admins publish and lock (Project 4)", async () => {
  const writes = [
    "online_store:update_preferences",
    "online_store:upload_image",
    "online_store:edit_theme",
    "online_store:manage_menus",
    "online_store:manage_policies",
  ];
  const adminOnly = ["online_store_admin:publish_theme", "online_store_admin:update_access"];
  for (const role of ["viewer", "operator", "admin"]) {
    expect(await acl.authorize(who([role]), "online_store:read"), role).toBe(true);
  }
  for (const permission of writes) {
    expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
    expect(await acl.authorize(who(["operator"]), permission), permission).toBe(true);
  }
  for (const permission of adminOnly) {
    expect(await acl.authorize(who(["viewer"]), permission), permission).toBe(false);
    expect(await acl.authorize(who(["operator"]), permission), permission).toBe(false);
    expect(await acl.authorize(who(["admin"]), permission), permission).toBe(true);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts`
Expected: FAIL — no `online_store` schema or tables.
Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts`
Expected: FAIL — operator lacks `online_store:edit_theme`.

- [ ] **Step 3: Write the migration, the models and the permission changes**

`packages/db/prisma/schema/migrations/20261027000000_online_store_identity/migration.sql`:

```sql
-- Project 4 Part 1 — Online Store identity: preferences, the password lock, the theme document
-- (draft + published + releases) and hashed preview tokens. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console BEFORE the release that reads these tables.
-- Additive and expand-only (MIGRATIONS.md §1): a new schema, five new tables, nothing existing is
-- altered, and there is no backfill (an absent row means the defaults, spec 1.2). Every table is
-- tenant-scoped and gets its OWN RLS policy explicitly, exactly as 20261013000000_store_shipping_taxes.
-- No FKs to other schemas (bare-id refs, D-002). No grants: earlier migrations add none.
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "online_store";

CREATE TABLE "online_store"."storefront_preferences" (
  "tenant_id"             TEXT         NOT NULL,
  "home_title"            JSONB        NOT NULL DEFAULT '{}',
  "home_meta_description" JSONB        NOT NULL DEFAULT '{}',
  "share_image_ref"       TEXT,
  "default_locale"        TEXT         NOT NULL DEFAULT 'ar',
  "version"               INTEGER      NOT NULL DEFAULT 0,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_preferences_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_preferences_default_locale_check" CHECK ("default_locale" IN ('ar', 'en'))
);
ALTER TABLE "online_store"."storefront_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_preferences";
CREATE POLICY tenant_isolation ON "online_store"."storefront_preferences" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_access" (
  "tenant_id"           TEXT         NOT NULL,
  "locked"              BOOLEAN      NOT NULL DEFAULT false,
  "password_hash"       TEXT,
  "password_updated_at" TIMESTAMP(3),
  "message"             JSONB        NOT NULL DEFAULT '{}',
  "access_version"      INTEGER      NOT NULL DEFAULT 1,
  "version"             INTEGER      NOT NULL DEFAULT 0,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_access_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_access_locked_needs_password_check" CHECK (NOT "locked" OR "password_hash" IS NOT NULL)
);
ALTER TABLE "online_store"."storefront_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_access";
CREATE POLICY tenant_isolation ON "online_store"."storefront_access" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_themes" (
  "tenant_id"                TEXT         NOT NULL,
  "draft"                    JSONB        NOT NULL,
  "draft_revision"           INTEGER      NOT NULL DEFAULT 1,
  "draft_saved_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published"                JSONB,
  "published_draft_revision" INTEGER,
  "release_number"           INTEGER      NOT NULL DEFAULT 0,
  "published_at"             TIMESTAMP(3),
  "published_by"             TEXT,
  "version"                  INTEGER      NOT NULL DEFAULT 0,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_themes_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "online_store"."storefront_themes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_themes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_themes";
CREATE POLICY tenant_isolation ON "online_store"."storefront_themes" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."storefront_theme_releases" (
  "id"             UUID         NOT NULL,
  "tenant_id"      TEXT         NOT NULL,
  "release_number" INTEGER      NOT NULL,
  "document"       JSONB        NOT NULL,
  "published_at"   TIMESTAMP(3) NOT NULL,
  "published_by"   TEXT         NOT NULL,
  CONSTRAINT "storefront_theme_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storefront_theme_releases_tenant_id_release_number_key" ON "online_store"."storefront_theme_releases" ("tenant_id", "release_number");
ALTER TABLE "online_store"."storefront_theme_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."storefront_theme_releases" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."storefront_theme_releases";
CREATE POLICY tenant_isolation ON "online_store"."storefront_theme_releases" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE "online_store"."preview_tokens" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "token_hash" TEXT         NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "online_store"."preview_tokens" ("token_hash");
CREATE INDEX "preview_tokens_tenant_id_expires_at_idx" ON "online_store"."preview_tokens" ("tenant_id", "expires_at");
ALTER TABLE "online_store"."preview_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "online_store"."preview_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "online_store"."preview_tokens";
CREATE POLICY tenant_isolation ON "online_store"."preview_tokens" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "online_store"."preview_tokens" IS
  'Project 4: staff preview links. Only SHA-256(token) is stored; tokens expire after 60 minutes.';

RESET row_security;
```

`packages/db/prisma/schema/online-store.prisma`:

```prisma
// `online_store` schema — Online Store (services/online-store, Project 4). One row per shop for
// preferences, access and the theme document; releases and preview tokens are per shop. Bare-id
// refs only (share_image_ref, image refs inside the JSON documents are media asset ids).

model OnlineStorePreferences {
  tenantId            String   @id @map("tenant_id")
  homeTitle           Json     @default("{}") @map("home_title")
  homeMetaDescription Json     @default("{}") @map("home_meta_description")
  shareImageRef       String?  @map("share_image_ref")
  defaultLocale       String   @default("ar") @map("default_locale") // ar | en (CHECK + domain)
  version             Int      @default(0)
  updatedAt           DateTime @default(now()) @updatedAt @map("updated_at")

  @@map("storefront_preferences")
  @@schema("online_store")
}

model OnlineStoreAccess {
  tenantId          String    @id @map("tenant_id")
  locked            Boolean   @default(false)
  /// scrypt hash from the password hasher; never leaves the service.
  passwordHash      String?   @map("password_hash")
  passwordUpdatedAt DateTime? @map("password_updated_at")
  message           Json      @default("{}")
  accessVersion     Int       @default(1) @map("access_version")
  version           Int       @default(0)
  updatedAt         DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("storefront_access")
  @@schema("online_store")
}

model OnlineStoreTheme {
  tenantId               String    @id @map("tenant_id")
  draft                  Json
  draftRevision          Int       @default(1) @map("draft_revision")
  draftSavedAt           DateTime  @default(now()) @map("draft_saved_at")
  published              Json?
  publishedDraftRevision Int?      @map("published_draft_revision")
  releaseNumber          Int       @default(0) @map("release_number")
  publishedAt            DateTime? @map("published_at")
  publishedBy            String?   @map("published_by")
  version                Int       @default(0)
  createdAt              DateTime  @default(now()) @map("created_at")
  updatedAt              DateTime  @default(now()) @updatedAt @map("updated_at")

  @@map("storefront_themes")
  @@schema("online_store")
}

model OnlineStoreThemeRelease {
  id            String   @id @db.Uuid
  tenantId      String   @map("tenant_id")
  releaseNumber Int      @map("release_number")
  document      Json
  publishedAt   DateTime @map("published_at")
  publishedBy   String   @map("published_by")

  @@unique([tenantId, releaseNumber])
  @@map("storefront_theme_releases")
  @@schema("online_store")
}

model OnlineStorePreviewToken {
  id        String   @id @db.Uuid
  tenantId  String   @map("tenant_id")
  tokenHash String   @unique @map("token_hash")
  expiresAt DateTime @map("expires_at")
  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([tenantId, expiresAt])
  @@map("preview_tokens")
  @@schema("online_store")
}
```

In `packages/db/prisma/schema/main.prisma`, append `, "online_store"` at the end of the `schemas = [...]` list (after `"customer_360"`).

In `packages/auth/src/role-table-access-control.ts`, add `"online_store",` to `SHOP_RESOURCES` after `"notifications",`, with a comment line above the array entry: `// Project 4: online_store_admin (publish, lock) is deliberately NOT here — admin only.`

In `scripts/ops/seed-ory-network.mjs`, add to `PERMISSIONS` in alphabetical position (after `"notifications:read",`):

```js
  "online_store:edit_theme",
  "online_store:manage_menus",
  "online_store:manage_policies",
  "online_store:read",
  "online_store:update_preferences",
  "online_store:upload_image",
  "online_store_admin:publish_theme",
  "online_store_admin:update_access",
```

and after `"pages:read",`:

```js
  "pages:update_page",
```

- [ ] **Step 4: Run them to verify they pass; validate and generate Prisma**

Run: `pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts` — PASS.
Run: `pnpm --filter @platform/auth exec vitest run src/role-table-access-control.test.ts` — PASS.
Run: `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` — "The schema … is valid".
Run: the same with `prisma generate` — client generated with `onlineStore*` delegates. **Never run `prisma migrate`.**

- [ ] **Step 5: Scaffold `services/online-store`**

`services/online-store/package.json`:

```json
{
  "name": "@platform/online-store",
  "version": "0.0.0",
  "private": true,
  "description": "Online Store bounded context — preferences, password lock, theme draft/publish/releases, preview tokens (Project 4).",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@platform/application": "workspace:*",
    "@platform/contracts": "workspace:*",
    "@platform/db": "workspace:*",
    "@platform/domain": "workspace:*",
    "@platform/domain-events": "workspace:*",
    "@platform/messaging": "workspace:*",
    "@platform/repository": "workspace:*",
    "@platform/storefront-content": "workspace:*",
    "@platform/types": "workspace:*",
    "@platform/utils": "workspace:*",
    "@prisma/client": "^6.5.0"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig": "workspace:*",
    "@types/node": "^22.7.5",
    "@vitest/coverage-v8": "^2.1.4",
    "eslint": "^9.13.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`tsconfig.json` and `vitest.config.ts`: copy `services/theme/tsconfig.json` verbatim, and `services/theme/vitest.config.ts` with thresholds `{ lines: 85, statements: 85, functions: 85, branches: 80 }` and no ratchet comment. Run `pnpm install`.

- [ ] **Step 6: Write the failing domain tests**

`src/domain/storefront-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePasswordInput, StorefrontAccess } from "./storefront-access";

const now = new Date("2026-10-27T10:00:00.000Z");

describe("parsePasswordInput", () => {
  it.each([
    [undefined, { kind: "keep" }],
    [null, { kind: "keep" }],
    ["   ", { kind: "keep" }],
    ["abc", { kind: "invalid" }],
    ["x".repeat(101), { kind: "invalid" }],
    ["  ١٢٣٤  ", { kind: "set", password: "١٢٣٤" }],
    ["open sesame", { kind: "set", password: "open sesame" }],
  ])("%j → %j", (raw, expected) => {
    expect(parsePasswordInput(raw)).toEqual(expected);
  });
});

describe("StorefrontAccess", () => {
  it("is unlocked with no password by default, access version 1", () => {
    const access = StorefrontAccess.defaults();
    expect(access.snapshot()).toMatchObject({
      locked: false,
      passwordHash: null,
      accessVersion: 1,
      version: 0,
      persisted: false,
    });
  });

  it("refuses to lock without any password, and changes nothing", () => {
    const access = StorefrontAccess.defaults();
    const result = access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^PASSWORD_REQUIRED:/);
    expect(access.snapshot().locked).toBe(false);
  });

  it("bumps the access version on a password change and on unlocked → locked only", () => {
    const access = StorefrontAccess.defaults();
    access.apply({ locked: false, newPasswordHash: "h1", message: {}, now });
    expect(access.snapshot().accessVersion).toBe(2);
    expect(access.snapshot().passwordUpdatedAt).toEqual(now);
    access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: true, newPasswordHash: null, message: { ar: "قريبًا" }, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: false, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(3);
    access.apply({ locked: true, newPasswordHash: null, message: {}, now });
    expect(access.snapshot().accessVersion).toBe(4);
  });
});
```

`src/domain/storefront-theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT, type ThemeDocument } from "@platform/storefront-content";
import { StorefrontTheme } from "./storefront-theme";

const t0 = new Date("2026-10-27T10:00:00.000Z");
const branded: ThemeDocument = {
  ...DEFAULT_THEME_DOCUMENT,
  brand: { ...DEFAULT_THEME_DOCUMENT.brand, corners: "pill" },
};

describe("StorefrontTheme", () => {
  it("starts on the default document, revision 0, never published, nothing to publish", () => {
    const theme = StorefrontTheme.initial();
    expect(theme.snapshot()).toMatchObject({
      draftRevision: 0,
      published: null,
      releaseNumber: 0,
      persisted: false,
    });
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("each draft save bumps the revision", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.saveDraft(branded, t0);
    expect(theme.snapshot().draftRevision).toBe(2);
    expect(theme.hasUnpublishedChanges()).toBe(true);
  });

  it("publishes exactly the previewed revision and returns the release", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    const release = theme.publish({
      expectedDraftRevision: 1,
      by: "staff-1",
      releaseId: "r1",
      now: t0,
    });
    expect(release.ok && release.value).toEqual({
      id: "r1",
      releaseNumber: 1,
      document: branded,
      publishedAt: t0,
      publishedBy: "staff-1",
    });
    expect(theme.snapshot()).toMatchObject({
      published: branded,
      publishedDraftRevision: 1,
      releaseNumber: 1,
      publishedBy: "staff-1",
    });
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("refuses a stale revision with DRAFT_CHANGED and an unchanged draft with NOTHING_TO_PUBLISH", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.saveDraft(branded, t0);
    const stale = theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    expect(!stale.ok && stale.error.message).toMatch(/^DRAFT_CHANGED:/);
    expect(theme.snapshot().releaseNumber).toBe(0);
    theme.publish({ expectedDraftRevision: 2, by: "s", releaseId: "r", now: t0 });
    const again = theme.publish({ expectedDraftRevision: 2, by: "s", releaseId: "r2", now: t0 });
    expect(!again.ok && again.error.message).toMatch(/^NOTHING_TO_PUBLISH:/);
  });

  it("discard returns the draft to the live document and still bumps the revision", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    theme.saveDraft(DEFAULT_THEME_DOCUMENT, t0);
    theme.discardDraft(t0);
    expect(theme.snapshot().draft).toEqual(branded);
    expect(theme.snapshot().draftRevision).toBe(3);
    expect(theme.hasUnpublishedChanges()).toBe(false);
  });

  it("restoring a release copies it into the draft, never to live", () => {
    const theme = StorefrontTheme.initial();
    theme.saveDraft(branded, t0);
    theme.publish({ expectedDraftRevision: 1, by: "s", releaseId: "r", now: t0 });
    theme.restoreRelease(
      {
        id: "old",
        releaseNumber: 1,
        document: DEFAULT_THEME_DOCUMENT,
        publishedAt: t0,
        publishedBy: "s",
      },
      t0,
    );
    expect(theme.snapshot().draft).toEqual(DEFAULT_THEME_DOCUMENT);
    expect(theme.snapshot().published).toEqual(branded);
    expect(theme.hasUnpublishedChanges()).toBe(true);
  });
});
```

`src/domain/preview-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPreviewToken, isWellFormedPreviewToken, mintPreviewToken } from "./preview-token";

describe("preview tokens", () => {
  it("mints 32 random bytes as base64url (43 characters), different every time", () => {
    const a = mintPreviewToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mintPreviewToken()).not.toBe(a);
  });

  it("hashes to lower-case hex SHA-256, never the token itself", () => {
    const token = mintPreviewToken();
    expect(hashPreviewToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPreviewToken(token)).not.toContain(token);
  });

  it.each([
    ["", false],
    ["short", false],
    ["a".repeat(101), false],
    ["has space and !".padEnd(43, "x"), false],
    ["A".repeat(43), true],
  ])("isWellFormedPreviewToken(%j) = %s", (value, expected) => {
    expect(isWellFormedPreviewToken(value)).toBe(expected);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/domain`
Expected: FAIL — modules not found.

- [ ] **Step 8: Implement the domain**

`src/domain/errors.ts`:

```ts
import type { ContentIssue } from "@platform/storefront-content";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "@platform/utils";

/** Ruling 9: every specific code is the message prefix; the presenter copies it into `body.code`. */
export const CODE_PATTERN = /^([A-Z][A-Z_]+):/;

export const versionConflict = () =>
  new ConflictError("VERSION_CONFLICT: This was changed in another window. Reload to continue.");
export const draftChanged = () =>
  new ConflictError("DRAFT_CHANGED: The draft changed after it was previewed. Preview it again.");
export const nothingToPublish = () =>
  new BusinessRuleError("NOTHING_TO_PUBLISH: The draft has no unpublished changes.");
export const releaseNotFound = () => new NotFoundError("RELEASE_NOT_FOUND: No such release.");
export const passwordRequired = () =>
  new ValidationError("PASSWORD_REQUIRED: Set a password before locking the store.", [
    { field: "password", message: "PASSWORD_REQUIRED" },
  ]);
export const imageNotFound = (field: string) =>
  new ValidationError("IMAGE_NOT_FOUND: The image does not exist in this store.", [
    { field, message: "IMAGE_NOT_FOUND" },
  ]);
export const invalidContent = (issues: readonly ContentIssue[]) => {
  const top = issues.find((issue) => issue.path === "");
  const code = top?.code ?? "INVALID_CONTENT";
  return new ValidationError(
    `${code}: Check the highlighted fields.`,
    issues.map((issue) => ({ field: issue.path, message: issue.code })),
  );
};
```

`src/domain/storefront-preferences.ts`:

```ts
import type { Locale, LocalizedText } from "@platform/storefront-content";

export const HOME_TITLE_MAX = 70;
export const HOME_DESCRIPTION_MAX = 320;

export interface PreferencesSnapshot {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImageRef: string | null;
  readonly defaultLocale: Locale;
  readonly version: number;
  readonly updatedAt: Date | null;
  /** False until the first save inserts the row (an absent row means the defaults). */
  readonly persisted: boolean;
}

export interface PreferencesInput {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImageRef: string | null;
  readonly defaultLocale: Locale;
}

/** Shopify's Online Store → Preferences: live on save, no draft (spec 1.4). */
export class StorefrontPreferences {
  private state: PreferencesSnapshot;

  private constructor(state: PreferencesSnapshot) {
    this.state = state;
  }

  static defaults(): StorefrontPreferences {
    return new StorefrontPreferences({
      homeTitle: {},
      homeMetaDescription: {},
      shareImageRef: null,
      defaultLocale: "ar",
      version: 0,
      updatedAt: null,
      persisted: false,
    });
  }

  static reconstitute(snapshot: PreferencesSnapshot): StorefrontPreferences {
    return new StorefrontPreferences(snapshot);
  }

  /** Input is already normalised and ownership-checked by the use case. */
  update(input: PreferencesInput, now: Date): void {
    this.state = { ...this.state, ...input, updatedAt: now };
  }

  snapshot(): PreferencesSnapshot {
    return this.state;
  }

  /** The version the row will carry after a successful save. */
  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
```

`src/domain/storefront-access.ts`:

```ts
import type { LocalizedText } from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { passwordRequired } from "./errors";

export const VISITOR_MESSAGE_MAX = 500;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 100;

export interface AccessSnapshot {
  readonly locked: boolean;
  readonly passwordHash: string | null;
  readonly passwordUpdatedAt: Date | null;
  readonly message: LocalizedText;
  readonly accessVersion: number;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly persisted: boolean;
}

/** Ruling 10: omitted, null or blank keeps the current password; any script is allowed. */
export function parsePasswordInput(
  raw: string | null | undefined,
):
  | { readonly kind: "keep" }
  | { readonly kind: "set"; readonly password: string }
  | { readonly kind: "invalid" } {
  if (raw === undefined || raw === null) return { kind: "keep" };
  const password = raw.trim();
  if (password.length === 0) return { kind: "keep" };
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { kind: "invalid" };
  return { kind: "set", password };
}

/** The storefront password lock (spec 1.5). The hash never leaves this aggregate's snapshot. */
export class StorefrontAccess {
  private state: AccessSnapshot;

  private constructor(state: AccessSnapshot) {
    this.state = state;
  }

  static defaults(): StorefrontAccess {
    return new StorefrontAccess({
      locked: false,
      passwordHash: null,
      passwordUpdatedAt: null,
      message: {},
      accessVersion: 1,
      version: 0,
      updatedAt: null,
      persisted: false,
    });
  }

  static reconstitute(snapshot: AccessSnapshot): StorefrontAccess {
    return new StorefrontAccess(snapshot);
  }

  /**
   * Validates first, mutates only on success. `accessVersion` bumps when the password changes and
   * when the store goes from unlocked to locked, which revokes every unlock cookie at once.
   */
  apply(input: {
    readonly locked: boolean;
    readonly newPasswordHash: string | null;
    readonly message: LocalizedText;
    readonly now: Date;
  }): Result<void, DomainError> {
    const hash = input.newPasswordHash ?? this.state.passwordHash;
    if (input.locked && hash === null) return err(passwordRequired());
    const passwordChanged = input.newPasswordHash !== null;
    const relocked = input.locked && !this.state.locked;
    this.state = {
      ...this.state,
      locked: input.locked,
      passwordHash: hash,
      passwordUpdatedAt: passwordChanged ? input.now : this.state.passwordUpdatedAt,
      message: input.message,
      accessVersion: this.state.accessVersion + (passwordChanged || relocked ? 1 : 0),
      updatedAt: input.now,
    };
    return ok(undefined);
  }

  snapshot(): AccessSnapshot {
    return this.state;
  }

  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
```

`src/domain/storefront-theme.ts`:

```ts
import {
  canonicalDocumentJson,
  DEFAULT_THEME_DOCUMENT,
  type ThemeDocument,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { draftChanged, nothingToPublish } from "./errors";

export const RELEASES_KEPT = 20;

export interface ThemeRelease {
  readonly id: string;
  readonly releaseNumber: number;
  readonly document: ThemeDocument;
  readonly publishedAt: Date;
  readonly publishedBy: string;
}

export interface ThemeSnapshot {
  readonly draft: ThemeDocument;
  readonly draftRevision: number;
  readonly draftSavedAt: Date | null;
  readonly published: ThemeDocument | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: Date | null;
  readonly publishedBy: string | null;
  readonly version: number;
  readonly persisted: boolean;
}

/** One live theme with one draft (spec 1.2/1.8). Publish is bound to the previewed revision. */
export class StorefrontTheme {
  private state: ThemeSnapshot;

  private constructor(state: ThemeSnapshot) {
    this.state = state;
  }

  static initial(): StorefrontTheme {
    return new StorefrontTheme({
      draft: DEFAULT_THEME_DOCUMENT,
      draftRevision: 0,
      draftSavedAt: null,
      published: null,
      publishedDraftRevision: null,
      releaseNumber: 0,
      publishedAt: null,
      publishedBy: null,
      version: 0,
      persisted: false,
    });
  }

  static reconstitute(snapshot: ThemeSnapshot): StorefrontTheme {
    return new StorefrontTheme(snapshot);
  }

  /** Ruling 7: a content comparison, independent of JSONB key order. */
  hasUnpublishedChanges(): boolean {
    return (
      canonicalDocumentJson(this.state.draft) !==
      canonicalDocumentJson(this.state.published ?? DEFAULT_THEME_DOCUMENT)
    );
  }

  saveDraft(document: ThemeDocument, now: Date): void {
    this.state = {
      ...this.state,
      draft: document,
      draftRevision: this.state.draftRevision + 1,
      draftSavedAt: now,
    };
  }

  publish(input: {
    readonly expectedDraftRevision: number;
    readonly by: string;
    readonly releaseId: string;
    readonly now: Date;
  }): Result<ThemeRelease, DomainError> {
    if (input.expectedDraftRevision !== this.state.draftRevision) return err(draftChanged());
    if (!this.hasUnpublishedChanges()) return err(nothingToPublish());
    const releaseNumber = this.state.releaseNumber + 1;
    this.state = {
      ...this.state,
      published: this.state.draft,
      publishedDraftRevision: this.state.draftRevision,
      releaseNumber,
      publishedAt: input.now,
      publishedBy: input.by,
    };
    return ok({
      id: input.releaseId,
      releaseNumber,
      document: this.state.draft,
      publishedAt: input.now,
      publishedBy: input.by,
    });
  }

  discardDraft(now: Date): void {
    this.saveDraft(this.state.published ?? DEFAULT_THEME_DOCUMENT, now);
  }

  restoreRelease(release: ThemeRelease, now: Date): void {
    this.saveDraft(release.document, now);
  }

  snapshot(): ThemeSnapshot {
    return this.state;
  }

  get nextVersion(): number {
    return this.state.persisted ? this.state.version + 1 : 1;
  }
}
```

`src/domain/preview-token.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export const PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_TOKEN_MAX_LENGTH = 100;
const SHAPE = /^[A-Za-z0-9_-]{32,100}$/;

export interface PreviewTokenRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** 256 random bits, base64url (Plan 1C's shape). Exists once: in the 201 body and the preview URL. */
export function mintPreviewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored and looked up. Never the token. */
export function hashPreviewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedPreviewToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= PREVIEW_TOKEN_MAX_LENGTH && SHAPE.test(value);
}
```

(`isWellFormedPreviewToken("A".repeat(43))` is true; the 43-character string with spaces fails the shape.)

`src/domain/events.ts`:

```ts
import { DomainEvent, type DomainEventProps } from "@platform/domain";

/** Audit-trail events (spec 1.8). No consumer in this project; payloads carry no tenant and no secret. */
export class ThemePublished extends DomainEvent {
  readonly eventName = "online_store.theme.published";
  readonly data: { readonly releaseNumber: number };
  constructor(props: DomainEventProps, data: { readonly releaseNumber: number }) {
    super(props);
    this.data = data;
  }
}

export class AccessChanged extends DomainEvent {
  readonly eventName = "online_store.access.changed";
  readonly data: { readonly locked: boolean };
  constructor(props: DomainEventProps, data: { readonly locked: boolean }) {
    super(props);
    this.data = data;
  }
}

export class PreferencesUpdated extends DomainEvent {
  readonly eventName = "online_store.preferences.updated";
  readonly data: Record<string, never> = {};
}

export const ONLINE_STORE_PUBLISHED_EVENTS: readonly string[] = [
  "online_store.theme.published",
  "online_store.access.changed",
  "online_store.preferences.updated",
];
```

`src/domain/repositories.ts`:

```ts
import type { StorefrontAccess } from "./storefront-access";
import type { StorefrontPreferences } from "./storefront-preferences";
import type { StorefrontTheme, ThemeRelease } from "./storefront-theme";
import type { PreviewTokenRecord } from "./preview-token";

/**
 * ADR-0014: every method takes `tenantId` per call. `get` never returns null: an absent row is the
 * aggregate's defaults with `persisted: false`. `save` requires the unit of work's `tx`, inserts on
 * the first save and is a version-guarded update afterwards; a lost race throws `ConcurrencyError`.
 */
export interface PreferencesRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontPreferences>;
  save(preferences: StorefrontPreferences, tenantId: string, tx: unknown): Promise<void>;
}

export interface AccessRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontAccess>;
  save(access: StorefrontAccess, tenantId: string, tx: unknown): Promise<void>;
}

export interface ThemeRepository {
  get(tenantId: string, tx?: unknown): Promise<StorefrontTheme>;
  save(theme: StorefrontTheme, tenantId: string, tx: unknown): Promise<void>;
}

export interface ThemeReleaseRepository {
  append(release: ThemeRelease, tenantId: string, tx: unknown): Promise<void>;
  /** Newest first, at most `limit`. */
  list(tenantId: string, limit: number, tx?: unknown): Promise<readonly ThemeRelease[]>;
  get(releaseNumber: number, tenantId: string, tx?: unknown): Promise<ThemeRelease | null>;
  /** Deletes every release older than the newest `keep`; returns how many went. */
  pruneBeyond(keep: number, tenantId: string, tx: unknown): Promise<number>;
}

export interface PreviewTokenRepository {
  insert(record: PreviewTokenRecord, tenantId: string, tx: unknown): Promise<void>;
  /** The unexpired token with this hash IN THIS SHOP, or null. A token of shop A is unknown in B. */
  findActive(tokenHash: string, tenantId: string, now: Date): Promise<PreviewTokenRecord | null>;
  deleteExpired(tenantId: string, now: Date, tx: unknown): Promise<number>;
}
```

- [ ] **Step 9: Run the domain tests**

Run: `pnpm --filter @platform/online-store exec vitest run src/domain`
Expected: PASS.

- [ ] **Step 10: Write the failing repository tests**

`src/infrastructure/prisma-repositories.test.ts` (fake-backed, no database):

```ts
import { describe, expect, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { ConcurrencyError } from "@platform/utils";
import { StorefrontTheme } from "../domain/storefront-theme";
import {
  PrismaAccessRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./prisma-repositories";

const now = new Date("2026-10-27T10:00:00.000Z");

function setup() {
  const fake = createFakePrisma();
  const tx = fake.database as unknown as TransactionClient;
  const deps = { prisma: fake.database };
  return {
    fake,
    tx,
    preferences: new PrismaPreferencesRepository(deps),
    access: new PrismaAccessRepository(deps),
    themes: new PrismaThemeRepository(deps),
    releases: new PrismaThemeReleaseRepository(deps),
    tokens: new PrismaPreviewTokenRepository(deps),
  };
}

describe("Prisma online-store repositories (fake client)", () => {
  it("an absent row reads as the defaults; the first save inserts version 1", async () => {
    const { preferences, tx, fake } = setup();
    const prefs = await preferences.get("t-1");
    expect(prefs.snapshot()).toMatchObject({ defaultLocale: "ar", version: 0, persisted: false });
    prefs.update(
      {
        homeTitle: { ar: "متجر" },
        homeMetaDescription: {},
        shareImageRef: null,
        defaultLocale: "en",
      },
      now,
    );
    await preferences.save(prefs, "t-1", tx);
    expect(fake.rowsOf("onlineStorePreferences")).toEqual([
      expect.objectContaining({ tenantId: "t-1", defaultLocale: "en", version: 1 }),
    ]);
    expect((await preferences.get("t-1")).snapshot()).toMatchObject({
      version: 1,
      persisted: true,
    });
  });

  it("a save from a stale version throws ConcurrencyError and writes nothing", async () => {
    const { access, tx, fake } = setup();
    const first = await access.get("t-1");
    first.apply({ locked: false, newPasswordHash: "h", message: {}, now });
    await access.save(first, "t-1", tx);
    const a = await access.get("t-1");
    const b = await access.get("t-1");
    a.apply({ locked: true, newPasswordHash: null, message: {}, now });
    await access.save(a, "t-1", tx);
    b.apply({ locked: false, newPasswordHash: "other", message: {}, now });
    await expect(access.save(b, "t-1", tx)).rejects.toBeInstanceOf(ConcurrencyError);
    expect(fake.rowsOf("onlineStoreAccess")[0]).toMatchObject({
      locked: true,
      passwordHash: "h",
      version: 2,
    });
  });

  it("round-trips the theme documents through JSON and the tolerant reader", async () => {
    const { themes, tx } = setup();
    const theme = StorefrontTheme.initial();
    theme.saveDraft({ ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } }, now);
    theme.publish({ expectedDraftRevision: 1, by: "s-1", releaseId: "r", now });
    await themes.save(theme, "t-1", tx);
    const read = (await themes.get("t-1")).snapshot();
    expect(read.draft.header.sticky).toBe(true);
    expect(read.published?.header.sticky).toBe(true);
    expect(read).toMatchObject({
      draftRevision: 1,
      publishedDraftRevision: 1,
      releaseNumber: 1,
      version: 1,
    });
  });

  it("lists releases newest first and prunes beyond the newest N", async () => {
    const { releases, tx } = setup();
    for (let n = 1; n <= 21; n += 1) {
      await releases.append(
        {
          id: `r-${n}`,
          releaseNumber: n,
          document: DEFAULT_THEME_DOCUMENT,
          publishedAt: now,
          publishedBy: "s",
        },
        "t-1",
        tx,
      );
    }
    expect(await releases.pruneBeyond(20, "t-1", tx)).toBe(1);
    const listed = await releases.list("t-1", 20);
    expect(listed.map((r) => r.releaseNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => 21 - i),
    );
    expect(await releases.get(1, "t-1")).toBeNull();
    expect((await releases.get(2, "t-1"))?.id).toBe("r-2");
  });

  it("finds a token only by hash, in its own shop, before it expires; deletes expired ones", async () => {
    const { tokens, tx, fake } = setup();
    const record = {
      id: "p-1",
      tokenHash: "h1",
      expiresAt: new Date(now.getTime() + 1000),
      createdBy: "s",
      createdAt: now,
    };
    await tokens.insert(record, "t-1", tx);
    await tokens.insert({ ...record, id: "p-2", tokenHash: "old", expiresAt: now }, "t-1", tx);
    expect(await tokens.findActive("h1", "t-1", now)).toEqual(record);
    expect(await tokens.findActive("h1", "t-2", now)).toBeNull();
    expect(await tokens.findActive("old", "t-1", now)).toBeNull();
    expect(await tokens.deleteExpired("t-1", now, tx)).toBe(1);
    expect(fake.rowsOf("onlineStorePreviewToken").map((r) => r["id"])).toEqual(["p-1"]);
  });
});
```

`src/infrastructure/tenant-isolation.test.ts`:

```ts
import { describe, it } from "vitest";
import type { TransactionClient } from "@platform/db";
import { createFakePrisma } from "@platform/db/testing";
import { tenantRowIsolationCases, type TenantRowStore } from "@platform/messaging/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import type {
  AccessRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import {
  InMemoryAccessRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "./in-memory-repositories";
import {
  PrismaAccessRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./prisma-repositories";

const now = new Date("2026-10-27T10:00:00.000Z");
const later = new Date("2026-10-27T11:00:00.000Z");

type Layer = { name: string; make: () => { tx: unknown; repos: Repos } };
interface Repos {
  preferences: PreferencesRepository;
  access: AccessRepository;
  themes: ThemeRepository;
  releases: ThemeReleaseRepository;
  tokens: PreviewTokenRepository;
}

const layers: Layer[] = [
  {
    name: "in-memory",
    make: () => ({
      tx: undefined,
      repos: {
        preferences: new InMemoryPreferencesRepository(),
        access: new InMemoryAccessRepository(),
        themes: new InMemoryThemeRepository(),
        releases: new InMemoryThemeReleaseRepository(),
        tokens: new InMemoryPreviewTokenRepository(),
      },
    }),
  },
  {
    name: "prisma (fake client)",
    make: () => {
      const fake = createFakePrisma();
      const deps = { prisma: fake.database };
      return {
        tx: fake.database as unknown as TransactionClient,
        repos: {
          preferences: new PrismaPreferencesRepository(deps),
          access: new PrismaAccessRepository(deps),
          themes: new PrismaThemeRepository(deps),
          releases: new PrismaThemeReleaseRepository(deps),
          tokens: new PrismaPreviewTokenRepository(deps),
        },
      };
    },
  },
];

/** One row per shop: the "key" is the shop's row, the marker lives in a text field. */
function preferencesStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.preferences.get(tenantId)).snapshot();
    return s.persisted ? (s.homeTitle.en ?? null) : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const p = await repos.preferences.get(tenantId, tx);
    p.update(
      {
        homeTitle: { en: marker },
        homeMetaDescription: {},
        shareImageRef: null,
        defaultLocale: "ar",
      },
      now,
    );
    await repos.preferences.save(p, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

function accessStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.access.get(tenantId)).snapshot();
    return s.persisted ? s.passwordHash : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const a = await repos.access.get(tenantId, tx);
    a.apply({ locked: false, newPasswordHash: marker, message: {}, now });
    await repos.access.save(a, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

function themeStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const find = async (tenantId: string) => {
    const s = (await repos.themes.get(tenantId)).snapshot();
    return s.persisted ? (s.draft.footer.note.en ?? null) : null;
  };
  const write = async (tenantId: string, marker: string) => {
    const theme = await repos.themes.get(tenantId, tx);
    theme.saveDraft(
      { ...DEFAULT_THEME_DOCUMENT, footer: { note: { en: marker }, showSocial: true } },
      now,
    );
    await repos.themes.save(theme, tenantId, tx);
  };
  return {
    insert: (t, _k, m) => write(t, m),
    find: (t) => find(t),
    list: async (t) => {
      const m = await find(t);
      return m === null ? [] : [m];
    },
    update: (t, _k, m) => write(t, m),
  };
}

/** The same key always maps to the same release number, under every shop (identical keys on purpose). */
function releaseStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const numbers = new Map<string, number>();
  const numberOf = (key: string): number => {
    const known = numbers.get(key);
    if (known !== undefined) return known;
    numbers.set(key, numbers.size + 1);
    return numbers.size;
  };
  return {
    insert: (t, k, m) =>
      repos.releases.append(
        {
          id: `${t}-${k}`,
          releaseNumber: numberOf(k),
          document: DEFAULT_THEME_DOCUMENT,
          publishedAt: now,
          publishedBy: m,
        },
        t,
        tx,
      ),
    find: async (t, k) => (await repos.releases.get(numberOf(k), t))?.publishedBy ?? null,
    list: async (t) => (await repos.releases.list(t, 20)).map((r) => r.publishedBy),
    update: async () => undefined, // releases are append-only
    remove: async (t) => void (await repos.releases.pruneBeyond(0, t, tx)),
  };
}

/** Tokens have no list read; `list` probes every key ever inserted, through the tenant-scoped lookup. */
function tokenStore({ tx, repos }: ReturnType<Layer["make"]>): TenantRowStore {
  const keys = new Set<string>();
  const find = async (t: string, k: string) =>
    (await repos.tokens.findActive(k, t, now))?.createdBy ?? null;
  return {
    insert: async (t, k, m) => {
      keys.add(k);
      await repos.tokens.insert(
        { id: `${t}-${k}`, tokenHash: k, expiresAt: later, createdBy: m, createdAt: now },
        t,
        tx,
      );
    },
    find,
    list: async (t) =>
      (await Promise.all([...keys].map((k) => find(t, k)))).filter((m): m is string => m !== null),
    update: async () => undefined, // tokens are immutable
    remove: async (t) =>
      void (await repos.tokens.deleteExpired(t, new Date(later.getTime() + 1), tx)),
  };
}

/**
 * Single-row-per-shop tables cannot hold three rows for one shop, so the shared "cannot count"
 * case (three inserts under A) does not apply to them; the other cases do, unchanged.
 */
const SINGLE_ROW = new Set(["preferences", "access", "theme"]);

for (const layer of layers) {
  describe(`online-store tenant isolation — ${layer.name} (ADR-0014)`, () => {
    for (const [name, build] of [
      ["preferences", preferencesStore],
      ["access", accessStore],
      ["theme", themeStore],
      ["theme releases", releaseStore],
      ["preview tokens", tokenStore],
    ] as const) {
      const cases = tenantRowIsolationCases({
        context: `online-store/${name}`,
        layer: layer.name,
        make: () => build(layer.make()),
      }).filter((c) => !(SINGLE_ROW.has(name) && c.name.includes("cannot count")));
      for (const c of cases) {
        it(c.name, c.run);
      }
    }
  });
}
```

`src/infrastructure/prisma-repositories.integration.test.ts` (runs only with `DATABASE_URL_TEST`; never point it at a real database):

```ts
import { describe, expect, it } from "vitest";
import { PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { StorefrontTheme } from "../domain/storefront-theme";
import { PrismaThemeReleaseRepository, PrismaThemeRepository } from "./prisma-repositories";

const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("online-store Prisma repositories (integration)", () => {
  it("saves, publishes and reads a theme for one shop only", async () => {
    const prisma = createTestPrismaClient(databaseUrl);
    const themes = new PrismaThemeRepository({ prisma });
    const releases = new PrismaThemeReleaseRepository({ prisma });
    const uow = new PrismaUnitOfWork(prisma);
    const tenant = `it-${crypto.randomUUID()}`;
    const now = new Date();
    await uow.run(async (tx) => {
      const theme = await themes.get(tenant, tx);
      theme.saveDraft({ ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } }, now);
      const release = theme.publish({
        expectedDraftRevision: 1,
        by: "s",
        releaseId: crypto.randomUUID(),
        now,
      });
      if (!release.ok) throw release.error;
      await themes.save(theme, tenant, tx);
      await releases.append(release.value, tenant, tx);
    });
    expect((await themes.get(tenant)).snapshot().published?.header.sticky).toBe(true);
    expect((await themes.get(`${tenant}-other`)).snapshot().persisted).toBe(false);
    expect(await releases.list(tenant, 20)).toHaveLength(1);
  });
});
```

- [ ] **Step 11: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/infrastructure`
Expected: FAIL — repository modules not found.

- [ ] **Step 12: Implement the repositories**

`src/infrastructure/rows.ts`:

```ts
import type { Prisma } from "@platform/db";
import {
  readThemeDocument,
  type Locale,
  type LocalizedText,
  type ThemeDocument,
} from "@platform/storefront-content";

/** Tolerant read of a stored `{ ar?, en? }` (only string values survive). */
export function localizedTextOf(value: unknown): LocalizedText {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw["ar"] === "string" && raw["ar"] !== "" ? { ar: raw["ar"] } : {}),
    ...(typeof raw["en"] === "string" && raw["en"] !== "" ? { en: raw["en"] } : {}),
  };
}

export const localeOf = (value: unknown): Locale => (value === "en" ? "en" : "ar");

export function documentOf(value: unknown): ThemeDocument {
  return readThemeDocument(value);
}

export const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

/** Prisma's unique-violation code: a concurrent first insert lost the race. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}
```

`src/infrastructure/prisma-repositories.ts`:

```ts
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { ConcurrencyError } from "@platform/utils";
import type {
  AccessRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type { PreviewTokenRecord } from "../domain/preview-token";
import { StorefrontAccess } from "../domain/storefront-access";
import { StorefrontPreferences } from "../domain/storefront-preferences";
import { StorefrontTheme, type ThemeRelease } from "../domain/storefront-theme";
import { documentOf, isUniqueViolation, json, localeOf, localizedTextOf } from "./rows";

export interface PrismaOnlineStoreDeps {
  readonly prisma: Database;
}

function requireTx(tx: unknown, who: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${who} requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/** ADR-0014: the caller's `tx` when given, else a tenant-scoped read transaction. */
function read<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  fn: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? fn(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, fn);
}

/** First save inserts (a lost insert race is a ConcurrencyError); later saves are version-guarded. */
async function guardedWrite(
  persisted: boolean,
  insert: () => Promise<unknown>,
  update: () => Promise<{ count: number }>,
  what: string,
): Promise<void> {
  if (!persisted) {
    try {
      await insert();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConcurrencyError(`${what} was created concurrently`);
      throw error;
    }
    return;
  }
  const updated = await update();
  if (updated.count === 0) throw new ConcurrencyError(`${what} was modified concurrently`);
}

export class PrismaPreferencesRepository implements PreferencesRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontPreferences> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStorePreferences.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontPreferences.defaults();
    return StorefrontPreferences.reconstitute({
      homeTitle: localizedTextOf(row.homeTitle),
      homeMetaDescription: localizedTextOf(row.homeMetaDescription),
      shareImageRef: row.shareImageRef,
      defaultLocale: localeOf(row.defaultLocale),
      version: row.version,
      updatedAt: row.updatedAt,
      persisted: true,
    });
  }

  async save(preferences: StorefrontPreferences, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPreferencesRepository.save");
    const s = preferences.snapshot();
    const data = {
      homeTitle: json(s.homeTitle),
      homeMetaDescription: json(s.homeMetaDescription),
      shareImageRef: s.shareImageRef,
      defaultLocale: s.defaultLocale,
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStorePreferences.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStorePreferences.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront preferences",
    );
  }
}

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontAccess> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreAccess.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontAccess.defaults();
    return StorefrontAccess.reconstitute({
      locked: row.locked,
      passwordHash: row.passwordHash,
      passwordUpdatedAt: row.passwordUpdatedAt,
      message: localizedTextOf(row.message),
      accessVersion: row.accessVersion,
      version: row.version,
      updatedAt: row.updatedAt,
      persisted: true,
    });
  }

  async save(access: StorefrontAccess, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaAccessRepository.save");
    const s = access.snapshot();
    const data = {
      locked: s.locked,
      passwordHash: s.passwordHash,
      passwordUpdatedAt: s.passwordUpdatedAt,
      message: json(s.message),
      accessVersion: s.accessVersion,
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStoreAccess.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStoreAccess.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront access",
    );
  }
}

export class PrismaThemeRepository implements ThemeRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async get(tenantId: string, tx?: unknown): Promise<StorefrontTheme> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreTheme.findFirst({ where: { tenantId } }),
    );
    if (row === null) return StorefrontTheme.initial();
    return StorefrontTheme.reconstitute({
      draft: documentOf(row.draft),
      draftRevision: row.draftRevision,
      draftSavedAt: row.draftSavedAt,
      published: row.published === null ? null : documentOf(row.published),
      publishedDraftRevision: row.publishedDraftRevision,
      releaseNumber: row.releaseNumber,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      version: row.version,
      persisted: true,
    });
  }

  async save(theme: StorefrontTheme, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaThemeRepository.save");
    const s = theme.snapshot();
    // `published` only ever goes from null to a document, so a null is never written (Ruling: no DbNull).
    const data = {
      draft: json(s.draft),
      draftRevision: s.draftRevision,
      ...(s.draftSavedAt === null ? {} : { draftSavedAt: s.draftSavedAt }),
      ...(s.published === null ? {} : { published: json(s.published) }),
      publishedDraftRevision: s.publishedDraftRevision,
      releaseNumber: s.releaseNumber,
      publishedAt: s.publishedAt,
      publishedBy: s.publishedBy,
    };
    await guardedWrite(
      s.persisted,
      () => client.onlineStoreTheme.create({ data: { tenantId, ...data, version: 1 } }),
      () =>
        client.onlineStoreTheme.updateMany({
          where: { tenantId, version: s.version },
          data: { ...data, version: { increment: 1 } },
        }),
      "Storefront theme",
    );
  }
}

function releaseOf(row: {
  id: string;
  releaseNumber: number;
  document: unknown;
  publishedAt: Date;
  publishedBy: string;
}): ThemeRelease {
  return {
    id: row.id,
    releaseNumber: row.releaseNumber,
    document: documentOf(row.document),
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
  };
}

export class PrismaThemeReleaseRepository implements ThemeReleaseRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async append(release: ThemeRelease, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaThemeReleaseRepository.append");
    await client.onlineStoreThemeRelease.create({
      data: {
        id: release.id,
        tenantId,
        releaseNumber: release.releaseNumber,
        document: json(release.document),
        publishedAt: release.publishedAt,
        publishedBy: release.publishedBy,
      },
    });
  }

  async list(tenantId: string, limit: number, tx?: unknown): Promise<readonly ThemeRelease[]> {
    const rows = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreThemeRelease.findMany({
        where: { tenantId },
        orderBy: { releaseNumber: "desc" },
        take: limit,
      }),
    );
    // Sorted again here: the order is the contract, not an accident of the driver.
    return rows
      .map(releaseOf)
      .sort((a, b) => b.releaseNumber - a.releaseNumber)
      .slice(0, limit);
  }

  async get(releaseNumber: number, tenantId: string, tx?: unknown): Promise<ThemeRelease | null> {
    const row = await read(this.deps.prisma, tenantId, tx, (client) =>
      client.onlineStoreThemeRelease.findFirst({ where: { tenantId, releaseNumber } }),
    );
    return row === null ? null : releaseOf(row);
  }

  async pruneBeyond(keep: number, tenantId: string, tx: unknown): Promise<number> {
    const client = requireTx(tx, "PrismaThemeReleaseRepository.pruneBeyond");
    const rows = await client.onlineStoreThemeRelease.findMany({
      where: { tenantId },
      select: { releaseNumber: true },
    });
    const numbers = rows.map((row) => row.releaseNumber).sort((a, b) => b - a);
    if (numbers.length <= keep) return 0;
    const deleted = await client.onlineStoreThemeRelease.deleteMany({
      where: { tenantId, releaseNumber: { in: numbers.slice(keep) } },
    });
    return deleted.count;
  }
}

export class PrismaPreviewTokenRepository implements PreviewTokenRepository {
  constructor(private readonly deps: PrismaOnlineStoreDeps) {}

  async insert(record: PreviewTokenRecord, tenantId: string, tx: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPreviewTokenRepository.insert");
    await client.onlineStorePreviewToken.create({ data: { ...record, tenantId } });
  }

  async findActive(
    tokenHash: string,
    tenantId: string,
    now: Date,
  ): Promise<PreviewTokenRecord | null> {
    const row = await runReadScoped(this.deps.prisma, tenantId, (client) =>
      client.onlineStorePreviewToken.findFirst({
        where: { tenantId, tokenHash, expiresAt: { gt: now } },
      }),
    );
    return row === null
      ? null
      : {
          id: row.id,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        };
  }

  async deleteExpired(tenantId: string, now: Date, tx: unknown): Promise<number> {
    const client = requireTx(tx, "PrismaPreviewTokenRepository.deleteExpired");
    const deleted = await client.onlineStorePreviewToken.deleteMany({
      where: { tenantId, expiresAt: { lte: now } },
    });
    return deleted.count;
  }
}
```

`src/infrastructure/in-memory-repositories.ts` (same contract, keyed by tenant, so a missing tenant filter is visible):

```ts
import { ConcurrencyError } from "@platform/utils";
import type {
  AccessRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type { PreviewTokenRecord } from "../domain/preview-token";
import { StorefrontAccess, type AccessSnapshot } from "../domain/storefront-access";
import { StorefrontPreferences, type PreferencesSnapshot } from "../domain/storefront-preferences";
import { StorefrontTheme, type ThemeRelease, type ThemeSnapshot } from "../domain/storefront-theme";

/** A single-row-per-shop store with the Prisma repository's insert/guarded-update semantics. */
class Rows<S extends { readonly version: number; readonly persisted: boolean }> {
  private readonly rows = new Map<string, S>();

  get(tenantId: string): S | undefined {
    return this.rows.get(tenantId);
  }

  save(tenantId: string, snapshot: S, what: string): void {
    const current = this.rows.get(tenantId);
    if (!snapshot.persisted) {
      if (current !== undefined) throw new ConcurrencyError(`${what} was created concurrently`);
      this.rows.set(tenantId, { ...snapshot, version: 1, persisted: true });
      return;
    }
    if (current === undefined || current.version !== snapshot.version) {
      throw new ConcurrencyError(`${what} was modified concurrently`);
    }
    this.rows.set(tenantId, { ...snapshot, version: snapshot.version + 1 });
  }
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly rows = new Rows<PreferencesSnapshot>();
  async get(tenantId: string): Promise<StorefrontPreferences> {
    const row = this.rows.get(tenantId);
    return row === undefined
      ? StorefrontPreferences.defaults()
      : StorefrontPreferences.reconstitute(row);
  }
  async save(p: StorefrontPreferences, tenantId: string): Promise<void> {
    this.rows.save(tenantId, p.snapshot(), "Storefront preferences");
  }
}

export class InMemoryAccessRepository implements AccessRepository {
  private readonly rows = new Rows<AccessSnapshot>();
  async get(tenantId: string): Promise<StorefrontAccess> {
    const row = this.rows.get(tenantId);
    return row === undefined ? StorefrontAccess.defaults() : StorefrontAccess.reconstitute(row);
  }
  async save(a: StorefrontAccess, tenantId: string): Promise<void> {
    this.rows.save(tenantId, a.snapshot(), "Storefront access");
  }
}

export class InMemoryThemeRepository implements ThemeRepository {
  private readonly rows = new Rows<ThemeSnapshot>();
  async get(tenantId: string): Promise<StorefrontTheme> {
    const row = this.rows.get(tenantId);
    return row === undefined ? StorefrontTheme.initial() : StorefrontTheme.reconstitute(row);
  }
  async save(t: StorefrontTheme, tenantId: string): Promise<void> {
    this.rows.save(tenantId, t.snapshot(), "Storefront theme");
  }
}

export class InMemoryThemeReleaseRepository implements ThemeReleaseRepository {
  private readonly rows: { tenantId: string; release: ThemeRelease }[] = [];
  async append(release: ThemeRelease, tenantId: string): Promise<void> {
    if (
      this.rows.some(
        (r) => r.tenantId === tenantId && r.release.releaseNumber === release.releaseNumber,
      )
    ) {
      throw new ConcurrencyError("Release number already used");
    }
    this.rows.push({ tenantId, release });
  }
  async list(tenantId: string, limit: number): Promise<readonly ThemeRelease[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId)
      .map((r) => r.release)
      .sort((a, b) => b.releaseNumber - a.releaseNumber)
      .slice(0, limit);
  }
  async get(releaseNumber: number, tenantId: string): Promise<ThemeRelease | null> {
    return (
      this.rows.find((r) => r.tenantId === tenantId && r.release.releaseNumber === releaseNumber)
        ?.release ?? null
    );
  }
  async pruneBeyond(keep: number, tenantId: string): Promise<number> {
    const kept = new Set((await this.list(tenantId, keep)).map((r) => r.id));
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row !== undefined && row.tenantId === tenantId && !kept.has(row.release.id))
        this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
}

export class InMemoryPreviewTokenRepository implements PreviewTokenRepository {
  private readonly rows: { tenantId: string; record: PreviewTokenRecord }[] = [];
  async insert(record: PreviewTokenRecord, tenantId: string): Promise<void> {
    this.rows.push({ tenantId, record });
  }
  async findActive(
    tokenHash: string,
    tenantId: string,
    now: Date,
  ): Promise<PreviewTokenRecord | null> {
    return (
      this.rows.find(
        (r) =>
          r.tenantId === tenantId && r.record.tokenHash === tokenHash && r.record.expiresAt > now,
      )?.record ?? null
    );
  }
  async deleteExpired(tenantId: string, now: Date): Promise<number> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row !== undefined && row.tenantId === tenantId && row.record.expiresAt <= now)
        this.rows.splice(i, 1);
    }
    return before - this.rows.length;
  }
  /** Test seam: every stored record, across shops (to assert only hashes are stored). */
  all(): readonly PreviewTokenRecord[] {
    return this.rows.map((r) => r.record);
  }
}
```

`src/infrastructure/in-memory-unit-of-work.ts`: copy `services/theme/src/infrastructure/in-memory-unit-of-work.ts` verbatim.

`pruneBeyond(0, …)` deletes every release of the shop (the isolation test's `remove` relies on it); `pruneBeyond(20, …)` deletes everything older than the 20 newest.

- [ ] **Step 13: Run the repository tests and the tenant-where guard**

Run: `pnpm --filter @platform/online-store test` — PASS (the integration file is skipped without `DATABASE_URL_TEST`).
Run: `node scripts/dev/check-prisma-tenant-where.mjs` — exactly the one known finding (`discounts.admin-controller.ts:166`); nothing under `services/online-store`.
Run: `pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/online-store lint` — clean.

- [ ] **Step 14: Commit**

```bash
git add packages/db/prisma/schema/migrations/20261027000000_online_store_identity \
  packages/db/prisma/schema/online-store.prisma packages/db/prisma/schema/main.prisma \
  packages/db/src/schema-migration-consistency.test.ts \
  packages/auth/src/role-table-access-control.ts packages/auth/src/role-table-access-control.test.ts \
  scripts/ops/seed-ory-network.mjs services/online-store pnpm-lock.yaml
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): add the online_store schema, permissions and the domain with repositories

Hand-written migration 20261027000000_online_store_identity (five RLS-forced tables, not applied),
online_store in SHOP_RESOURCES, and the preferences/access/theme/preview-token aggregates with
in-memory and tenant-scoped Prisma repositories.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Online-store use cases, ports, controller and composition

Model tier: **strong** (the unit-of-work ordering, the timing-equal unlock and the shell DTO are security boundaries).

**Files:**

- Create: `services/online-store/src/application/ports.ts`, `deps.ts`, `guarded.ts`
- Create: `services/online-store/src/application/preferences.use-cases.ts`, `access.use-cases.ts`, `theme.use-cases.ts`, `preview.use-cases.ts`, `shell.use-case.ts`
- Create: `services/online-store/src/infrastructure/event-translator.ts`
- Create: `services/online-store/src/interfaces/presenter.ts`, `online-store.controller.ts`
- Create: `services/online-store/src/composition.ts`, `src/index.ts`
- Create: `services/online-store/src/testing/fakes.ts`
- Test: `services/online-store/src/application/preferences.use-cases.test.ts`, `access.use-cases.test.ts`, `theme.use-cases.test.ts`, `preview.use-cases.test.ts`, `shell.use-case.test.ts`, `src/interfaces/presenter.test.ts`

**Interfaces:**

- Consumes: Task 1 (`validateThemeDocument`, `checkBrandContrast`, `imageRefsOf`, `normalizeLocalizedText`, `readSocial`, `DEFAULT_THEME_DOCUMENT`, `ContrastWarning`, `LocalizedText`, `Locale`, `ThemeDocument`); Task 2 (aggregates, repositories, errors, events, preview-token helpers, in-memory repositories, `InMemoryUnitOfWork`, Prisma repositories).
- Produces:
  - `ports.ts`: `interface ImageDto { url: string; alt: string | null; width: number | null; height: number | null }`, `ImageRefsPort { existingIds(ids: readonly string[], tenantId: string): Promise<readonly string[]>; resolve(ids: readonly string[], tenantId: string): Promise<Readonly<Record<string, ImageDto>>> }`, `StorefrontPasswordHasher { hash(plain: string): Promise<string>; verify(plain: string, hash: string): Promise<boolean> }`, `ShopHostPort { primaryHostname(tenantId: string): Promise<string | null> }`, `StoreIdentityPort { storeName(tenantId: string): Promise<string> }`, `EventRecorder { record(events: readonly DomainEvent[], tenantId: string, tx: unknown): Promise<void> }`.
  - Views: `PreferencesView`, `AccessStatusView`, `PublicAccessView`, `ThemeStateView`, `SaveDraftView`, `PublishView`, `ReleasesView`, `PreviewTokenView`, `PublicShellView` (shapes in the code below).
  - `OnlineStoreController` methods (each returns `ControllerResponse`): `getPreferences({ tenantId })`, `updatePreferences(UpdatePreferencesInput)`, `getAccess({ tenantId })`, `updateAccess(UpdateAccessInput)`, `getTheme({ tenantId })`, `saveThemeDraft({ document, expectedVersion, tenantId })`, `discardThemeDraft({ expectedVersion, tenantId })`, `publishTheme({ expectedDraftRevision, by, tenantId })`, `listThemeReleases({ tenantId })`, `restoreThemeRelease({ releaseNumber, expectedVersion, tenantId })`, `issuePreviewToken({ createdBy, tenantId })`, `shell({ tenantId, previewToken? })`, `publicAccess({ tenantId })`, `unlock({ password, tenantId })`.
  - `wireOnlineStore(deps: OnlineStoreWiringDeps): WiredOnlineStore` with `WiredOnlineStore { controller; publicReads: { shell(tenantId, previewToken?); access(tenantId); unlock(tenantId, password) }; drainOutbox; deliveredEventTypes }`; `OnlineStoreWiringDeps { serializer; idGenerator; clock; prisma?; imageRefs; passwordHasher; shopHost; storeIdentity }`; `buildOnlineStoreController(repos, unitOfWork, deps, events)` (test seam, not in `index.ts`).

- [ ] **Step 1: Write the test fakes**

`src/testing/fakes.ts`:

```ts
import type { Clock, IdGenerator } from "@platform/contracts";
import type {
  ImageDto,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "../application/ports";
import type { DomainEvent } from "@platform/domain";
import { buildOnlineStoreController, type OnlineStoreRepos } from "../composition";
import {
  InMemoryAccessRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

/** Media fake: each shop owns the listed ids; a foreign or unknown id resolves to nothing. */
export function fakeImageRefs(owned: Readonly<Record<string, readonly string[]>>): ImageRefsPort {
  const image = (id: string): ImageDto => ({
    url: `https://cdn.test/${id}.png`,
    alt: null,
    width: 64,
    height: 64,
  });
  return {
    existingIds: async (ids, tenantId) => ids.filter((id) => (owned[tenantId] ?? []).includes(id)),
    resolve: async (ids, tenantId) =>
      Object.fromEntries(
        ids.filter((id) => (owned[tenantId] ?? []).includes(id)).map((id) => [id, image(id)]),
      ),
  };
}

/** Records every verify call so a test can see the dummy-hash path ran. */
export function fakeHasher(): StorefrontPasswordHasher & { readonly verified: string[] } {
  const verified: string[] = [];
  return {
    verified,
    hash: async (plain) => `hash:${plain}`,
    verify: async (plain, hash) => {
      verified.push(hash);
      return hash === `hash:${plain}`;
    },
  };
}

export function harness(
  options: {
    owned?: Readonly<Record<string, readonly string[]>>;
    hosts?: Readonly<Record<string, string>>;
    names?: Readonly<Record<string, string>>;
  } = {},
) {
  let now = new Date("2026-10-27T10:00:00.000Z");
  let id = 0;
  const clock: Clock = { now: () => now };
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-7000-8000-${String((id += 1)).padStart(12, "0")}`,
  };
  const repos: OnlineStoreRepos = {
    preferences: new InMemoryPreferencesRepository(),
    access: new InMemoryAccessRepository(),
    themes: new InMemoryThemeRepository(),
    releases: new InMemoryThemeReleaseRepository(),
    previewTokens: new InMemoryPreviewTokenRepository(),
  };
  const hasher = fakeHasher();
  const recorded: { tenantId: string; type: string }[] = [];
  const shopHost: ShopHostPort = { primaryHostname: async (t) => options.hosts?.[t] ?? null };
  const storeIdentity: StoreIdentityPort = { storeName: async (t) => options.names?.[t] ?? "" };
  const controller = buildOnlineStoreController(
    repos,
    new InMemoryUnitOfWork(),
    {
      idGenerator,
      clock,
      imageRefs: fakeImageRefs(options.owned ?? {}),
      passwordHasher: hasher,
      shopHost,
      storeIdentity,
    },
    {
      record: async (events: readonly DomainEvent[], tenantId: string) => {
        for (const event of events)
          recorded.push({ tenantId, type: (event as { eventName: string }).eventName });
      },
    },
  );
  return {
    controller,
    repos,
    hasher,
    recorded,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
```

- [ ] **Step 2: Write the failing use-case tests**

`src/application/theme.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { harness } from "../testing/fakes";

const T = "t-1";
const doc = (patch: (d: any) => void = () => undefined) => {
  const d = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
  patch(d);
  return d;
};

describe("theme use cases", () => {
  it("a never-saved shop reads the default document as draft, nothing published, version 0", async () => {
    const { controller } = harness();
    const res = await controller.getTheme({ tenantId: T });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      draft: DEFAULT_THEME_DOCUMENT,
      published: null,
      draftRevision: 0,
      publishedDraftRevision: null,
      releaseNumber: 0,
      hasUnpublishedChanges: false,
      images: {},
      version: 0,
    });
  });

  it("saves a draft, bumps the revision, and returns contrast warnings", async () => {
    const { controller } = harness();
    const res = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => {
        d.brand.colors.background = "#FFFFFF";
        d.brand.colors.foreground = "#888888";
      }),
    });
    expect(res).toEqual({
      status: 200,
      body: {
        draftRevision: 1,
        version: 1,
        warnings: [{ pair: "foreground", ratio: 3.54, minimum: 4.5 }],
      },
    });
  });

  it("refuses unreadable body text, a bad colour, unknown keys and a foreign image — writing nothing", async () => {
    const { controller, repos } = harness({ owned: { "t-other": ["img-b"] } });
    const contrast = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => {
        d.brand.colors.background = "#ffffff";
        d.brand.colors.foreground = "#eeeeee";
      }),
    });
    expect(contrast.status).toBe(422);
    expect(contrast.body).toMatchObject({
      fields: [{ field: "brand.colors.foreground", message: "CONTRAST_TOO_LOW" }],
    });
    const colour = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.colors.primary = "red")),
    });
    expect(colour.body).toMatchObject({
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    const foreign = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.logo.imageRef = "img-b")),
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body).toMatchObject({
      code: "IMAGE_NOT_FOUND",
      fields: [{ field: "brand.logo.imageRef", message: "IMAGE_NOT_FOUND" }],
    });
    expect((await repos.themes.get(T)).snapshot().persisted).toBe(false);
  });

  it("answers DOCUMENT_TOO_LARGE as the top-level code", async () => {
    const { controller } = harness();
    const res = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: { pad: "x".repeat(300_000) },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "DOCUMENT_TOO_LARGE" });
  });

  it("two tabs: the second save from the same version is VERSION_CONFLICT", async () => {
    const { controller } = harness();
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: doc() });
    const second = await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc(),
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("publish after another save → DRAFT_CHANGED, nothing written (Review Focus 4)", async () => {
    const { controller, repos, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 1,
      document: doc((d) => (d.brand.corners = "pill")),
    });
    const res = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "DRAFT_CHANGED" });
    expect((await repos.themes.get(T)).snapshot()).toMatchObject({
      published: null,
      releaseNumber: 0,
      version: 2,
    });
    expect(await repos.releases.list(T, 20)).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("publishes, records the release and the event, and refuses an unchanged re-publish", async () => {
    const { controller, recorded } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    const res = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(res).toEqual({
      status: 200,
      body: { releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.theme.published" }]);
    const again = await controller.publishTheme({
      tenantId: T,
      expectedDraftRevision: 1,
      by: "admin-1",
    });
    expect(again.body).toMatchObject({ code: "NOTHING_TO_PUBLISH" });
  });

  it("keeps the last 20 releases (the 21st publish prunes release 1)", async () => {
    const { controller } = harness();
    let version = 0;
    for (let n = 1; n <= 21; n += 1) {
      const saved = await controller.saveThemeDraft({
        tenantId: T,
        expectedVersion: version,
        document: doc((d) => (d.brand.logo.widthPx = 60 + n)),
      });
      const body = saved.body as { draftRevision: number; version: number };
      await controller.publishTheme({
        tenantId: T,
        expectedDraftRevision: body.draftRevision,
        by: "a",
      });
      version = body.version + 1;
    }
    const list = await controller.listThemeReleases({ tenantId: T });
    const numbers = (list.body as { releases: { releaseNumber: number; publishedByName: null }[] })
      .releases;
    expect(numbers).toHaveLength(20);
    expect(numbers[0]).toEqual({
      releaseNumber: 21,
      publishedAt: "2026-10-27T10:00:00.000Z",
      publishedByName: null,
    });
    expect(numbers.at(-1)?.releaseNumber).toBe(2);
  });

  it("restore copies a release into the draft only; an unknown release is RELEASE_NOT_FOUND", async () => {
    const { controller } = harness();
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.header.sticky = true)),
    });
    await controller.publishTheme({ tenantId: T, expectedDraftRevision: 1, by: "a" });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.corners = "square")),
    });
    const restored = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 1,
      expectedVersion: 3,
    });
    expect(restored).toEqual({ status: 200, body: { draftRevision: 3, version: 4 } });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      draft: any;
      published: any;
      hasUnpublishedChanges: boolean;
    };
    expect(state.draft.header.sticky).toBe(true);
    expect(state.hasUnpublishedChanges).toBe(false);
    const missing = await controller.restoreThemeRelease({
      tenantId: T,
      releaseNumber: 9,
      expectedVersion: 4,
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RELEASE_NOT_FOUND" });
  });

  it("discard returns the draft to live and resolves images for both documents in one read", async () => {
    const { controller } = harness({ owned: { [T]: ["logo-1"] } });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 0,
      document: doc((d) => (d.brand.logo.imageRef = "logo-1")),
    });
    const discarded = await controller.discardThemeDraft({ tenantId: T, expectedVersion: 1 });
    expect(discarded).toEqual({ status: 200, body: { draftRevision: 2, version: 2 } });
    await controller.saveThemeDraft({
      tenantId: T,
      expectedVersion: 2,
      document: doc((d) => (d.brand.logo.imageRef = "logo-1")),
    });
    const state = (await controller.getTheme({ tenantId: T })).body as {
      images: Record<string, unknown>;
    };
    expect(Object.keys(state.images)).toEqual(["logo-1"]);
  });
});
```

`src/application/access.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("access use cases", () => {
  it("never returns the password or its hash", async () => {
    const { controller } = harness();
    const res = await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "open sesame",
      message: { ar: "قريبًا" },
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      locked: true,
      passwordSet: true,
      passwordUpdatedAt: "2026-10-27T10:00:00.000Z",
      message: { ar: "قريبًا" },
      version: 1,
    });
    const read = await controller.getAccess({ tenantId: T });
    expect(JSON.stringify(read.body)).not.toMatch(/sesame|hash:/);
  });

  it("refuses to lock with no password (PASSWORD_REQUIRED) and a 3-character password", async () => {
    const { controller, repos } = harness();
    const none = await controller.updateAccess({
      tenantId: T,
      locked: true,
      message: {},
      expectedVersion: 0,
    });
    expect(none.status).toBe(422);
    expect(none.body).toMatchObject({ code: "PASSWORD_REQUIRED" });
    const short = await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "abc",
      message: {},
      expectedVersion: 0,
    });
    expect(short.body).toMatchObject({
      code: "PASSWORD_LENGTH",
      fields: [{ field: "password", message: "PASSWORD_LENGTH" }],
    });
    expect((await repos.access.get(T)).snapshot().persisted).toBe(false);
  });

  it("a stale version is VERSION_CONFLICT", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const stale = await controller.updateAccess({
      tenantId: T,
      locked: true,
      message: {},
      expectedVersion: 0,
    });
    expect(stale.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("the public read carries locked, accessVersion and the visitor message only", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: { en: "Soon" },
      expectedVersion: 0,
    });
    expect(await controller.publicAccess({ tenantId: T })).toEqual({
      status: 200,
      // One save that sets a password AND locks bumps the access version once (1 → 2).
      body: { locked: true, accessVersion: 2, message: { en: "Soon" } },
    });
  });

  it("unlock: right password → accessVersion; wrong, unlocked or never set → the same 401", async () => {
    const { controller, hasher } = harness();
    const neverSet = await controller.unlock({ tenantId: T, password: "1234" });
    expect(neverSet).toEqual({
      status: 401,
      body: {
        code: "PASSWORD_INCORRECT",
        message: "Incorrect password",
        retryable: false,
        fields: [],
      },
    });
    expect(hasher.verified).toHaveLength(1); // the dummy hash was verified: equal cost
    await controller.updateAccess({
      tenantId: T,
      locked: false,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    expect((await controller.unlock({ tenantId: T, password: "1234" })).body).toEqual(
      neverSet.body,
    );
    await controller.updateAccess({ tenantId: T, locked: true, message: {}, expectedVersion: 1 });
    expect((await controller.unlock({ tenantId: T, password: "nope" })).body).toEqual(
      neverSet.body,
    );
    expect(await controller.unlock({ tenantId: T, password: " 1234 " })).toEqual({
      status: 200,
      body: { accessVersion: 3 },
    });
    expect(hasher.verified).toHaveLength(4);
  });
});
```

`src/application/preview.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPreviewToken } from "../domain/preview-token";
import { InMemoryPreviewTokenRepository } from "../infrastructure/in-memory-repositories";
import { harness } from "../testing/fakes";

describe("preview tokens", () => {
  it("issues a 60-minute token, stores only its hash, and builds the primary-host url", async () => {
    const { controller, repos } = harness({ hosts: { "t-1": "shop.example.eg" } });
    const res = await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "staff-1" });
    expect(res.status).toBe(201);
    const body = res.body as { token: string; expiresAt: string; url: string };
    expect(body.expiresAt).toBe("2026-10-27T11:00:00.000Z");
    expect(body.url).toBe(`https://shop.example.eg/?preview=${body.token}`);
    const stored = (repos.previewTokens as InMemoryPreviewTokenRepository).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashPreviewToken(body.token));
    expect(JSON.stringify(stored)).not.toContain(body.token);
  });

  it("url is null without a verified primary hostname", async () => {
    const { controller } = harness();
    const res = await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" });
    expect((res.body as { url: unknown }).url).toBeNull();
  });

  it("a token resolves in its own shop only, until it expires; issuing deletes expired rows", async () => {
    const { controller, repos, advance } = harness();
    const token = (
      (await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    expect((await controller.shell({ tenantId: "t-1", previewToken: token })).status).toBe(200);
    expect((await controller.shell({ tenantId: "t-2", previewToken: token })).status).toBe(401);
    advance(60 * 60 * 1000);
    const expired = await controller.shell({ tenantId: "t-1", previewToken: token });
    expect(expired).toEqual({
      status: 401,
      body: {
        code: "PREVIEW_INVALID",
        message: "Preview link is invalid or expired",
        retryable: false,
        fields: [],
      },
    });
    await controller.issuePreviewToken({ tenantId: "t-1", createdBy: "s" });
    expect((repos.previewTokens as InMemoryPreviewTokenRepository).all()).toHaveLength(1);
  });

  it("a malformed token is refused without a lookup", async () => {
    const { controller } = harness();
    expect(
      (await controller.shell({ tenantId: "t-1", previewToken: "x".repeat(101) })).status,
    ).toBe(401);
  });
});
```

`src/application/shell.use-case.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("GetStorefrontShell", () => {
  it("an untouched shop: live, default brand, unbranded, Arabic, unlocked", async () => {
    const { controller } = harness({ names: { [T]: "متجر النور" } });
    const res = await controller.shell({ tenantId: T });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mode: "live",
      previewExpiresAt: null,
      branded: false,
      storeName: "متجر النور",
      defaultLocale: "ar",
      preferences: { homeTitle: {}, homeMetaDescription: {}, shareImage: null },
      brand: {
        logo: { image: null, widthPx: 140 },
        favicon: null,
        colors: DEFAULT_THEME_DOCUMENT.brand.colors,
        typography: DEFAULT_THEME_DOCUMENT.brand.typography,
        corners: "rounded",
        social: {},
      },
      header: { sticky: false },
      footer: { note: {}, showSocial: true },
      locked: false,
    });
  });

  it("live shows the published document, preview shows the draft", async () => {
    const { controller } = harness({ owned: { [T]: ["logo-1"] } });
    const draft = JSON.parse(JSON.stringify(DEFAULT_THEME_DOCUMENT));
    draft.brand.logo.imageRef = "logo-1";
    await controller.saveThemeDraft({ tenantId: T, expectedVersion: 0, document: draft });
    const live = (await controller.shell({ tenantId: T })).body as any;
    expect(live.brand.logo.image).toBeNull();
    const token = (
      (await controller.issuePreviewToken({ tenantId: T, createdBy: "s" })).body as {
        token: string;
      }
    ).token;
    const preview = (await controller.shell({ tenantId: T, previewToken: token })).body as any;
    expect(preview.mode).toBe("preview");
    expect(preview.previewExpiresAt).toBe("2026-10-27T11:00:00.000Z");
    expect(preview.branded).toBe(true);
    expect(preview.brand.logo.image).toEqual({
      url: "https://cdn.test/logo-1.png",
      alt: null,
      width: 64,
      height: 64,
    });
  });

  it("carries no tenant, storage key, revision, hash, version or accessVersion", async () => {
    const { controller } = harness();
    await controller.updateAccess({
      tenantId: T,
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const json = JSON.stringify((await controller.shell({ tenantId: T })).body);
    for (const leak of [
      "t-1",
      "tenant",
      "Revision",
      "version",
      "hash",
      "accessVersion",
      "storageKey",
      "imageRef",
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(JSON.parse(json).locked).toBe(true);
  });
});
```

`src/application/preferences.use-cases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { harness } from "../testing/fakes";

const T = "t-1";

describe("preferences use cases", () => {
  it("reads the defaults with the store name", async () => {
    const { controller } = harness({ names: { [T]: "Nour" } });
    expect(await controller.getPreferences({ tenantId: T })).toEqual({
      status: 200,
      body: {
        homeTitle: {},
        homeMetaDescription: {},
        shareImage: null,
        defaultLocale: "ar",
        storeName: "Nour",
        version: 0,
      },
    });
  });

  it("saves normalised text, an owned share image, and records the event", async () => {
    const { controller, recorded } = harness({ owned: { [T]: ["og-1"] } });
    const res = await controller.updatePreferences({
      tenantId: T,
      homeTitle: { ar: "  متجر‮ النور ", en: "" },
      homeMetaDescription: { en: "Hand-made" },
      shareImageId: "og-1",
      defaultLocale: "en",
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      homeTitle: { ar: "متجر النور" },
      homeMetaDescription: { en: "Hand-made" },
      shareImage: { url: "https://cdn.test/og-1.png" },
      defaultLocale: "en",
      version: 1,
    });
    expect(recorded).toEqual([{ tenantId: T, type: "online_store.preferences.updated" }]);
  });

  it("refuses a 71-character title, a foreign share image and a stale version", async () => {
    const { controller } = harness({ owned: { other: ["og-x"] } });
    const long = await controller.updatePreferences({
      tenantId: T,
      homeTitle: { en: "x".repeat(71) },
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(long.body).toMatchObject({ fields: [{ field: "homeTitle.en", message: "TOO_LONG" }] });
    const foreign = await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: "og-x",
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(foreign.body).toMatchObject({ code: "IMAGE_NOT_FOUND" });
    await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    const stale = await controller.updatePreferences({
      tenantId: T,
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
    });
    expect(stale.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
```

`src/interfaces/presenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { err, ok } from "@platform/types";
import { draftChanged, invalidContent, nothingToPublish } from "../domain/errors";
import { present } from "./presenter";

describe("present", () => {
  it("copies the CODE: prefix into body.code and maps the status", () => {
    expect(present(err(draftChanged()), 200)).toMatchObject({
      status: 409,
      body: { code: "DRAFT_CHANGED" },
    });
    expect(present(err(nothingToPublish()), 200)).toMatchObject({
      status: 409,
      body: { code: "NOTHING_TO_PUBLISH" },
    });
    expect(
      present(err(invalidContent([{ path: "brand.corners", code: "INVALID_VALUE" }])), 200),
    ).toMatchObject({
      status: 422,
      body: {
        code: "INVALID_CONTENT",
        fields: [{ field: "brand.corners", message: "INVALID_VALUE" }],
      },
    });
    expect(present(ok({ a: 1 }), 201)).toEqual({ status: 201, body: { a: 1 } });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/application src/interfaces`
Expected: FAIL — `../composition` and the use-case modules do not exist.

- [ ] **Step 4: Implement ports, deps and the guarded helper**

`src/application/ports.ts`:

```ts
import type { DomainEvent } from "@platform/domain";

/** What a reader may know about an image: never a storage key, never a tenant (spec 1.7). */
export interface ImageDto {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

/** Backed by Media's `ResolveMediaImages` (one batched tenant-scoped read per call). */
export interface ImageRefsPort {
  /** The subset of `ids` that are this shop's own ACTIVE assets. */
  existingIds(ids: readonly string[], tenantId: string): Promise<readonly string[]>;
  /** Resolvable ids only; a missing, archived or foreign id is simply absent. */
  resolve(ids: readonly string[], tenantId: string): Promise<Readonly<Record<string, ImageDto>>>;
}

/** Backed by `@platform/security`'s `ScryptPasswordHasher` (constant-cost compare). */
export interface StorefrontPasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** The shop's primary VERIFIED hostname (tenancy, ADR-0014 8f exemption), or null. */
export interface ShopHostPort {
  primaryHostname(tenantId: string): Promise<string | null>;
}

/** Settings → General's store name (tenancy, pinned today; this adapter is the switch point). */
export interface StoreIdentityPort {
  storeName(tenantId: string): Promise<string>;
}

/** Writes events to the outbox in the caller's transaction, tenant attached at write time. */
export interface EventRecorder {
  record(events: readonly DomainEvent[], tenantId: string, tx: unknown): Promise<void>;
}
```

`src/application/deps.ts`:

```ts
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import type {
  AccessRepository,
  PreferencesRepository,
  PreviewTokenRepository,
  ThemeReleaseRepository,
  ThemeRepository,
} from "../domain/repositories";
import type {
  EventRecorder,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "./ports";

export interface OnlineStoreDeps {
  readonly preferences: PreferencesRepository;
  readonly access: AccessRepository;
  readonly themes: ThemeRepository;
  readonly releases: ThemeReleaseRepository;
  readonly previewTokens: PreviewTokenRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly imageRefs: ImageRefsPort;
  readonly passwordHasher: StorefrontPasswordHasher;
  readonly shopHost: ShopHostPort;
  readonly storeIdentity: StoreIdentityPort;
  readonly events: EventRecorder;
}
```

`src/application/guarded.ts`:

```ts
import { UniqueEntityId, type DomainEventProps } from "@platform/domain";
import { err, type Result } from "@platform/types";
import { ConcurrencyError, type DomainError } from "@platform/utils";
import { versionConflict } from "../domain/errors";
import type { OnlineStoreDeps } from "./deps";

/**
 * Runs a unit of work. A lost race throws ConcurrencyError INSIDE `run` (so the transaction rolls
 * back) and is answered here, outside it, as 409 VERSION_CONFLICT. Every use case validates before
 * its first write, because `run` commits whenever the callback returns — even an `err` Result.
 */
export async function inUnitOfWork<T>(
  deps: Pick<OnlineStoreDeps, "unitOfWork">,
  work: (tx: unknown) => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  try {
    return await deps.unitOfWork.run(work);
  } catch (error) {
    if (error instanceof ConcurrencyError) return err(versionConflict());
    throw error;
  }
}

export function eventProps(
  deps: Pick<OnlineStoreDeps, "idGenerator" | "clock">,
  tenantId: string,
): DomainEventProps {
  return {
    eventId: deps.idGenerator.generate(),
    aggregateId: UniqueEntityId.from(tenantId),
    occurredAt: deps.clock.now(),
  };
}

export const iso = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();
```

- [ ] **Step 5: Implement the use cases**

`src/application/preferences.use-cases.ts`:

```ts
import {
  normalizeLocalizedText,
  type ContentIssue,
  type Locale,
  type LocalizedText,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { imageNotFound, invalidContent, versionConflict } from "../domain/errors";
import { PreferencesUpdated } from "../domain/events";
import {
  HOME_DESCRIPTION_MAX,
  HOME_TITLE_MAX,
  type StorefrontPreferences,
} from "../domain/storefront-preferences";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork } from "./guarded";
import type { ImageDto } from "./ports";

export interface PreferencesView {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImage: ImageDto | null;
  readonly defaultLocale: Locale;
  readonly storeName: string;
  readonly version: number;
}

export interface UpdatePreferencesInput {
  readonly homeTitle: unknown;
  readonly homeMetaDescription: unknown;
  readonly shareImageId: string | null;
  readonly defaultLocale: Locale;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

async function viewOf(
  deps: OnlineStoreDeps,
  prefs: StorefrontPreferences,
  tenantId: string,
  version: number,
): Promise<PreferencesView> {
  const s = prefs.snapshot();
  const [storeName, images] = await Promise.all([
    deps.storeIdentity.storeName(tenantId),
    s.shareImageRef === null
      ? Promise.resolve({})
      : deps.imageRefs.resolve([s.shareImageRef], tenantId),
  ]);
  return {
    homeTitle: s.homeTitle,
    homeMetaDescription: s.homeMetaDescription,
    shareImage:
      s.shareImageRef === null
        ? null
        : ((images as Record<string, ImageDto>)[s.shareImageRef] ?? null),
    defaultLocale: s.defaultLocale,
    storeName,
    version,
  };
}

export class GetPreferences {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<PreferencesView, DomainError>> {
    const prefs = await this.deps.preferences.get(input.tenantId);
    return ok(await viewOf(this.deps, prefs, input.tenantId, prefs.snapshot().version));
  }
}

/** Live on save (spec 1.4). Everything is validated before the unit of work writes anything. */
export class UpdatePreferences {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdatePreferencesInput): Promise<Result<PreferencesView, DomainError>> {
    const issues: ContentIssue[] = [];
    const homeTitle = normalizeLocalizedText(
      input.homeTitle,
      { path: "homeTitle", max: HOME_TITLE_MAX },
      issues,
    );
    const homeMetaDescription = normalizeLocalizedText(
      input.homeMetaDescription,
      { path: "homeMetaDescription", max: HOME_DESCRIPTION_MAX },
      issues,
    );
    if (issues.length > 0) return err(invalidContent(issues));
    if (input.shareImageId !== null) {
      const owned = await this.deps.imageRefs.existingIds([input.shareImageId], input.tenantId);
      if (!owned.includes(input.shareImageId)) return err(imageNotFound("shareImageId"));
    }
    const saved = await inUnitOfWork(this.deps, async (tx) => {
      const prefs = await this.deps.preferences.get(input.tenantId, tx);
      if (prefs.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = prefs.nextVersion;
      prefs.update(
        {
          homeTitle,
          homeMetaDescription,
          shareImageRef: input.shareImageId,
          defaultLocale: input.defaultLocale,
        },
        this.deps.clock.now(),
      );
      await this.deps.preferences.save(prefs, input.tenantId, tx);
      await this.deps.events.record(
        [new PreferencesUpdated(eventProps(this.deps, input.tenantId))],
        input.tenantId,
        tx,
      );
      return ok({ prefs, version });
    });
    if (!saved.ok) return saved;
    return ok(await viewOf(this.deps, saved.value.prefs, input.tenantId, saved.value.version));
  }
}
```

`src/application/access.use-cases.ts`:

```ts
import {
  normalizeLocalizedText,
  type ContentIssue,
  type LocalizedText,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type DomainError } from "@platform/utils";
import { invalidContent, versionConflict } from "../domain/errors";
import { AccessChanged } from "../domain/events";
import {
  parsePasswordInput,
  VISITOR_MESSAGE_MAX,
  type StorefrontAccess,
} from "../domain/storefront-access";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork, iso } from "./guarded";

export interface AccessStatusView {
  readonly locked: boolean;
  readonly passwordSet: boolean;
  readonly passwordUpdatedAt: string | null;
  readonly message: LocalizedText;
  readonly version: number;
}

export interface PublicAccessView {
  readonly locked: boolean;
  readonly accessVersion: number;
  readonly message: LocalizedText;
}

export interface UpdateAccessInput {
  readonly locked: boolean;
  readonly password?: string | null;
  readonly message: unknown;
  readonly expectedVersion: number;
  readonly tenantId: string;
}

/** The only shape the admin sees: never the hash, never the password (spec 1.5). */
function statusOf(access: StorefrontAccess, version: number): AccessStatusView {
  const s = access.snapshot();
  return {
    locked: s.locked,
    passwordSet: s.passwordHash !== null,
    passwordUpdatedAt: iso(s.passwordUpdatedAt),
    message: s.message,
    version,
  };
}

export class GetAccessStatus {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<AccessStatusView, DomainError>> {
    const access = await this.deps.access.get(input.tenantId);
    return ok(statusOf(access, access.snapshot().version));
  }
}

export class UpdateAccess {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: UpdateAccessInput): Promise<Result<AccessStatusView, DomainError>> {
    const password = parsePasswordInput(input.password);
    if (password.kind === "invalid") {
      return err(
        new ValidationError("PASSWORD_LENGTH: Use 4 to 100 characters.", [
          { field: "password", message: "PASSWORD_LENGTH" },
        ]),
      );
    }
    const issues: ContentIssue[] = [];
    const message = normalizeLocalizedText(
      input.message,
      { path: "message", max: VISITOR_MESSAGE_MAX, multiline: true },
      issues,
    );
    if (issues.length > 0) return err(invalidContent(issues));
    // Ruling 10: scrypt runs BEFORE the transaction opens.
    const newPasswordHash =
      password.kind === "set" ? await this.deps.passwordHasher.hash(password.password) : null;
    return inUnitOfWork(this.deps, async (tx) => {
      const access = await this.deps.access.get(input.tenantId, tx);
      if (access.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = access.nextVersion;
      const applied = access.apply({
        locked: input.locked,
        newPasswordHash,
        message,
        now: this.deps.clock.now(),
      });
      if (!applied.ok) return applied; // nothing written yet
      await this.deps.access.save(access, input.tenantId, tx);
      await this.deps.events.record(
        [new AccessChanged(eventProps(this.deps, input.tenantId), { locked: input.locked })],
        input.tenantId,
        tx,
      );
      return ok(statusOf(access, version));
    });
  }
}

export class GetPublicAccess {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: { readonly tenantId: string }): Promise<PublicAccessView> {
    const s = (await this.deps.access.get(input.tenantId)).snapshot();
    return { locked: s.locked, accessVersion: s.accessVersion, message: s.message };
  }
}

/**
 * Ruling 11: wrong password, no lock and no hash all cost one scrypt verify (a dummy hash minted
 * once per process with the same hasher), and all answer the same "incorrect".
 */
export class VerifyStorefrontPassword {
  private dummyHash: Promise<string> | undefined;
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly password: string;
    readonly tenantId: string;
  }): Promise<{ readonly ok: true; readonly accessVersion: number } | { readonly ok: false }> {
    const s = (await this.deps.access.get(input.tenantId)).snapshot();
    this.dummyHash ??= this.deps.passwordHasher.hash("morbeh-unlock-dummy");
    const hash = s.passwordHash ?? (await this.dummyHash);
    const matches = await this.deps.passwordHasher.verify(input.password.trim(), hash);
    if (matches && s.locked && s.passwordHash !== null)
      return { ok: true, accessVersion: s.accessVersion };
    return { ok: false };
  }
}
```

Note: `dummyHash` is a `Promise<string>` field on the use case — not a tenant id, so the tenant-mode guard ignores it.

`src/application/theme.use-cases.ts`:

```ts
import {
  checkBrandContrast,
  imageRefsOf,
  validateThemeDocument,
  type ContrastWarning,
  type ThemeDocument,
} from "@platform/storefront-content";
import { err, ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { imageNotFound, invalidContent, releaseNotFound, versionConflict } from "../domain/errors";
import { ThemePublished } from "../domain/events";
import { RELEASES_KEPT, type StorefrontTheme } from "../domain/storefront-theme";
import type { OnlineStoreDeps } from "./deps";
import { eventProps, inUnitOfWork, iso } from "./guarded";
import type { ImageDto } from "./ports";

export interface ThemeStateView {
  readonly draft: ThemeDocument;
  readonly published: ThemeDocument | null;
  readonly draftRevision: number;
  readonly draftSavedAt: string | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly hasUnpublishedChanges: boolean;
  readonly images: Readonly<Record<string, ImageDto>>;
  readonly version: number;
}
export interface SaveDraftView {
  readonly draftRevision: number;
  readonly version: number;
  readonly warnings: readonly ContrastWarning[];
}
export interface DraftRevisionView {
  readonly draftRevision: number;
  readonly version: number;
}
export interface PublishView {
  readonly releaseNumber: number;
  readonly publishedAt: string;
}
export interface ReleasesView {
  readonly releases: readonly {
    readonly releaseNumber: number;
    readonly publishedAt: string;
    readonly publishedByName: string | null;
  }[];
}

const IMAGE_PATHS = { logo: "brand.logo.imageRef", favicon: "brand.favicon.imageRef" } as const;

export class GetTheme {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly tenantId: string;
  }): Promise<Result<ThemeStateView, DomainError>> {
    const theme = await this.deps.themes.get(input.tenantId);
    const s = theme.snapshot();
    const ids = [
      ...new Set([
        ...imageRefsOf(s.draft),
        ...(s.published === null ? [] : imageRefsOf(s.published)),
      ]),
    ];
    const images = ids.length === 0 ? {} : await this.deps.imageRefs.resolve(ids, input.tenantId);
    return ok({
      draft: s.draft,
      published: s.published,
      draftRevision: s.draftRevision,
      draftSavedAt: iso(s.draftSavedAt),
      publishedDraftRevision: s.publishedDraftRevision,
      releaseNumber: s.releaseNumber,
      publishedAt: iso(s.publishedAt),
      publishedBy: s.publishedBy,
      hasUnpublishedChanges: theme.hasUnpublishedChanges(),
      images,
      version: s.version,
    });
  }
}

/** Validate (document, contrast, image ownership) → then one unit of work with the version check. */
export class SaveThemeDraft {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly document: unknown;
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<SaveDraftView, DomainError>> {
    const validated = validateThemeDocument(input.document);
    if (!validated.ok) return err(invalidContent(validated.issues));
    const doc = validated.value;
    const contrast = checkBrandContrast(doc.brand.colors);
    if (contrast.blocking.length > 0) return err(invalidContent(contrast.blocking));
    const refs = imageRefsOf(doc);
    if (refs.length > 0) {
      const owned = await this.deps.imageRefs.existingIds(refs, input.tenantId);
      if (doc.brand.logo.imageRef !== null && !owned.includes(doc.brand.logo.imageRef))
        return err(imageNotFound(IMAGE_PATHS.logo));
      if (doc.brand.favicon.imageRef !== null && !owned.includes(doc.brand.favicon.imageRef))
        return err(imageNotFound(IMAGE_PATHS.favicon));
    }
    return inUnitOfWork(this.deps, async (tx) => {
      const theme = await this.deps.themes.get(input.tenantId, tx);
      if (theme.snapshot().version !== input.expectedVersion) return err(versionConflict());
      const version = theme.nextVersion;
      theme.saveDraft(doc, this.deps.clock.now());
      await this.deps.themes.save(theme, input.tenantId, tx);
      return ok({
        draftRevision: theme.snapshot().draftRevision,
        version,
        warnings: contrast.warnings,
      });
    });
  }
}

/** Spec 1.8: publish exactly the previewed revision; release + prune + event in the same transaction. */
export class PublishTheme {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly expectedDraftRevision: number;
    readonly by: string;
    readonly tenantId: string;
  }): Promise<Result<PublishView, DomainError>> {
    return inUnitOfWork(this.deps, async (tx) => {
      const theme = await this.deps.themes.get(input.tenantId, tx);
      const now = this.deps.clock.now();
      const release = theme.publish({
        expectedDraftRevision: input.expectedDraftRevision,
        by: input.by,
        releaseId: this.deps.idGenerator.generate(),
        now,
      });
      if (!release.ok) return release; // DRAFT_CHANGED / NOTHING_TO_PUBLISH — nothing written
      await this.deps.themes.save(theme, input.tenantId, tx);
      await this.deps.releases.append(release.value, input.tenantId, tx);
      await this.deps.releases.pruneBeyond(RELEASES_KEPT, input.tenantId, tx);
      await this.deps.events.record(
        [
          new ThemePublished(eventProps(this.deps, input.tenantId), {
            releaseNumber: release.value.releaseNumber,
          }),
        ],
        input.tenantId,
        tx,
      );
      return ok({ releaseNumber: release.value.releaseNumber, publishedAt: now.toISOString() });
    });
  }
}

async function rewriteDraft(
  deps: OnlineStoreDeps,
  input: { readonly expectedVersion: number; readonly tenantId: string },
  change: (theme: StorefrontTheme, tx: unknown) => Promise<Result<void, DomainError>>,
): Promise<Result<DraftRevisionView, DomainError>> {
  return inUnitOfWork(deps, async (tx) => {
    const theme = await deps.themes.get(input.tenantId, tx);
    if (theme.snapshot().version !== input.expectedVersion) return err(versionConflict());
    const version = theme.nextVersion;
    const changed = await change(theme, tx);
    if (!changed.ok) return changed;
    await deps.themes.save(theme, input.tenantId, tx);
    return ok({ draftRevision: theme.snapshot().draftRevision, version });
  });
}

export class DiscardThemeDraft {
  constructor(private readonly deps: OnlineStoreDeps) {}
  execute(input: {
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<DraftRevisionView, DomainError>> {
    return rewriteDraft(this.deps, input, async (theme) => {
      theme.discardDraft(this.deps.clock.now());
      return ok(undefined);
    });
  }
}

/** Spec 1.8: restore goes into the DRAFT; publishing it is a separate step. */
export class RestoreThemeRelease {
  constructor(private readonly deps: OnlineStoreDeps) {}
  execute(input: {
    readonly releaseNumber: number;
    readonly expectedVersion: number;
    readonly tenantId: string;
  }): Promise<Result<DraftRevisionView, DomainError>> {
    return rewriteDraft(this.deps, input, async (theme, tx) => {
      const release = await this.deps.releases.get(input.releaseNumber, input.tenantId, tx);
      if (release === null) return err(releaseNotFound());
      theme.restoreRelease(release, this.deps.clock.now());
      return ok(undefined);
    });
  }
}

export class ListThemeReleases {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: { readonly tenantId: string }): Promise<Result<ReleasesView, DomainError>> {
    const releases = await this.deps.releases.list(input.tenantId, RELEASES_KEPT);
    // Ruling 12: no staff-directory name read exists on this base.
    return ok({
      releases: releases.map((r) => ({
        releaseNumber: r.releaseNumber,
        publishedAt: r.publishedAt.toISOString(),
        publishedByName: null,
      })),
    });
  }
}
```

(In `RestoreThemeRelease` the release is read before the version check fails? No — `rewriteDraft` checks the version first, then calls `change`; both are reads before any write.)

`src/application/preview.use-cases.ts`:

```ts
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import {
  hashPreviewToken,
  isWellFormedPreviewToken,
  mintPreviewToken,
  PREVIEW_TOKEN_TTL_MS,
} from "../domain/preview-token";
import type { OnlineStoreDeps } from "./deps";
import { inUnitOfWork } from "./guarded";

export interface PreviewTokenView {
  readonly token: string;
  readonly expiresAt: string;
  readonly url: string | null;
}

/** Spec 1.6. The token exists once: in this result. Only its SHA-256 is stored. */
export class IssuePreviewToken {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly createdBy: string;
    readonly tenantId: string;
  }): Promise<Result<PreviewTokenView, DomainError>> {
    const token = mintPreviewToken();
    const now = this.deps.clock.now();
    const expiresAt = new Date(now.getTime() + PREVIEW_TOKEN_TTL_MS);
    const stored = await inUnitOfWork(this.deps, async (tx) => {
      await this.deps.previewTokens.deleteExpired(input.tenantId, now, tx);
      await this.deps.previewTokens.insert(
        {
          id: this.deps.idGenerator.generate(),
          tokenHash: hashPreviewToken(token),
          expiresAt,
          createdBy: input.createdBy,
          createdAt: now,
        },
        input.tenantId,
        tx,
      );
      return ok(undefined);
    });
    if (!stored.ok) return stored;
    let host: string | null = null;
    try {
      host = await this.deps.shopHost.primaryHostname(input.tenantId);
    } catch {
      host = null; // admin-web falls back to STOREFRONT_URL
    }
    return ok({
      token,
      expiresAt: expiresAt.toISOString(),
      url: host === null ? null : `https://${host}/?preview=${encodeURIComponent(token)}`,
    });
  }
}

/** The expiry when usable, else null — no reason detail. Another shop's token is unknown here. */
export class ResolvePreviewToken {
  constructor(private readonly deps: OnlineStoreDeps) {}
  async execute(input: {
    readonly token: string;
    readonly tenantId: string;
  }): Promise<Date | null> {
    if (!isWellFormedPreviewToken(input.token)) return null;
    const found = await this.deps.previewTokens.findActive(
      hashPreviewToken(input.token),
      input.tenantId,
      this.deps.clock.now(),
    );
    return found === null ? null : found.expiresAt;
  }
}
```

`src/application/shell.use-case.ts`:

```ts
import {
  DEFAULT_THEME_DOCUMENT,
  readSocial,
  type Locale,
  type LocalizedText,
  type ThemeBrand,
} from "@platform/storefront-content";
import type { OnlineStoreDeps } from "./deps";
import type { ImageDto } from "./ports";
import type { ResolvePreviewToken } from "./preview.use-cases";

/** Spec 1.10 `PublicShellDto` (+ `branded`, Ruling 6). No tenant, key, revision, hash or version. */
export interface PublicShellView {
  readonly mode: "live" | "preview";
  /** The preview link's expiry (ISO) for the preview banner; null when live. */
  readonly previewExpiresAt: string | null;
  readonly branded: boolean;
  readonly storeName: string;
  readonly defaultLocale: Locale;
  readonly preferences: {
    readonly homeTitle: LocalizedText;
    readonly homeMetaDescription: LocalizedText;
    readonly shareImage: ImageDto | null;
  };
  readonly brand: {
    readonly logo: { readonly image: ImageDto | null; readonly widthPx: number };
    readonly favicon: ImageDto | null;
    readonly colors: ThemeBrand["colors"];
    readonly typography: ThemeBrand["typography"];
    readonly corners: ThemeBrand["corners"];
    readonly social: ThemeBrand["social"];
  };
  readonly header: { readonly sticky: boolean };
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  readonly locked: boolean;
}

export type ShellOutcome =
  { readonly kind: "ok"; readonly shell: PublicShellView } | { readonly kind: "preview_invalid" };

export class GetStorefrontShell {
  constructor(
    private readonly deps: OnlineStoreDeps,
    private readonly resolvePreview: ResolvePreviewToken,
  ) {}

  async execute(input: {
    readonly tenantId: string;
    readonly previewToken?: string;
  }): Promise<ShellOutcome> {
    const preview = input.previewToken !== undefined;
    const expiresAt = preview
      ? await this.resolvePreview.execute({
          token: input.previewToken as string,
          tenantId: input.tenantId,
        })
      : null;
    if (preview && expiresAt === null) return { kind: "preview_invalid" };
    const [theme, prefs, access, storeName] = await Promise.all([
      this.deps.themes.get(input.tenantId),
      this.deps.preferences.get(input.tenantId),
      this.deps.access.get(input.tenantId),
      this.deps.storeIdentity.storeName(input.tenantId),
    ]);
    const t = theme.snapshot();
    const doc = preview ? t.draft : (t.published ?? DEFAULT_THEME_DOCUMENT);
    const p = prefs.snapshot();
    const ids = [doc.brand.logo.imageRef, doc.brand.favicon.imageRef, p.shareImageRef].filter(
      (id): id is string => id !== null,
    );
    const images =
      ids.length === 0 ? {} : await this.deps.imageRefs.resolve([...new Set(ids)], input.tenantId);
    const image = (id: string | null): ImageDto | null =>
      id === null ? null : (images[id] ?? null);
    return {
      kind: "ok",
      shell: {
        mode: preview ? "preview" : "live",
        previewExpiresAt: expiresAt === null ? null : expiresAt.toISOString(),
        branded: preview || t.published !== null,
        storeName,
        defaultLocale: p.defaultLocale,
        preferences: {
          homeTitle: p.homeTitle,
          homeMetaDescription: p.homeMetaDescription,
          shareImage: image(p.shareImageRef),
        },
        brand: {
          logo: { image: image(doc.brand.logo.imageRef), widthPx: doc.brand.logo.widthPx },
          favicon: image(doc.brand.favicon.imageRef),
          colors: doc.brand.colors,
          typography: doc.brand.typography,
          corners: doc.brand.corners,
          social: readSocial(doc.brand.social),
        },
        header: { sticky: doc.header.sticky },
        footer: { note: doc.footer.note, showSocial: doc.footer.showSocial },
        locked: access.snapshot().locked,
      },
    };
  }
}
```

- [ ] **Step 6: Implement the presenter, controller, translator and composition**

`src/interfaces/presenter.ts`:

```ts
import type { Result } from "@platform/types";
import { toErrorEnvelope, type DomainError } from "@platform/utils";
import { CODE_PATTERN } from "../domain/errors";

export interface ControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONCURRENCY: 409,
  BUSINESS_RULE: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
};

/** Ruling 9: the specific code (message prefix `CODE:`) becomes `body.code`. */
export function present<T>(
  result: Result<T, DomainError>,
  successStatus: number,
): ControllerResponse {
  if (result.ok) return { status: successStatus, body: result.value };
  const envelope = toErrorEnvelope(result.error);
  const specific = CODE_PATTERN.exec(result.error.message)?.[1];
  return {
    status: STATUS_BY_CODE[result.error.code] ?? 422,
    body: { ...envelope, code: specific ?? envelope.code },
  };
}

export function plainError(status: number, code: string, message: string): ControllerResponse {
  return { status, body: { code, message, retryable: false, fields: [] } };
}
```

`src/interfaces/online-store.controller.ts`:

```ts
import type {
  GetAccessStatus,
  GetPublicAccess,
  UpdateAccess,
  UpdateAccessInput,
  VerifyStorefrontPassword,
} from "../application/access.use-cases";
import type {
  GetPreferences,
  UpdatePreferences,
  UpdatePreferencesInput,
} from "../application/preferences.use-cases";
import type { IssuePreviewToken } from "../application/preview.use-cases";
import type { GetStorefrontShell } from "../application/shell.use-case";
import type {
  DiscardThemeDraft,
  GetTheme,
  ListThemeReleases,
  PublishTheme,
  RestoreThemeRelease,
  SaveThemeDraft,
} from "../application/theme.use-cases";
import { plainError, present, type ControllerResponse } from "./presenter";

export interface OnlineStoreControllerDeps {
  readonly getPreferences: GetPreferences;
  readonly updatePreferences: UpdatePreferences;
  readonly getAccessStatus: GetAccessStatus;
  readonly updateAccess: UpdateAccess;
  readonly getPublicAccess: GetPublicAccess;
  readonly verifyPassword: VerifyStorefrontPassword;
  readonly getTheme: GetTheme;
  readonly saveThemeDraft: SaveThemeDraft;
  readonly discardThemeDraft: DiscardThemeDraft;
  readonly publishTheme: PublishTheme;
  readonly listThemeReleases: ListThemeReleases;
  readonly restoreThemeRelease: RestoreThemeRelease;
  readonly issuePreviewToken: IssuePreviewToken;
  readonly getShell: GetStorefrontShell;
}

type Tenant = { readonly tenantId: string };

/** Framework-agnostic boundary (no HTTP). Admin methods are guarded by apps/admin; public ones are not. */
export class OnlineStoreController {
  constructor(private readonly deps: OnlineStoreControllerDeps) {}

  async getPreferences(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getPreferences.execute(input), 200);
  }
  async updatePreferences(input: UpdatePreferencesInput): Promise<ControllerResponse> {
    return present(await this.deps.updatePreferences.execute(input), 200);
  }
  async getAccess(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getAccessStatus.execute(input), 200);
  }
  async updateAccess(input: UpdateAccessInput): Promise<ControllerResponse> {
    return present(await this.deps.updateAccess.execute(input), 200);
  }
  async getTheme(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.getTheme.execute(input), 200);
  }
  async saveThemeDraft(
    input: { readonly document: unknown; readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.saveThemeDraft.execute(input), 200);
  }
  async discardThemeDraft(
    input: { readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.discardThemeDraft.execute(input), 200);
  }
  async publishTheme(
    input: { readonly expectedDraftRevision: number; readonly by: string } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.publishTheme.execute(input), 200);
  }
  async listThemeReleases(input: Tenant): Promise<ControllerResponse> {
    return present(await this.deps.listThemeReleases.execute(input), 200);
  }
  async restoreThemeRelease(
    input: { readonly releaseNumber: number; readonly expectedVersion: number } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.restoreThemeRelease.execute(input), 200);
  }
  async issuePreviewToken(
    input: { readonly createdBy: string } & Tenant,
  ): Promise<ControllerResponse> {
    return present(await this.deps.issuePreviewToken.execute(input), 201);
  }

  /** Public: the storefront shell; a bad preview token is 401 PREVIEW_INVALID (the storefront falls back to live). */
  async shell(input: { readonly previewToken?: string } & Tenant): Promise<ControllerResponse> {
    const outcome = await this.deps.getShell.execute(input);
    if (outcome.kind === "preview_invalid")
      return plainError(401, "PREVIEW_INVALID", "Preview link is invalid or expired");
    return { status: 200, body: outcome.shell };
  }
  async publicAccess(input: Tenant): Promise<ControllerResponse> {
    return { status: 200, body: await this.deps.getPublicAccess.execute(input) };
  }
  /** Public: one uniform 401 for wrong password, no lock and no hash. */
  async unlock(input: { readonly password: string } & Tenant): Promise<ControllerResponse> {
    const result = await this.deps.verifyPassword.execute(input);
    return result.ok
      ? { status: 200, body: { accessVersion: result.accessVersion } }
      : plainError(401, "PASSWORD_INCORRECT", "Incorrect password");
  }
}
```

`src/infrastructure/event-translator.ts`:

```ts
import type { DomainEvent } from "@platform/domain";
import type { IntegrationEventDescriptor, IntegrationEventTranslator } from "@platform/messaging";
import { AccessChanged, PreferencesUpdated, ThemePublished } from "../domain/events";

export class OnlineStoreEventTranslator implements IntegrationEventTranslator {
  translate(event: DomainEvent): IntegrationEventDescriptor | undefined {
    if (
      event instanceof ThemePublished ||
      event instanceof AccessChanged ||
      event instanceof PreferencesUpdated
    ) {
      return {
        type: event.eventName,
        eventVersion: 1,
        aggregateType: "online_store",
        payload: event.data,
      };
    }
    return undefined;
  }
}
```

`src/composition.ts`:

```ts
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork, type Database } from "@platform/db";
import type { EventSerializer } from "@platform/domain-events";
import {
  InMemoryEventBus,
  InMemoryEventPublisher,
  InMemoryOutboxStore,
  OutboxRelay,
  OutboxWriter,
  rootEventContext,
  type Subscriber,
} from "@platform/messaging";
import type { TransactionalUnitOfWork } from "@platform/repository";
import {
  GetAccessStatus,
  GetPublicAccess,
  UpdateAccess,
  VerifyStorefrontPassword,
} from "./application/access.use-cases";
import type { OnlineStoreDeps } from "./application/deps";
import type {
  EventRecorder,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "./application/ports";
import { GetPreferences, UpdatePreferences } from "./application/preferences.use-cases";
import { IssuePreviewToken, ResolvePreviewToken } from "./application/preview.use-cases";
import { GetStorefrontShell } from "./application/shell.use-case";
import {
  DiscardThemeDraft,
  GetTheme,
  ListThemeReleases,
  PublishTheme,
  RestoreThemeRelease,
  SaveThemeDraft,
} from "./application/theme.use-cases";
import { ONLINE_STORE_PUBLISHED_EVENTS } from "./domain/events";
import { OnlineStoreEventTranslator } from "./infrastructure/event-translator";
import {
  InMemoryAccessRepository,
  InMemoryPreferencesRepository,
  InMemoryPreviewTokenRepository,
  InMemoryThemeReleaseRepository,
  InMemoryThemeRepository,
} from "./infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "./infrastructure/in-memory-unit-of-work";
import {
  PrismaAccessRepository,
  PrismaPreferencesRepository,
  PrismaPreviewTokenRepository,
  PrismaThemeReleaseRepository,
  PrismaThemeRepository,
} from "./infrastructure/prisma-repositories";
import { OnlineStoreController } from "./interfaces/online-store.controller";
import type { ControllerResponse } from "./interfaces/presenter";

export interface OnlineStoreWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Present ⇒ Prisma repositories + PrismaUnitOfWork. ADR-0014: no tenant at composition time. */
  readonly prisma?: Database;
  readonly imageRefs: ImageRefsPort;
  readonly passwordHasher: StorefrontPasswordHasher;
  readonly shopHost: ShopHostPort;
  readonly storeIdentity: StoreIdentityPort;
}

export interface OnlineStoreRepos {
  readonly preferences: OnlineStoreDeps["preferences"];
  readonly access: OnlineStoreDeps["access"];
  readonly themes: OnlineStoreDeps["themes"];
  readonly releases: OnlineStoreDeps["releases"];
  readonly previewTokens: OnlineStoreDeps["previewTokens"];
}

/** Closures taking `tenantId` per call (spec "Composition"); nothing here holds a tenant. */
export interface OnlineStorePublicReads {
  readonly shell: (tenantId: string, previewToken?: string) => Promise<ControllerResponse>;
  readonly access: (tenantId: string) => Promise<ControllerResponse>;
  readonly unlock: (tenantId: string, password: string) => Promise<ControllerResponse>;
}

export interface WiredOnlineStore {
  readonly controller: OnlineStoreController;
  readonly publicReads: OnlineStorePublicReads;
  readonly drainOutbox: () => Promise<number>;
  readonly deliveredEventTypes: readonly string[];
}

/** Test seam (not exported from index.ts): the controller from given repositories. */
export function buildOnlineStoreController(
  repos: OnlineStoreRepos,
  unitOfWork: TransactionalUnitOfWork<unknown>,
  ports: Pick<
    OnlineStoreWiringDeps,
    "idGenerator" | "clock" | "imageRefs" | "passwordHasher" | "shopHost" | "storeIdentity"
  >,
  events: EventRecorder,
): OnlineStoreController {
  const deps: OnlineStoreDeps = { ...repos, ...ports, unitOfWork, events };
  const resolvePreview = new ResolvePreviewToken(deps);
  return new OnlineStoreController({
    getPreferences: new GetPreferences(deps),
    updatePreferences: new UpdatePreferences(deps),
    getAccessStatus: new GetAccessStatus(deps),
    updateAccess: new UpdateAccess(deps),
    getPublicAccess: new GetPublicAccess(deps),
    verifyPassword: new VerifyStorefrontPassword(deps),
    getTheme: new GetTheme(deps),
    saveThemeDraft: new SaveThemeDraft(deps),
    discardThemeDraft: new DiscardThemeDraft(deps),
    publishTheme: new PublishTheme(deps),
    listThemeReleases: new ListThemeReleases(deps),
    restoreThemeRelease: new RestoreThemeRelease(deps),
    issuePreviewToken: new IssuePreviewToken(deps),
    getShell: new GetStorefrontShell(deps, resolvePreview),
  });
}

function publicReadsOf(controller: OnlineStoreController): OnlineStorePublicReads {
  return {
    shell: (tenantId, previewToken) =>
      controller.shell({ tenantId, ...(previewToken === undefined ? {} : { previewToken }) }),
    access: (tenantId) => controller.publicAccess({ tenantId }),
    unlock: (tenantId, password) => controller.unlock({ tenantId, password }),
  };
}

export function wireOnlineStore(deps: OnlineStoreWiringDeps): WiredOnlineStore {
  const translator = new OnlineStoreEventTranslator();
  const context = rootEventContext(deps.idGenerator); // no tenant: attached per write below
  if (deps.prisma !== undefined) {
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(deps.prisma),
      translator,
      serializer: deps.serializer,
      clock: deps.clock,
      producer: "online-store",
    });
    const events: EventRecorder = {
      record: (list, tenantId, tx) => outbox.write(list, { ...context, tenantId }, tx as never),
    };
    const prisma = { prisma: deps.prisma };
    const controller = buildOnlineStoreController(
      {
        preferences: new PrismaPreferencesRepository(prisma),
        access: new PrismaAccessRepository(prisma),
        themes: new PrismaThemeRepository(prisma),
        releases: new PrismaThemeReleaseRepository(prisma),
        previewTokens: new PrismaPreviewTokenRepository(prisma),
      },
      new PrismaUnitOfWork(deps.prisma),
      deps,
      events,
    );
    return {
      controller,
      publicReads: publicReadsOf(controller),
      drainOutbox: async () => 0,
      deliveredEventTypes: [],
    };
  }

  const store = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store,
    translator,
    serializer: deps.serializer,
    clock: deps.clock,
    producer: "online-store",
  });
  const events: EventRecorder = {
    record: (list, tenantId, tx) => outbox.write(list, { ...context, tenantId }, tx),
  };
  const controller = buildOnlineStoreController(
    {
      preferences: new InMemoryPreferencesRepository(),
      access: new InMemoryAccessRepository(),
      themes: new InMemoryThemeRepository(),
      releases: new InMemoryThemeReleaseRepository(),
      previewTokens: new InMemoryPreviewTokenRepository(),
    },
    new InMemoryUnitOfWork(),
    deps,
    events,
  );
  const bus = new InMemoryEventBus();
  const delivered: string[] = [];
  const sink: Subscriber = async (record) => {
    delivered.push(record.headers.type ?? record.topic);
  };
  for (const type of ONLINE_STORE_PUBLISHED_EVENTS) bus.subscribe(`${type}.v1`, sink);
  const relay = new OutboxRelay({
    store,
    publisher: new InMemoryEventPublisher(bus),
    clock: deps.clock,
  });
  return {
    controller,
    publicReads: publicReadsOf(controller),
    drainOutbox: () => relay.drainOnce(),
    deliveredEventTypes: delivered,
  };
}
```

(`tx as never`: the Prisma `OutboxWriter<TransactionClient>` expects the unit of work's transaction client, which is what `tx` is; replace with `tx as TransactionClient` and import the type if `never` trips lint.)

`src/index.ts`:

```ts
export { wireOnlineStore } from "./composition";
export type {
  OnlineStorePublicReads,
  OnlineStoreWiringDeps,
  WiredOnlineStore,
} from "./composition";
export { OnlineStoreController } from "./interfaces/online-store.controller";
export type { ControllerResponse } from "./interfaces/presenter";
export type {
  ImageDto,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "./application/ports";
export type { UpdateAccessInput } from "./application/access.use-cases";
export type { UpdatePreferencesInput } from "./application/preferences.use-cases";
export type { PublicShellView } from "./application/shell.use-case";
export { ONLINE_STORE_PUBLISHED_EVENTS } from "./domain/events";
export { PREVIEW_TOKEN_MAX_LENGTH } from "./domain/preview-token";
```

- [ ] **Step 7: Run the service suite, the guard script, typecheck and lint**

Run: `pnpm --filter @platform/online-store test` — PASS.
Run: `node scripts/dev/check-prisma-tenant-where.mjs` — only the known finding.
Run: `pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/online-store lint` — clean (run prettier on the new files first).

Check by reading, not by test: in every use case, the first repository `save`/`append`/`insert`/`deleteExpired`/`events.record` call comes after every `return err(...)` of that unit of work.

- [ ] **Step 8: Commit**

```bash
git add services/online-store
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): add the preferences, access, theme, preview and shell use cases

Validate-then-write units of work, publish bound to the previewed draft revision, 20 releases kept,
a timing-equal unlock, hashed 60-minute preview tokens and the public shell with no internals.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Media — per-purpose image uploads (logo, favicon, share image, section image)

Model tier: **standard** (the policy table is fully specified; the product path must not change).

**Files:**

- Create: `services/media/src/application/image-purposes.ts`
- Create: `services/media/src/application/upload-image.use-case.ts`, `upload-image.test.ts`
- Modify: `services/media/src/application/upload-product-image.use-case.ts` (`StorageKeyBuilder.namespace` widened; `UploadProductImage` delegates to `UploadImage`)
- Modify: `services/media/src/interfaces/media-library.controller.ts` (`uploadImage` + its responses; `uploadImage` dep)
- Modify: `services/media/src/media-library.composition.ts` (wire `UploadImage`)
- Modify: `services/media/src/index.ts` (exports)
- Test (unchanged, must stay green): `services/media/src/application/upload-product-image.test.ts`, `services/media/src/interfaces/media-upload.controller.test.ts`, `apps/admin/src/http/media-upload-routes.test.ts`

**Interfaces:**

- Consumes: `sniffImage`, `ImageType`, `MediaAsset`, `MediaAssetRepository`, `ObjectStoragePort`, `publicMediaUrl`, `IMMUTABLE_CACHE_CONTROL`, `MAX_UPLOAD_BYTES`, `StorageKeyBuilder` (all existing in `services/media`).
- Produces:
  - `type ImagePurpose = "product" | "logo" | "favicon" | "share_image" | "section_image"`, `ONLINE_STORE_IMAGE_PURPOSES = ["logo", "favicon", "share_image", "section_image"] as const`, `type OnlineStoreImagePurpose`, `MAX_IMAGE_PIXELS = 40_000_000`, `IMAGE_POLICIES: Record<ImagePurpose, ImagePolicy>` with `ImagePolicy { namespace; types: readonly ImageType[]; maxBytes: number; dimensions: { minWidth: number; minHeight: number; maxSide: number | null; square: boolean } | null; maxPixels: number | null }`.
  - `class UploadImage { execute(input: UploadImageInput): Promise<UploadImageOutcome> }`, `UploadImageInput { bytes; fileName?; purpose: ImagePurpose; tenantId }`, `UploadImageOutcome = ok | unavailable | too_large { maxBytes } | unsupported | bad_dimensions { min: { width; height }; max: number | null; square: boolean } | too_many_pixels`.
  - `MediaLibraryController.uploadImage(input: UploadImageInput & { purpose: OnlineStoreImagePurpose }): Promise<ControllerResponse>` → 201 `{ id, url, width, height, alt }`; 503 `UNAVAILABLE`; 413 `PAYLOAD_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 422 `BAD_DIMENSIONS` (+ `min`, `max`, `square`); 422 `IMAGE_TOO_LARGE_DIMENSIONS`.

- [ ] **Step 1: Write the failing tests**

`services/media/src/application/upload-image.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { StorageKeyFactory } from "@platform/storage";
import { InMemoryMediaAssetRepository } from "../infrastructure/in-memory-library-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { MediaLibraryEventTranslator } from "../infrastructure/media-library-event-translator";
import { IMAGE_POLICIES } from "./image-purposes";
import type { ObjectStoragePort } from "./object-storage.port";
import { UploadImage, type UploadImageInput } from "./upload-image.use-case";
import { MAX_UPLOAD_BYTES } from "./upload-product-image.use-case";

const clock: Clock = { now: () => new Date("2026-10-27T09:30:00.000Z") };
const MB = 1024 * 1024;

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Headers only: the sniffer reads sizes from the header; `pad` makes the body as large as needed. */
function bytes(head: number[], pad = 0): Uint8Array {
  const out = new Uint8Array(head.length + pad);
  out.set(head);
  return out;
}
const png = (w: number, h: number, pad = 0) =>
  bytes(
    [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      ...ascii("IHDR"),
      ...u32be(w),
      ...u32be(h),
      8,
      6,
      0,
      0,
      0,
    ],
    pad,
  );
const jpeg = (w: number, h: number, pad = 0) =>
  bytes([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, ...u16be(h), ...u16be(w), 3, 0, 0, 0, 0], pad);
const webp = (w: number, h: number) =>
  bytes([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...u24le(w - 1),
    ...u24le(h - 1),
  ]);
const gif = (w: number, h: number) =>
  bytes([...ascii("GIF89a"), ...u16le(w), ...u16le(h), 0, 0, 0]);

function harness(publicBaseUrl: string | undefined = "https://cdn.test/media") {
  const puts: { key: string; contentType: string }[] = [];
  const storage: ObjectStoragePort = {
    persistent: true,
    exists: async () => true,
    getDownloadUrl: async (k) => k,
    put: async (key, _b, contentType) => {
      puts.push({ key, contentType });
    },
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new MediaLibraryEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "media",
  });
  const upload = new UploadImage({
    mediaAssets: new InMemoryMediaAssetRepository({
      outbox,
      context: rootEventContext(idGenerator),
    }),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    objectStorage: storage,
    keyFactory: new StorageKeyFactory({ idGenerator, clock }),
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
  });
  const run = (input: Omit<UploadImageInput, "tenantId">) =>
    upload.execute({ ...input, tenantId: "t-1" });
  return { run, puts };
}

describe("UploadImage — per-purpose policy (spec 1.7, Review Focus 5)", () => {
  it("stores a logo under brand-assets with the sniffed type", async () => {
    const { run, puts } = harness();
    const out = await run({ bytes: png(400, 120), purpose: "logo", fileName: "logo.png" });
    expect(out).toMatchObject({ kind: "ok", image: { width: 400, height: 120, alt: null } });
    expect(puts).toEqual([
      {
        key: expect.stringMatching(/^tenants\/t-1\/brand-assets\/2026\/10\/.+\.png$/),
        contentType: "image/png",
      },
    ]);
  });

  it("stores a section image under theme-assets", async () => {
    const { run, puts } = harness();
    expect((await run({ bytes: webp(1600, 900), purpose: "section_image" })).kind).toBe("ok");
    expect(puts[0]?.key).toMatch(/\/theme-assets\//);
  });

  it.each([
    ["logo GIF", gif(200, 200), "logo", { kind: "unsupported" }],
    ["logo over 2 MB", png(200, 200, 2 * MB), "logo", { kind: "too_large", maxBytes: 2 * MB }],
    [
      "logo 20 px tall",
      png(400, 20),
      "logo",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 4000, square: false },
    ],
    [
      "logo 5000 px wide",
      png(5000, 100),
      "logo",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 4000, square: false },
    ],
    ["favicon that is a JPEG named .png", jpeg(64, 64), "favicon", { kind: "unsupported" }],
    ["animated GIF favicon", gif(64, 64), "favicon", { kind: "unsupported" }],
    [
      "favicon not square",
      png(64, 32),
      "favicon",
      { kind: "bad_dimensions", min: { width: 32, height: 32 }, max: 1024, square: true },
    ],
    ["favicon over 1 MB", png(64, 64, MB), "favicon", { kind: "too_large", maxBytes: MB }],
    ["WebP share image", webp(1200, 630), "share_image", { kind: "unsupported" }],
    [
      "share image 599 wide",
      jpeg(599, 315),
      "share_image",
      { kind: "bad_dimensions", min: { width: 600, height: 315 }, max: null, square: false },
    ],
    [
      "section image 150 px",
      png(150, 600),
      "section_image",
      { kind: "bad_dimensions", min: { width: 200, height: 200 }, max: null, square: false },
    ],
    [
      "pixel bomb: 20000 × 20000 header in a 7.9 MB body",
      png(20000, 20000, Math.floor(7.9 * MB)),
      "section_image",
      { kind: "too_many_pixels" },
    ],
    [
      "an SVG",
      bytes(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")),
      "logo",
      { kind: "unsupported" },
    ],
  ] as const)("refuses %s and stores nothing", async (_name, input, purpose, expected) => {
    const { run, puts } = harness();
    expect(await run({ bytes: input, purpose })).toEqual(expected);
    expect(puts).toEqual([]);
  });

  it("accepts the share-image minimum and a square PNG favicon", async () => {
    const { run } = harness();
    expect((await run({ bytes: jpeg(600, 315), purpose: "share_image" })).kind).toBe("ok");
    expect((await run({ bytes: png(512, 512), purpose: "favicon" })).kind).toBe("ok");
  });

  it("keeps products exactly as before: GIF allowed, no dimension or pixel rule (Ruling 3)", async () => {
    const { run } = harness();
    expect((await run({ bytes: gif(10, 10), purpose: "product" })).kind).toBe("ok");
    expect((await run({ bytes: png(20000, 20000), purpose: "product" })).kind).toBe("ok");
    expect(await run({ bytes: png(10, 10, 8 * MB), purpose: "product" })).toEqual({
      kind: "too_large",
      maxBytes: 8 * MB,
    });
  });

  it("restates the product cap as exactly MAX_UPLOAD_BYTES", () => {
    expect(IMAGE_POLICIES.product.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("is unavailable without a public base url", async () => {
    const { run } = harness(undefined);
    expect(await run({ bytes: png(100, 100), purpose: "logo" })).toEqual({ kind: "unavailable" });
  });
});
```

Append to `services/media/src/interfaces/media-upload.controller.test.ts` a `describe("MediaLibraryController.uploadImage")` that builds the controller the way that file already does and asserts:

```ts
it("maps each outcome to its status and code", async () => {
  // favicon JPEG → 415 UNSUPPORTED_MEDIA_TYPE; logo 20 px → 422 BAD_DIMENSIONS with min/max/square;
  // 40 MP section image → 422 IMAGE_TOO_LARGE_DIMENSIONS; logo > 2 MB → 413 "larger than 2 MB".
  expect(
    (await controller.uploadImage({ bytes: jpeg(64, 64), purpose: "favicon", tenantId: "t-1" }))
      .status,
  ).toBe(415);
  const bad = await controller.uploadImage({
    bytes: png(400, 20),
    purpose: "logo",
    tenantId: "t-1",
  });
  expect(bad).toEqual({
    status: 422,
    body: {
      code: "BAD_DIMENSIONS",
      message: "The image size is not allowed here.",
      retryable: false,
      fields: [],
      min: { width: 32, height: 32 },
      max: 4000,
      square: false,
    },
  });
  expect(
    (
      await controller.uploadImage({
        bytes: png(20000, 20000),
        purpose: "section_image",
        tenantId: "t-1",
      })
    ).body,
  ).toMatchObject({ code: "IMAGE_TOO_LARGE_DIMENSIONS" });
  expect(
    (await controller.uploadImage({ bytes: png(64, 64, 3 * MB), purpose: "logo", tenantId: "t-1" }))
      .body,
  ).toMatchObject({ code: "PAYLOAD_TOO_LARGE", message: "The image is larger than 2 MB." });
});
```

(Reuse that file's existing controller construction and byte helpers; copy `png`/`jpeg` from `upload-image.test.ts` into it if it lacks them.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/media exec vitest run src/application/upload-image.test.ts src/interfaces/media-upload.controller.test.ts`
Expected: FAIL — `upload-image.use-case` not found; `uploadImage` not a function.

- [ ] **Step 3: Implement the policy table and `UploadImage`**

`services/media/src/application/image-purposes.ts`:

```ts
import type { ImageType } from "./sniff-image";

// No value import from upload-product-image.use-case.ts: that module imports UploadImage, which
// imports this table, so a load-time read of its MAX_UPLOAD_BYTES would hit the temporal dead zone.
// The product cap is restated as 8 MB; a test pins it equal to MAX_UPLOAD_BYTES.

export type ImagePurpose = "product" | "logo" | "favicon" | "share_image" | "section_image";
export const ONLINE_STORE_IMAGE_PURPOSES = [
  "logo",
  "favicon",
  "share_image",
  "section_image",
] as const;
export type OnlineStoreImagePurpose = (typeof ONLINE_STORE_IMAGE_PURPOSES)[number];
export type ImageNamespace = "product-images" | "brand-assets" | "theme-assets";

/** Decompression-bomb guard for the online-store purposes (Ruling 3: products unchanged). */
export const MAX_IMAGE_PIXELS = 40_000_000;
const MB = 1024 * 1024;

export interface ImagePolicy {
  readonly namespace: ImageNamespace;
  readonly types: readonly ImageType[];
  readonly maxBytes: number;
  readonly dimensions: {
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxSide: number | null;
    readonly square: boolean;
  } | null;
  readonly maxPixels: number | null;
}

/** Spec 1.7, checked AFTER sniffing: the bytes decide, never the client's content type. */
export const IMAGE_POLICIES: Readonly<Record<ImagePurpose, ImagePolicy>> = {
  product: {
    namespace: "product-images",
    types: ["jpeg", "png", "webp", "gif"],
    maxBytes: 8 * MB,
    dimensions: null,
    maxPixels: null,
  },
  logo: {
    namespace: "brand-assets",
    types: ["png", "webp", "jpeg"],
    maxBytes: 2 * MB,
    dimensions: { minWidth: 32, minHeight: 32, maxSide: 4000, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  favicon: {
    namespace: "brand-assets",
    types: ["png"],
    maxBytes: 1 * MB,
    dimensions: { minWidth: 32, minHeight: 32, maxSide: 1024, square: true },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  share_image: {
    namespace: "brand-assets",
    types: ["jpeg", "png"],
    maxBytes: 5 * MB,
    dimensions: { minWidth: 600, minHeight: 315, maxSide: null, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
  section_image: {
    namespace: "theme-assets",
    types: ["jpeg", "png", "webp"],
    maxBytes: 8 * MB,
    dimensions: { minWidth: 200, minHeight: 200, maxSide: null, square: false },
    maxPixels: MAX_IMAGE_PIXELS,
  },
};
```

`services/media/src/application/upload-image.use-case.ts`:

```ts
import { UniqueEntityId } from "@platform/domain";
import { MediaAsset } from "../domain/media-asset";
import { IMAGE_POLICIES, type ImagePurpose } from "./image-purposes";
import { sniffImage, type ImageType } from "./sniff-image";
import {
  IMMUTABLE_CACHE_CONTROL,
  publicMediaUrl,
  type UploadedImage,
  type UploadProductImageDeps,
} from "./upload-product-image.use-case";

const MAX_NAME_LENGTH = 255;
const CONTENT_TYPE: Readonly<Record<ImageType, string>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};
const EXTENSION: Readonly<Record<ImageType, string>> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
};

export type UploadImageDeps = UploadProductImageDeps;

export interface UploadImageInput {
  readonly bytes: Uint8Array;
  /** Display name only, never part of the key. */
  readonly fileName?: string;
  readonly purpose: ImagePurpose;
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
}

export type UploadImageOutcome =
  | { readonly kind: "ok"; readonly image: UploadedImage }
  | { readonly kind: "unavailable" }
  | { readonly kind: "too_large"; readonly maxBytes: number }
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "bad_dimensions";
      readonly min: { readonly width: number; readonly height: number };
      readonly max: number | null;
      readonly square: boolean;
    }
  | { readonly kind: "too_many_pixels" };

/**
 * Stores an image for one purpose (spec 1.7). Order: storage available → byte cap → sniff → type
 * allowed for the purpose → pixel cap → dimensions → store. Nothing is written unless all pass.
 */
export class UploadImage {
  constructor(private readonly deps: UploadImageDeps) {}

  async execute(input: UploadImageInput): Promise<UploadImageOutcome> {
    const { publicBaseUrl, objectStorage } = this.deps;
    if (!objectStorage.persistent || publicBaseUrl === undefined) return { kind: "unavailable" };
    const policy = IMAGE_POLICIES[input.purpose];
    if (input.bytes.length > policy.maxBytes)
      return { kind: "too_large", maxBytes: policy.maxBytes };
    const sniffed = sniffImage(input.bytes);
    if (sniffed === null || !policy.types.includes(sniffed.type)) return { kind: "unsupported" };
    if (policy.maxPixels !== null && sniffed.width * sniffed.height > policy.maxPixels)
      return { kind: "too_many_pixels" };
    const d = policy.dimensions;
    if (d !== null) {
      const tooSmall = sniffed.width < d.minWidth || sniffed.height < d.minHeight;
      const tooBig =
        d.maxSide !== null && (sniffed.width > d.maxSide || sniffed.height > d.maxSide);
      const notSquare = d.square && sniffed.width !== sniffed.height;
      if (tooSmall || tooBig || notSquare) {
        return {
          kind: "bad_dimensions",
          min: { width: d.minWidth, height: d.minHeight },
          max: d.maxSide,
          square: d.square,
        };
      }
    }

    const extension = EXTENSION[sniffed.type];
    const contentType = CONTENT_TYPE[sniffed.type];
    const storageKey = this.deps.keyFactory.build({
      tenantId: input.tenantId,
      namespace: policy.namespace,
      filename: `image.${extension}`,
    });
    const name = (input.fileName?.trim() ?? "").slice(0, MAX_NAME_LENGTH) || `image.${extension}`;
    await objectStorage.put(storageKey, input.bytes, contentType, IMMUTABLE_CACHE_CONTROL);
    const id = await this.deps.unitOfWork.run<string>(async (tx) => {
      const assetId = UniqueEntityId.from(this.deps.idGenerator.generate());
      const asset = MediaAsset.create(
        assetId,
        name,
        storageKey,
        this.deps.idGenerator.generate(),
        this.deps.clock.now(),
        undefined,
        {
          contentType,
          byteSize: input.bytes.length,
          width: sniffed.width,
          height: sniffed.height,
        },
      );
      await this.deps.mediaAssets.save(asset, input.tenantId, tx);
      return assetId.toString();
    });
    return {
      kind: "ok",
      image: {
        id,
        url: publicMediaUrl(publicBaseUrl, storageKey),
        width: sniffed.width,
        height: sniffed.height,
        alt: null,
      },
    };
  }
}
```

In `upload-product-image.use-case.ts`:

1. Widen the key builder: `readonly namespace: "product-images" | "brand-assets" | "theme-assets";` (all three are `StorageNamespace` members, mapped to the `media` bucket).
2. Replace the body of `UploadProductImage.execute` with a delegation that keeps today's outcomes exactly:

```ts
export class UploadProductImage {
  private readonly upload: UploadImage;

  constructor(deps: UploadProductImageDeps) {
    this.upload = new UploadImage(deps);
  }

  /** Plan 2C-3 behaviour, unchanged (anti-goal): JPEG/PNG/WebP/GIF, 8 MB, no dimension rule. */
  async execute(input: UploadProductImageInput): Promise<UploadProductImageOutcome> {
    const outcome = await this.upload.execute({ ...input, purpose: "product" });
    switch (outcome.kind) {
      case "ok":
      case "unavailable":
      case "unsupported":
        return outcome;
      case "too_large":
        return { kind: "too_large" };
      case "bad_dimensions":
      case "too_many_pixels":
        // The product policy has no dimension or pixel rule, so these cannot happen.
        return { kind: "unsupported" };
    }
  }
}
```

Add `import { UploadImage } from "./upload-image.use-case";` and remove the now-unused `CONTENT_TYPE`/`EXTENSION`/`MAX_NAME_LENGTH`/`sniffImage`/`UniqueEntityId`/`MediaAsset` imports only if lint reports them unused (`UpdateMediaAlt` in the same file still uses `MediaAsset`'s `MAX_ALT_LENGTH`). Because `upload-image.use-case.ts` imports values from this file and this file imports `UploadImage`, keep `publicMediaUrl`, `IMMUTABLE_CACHE_CONTROL` and `MAX_UPLOAD_BYTES` declared here as today (ES modules resolve the cycle: neither module reads the other's exports at load time).

- [ ] **Step 4: Controller, composition, exports**

In `services/media/src/interfaces/media-library.controller.ts`, add `readonly uploadImage: UploadImage;` to `MediaLibraryControllerDeps`, import `UploadImage`, `UploadImageInput` and `OnlineStoreImagePurpose`, and add:

```ts
  /** Project 4: online-store images by purpose. 201 with the image; 503/413/415/422 envelopes. */
  async uploadImage(
    input: Omit<UploadImageInput, "purpose"> & { readonly purpose: OnlineStoreImagePurpose },
  ): Promise<ControllerResponse> {
    const outcome = await this.deps.uploadImage.execute(input);
    switch (outcome.kind) {
      case "ok":
        return { status: 201, body: outcome.image };
      case "unavailable":
        return { status: 503, body: envelope("UNAVAILABLE", "Image storage isn't set up yet.", true) };
      case "too_large":
        return {
          status: 413,
          body: envelope("PAYLOAD_TOO_LARGE", `The image is larger than ${Math.round(outcome.maxBytes / (1024 * 1024))} MB.`, false),
        };
      case "unsupported":
        return { status: 415, body: envelope("UNSUPPORTED_MEDIA_TYPE", "This image type is not accepted here.", false) };
      case "bad_dimensions":
        return {
          status: 422,
          body: { ...envelope("BAD_DIMENSIONS", "The image size is not allowed here.", false), min: outcome.min, max: outcome.max, square: outcome.square },
        };
      case "too_many_pixels":
        return { status: 422, body: envelope("IMAGE_TOO_LARGE_DIMENSIONS", "The image has too many pixels.", false) };
    }
  }
```

In `media-library.composition.ts` `buildController`, add next to `uploadProductImage`:

```ts
    uploadImage: new UploadImage({
      mediaAssets: repos.mediaAssets,
      unitOfWork,
      idGenerator: deps.idGenerator,
      clock: deps.clock,
      objectStorage,
      keyFactory: new StorageKeyFactory({ idGenerator: deps.idGenerator, clock: deps.clock }),
      ...(deps.publicMediaBaseUrl === undefined ? {} : { publicBaseUrl: deps.publicMediaBaseUrl }),
    }),
```

In `src/index.ts` add:

```ts
export {
  UploadImage,
  type UploadImageInput,
  type UploadImageOutcome,
} from "./application/upload-image.use-case";
export {
  IMAGE_POLICIES,
  MAX_IMAGE_PIXELS,
  ONLINE_STORE_IMAGE_PURPOSES,
  type ImagePurpose,
  type OnlineStoreImagePurpose,
} from "./application/image-purposes";
```

- [ ] **Step 5: Run media and the product-route tests**

Run: `pnpm --filter @platform/media test` — PASS, including the untouched `upload-product-image.test.ts`.
Run: `pnpm --filter @platform/admin exec vitest run src/http/media-upload-routes.test.ts src/http/product-images-routes.test.ts` — PASS unchanged (anti-goal: no behaviour change to `POST /media/uploads`).
Run: `pnpm --filter @platform/media typecheck && pnpm --filter @platform/media lint`.

- [ ] **Step 6: Commit**

```bash
git add services/media/src
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(media): upload images by purpose for the online store

UploadImage checks type, size, dimensions and a 40 MP cap after sniffing for logo, favicon (PNG,
square), share image (JPEG/PNG) and section images; product uploads keep their exact behaviour.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: apps/admin — wiring, cross-context adapters, the guarded controller and the admin routes

Model tier: **strong** (tenant-mode guard, permissions per route, the non-idempotent token route).

**Files:**

- Modify: `apps/admin/package.json` (`"@platform/online-store": "workspace:*"`, `"@platform/storefront-content": "workspace:*"`)
- Create: `apps/admin/src/infrastructure/cross-context/online-store.adapters.ts`, `online-store.adapters.test.ts`
- Create: `apps/admin/src/interfaces/online-store.admin-controller.ts`
- Modify: `apps/admin/src/interfaces/media-library.admin-controller.ts` (`uploadImage`)
- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps.onlineStorePasswordHasher?`, `WiredAdmin.onlineStore`, `publicReads.onlineStore`, `contexts`)
- Create: `apps/admin/src/http/online-store-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (`...onlineStoreRoutes(admin)`)
- Create: `apps/admin/src/http/testing/online-store-harness.ts`
- Test: `apps/admin/src/http/online-store-routes.test.ts`, `apps/admin/src/tenant-mode-guard.test.ts` (one case)

**Interfaces:**

- Consumes: Task 3 (`wireOnlineStore`, `OnlineStoreController`, `OnlineStorePublicReads`, ports, `UpdateAccessInput`, `UpdatePreferencesInput`); Task 4 (`MediaLibraryController.uploadImage`, `ONLINE_STORE_IMAGE_PURPOSES`, `MAX_UPLOAD_BYTES`); `ScryptPasswordHasher` (`@platform/security`); `ResolveMediaImages` (`@platform/media`); `TenancyController.listShopDomains/getPublicStore` (`@platform/tenancy`); `RoleTableAccessControl` (`@platform/auth`).
- Produces:
  - `mediaImageRefs(existingIds, resolve): ImageRefsPort`, `scryptStorefrontPasswordHasher(hasher?): StorefrontPasswordHasher`, `tenancyShopHost(listShopDomains): ShopHostPort`, `tenancyStoreIdentity(getPublicStore): StoreIdentityPort` — every one an object literal of closures.
  - `WiredAdmin.onlineStore: OnlineStoreAdminController` with `(principal, input)` methods: `getPreferences`, `updatePreferences`, `getAccess`, `updateAccess`, `getTheme`, `saveThemeDraft`, `discardThemeDraft`, `publishTheme`, `listThemeReleases`, `restoreThemeRelease`, `issuePreviewToken`.
  - `WiredAdmin.publicReads.onlineStore: OnlineStorePublicReads` (Task 6 routes use it).
  - `WiredAdmin.mediaLibrary.uploadImage(principal, input)` guarded by `online_store:upload_image`.
  - Routes (all `/api/v1`): the twelve rows of spec 1.9.
  - `buildOnlineStoreApp(options?): Promise<FastifyInstance>`, `headersFor(role, extra?)`, `countingLimiter()` in `testing/online-store-harness.ts`.

- [ ] **Step 1: Write the adapters test and the guard case**

`apps/admin/src/infrastructure/cross-context/online-store.adapters.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { findConstructionTimeTenants } from "../../tenant-mode-guard";
import {
  mediaImageRefs,
  scryptStorefrontPasswordHasher,
  tenancyShopHost,
  tenancyStoreIdentity,
} from "./online-store.adapters";

describe("online-store cross-context adapters", () => {
  it("resolves media ids into a record and asks existing ids per tenant", async () => {
    const existingIds = vi.fn(async (ids: readonly string[]) => ids.slice(0, 1));
    const resolve = vi.fn(
      async () =>
        new Map([["a", { id: "a", url: "https://cdn/a", alt: "A", width: 1, height: 2 }]]),
    );
    const port = mediaImageRefs(existingIds, resolve);
    expect(await port.existingIds(["a", "b"], "t-1")).toEqual(["a"]);
    expect(existingIds).toHaveBeenCalledWith(["a", "b"], "t-1");
    expect(await port.resolve(["a"], "t-1")).toEqual({
      a: { url: "https://cdn/a", alt: "A", width: 1, height: 2 },
    });
  });

  it("finds the primary VERIFIED hostname, or null", async () => {
    const list = vi.fn(async () => ({
      status: 200,
      body: {
        items: [
          { hostname: "pending.example", status: "pending", isPrimary: false },
          { hostname: "shop.example.eg", status: "verified", isPrimary: true },
        ],
      },
    }));
    expect(await tenancyShopHost(list).primaryHostname("t-1")).toBe("shop.example.eg");
    expect(list).toHaveBeenCalledWith("t-1");
    expect(
      await tenancyShopHost(async () => ({ status: 500, body: null })).primaryHostname("t-1"),
    ).toBeNull();
  });

  it("reads the store name, empty when unreadable", async () => {
    expect(
      await tenancyStoreIdentity(async () => ({
        status: 200,
        body: { name: "Nour", currency: "EGP" },
      })).storeName("t"),
    ).toBe("Nour");
    expect(
      await tenancyStoreIdentity(async () => ({ status: 500, body: null })).storeName("t"),
    ).toBe("");
  });

  it("hashes with scrypt and verifies", async () => {
    const hasher = scryptStorefrontPasswordHasher({ log2N: 10 });
    const hash = await hasher.hash("open sesame");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await hasher.verify("open sesame", hash)).toBe(true);
    expect(await hasher.verify("nope", hash)).toBe(false);
  });

  it("every adapter is closures only: no object the tenant-mode guard could walk into", () => {
    const adapters = {
      a: mediaImageRefs(
        async () => [],
        async () => new Map(),
      ),
      b: tenancyShopHost(async () => ({ status: 200, body: { items: [] } })),
      c: tenancyStoreIdentity(async () => ({ status: 200, body: { name: "" } })),
      d: scryptStorefrontPasswordHasher(),
    };
    for (const adapter of Object.values(adapters)) {
      for (const value of Object.values(adapter)) expect(typeof value).toBe("function");
    }
    expect(findConstructionTimeTenants(adapters, [])).toEqual([]);
  });
});
```

Append to `apps/admin/src/tenant-mode-guard.test.ts`, inside the `describe` that holds "passes on the real production-shaped graph ONLY because of the tenancy exemption":

```ts
it("the online store adds no construction-time tenant (Project 4)", () => {
  const found = findConstructionTimeTenants(pinnedProductionShapedGraph(), []);
  expect(
    found.filter((path) => path.startsWith("onlineStore") || path.startsWith("publicReads")),
  ).toEqual([]);
});
```

- [ ] **Step 2: Write the harness and the failing route tests**

`apps/admin/src/http/testing/online-store-harness.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type {
  Authenticator,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { ObjectStoragePort } from "@platform/media";
import type { StorefrontPasswordHasher } from "@platform/online-store";
import { InMemoryAuditTrail } from "../../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "../server";

export type StaffRole = "admin" | "operator" | "viewer";

/** Fake values only. The bearer token IS the role, so a test reads like the permission table. */
export function headersFor(
  role: StaffRole,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${role}`,
    "x-tenant-id": "t-1",
    "content-type": "application/json",
    ...extra,
  };
}

/** Counts per key and refuses beyond `limit`, like the Redis limiter. */
export function countingLimiter(): RateLimiter & { readonly keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    consume: async (key, limit) => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n > limit
        ? { allowed: false, remaining: 0, retryAfterMs: 120_000 }
        : { allowed: true, remaining: limit - n, retryAfterMs: 0 };
    },
  };
}

/** A fast deterministic hasher (the real scrypt is exercised in the adapters test). */
export const fastHasher: StorefrontPasswordHasher = {
  hash: async (plain) => `fake$${plain}`,
  verify: async (plain, hash) => hash === `fake$${plain}`,
};

export function recordingStorage(keys: string[]): ObjectStoragePort {
  return {
    persistent: true,
    exists: async () => true,
    getDownloadUrl: async (key) => `https://signed.example/${key}`,
    put: async (key) => {
      keys.push(key);
    },
  };
}

export function buildOnlineStoreApp(
  options: { rateLimiter?: RateLimiter; objectStorage?: ObjectStoragePort } = {},
): Promise<FastifyInstance> {
  const clock: Clock = { now: () => new Date("2026-10-27T10:00:00.000Z") };
  const claims = new Set<string>();
  const store = new Map<string, unknown>();
  const responseCache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const authenticator: Authenticator = {
    verify: async (token) =>
      token === "admin" || token === "operator" || token === "viewer"
        ? { id: `staff-${token}`, kind: "staff", roles: [token] }
        : null,
  };
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `0192f0aa-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter: options.rateLimiter ?? {
      consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    },
    idempotencyKeys,
    responseCache,
    onlineStorePasswordHasher: fastHasher,
    ...(options.objectStorage === undefined
      ? {}
      : {
          objectStorage: options.objectStorage,
          publicMediaBaseUrl: "https://cdn.example.test/media",
        }),
  });
}
```

`apps/admin/src/http/online-store-routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import {
  buildOnlineStoreApp,
  headersFor,
  recordingStorage,
  type StaffRole,
} from "./testing/online-store-harness";

const PNG_64 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64,
  0, 0, 0, 64, 8, 6, 0, 0, 0,
]);
const JPEG_64 = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 64, 0, 64, 3, 0, 0, 0, 0,
]);

let key = 0;
const idem = () => ({ "idempotency-key": `os-${(key += 1)}` });

describe("online-store admin routes (spec 1.9)", () => {
  let app: FastifyInstance;
  const keys: string[] = [];
  beforeAll(async () => {
    app = await buildOnlineStoreApp({ objectStorage: recordingStorage(keys) });
  });
  afterAll(async () => {
    await app.close();
  });

  const call = (role: StaffRole, method: "GET" | "PUT" | "POST", url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor(role, method === "GET" ? {} : idem()),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  it("viewers read everything and mint preview tokens, but write nothing", async () => {
    for (const url of [
      "/online-store/preferences",
      "/online-store/access",
      "/online-store/theme",
      "/online-store/theme/releases",
    ]) {
      expect((await call("viewer", "GET", url)).statusCode, url).toBe(200);
    }
    expect((await call("viewer", "POST", "/online-store/preview-tokens", {})).statusCode).toBe(201);
    const writes: [string, string, unknown][] = [
      [
        "PUT",
        "/online-store/preferences",
        {
          homeTitle: {},
          homeMetaDescription: {},
          shareImageId: null,
          defaultLocale: "ar",
          expectedVersion: 0,
        },
      ],
      [
        "PUT",
        "/online-store/theme/draft",
        { document: DEFAULT_THEME_DOCUMENT, expectedVersion: 0 },
      ],
      ["POST", "/online-store/theme/discard-draft", { expectedVersion: 0 }],
      ["POST", "/online-store/theme/publish", { expectedDraftRevision: 1 }],
      ["PUT", "/online-store/access", { locked: false, message: {}, expectedVersion: 0 }],
    ];
    for (const [method, url, body] of writes) {
      expect((await call("viewer", method as "PUT", url, body)).statusCode, url).toBe(403);
    }
  });

  it("operators edit the draft and preferences but cannot publish, restore or lock", async () => {
    const saved = await call("operator", "PUT", "/online-store/theme/draft", {
      document: { ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } },
      expectedVersion: 0,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ draftRevision: 1, version: 1, warnings: [] });
    expect(
      (await call("operator", "POST", "/online-store/theme/publish", { expectedDraftRevision: 1 }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "POST", "/online-store/theme/releases/1/restore", {
          expectedVersion: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call("operator", "PUT", "/online-store/access", {
          locked: true,
          password: "1234",
          message: {},
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(403);
    const prefs = await call("operator", "PUT", "/online-store/preferences", {
      homeTitle: { en: "Nour" },
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "en",
      expectedVersion: 0,
    });
    expect(prefs.statusCode).toBe(200);
  });

  it("admins publish the previewed revision; a stale one is 409 DRAFT_CHANGED", async () => {
    const stale = await call("admin", "POST", "/online-store/theme/publish", {
      expectedDraftRevision: 0,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "DRAFT_CHANGED" });
    const published = await call("admin", "POST", "/online-store/theme/publish", {
      expectedDraftRevision: 1,
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({ releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z" });
    const releases = await call("viewer", "GET", "/online-store/theme/releases");
    expect(releases.json()).toEqual({
      releases: [
        { releaseNumber: 1, publishedAt: "2026-10-27T10:00:00.000Z", publishedByName: null },
      ],
    });
  });

  it("admins lock with a password; the response never carries it", async () => {
    const res = await call("admin", "PUT", "/online-store/access", {
      locked: true,
      password: "open sesame",
      message: { ar: "قريبًا" },
      expectedVersion: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/sesame|fake\$/);
    expect(res.json()).toMatchObject({ locked: true, passwordSet: true, version: 1 });
  });

  it("bodies are strict: unknown keys are 422 before any handler runs", async () => {
    const res = await call("admin", "PUT", "/online-store/preferences", {
      homeTitle: {},
      homeMetaDescription: {},
      shareImageId: null,
      defaultLocale: "ar",
      expectedVersion: 0,
      storeName: "x",
    });
    expect(res.statusCode).toBe(422);
  });

  it("a preview token is never replayed from the idempotency cache (binding lesson)", async () => {
    const headers = headersFor("viewer", { "idempotency-key": "same-key" });
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/online-store/preview-tokens",
      headers,
      payload: {},
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/v1/online-store/preview-tokens",
      headers,
      payload: {},
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().token).not.toBe(b.json().token);
    expect(a.json()).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: "2026-10-27T11:00:00.000Z",
      url: null,
    });
  });

  it("uploads a logo for operators; refuses a JPEG favicon and viewers; never returns a storage key", async () => {
    const upload = (role: StaffRole, purpose: string, bytes: Uint8Array, contentType: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/online-store/images?purpose=${purpose}`,
        headers: { ...headersFor(role, idem()), "content-type": contentType },
        payload: Buffer.from(bytes),
      });
    const ok = await upload("operator", "logo", PNG_64, "image/png");
    expect(ok.statusCode).toBe(201);
    expect(Object.keys(ok.json()).sort()).toEqual(["alt", "height", "id", "url", "width"]);
    expect(keys.at(-1)).toMatch(/^tenants\/t-1\/brand-assets\//);
    expect((await upload("operator", "favicon", JPEG_64, "image/png")).statusCode).toBe(415);
    expect((await upload("operator", "logo", PNG_64, "image/gif")).statusCode).toBe(415);
    expect((await upload("viewer", "logo", PNG_64, "image/png")).statusCode).toBe(403);
    expect((await upload("operator", "product", PNG_64, "image/png")).statusCode).toBe(422);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/online-store.adapters.test.ts src/http/online-store-routes.test.ts`
Expected: FAIL — adapters module and routes missing (404s).

- [ ] **Step 4: Implement the adapters**

`apps/admin/src/infrastructure/cross-context/online-store.adapters.ts`:

```ts
import type {
  ImageDto,
  ImageRefsPort,
  ShopHostPort,
  StoreIdentityPort,
  StorefrontPasswordHasher,
} from "@platform/online-store";
import { ScryptPasswordHasher } from "@platform/security";

type Response = { readonly status: number; readonly body: unknown };
type Resolved = {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
};

/**
 * Ruling 13: every adapter is an object literal of CLOSURES. No adapter keeps a reference to the
 * media or tenancy controller as a property, so the tenant-mode guard (which walks object properties,
 * never closures) cannot reach tenancy's pinned internals through `onlineStore`.
 */
export function mediaImageRefs(
  existingIds: (ids: readonly string[], tenantId: string) => Promise<readonly string[]>,
  resolve: (ids: readonly string[], tenantId: string) => Promise<ReadonlyMap<string, Resolved>>,
): ImageRefsPort {
  return {
    existingIds: (ids, tenantId) => existingIds(ids, tenantId),
    resolve: async (ids, tenantId) => {
      const found = await resolve(ids, tenantId);
      const out: Record<string, ImageDto> = {};
      for (const [id, image] of found)
        out[id] = { url: image.url, alt: image.alt, width: image.width, height: image.height };
      return out;
    },
  };
}

/** The storefront password uses the platform's scrypt hasher (Plan 1B-1), constant-cost compare. */
export function scryptStorefrontPasswordHasher(
  options: { readonly log2N?: number } = {},
): StorefrontPasswordHasher {
  const hasher = new ScryptPasswordHasher(options);
  return {
    hash: (plain) => hasher.hash(plain),
    verify: (plain, hash) => hasher.verify(plain, hash),
  };
}

/** ADR-0014 8f exemption (spec "what stays pinned" 2): tenancy's domain list for this shop. */
export function tenancyShopHost(
  listShopDomains: (shopId: string) => Promise<Response>,
): ShopHostPort {
  return {
    primaryHostname: async (tenantId) => {
      const res = await listShopDomains(tenantId);
      if (res.status !== 200) return null;
      const items =
        (
          res.body as {
            items?: readonly { hostname?: unknown; status?: unknown; isPrimary?: unknown }[];
          }
        ).items ?? [];
      const primary = items.find(
        (d) => d.isPrimary === true && d.status === "verified" && typeof d.hostname === "string",
      );
      return (primary?.hostname as string | undefined) ?? null;
    },
  };
}

/** Spec "what stays pinned" 1: tenancy's store name (pinned to the deployment tenant today). */
export function tenancyStoreIdentity(getPublicStore: () => Promise<Response>): StoreIdentityPort {
  return {
    storeName: async () => {
      const res = await getPublicStore();
      const name = res.status === 200 ? (res.body as { name?: unknown } | null)?.name : undefined;
      return typeof name === "string" ? name.trim() : "";
    },
  };
}
```

- [ ] **Step 5: Implement the guarded controller and the media upload method**

`apps/admin/src/interfaces/online-store.admin-controller.ts`:

```ts
import type { Principal } from "@platform/contracts";
import type { OnlineStoreController } from "@platform/online-store";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

export interface OnlineStoreAdminControllerDeps {
  readonly onlineStore: OnlineStoreController;
  readonly guard: AdminGuard;
}

type In<K extends keyof OnlineStoreController> = Parameters<OnlineStoreController[K]>[0];

/** Online Store screens → Online Store (Project 4). Each action authorizes, then delegates. */
export class OnlineStoreAdminController {
  private readonly onlineStore: OnlineStoreController;
  private readonly guard: AdminGuard;

  constructor(deps: OnlineStoreAdminControllerDeps) {
    this.onlineStore = deps.onlineStore;
    this.guard = deps.guard;
  }

  private async run(
    principal: Principal,
    permission: string,
    action: () => Promise<AdminResponse>,
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, permission);
    return denied ?? action();
  }

  getPreferences(p: Principal, input: In<"getPreferences">) {
    return this.run(p, "online_store:read", () => this.onlineStore.getPreferences(input));
  }
  updatePreferences(p: Principal, input: In<"updatePreferences">) {
    return this.run(p, "online_store:update_preferences", () =>
      this.onlineStore.updatePreferences(input),
    );
  }
  getAccess(p: Principal, input: In<"getAccess">) {
    return this.run(p, "online_store:read", () => this.onlineStore.getAccess(input));
  }
  updateAccess(p: Principal, input: In<"updateAccess">) {
    return this.run(p, "online_store_admin:update_access", () =>
      this.onlineStore.updateAccess(input),
    );
  }
  getTheme(p: Principal, input: In<"getTheme">) {
    return this.run(p, "online_store:read", () => this.onlineStore.getTheme(input));
  }
  saveThemeDraft(p: Principal, input: In<"saveThemeDraft">) {
    return this.run(p, "online_store:edit_theme", () => this.onlineStore.saveThemeDraft(input));
  }
  discardThemeDraft(p: Principal, input: In<"discardThemeDraft">) {
    return this.run(p, "online_store:edit_theme", () => this.onlineStore.discardThemeDraft(input));
  }
  publishTheme(p: Principal, input: In<"publishTheme">) {
    return this.run(p, "online_store_admin:publish_theme", () =>
      this.onlineStore.publishTheme(input),
    );
  }
  listThemeReleases(p: Principal, input: In<"listThemeReleases">) {
    return this.run(p, "online_store:read", () => this.onlineStore.listThemeReleases(input));
  }
  restoreThemeRelease(p: Principal, input: In<"restoreThemeRelease">) {
    return this.run(p, "online_store_admin:publish_theme", () =>
      this.onlineStore.restoreThemeRelease(input),
    );
  }
  issuePreviewToken(p: Principal, input: In<"issuePreviewToken">) {
    return this.run(p, "online_store:read", () => this.onlineStore.issuePreviewToken(input));
  }
}
```

(If `Permission` in `@platform/contracts` is narrower than `string`, type `permission` as `Permission`.)

In `apps/admin/src/interfaces/media-library.admin-controller.ts`, add:

```ts
  /** Project 4: online-store images (logo, favicon, share image, section image). */
  async uploadImage(
    principal: Principal,
    input: Parameters<MediaLibraryController["uploadImage"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "online_store:upload_image");
    if (denied) return denied;
    return this.mediaLibrary.uploadImage(input);
  }
```

- [ ] **Step 6: Wire it in `composition.ts`**

1. Imports: `import { wireOnlineStore, type OnlineStorePublicReads, type StorefrontPasswordHasher } from "@platform/online-store";`, `import { OnlineStoreAdminController } from "./interfaces/online-store.admin-controller";`, `import { mediaImageRefs, scryptStorefrontPasswordHasher, tenancyShopHost, tenancyStoreIdentity } from "./infrastructure/cross-context/online-store.adapters";`.
2. `AdminWiringDeps`, after `storefrontPublicUrl`:

```ts
  /**
   * TEST SEAM (Project 4): the storefront password hasher. Absent ⇒ the real scrypt hasher. Route tests
   * pass a fast fake so 21 unlock attempts do not cost 21 scrypt runs.
   */
  readonly onlineStorePasswordHasher?: StorefrontPasswordHasher;
```

3. `WiredAdmin`, after `pages`:

```ts
  /** Online Store → Themes / Preferences (Project 4). Guarded; tenant per call. */
  readonly onlineStore: OnlineStoreAdminController;
```

and inside `publicReads`, after `loyalty`:

```ts
    /**
     * Project 4: the storefront shell, the lock state and the unlock check — closures taking the
     * request's tenant (spec "Composition"); `public-online-store-routes.ts` is their only caller.
     */
    readonly onlineStore: OnlineStorePublicReads;
```

4. In `wireAdmin`, right after `const tenancy = wireTenancy({...});`:

```ts
// Project 4. Every port is a closure (Ruling 13): no tenancy or media object hangs off onlineStore.
const onlineStore = wireOnlineStore({
  ...deps,
  imageRefs: mediaImageRefs(
    (ids, tenantId) => mediaLibrary.images.existingIds(ids, tenantId),
    (ids, tenantId) => mediaLibrary.images.execute({ ids, tenantId }),
  ),
  passwordHasher: deps.onlineStorePasswordHasher ?? scryptStorefrontPasswordHasher(),
  shopHost: tenancyShopHost((shopId) => tenancy.tenancy.listShopDomains({ shopId })),
  storeIdentity: tenancyStoreIdentity(() => tenancy.tenancy.getPublicStore()),
});
```

5. Add `onlineStore,` to the `contexts` array; in the returned object add `onlineStore: new OnlineStoreAdminController({ onlineStore: onlineStore.controller, guard }),` after `pages`, and `onlineStore: onlineStore.publicReads,` inside `publicReads` after `loyalty`.

- [ ] **Step 7: Write the admin routes**

`apps/admin/src/http/online-store-routes.ts`:

```ts
import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { MAX_UPLOAD_BYTES, ONLINE_STORE_IMAGE_PURPOSES } from "@platform/media";
import type { WiredAdmin } from "../composition";

/** Shape only; lengths and normalisation are the domain's (spec 1.4). The cap stops abuse early. */
const localized = z
  .object({ ar: z.string().max(4000).optional(), en: z.string().max(4000).optional() })
  .strict();
const expectedVersion = z.number().int().min(0);

const preferencesBody = z
  .object({
    homeTitle: localized,
    homeMetaDescription: localized,
    shareImageId: z.string().min(1).max(64).nullable(),
    defaultLocale: z.enum(["ar", "en"]),
    expectedVersion,
  })
  .strict();
const accessBody = z
  .object({
    locked: z.boolean(),
    password: z.string().max(200).nullable().optional(),
    message: localized,
    expectedVersion,
  })
  .strict();
/** The document is validated by `@platform/storefront-content` (strict, unknown keys rejected). */
const draftBody = z.object({ document: z.unknown(), expectedVersion }).strict();
const versionBody = z.object({ expectedVersion }).strict();
const publishBody = z.object({ expectedDraftRevision: z.number().int().min(0) }).strict();
const releaseParams = z.object({ releaseNumber: z.coerce.number().int().positive() });
const imageQuery = z.object({ purpose: z.enum(ONLINE_STORE_IMAGE_PURPOSES) }).strict();
const emptyBody = z.object({}).strict();

/** What a browser may send as an online-store image. The bytes are still sniffed per purpose. */
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

function decodeFileName(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** Online Store admin surface (spec 1.9). Pure delegation; every write idempotent except preview tokens. */
export function onlineStoreRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/online-store/preferences",
      version: 1,
      permission: "online_store:read",
      summary:
        "Online Store preferences: home title, meta description, share image, default language",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getPreferences(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/preferences",
      version: 1,
      permission: "online_store:update_preferences",
      idempotent: true,
      summary: "Save the preferences (live on save)",
      schema: { body: preferencesBody },
      handle: ({ body, context }) =>
        admin.onlineStore.updatePreferences(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/access",
      version: 1,
      permission: "online_store:read",
      summary:
        "The password lock: locked, whether a password is set, the visitor message (never the hash)",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getAccess(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/access",
      version: 1,
      permission: "online_store_admin:update_access",
      idempotent: true,
      summary:
        "Lock or unlock the storefront, replace the password, edit the visitor message (admin)",
      schema: { body: accessBody },
      handle: ({ body, context }) =>
        admin.onlineStore.updateAccess(context.principal, {
          locked: body.locked,
          ...(body.password === undefined ? {} : { password: body.password }),
          message: body.message,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/theme",
      version: 1,
      permission: "online_store:read",
      summary: "The theme: draft, published, revisions, release number and resolved images",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.getTheme(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "PUT",
      path: "/online-store/theme/draft",
      version: 1,
      permission: "online_store:edit_theme",
      idempotent: true,
      summary: "Save the theme draft (validated, contrast-checked, image ownership checked)",
      schema: { body: draftBody },
      handle: ({ body, context }) =>
        admin.onlineStore.saveThemeDraft(context.principal, {
          document: body.document,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/discard-draft",
      version: 1,
      permission: "online_store:edit_theme",
      idempotent: true,
      summary: "Discard the draft: it becomes the live document again",
      schema: { body: versionBody },
      handle: ({ body, context }) =>
        admin.onlineStore.discardThemeDraft(context.principal, {
          ...body,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/publish",
      version: 1,
      permission: "online_store_admin:publish_theme",
      idempotent: true,
      summary: "Publish the previewed draft revision (admin)",
      schema: { body: publishBody },
      handle: ({ body, context }) =>
        admin.onlineStore.publishTheme(context.principal, {
          expectedDraftRevision: body.expectedDraftRevision,
          by: context.principal.id,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "GET",
      path: "/online-store/theme/releases",
      version: 1,
      permission: "online_store:read",
      summary: "The last 20 releases, newest first",
      schema: {},
      handle: ({ context }) =>
        admin.onlineStore.listThemeReleases(context.principal, { tenantId: context.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/theme/releases/:releaseNumber/restore",
      version: 1,
      permission: "online_store_admin:publish_theme",
      idempotent: true,
      summary: "Copy a release into the draft (never straight to live) (admin)",
      schema: { params: releaseParams, body: versionBody },
      handle: ({ params, body, context }) =>
        admin.onlineStore.restoreThemeRelease(context.principal, {
          releaseNumber: params.releaseNumber,
          expectedVersion: body.expectedVersion,
          tenantId: context.tenantId,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/images",
      version: 1,
      permission: "online_store:upload_image",
      idempotent: true,
      summary:
        "Upload a logo, favicon, share image or section image (raw body; checked per purpose)",
      binaryBody: { maxBytes: MAX_UPLOAD_BYTES, contentTypes: IMAGE_CONTENT_TYPES },
      schema: { querystring: imageQuery },
      handle: ({ query, context }) => {
        const fileName = decodeFileName(context.headers?.["x-file-name"]);
        return admin.mediaLibrary.uploadImage(context.principal, {
          bytes: context.rawBody ?? new Uint8Array(),
          purpose: query.purpose,
          ...(fileName === undefined ? {} : { fileName }),
          tenantId: context.tenantId,
        });
      },
    }),
    defineRoute({
      method: "POST",
      path: "/online-store/preview-tokens",
      version: 1,
      permission: "online_store:read",
      // NOT idempotent (binding lesson): a token must never be replayed from the response cache.
      summary: "Mint a 60-minute preview token for the draft; only its hash is stored",
      schema: { body: emptyBody },
      handle: ({ context }) =>
        admin.onlineStore.issuePreviewToken(context.principal, {
          createdBy: context.principal.id,
          tenantId: context.tenantId,
        }),
    }),
  ] as readonly RouteDefinition[];
}
```

In `admin-routes.ts`: `import { onlineStoreRoutes } from "./online-store-routes";` and add `...onlineStoreRoutes(admin),` right after `...mediaLibraryRoutes(admin),`.

Note: the image route's querystring `.strict()` rejects `purpose=product` with 422 (the test expects it) — products keep `POST /media/uploads`.

- [ ] **Step 8: Run the admin tests, guard script, typecheck and lint**

Run: `pnpm install` (new workspace dependency links).
Run: `pnpm --filter @platform/admin exec vitest run src/http/online-store-routes.test.ts src/infrastructure/cross-context/online-store.adapters.test.ts src/tenant-mode-guard.test.ts` — PASS.
Run: `pnpm --filter @platform/admin test` — full suite PASS (the route table grew; nothing else changed).
Run: `node scripts/dev/check-prisma-tenant-where.mjs` — only the known finding.
Run: `pnpm --filter @platform/admin typecheck` and `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` — clean.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/package.json pnpm-lock.yaml apps/admin/src/composition.ts \
  apps/admin/src/infrastructure/cross-context/online-store.adapters.ts \
  apps/admin/src/infrastructure/cross-context/online-store.adapters.test.ts \
  apps/admin/src/interfaces/online-store.admin-controller.ts \
  apps/admin/src/interfaces/media-library.admin-controller.ts \
  apps/admin/src/http/online-store-routes.ts apps/admin/src/http/online-store-routes.test.ts \
  apps/admin/src/http/admin-routes.ts apps/admin/src/http/testing/online-store-harness.ts \
  apps/admin/src/tenant-mode-guard.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): wire the online store and add its admin routes

Closure-only adapters over media, scrypt and tenancy; a guarded OnlineStoreAdminController; the
twelve spec 1.9 routes with strict bodies; preview tokens are not idempotent; images by purpose.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: apps/admin — public online-store reads and the rate-limited unlock

Model tier: **strong** (anonymous routes, rate limiting, DTO leak test).

**Files:**

- Create: `apps/admin/src/http/public-online-store-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (`...publicOnlineStoreRoutes(admin, options.rateLimiter)`)
- Test: `apps/admin/src/http/public-online-store-routes.test.ts`

**Interfaces:**

- Consumes: `WiredAdmin.publicReads.onlineStore` (Task 5); `PREVIEW_TOKEN_MAX_LENGTH` (Task 3); the harness (Task 5).
- Produces (all `public: true`, tenant from `x-tenant-id`):
  - `GET /api/v1/public/online-store` — `PublicShellView` (Task 3); header `x-preview-token` ⇒ the draft, or 401 `PREVIEW_INVALID`.
  - `GET /api/v1/public/online-store/access` — `{ locked, accessVersion, message }`.
  - `POST /api/v1/public/online-store/unlock` — body `{ password }` (`.strict()`, ≤ 200 chars); 200 `{ accessVersion }`; 401 `PASSWORD_INCORRECT`; 429 `RATE_LIMITED` with `retry-after` after 20 attempts per 10 minutes per shop (`rl:${tenantId}:storefront-unlock`). Not idempotent.

- [ ] **Step 1: Write the failing tests**

`apps/admin/src/http/public-online-store-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { buildOnlineStoreApp, countingLimiter, headersFor } from "./testing/online-store-harness";

const anon = (tenant = "t-1", extra: Record<string, string> = {}) => ({
  "x-tenant-id": tenant,
  "content-type": "application/json",
  ...extra,
});
let key = 0;

describe("public online-store routes (spec 1.10)", () => {
  let app: FastifyInstance;
  let limiter: ReturnType<typeof countingLimiter>;
  beforeEach(async () => {
    limiter = countingLimiter();
    app = await buildOnlineStoreApp({ rateLimiter: limiter });
  });
  afterEach(async () => {
    await app.close();
  });

  const admin = (method: "PUT" | "POST", url: string, payload: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headersFor("admin", { "idempotency-key": `p-${(key += 1)}` }),
      payload,
    });

  it("serves the live shell anonymously with no internals (leak test)", async () => {
    await admin("PUT", "/online-store/access", {
      locked: true,
      password: "open sesame",
      message: { ar: "قريبًا" },
      expectedVersion: 0,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/public/online-store",
      headers: anon(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ mode: "live", branded: false, locked: true, defaultLocale: "ar" });
    for (const leak of [
      "t-1",
      "tenant",
      "version",
      "Revision",
      "hash",
      "fake$",
      "sesame",
      "storageKey",
      "tenants/",
      "imageRef",
      "accessVersion",
    ]) {
      expect(res.body, leak).not.toContain(leak);
    }
  });

  it("serves the draft with a valid preview token and 401 PREVIEW_INVALID otherwise", async () => {
    await admin("PUT", "/online-store/theme/draft", {
      document: { ...DEFAULT_THEME_DOCUMENT, header: { sticky: true } },
      expectedVersion: 0,
    });
    const token = (await admin("POST", "/online-store/preview-tokens", {})).json().token as string;
    const preview = await app.inject({
      method: "GET",
      url: "/api/v1/public/online-store",
      headers: anon("t-1", { "x-preview-token": token }),
    });
    expect(preview.json()).toMatchObject({
      mode: "preview",
      branded: true,
      header: { sticky: true },
    });
    const live = await app.inject({
      method: "GET",
      url: "/api/v1/public/online-store",
      headers: anon(),
    });
    expect(live.json().header.sticky).toBe(false);
    for (const bad of ["nope", "x".repeat(101), token.slice(1)]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/public/online-store",
        headers: anon("t-1", { "x-preview-token": bad }),
      });
      expect(res.statusCode, bad).toBe(401);
      expect(res.json().code).toBe("PREVIEW_INVALID");
    }
    const otherShop = await app.inject({
      method: "GET",
      url: "/api/v1/public/online-store",
      headers: anon("t-2", { "x-preview-token": token }),
    });
    expect(otherShop.statusCode).toBe(401);
  });

  it("access carries exactly locked, accessVersion and the visitor message", async () => {
    await admin("PUT", "/online-store/access", {
      locked: true,
      password: "1234",
      message: { en: "Soon" },
      expectedVersion: 0,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/public/online-store/access",
      headers: anon(),
    });
    expect(res.json()).toEqual({ locked: true, accessVersion: 2, message: { en: "Soon" } });
  });

  it("unlock: uniform 401 for no lock and wrong password; 200 with the access version", async () => {
    const unlock = (password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/online-store/unlock",
        headers: anon(),
        payload: { password },
      });
    const noLock = await unlock("1234");
    expect(noLock.statusCode).toBe(401);
    await admin("PUT", "/online-store/access", {
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const wrong = await unlock("4321");
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(noLock.json());
    expect((await unlock("1234")).json()).toEqual({ accessVersion: 2 });
    expect(limiter.keys.filter((k) => k === "rl:t-1:storefront-unlock")).toHaveLength(3);
  });

  it("the 21st attempt in 10 minutes is 429 with retry-after, even with the right password (Review Focus 9)", async () => {
    await admin("PUT", "/online-store/access", {
      locked: true,
      password: "1234",
      message: {},
      expectedVersion: 0,
    });
    const unlock = (password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/online-store/unlock",
        headers: anon(),
        payload: { password },
      });
    for (let i = 0; i < 20; i += 1) expect((await unlock("wrong")).statusCode).toBe(401);
    const limited = await unlock("1234");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(limited.headers["retry-after"]).toBe("120");
    // another shop has its own bucket
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/public/online-store/unlock",
          headers: anon("t-2"),
          payload: { password: "x" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("refuses unknown body keys", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/public/online-store/unlock",
      headers: anon(),
      payload: { password: "1234", remember: true },
    });
    expect(res.statusCode).toBe(422);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-online-store-routes.test.ts`
Expected: FAIL — 404 on the public routes.

- [ ] **Step 3: Implement the public routes**

`apps/admin/src/http/public-online-store-routes.ts`:

```ts
import { z } from "zod";
import type { RateLimiter } from "@platform/contracts";
import { defineRoute, type RouteDefinition } from "@platform/http";
import { PREVIEW_TOKEN_MAX_LENGTH } from "@platform/online-store";
import type { WiredAdmin } from "../composition";

const unlockBody = z.object({ password: z.string().max(200) }).strict();
const UNLOCK_LIMIT = 20;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000;

function previewHeader(value: string | string[] | undefined): string | null | "invalid" {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > PREVIEW_TOKEN_MAX_LENGTH)
    return "invalid";
  return value;
}

const previewInvalid = {
  status: 401,
  body: {
    code: "PREVIEW_INVALID",
    message: "Preview link is invalid or expired",
    retryable: false,
    fields: [],
  },
};

/**
 * Spec 1.10 — the storefront's anonymous reads of the Online Store, plus the unlock check. Each calls
 * a `publicReads.onlineStore` closure with the request's tenant. The rate limit is per SHOP (spec
 * decision 20: the Runtime only sees the storefront server's IP).
 */
export function publicOnlineStoreRoutes(
  admin: WiredAdmin,
  rateLimiter?: RateLimiter,
): readonly RouteDefinition[] {
  return [
    defineRoute({
      method: "GET",
      path: "/public/online-store",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary:
        "Public: the storefront shell (brand, preferences, header, footer, lock); the draft with x-preview-token",
      schema: {},
      handle: async ({ context }) => {
        const token = previewHeader(context.headers?.["x-preview-token"]);
        if (token === "invalid") return previewInvalid;
        return admin.publicReads.onlineStore.shell(context.tenantId, token ?? undefined);
      },
    }),
    defineRoute({
      method: "GET",
      path: "/public/online-store/access",
      version: 1,
      permission: "online_store:read",
      public: true,
      summary:
        "Public: whether the storefront is locked, its access version and the visitor message",
      schema: {},
      handle: ({ context }) => admin.publicReads.onlineStore.access(context.tenantId),
    }),
    defineRoute({
      method: "POST",
      path: "/public/online-store/unlock",
      version: 1,
      permission: "online_store:read",
      public: true,
      // NOT idempotent: a cached 200 must never be replayed for a different (wrong) password.
      summary: "Public: check the storefront password (20 attempts per 10 minutes per shop)",
      schema: { body: unlockBody },
      handle: async ({ body, context }) => {
        if (rateLimiter !== undefined) {
          const decision = await rateLimiter.consume(
            `rl:${context.tenantId}:storefront-unlock`,
            UNLOCK_LIMIT,
            UNLOCK_WINDOW_MS,
          );
          if (!decision.allowed) {
            return {
              status: 429,
              body: {
                code: "RATE_LIMITED",
                message: "Too many attempts",
                retryable: true,
                fields: [],
                retryAfterMs: decision.retryAfterMs,
              },
              headers: {
                "retry-after": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
              },
            };
          }
        }
        return admin.publicReads.onlineStore.unlock(context.tenantId, body.password);
      },
    }),
  ] as readonly RouteDefinition[];
}
```

In `admin-routes.ts`: import it and add `...publicOnlineStoreRoutes(admin, options.rateLimiter),` after `...publicShippingRoutes(admin),`.

- [ ] **Step 4: Run, typecheck, lint**

Run: `pnpm --filter @platform/admin exec vitest run src/http/public-online-store-routes.test.ts` — PASS.
Run: `pnpm --filter @platform/admin test`, `pnpm --filter @platform/admin typecheck`, `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` — clean.

If the leak test trips on a word that is not a leak (for example a merchant string containing "version"), change the fixture text, never the list.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/http/public-online-store-routes.ts apps/admin/src/http/public-online-store-routes.test.ts \
  apps/admin/src/http/admin-routes.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin): add the public storefront shell, access and unlock routes

Anonymous shell and lock reads through publicReads closures, preview by x-preview-token (401
PREVIEW_INVALID), and a per-shop 20-per-10-minutes unlock with one uniform 401.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Storefront — the cached shell read, the revalidation route and the production assertions

Model tier: **standard** (cache keys and the secret compare are specified exactly).

**Files:**

- Modify: `apps/storefront/package.json` (`"@platform/storefront-content": "workspace:*"`), `apps/storefront/next.config.ts` (`transpilePackages` += `"@platform/storefront-content"`)
- Modify: `apps/storefront/src/lib/runtime-api.ts` (export `currentShopId`, export `RUNTIME_API_URL`)
- Create: `apps/storefront/src/lib/online-store.ts`, `online-store.test.ts`
- Create: `apps/storefront/src/lib/storefront-env.ts`, `storefront-env.test.ts`
- Create: `apps/storefront/src/instrumentation.ts`
- Create: `apps/storefront/src/app/api/revalidate/route.ts`, `route.test.ts`
- Modify: `apps/storefront/src/middleware.ts` (matcher excludes `api/revalidate` — one line; Task 9 rewrites the body)
- Modify: `.env.example` (root)

**Interfaces:**

- Consumes: Task 1 (`readBrandStyle`, `readSocial`, `normalizeLocalizedText`, `type BrandStyle`, `type Locale`, `type LocalizedText`, `DEFAULT_THEME_DOCUMENT`); Task 6 (`GET /api/v1/public/online-store`, `/access`).
- Produces:
  - `runtime-api.ts`: `export const RUNTIME_API_URL`, `export async function currentShopId(): Promise<string>` (the old private `currentTenantId`, renamed; every caller updated).
  - `online-store.ts`: `PREVIEW_HEADER = "x-morbeh-preview"`, `shellTag(shopId)`, `interface ShellImage`, `interface StorefrontShell { mode; previewExpiresAt; previewExpired; branded; storeName; defaultLocale; preferences: { homeTitle; homeMetaDescription; shareImage }; brand: { logo: { image; widthPx }; favicon; style: BrandStyle; social }; header: { sticky }; footer: { note; showSocial }; locked }`, `FALLBACK_SHELL`, `sanitizeShell(raw: unknown, mode: "live" | "preview"): StorefrontShell`, `getStorefrontShell(previewToken: string | null): Promise<StorefrontShell>` (React-`cache`d per request), `getPublicAccess(): Promise<{ locked: boolean; accessVersion: number; message: LocalizedText } | null>`.
  - `storefront-env.ts`: `storefrontSecrets(env?): { accessSecret: string | null; revalidateSecret: string | null; adminOrigin: string | null }`, `assertStorefrontProductionEnv(env?): void`, `MIN_SECRET_BYTES = 32`.
  - `POST /api/revalidate` with `x-revalidate-secret`, body `{ shopId }` → `revalidateTag("os:" + shopId)`.

- [ ] **Step 1: Write the failing tests**

`apps/storefront/src/lib/online-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheCalls: { keyParts: string[]; tags: string[]; revalidate: number }[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    opts: { tags: string[]; revalidate: number },
  ) => {
    cacheCalls.push({ keyParts, tags: opts.tags, revalidate: opts.revalidate });
    return fn;
  },
}));
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => requestHeaders.get(k) ?? null }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));

const { FALLBACK_SHELL, getStorefrontShell, sanitizeShell } = await import("./online-store");

const liveBody = {
  mode: "live",
  previewExpiresAt: null,
  branded: true,
  storeName: "Nour",
  defaultLocale: "en",
  preferences: { homeTitle: { en: "Nour" }, homeMetaDescription: {}, shareImage: null },
  brand: {
    logo: {
      image: { url: "https://cdn.test/l.png", alt: null, width: 400, height: 100 },
      widthPx: 160,
    },
    favicon: null,
    colors: {
      background: "#ffffff",
      foreground: "#111111",
      primary: "#0055ff",
      primaryForeground: "#ffffff",
      accent: "#ffcc00",
      accentForeground: "#000000",
    },
    typography: { headingFont: "cairo", bodyFont: "tajawal", baseSize: "large" },
    corners: "pill",
    social: { instagram: "https://instagram.com/nour" },
  },
  header: { sticky: true },
  footer: { note: { ar: "أهلاً" }, showSocial: true },
  locked: false,
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  cacheCalls.length = 0;
  requestHeaders.clear();
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getStorefrontShell", () => {
  it("two shops, two cache entries: the shop id is in the key parts and the tag (Review Focus 2)", async () => {
    const fetchMock = vi.fn(async () => json(200, liveBody));
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    await getStorefrontShell(null);
    requestHeaders.set("x-shop-id", "shop-b");
    await getStorefrontShell(null);
    expect(cacheCalls).toEqual([
      { keyParts: ["online-store", "shop-a", "shell"], tags: ["os:shop-a"], revalidate: 60 },
      { keyParts: ["online-store", "shop-b", "shell"], tags: ["os:shop-b"], revalidate: 60 },
    ]);
    const tenants = fetchMock.mock.calls.map(
      (c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers["x-tenant-id"],
    );
    expect(tenants).toEqual(["shop-a", "shop-b"]);
  });

  it("previews are never cached and send x-preview-token", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, { ...liveBody, mode: "preview", previewExpiresAt: "2026-10-27T11:00:00.000Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("tok");
    expect(shell.mode).toBe("preview");
    expect(cacheCalls).toEqual([]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers["x-preview-token"]).toBe("tok");
    expect(init.cache).toBe("no-store");
  });

  it("an expired preview shows the live shell with previewExpired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) =>
        init.headers["x-preview-token"] === undefined
          ? json(200, liveBody)
          : json(401, { code: "PREVIEW_INVALID" }),
      ),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    const shell = await getStorefrontShell("old");
    expect(shell).toMatchObject({ mode: "live", previewExpired: true, storeName: "Nour" });
  });

  it("a failing Runtime gives the fallback (never thrown, never cached)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(503, {})),
    );
    requestHeaders.set("x-shop-id", "shop-a");
    expect(await getStorefrontShell(null)).toEqual(FALLBACK_SHELL);
    expect(FALLBACK_SHELL).toMatchObject({
      branded: false,
      locked: false,
      defaultLocale: "ar",
      storeName: "",
    });
  });
});

describe("sanitizeShell (defence in depth, spec 1.12)", () => {
  it("keeps valid data", () => {
    const shell = sanitizeShell(liveBody, "live");
    expect(shell.brand.style.corners).toBe("pill");
    expect(shell.brand.logo).toEqual({
      image: { url: "https://cdn.test/l.png", alt: null, width: 400, height: 100 },
      widthPx: 160,
    });
    expect(shell.brand.social).toEqual({ instagram: "https://instagram.com/nour" });
  });

  it("falls back on hostile or corrupt values", () => {
    const shell = sanitizeShell(
      {
        ...liveBody,
        defaultLocale: "fr",
        brand: {
          ...liveBody.brand,
          logo: {
            image: { url: "javascript:alert(1)", alt: 3, width: -1, height: "x" },
            widthPx: 99999,
          },
          colors: { ...liveBody.brand.colors, background: "#000000;}</style><script>" },
          social: { instagram: "http://insecure.example", myspace: "https://x" },
        },
      },
      "live",
    );
    expect(shell.defaultLocale).toBe("ar");
    expect(shell.brand.logo).toEqual({ image: null, widthPx: 140 });
    expect(shell.brand.style.colors.background).toBe("#f8fafc");
    expect(shell.brand.social).toEqual({});
    expect(sanitizeShell("garbage", "live")).toEqual({ ...FALLBACK_SHELL });
  });
});
```

`apps/storefront/src/lib/storefront-env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertStorefrontProductionEnv, storefrontSecrets } from "./storefront-env";

const S = "s".repeat(32);

describe("storefront env (spec 1.12 Environment)", () => {
  it("accepts only secrets of at least 32 bytes and a real admin origin", () => {
    expect(
      storefrontSecrets({
        STOREFRONT_ACCESS_SECRET: "short",
        STOREFRONT_REVALIDATE_SECRET: S,
        ADMIN_ORIGIN: "https://admin.example.com/path",
      }),
    ).toEqual({
      accessSecret: null,
      revalidateSecret: S,
      adminOrigin: "https://admin.example.com",
    });
  });

  it("asserts in production, names every missing item, and is silent in local", () => {
    expect(() => assertStorefrontProductionEnv({ APP_ENV: "production" })).toThrow(
      /STOREFRONT_ACCESS_SECRET.*STOREFRONT_REVALIDATE_SECRET.*ADMIN_ORIGIN/,
    );
    expect(() =>
      assertStorefrontProductionEnv({
        APP_ENV: "production",
        STOREFRONT_ACCESS_SECRET: S,
        STOREFRONT_REVALIDATE_SECRET: S,
        ADMIN_ORIGIN: "https://admin.example.com",
      }),
    ).not.toThrow();
    expect(() => assertStorefrontProductionEnv({})).not.toThrow();
  });
});
```

`apps/storefront/src/app/api/revalidate/route.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));
const { POST } = await import("./route");

const SECRET = "r".repeat(40);
const post = (body: unknown, secret?: string) =>
  POST(
    new Request("https://shop.example/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret === undefined ? {} : { "x-revalidate-secret": secret }),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", SECRET));
afterEach(() => {
  vi.unstubAllEnvs();
  revalidateTag.mockReset();
});

describe("POST /api/revalidate", () => {
  it("revalidates exactly the shop's tag with the right secret", async () => {
    const res = await post({ shopId: "shop-a" }, SECRET);
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("os:shop-a");
  });

  it("refuses a missing or wrong secret, and refuses everything when none is configured", async () => {
    expect((await post({ shopId: "shop-a" })).status).toBe(401);
    expect((await post({ shopId: "shop-a" }, `${SECRET}x`)).status).toBe(401);
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "");
    expect((await post({ shopId: "shop-a" }, "")).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a malformed shop id", async () => {
    for (const shopId of ["", "../x", "a b", 7, "x".repeat(65)]) {
      expect((await post({ shopId }, SECRET)).status).toBe(400);
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/online-store.test.ts src/lib/storefront-env.test.ts src/app/api/revalidate/route.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

In `apps/storefront/src/lib/runtime-api.ts`: change `const RUNTIME_API_URL = …` to `export const RUNTIME_API_URL = …`; rename `async function currentTenantId()` to `export async function currentShopId()` and replace its six call sites (`await currentTenantId()` → `await currentShopId()`). No behaviour change.

`apps/storefront/src/lib/storefront-env.ts` (Edge-safe: no `node:*`):

```ts
export const MIN_SECRET_BYTES = 32;

type Env = Readonly<Record<string, string | undefined>>;

function secretOf(value: string | undefined): string | null {
  return value !== undefined && new TextEncoder().encode(value).length >= MIN_SECRET_BYTES
    ? value
    : null;
}

function originOf(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface StorefrontSecrets {
  readonly accessSecret: string | null;
  readonly revalidateSecret: string | null;
  readonly adminOrigin: string | null;
}

/** Read per call (never cached at module scope), never logged, never sent to the browser. */
export function storefrontSecrets(env: Env = process.env): StorefrontSecrets {
  return {
    accessSecret: secretOf(env["STOREFRONT_ACCESS_SECRET"]),
    revalidateSecret: secretOf(env["STOREFRONT_REVALIDATE_SECRET"]),
    adminOrigin: originOf(env["ADMIN_ORIGIN"]),
  };
}

function isDevLike(env: Env): boolean {
  const appEnv = env["APP_ENV"] ?? "local";
  return appEnv === "local" || appEnv === "development";
}

/** Boot-time production assertion, like the runtime's `assertProduction*` (spec 1.5/1.12). */
export function assertStorefrontProductionEnv(env: Env = process.env): void {
  if (isDevLike(env)) return;
  const s = storefrontSecrets(env);
  const missing = [
    ...(s.accessSecret === null ? ["STOREFRONT_ACCESS_SECRET"] : []),
    ...(s.revalidateSecret === null ? ["STOREFRONT_REVALIDATE_SECRET"] : []),
    ...(s.adminOrigin === null ? ["ADMIN_ORIGIN"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(
      `storefront: missing production configuration: ${missing.join(", ")} (secrets need at least ${MIN_SECRET_BYTES} bytes)`,
    );
  }
}
```

`apps/storefront/src/instrumentation.ts`:

```ts
import { assertStorefrontProductionEnv } from "./lib/storefront-env";

/** Next calls this once per server start. A production storefront without its secrets does not boot. */
export function register(): void {
  if (process.env["NEXT_RUNTIME"] === "nodejs") assertStorefrontProductionEnv();
}
```

`apps/storefront/src/lib/online-store.ts`:

```ts
import { cache } from "react";
import { unstable_cache } from "next/cache";
import {
  DEFAULT_THEME_DOCUMENT,
  normalizeLocalizedText,
  readBrandStyle,
  readSocial,
  type BrandStyle,
  type Locale,
  type LocalizedText,
  type ThemeBrand,
} from "@platform/storefront-content";
import { currentShopId, RUNTIME_API_URL } from "./runtime-api";

/** Set ONLY by middleware (client-sent copies are stripped there). */
export const PREVIEW_HEADER = "x-morbeh-preview";
export const shellTag = (shopId: string): string => `os:${shopId}`;
const SHELL_TTL_SECONDS = 60;

export interface ShellImage {
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface StorefrontShell {
  readonly mode: "live" | "preview";
  readonly previewExpiresAt: string | null;
  /** A preview token was sent but is invalid or expired: this is the LIVE shell. */
  readonly previewExpired: boolean;
  readonly branded: boolean;
  readonly storeName: string;
  readonly defaultLocale: Locale;
  readonly preferences: {
    readonly homeTitle: LocalizedText;
    readonly homeMetaDescription: LocalizedText;
    readonly shareImage: ShellImage | null;
  };
  readonly brand: {
    readonly logo: { readonly image: ShellImage | null; readonly widthPx: number };
    readonly favicon: ShellImage | null;
    readonly style: BrandStyle;
    readonly social: ThemeBrand["social"];
  };
  readonly header: { readonly sticky: boolean };
  readonly footer: { readonly note: LocalizedText; readonly showSocial: boolean };
  readonly locked: boolean;
}

/** What renders when the Runtime cannot answer: today's look, unlocked (the gate fails closed in middleware). */
export const FALLBACK_SHELL: StorefrontShell = Object.freeze({
  mode: "live",
  previewExpiresAt: null,
  previewExpired: false,
  branded: false,
  storeName: "",
  defaultLocale: "ar",
  preferences: { homeTitle: {}, homeMetaDescription: {}, shareImage: null },
  brand: {
    logo: { image: null, widthPx: 140 },
    favicon: null,
    style: readBrandStyle(DEFAULT_THEME_DOCUMENT.brand),
    social: {},
  },
  header: { sticky: false },
  footer: { note: {}, showSocial: true },
  locked: false,
}) as StorefrontShell;

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const size = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;

function imageOf(value: unknown): ShellImage | null {
  const o = obj(value);
  const url = o["url"];
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return {
    url: parsed.toString(),
    alt: typeof o["alt"] === "string" ? o["alt"] : null,
    width: size(o["width"]),
    height: size(o["height"]),
  };
}

const textOf = (value: unknown, multiline = false): LocalizedText =>
  normalizeLocalizedText(value, { path: "", max: Number.MAX_SAFE_INTEGER, multiline }, []);

/** Spec 1.12 step 3: re-validate EVERYTHING received before it reaches CSS or markup. */
export function sanitizeShell(raw: unknown, mode: "live" | "preview"): StorefrontShell {
  const o = obj(raw);
  if (Object.keys(o).length === 0) return { ...FALLBACK_SHELL };
  const prefs = obj(o["preferences"]);
  const brand = obj(o["brand"]);
  const logo = obj(brand["logo"]);
  const width = logo["widthPx"];
  return {
    mode,
    previewExpiresAt:
      mode === "preview" && typeof o["previewExpiresAt"] === "string"
        ? o["previewExpiresAt"]
        : null,
    previewExpired: false,
    branded: o["branded"] === true,
    storeName: typeof o["storeName"] === "string" ? o["storeName"].trim() : "",
    defaultLocale: o["defaultLocale"] === "en" ? "en" : "ar",
    preferences: {
      homeTitle: textOf(prefs["homeTitle"]),
      homeMetaDescription: textOf(prefs["homeMetaDescription"]),
      shareImage: imageOf(prefs["shareImage"]),
    },
    brand: {
      logo: {
        image: imageOf(logo["image"]),
        widthPx:
          typeof width === "number" && Number.isInteger(width) && width >= 60 && width <= 320
            ? width
            : 140,
      },
      favicon: imageOf(brand["favicon"]),
      style: readBrandStyle(brand),
      social: readSocial(brand["social"]),
    },
    header: { sticky: obj(o["header"])["sticky"] === true },
    footer: {
      note: textOf(obj(o["footer"])["note"], true),
      showSocial: obj(o["footer"])["showSocial"] !== false,
    },
    locked: o["locked"] === true,
  };
}

async function fetchShell(
  shopId: string,
  previewToken: string | null,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store`, {
      headers: {
        "x-tenant-id": shopId,
        ...(previewToken === null ? {} : { "x-preview-token": previewToken }),
      },
      cache: "no-store",
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Decision 32: `unstable_cache` with the shop id in the KEY PARTS and tag `os:<shopId>`, 60 s TTL. A
 * failed read throws inside the cached function, so a failure is never cached.
 */
function cachedLiveShell(shopId: string): Promise<StorefrontShell> {
  return unstable_cache(
    async () => {
      const res = await fetchShell(shopId, null);
      if (res.status !== 200) throw new Error(`storefront shell read failed (${res.status})`);
      return sanitizeShell(res.body, "live");
    },
    ["online-store", shopId, "shell"],
    { tags: [shellTag(shopId)], revalidate: SHELL_TTL_SECONDS },
  )();
}

/** Live (cached) or preview (`no-store`); an invalid preview falls back to live with `previewExpired`. */
export const getStorefrontShell = cache(
  async (previewToken: string | null): Promise<StorefrontShell> => {
    const shopId = await currentShopId();
    const live = async (): Promise<StorefrontShell> => {
      try {
        return await cachedLiveShell(shopId);
      } catch {
        return FALLBACK_SHELL;
      }
    };
    if (previewToken === null) return live();
    const res = await fetchShell(shopId, previewToken);
    if (res.status === 200) return sanitizeShell(res.body, "preview");
    if (res.status === 401) return { ...(await live()), previewExpired: true };
    return live();
  },
);

/** For the password page only (never cached): the visitor message and lock state. */
export async function getPublicAccess(): Promise<{
  locked: boolean;
  accessVersion: number;
  message: LocalizedText;
} | null> {
  try {
    const response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store/access`, {
      headers: { "x-tenant-id": await currentShopId() },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = obj(await response.json());
    if (typeof body["locked"] !== "boolean" || typeof body["accessVersion"] !== "number")
      return null;
    return {
      locked: body["locked"],
      accessVersion: body["accessVersion"],
      message: textOf(body["message"], true),
    };
  } catch {
    return null;
  }
}
```

`apps/storefront/src/app/api/revalidate/route.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { storefrontSecrets } from "@/lib/storefront-env";

const SHOP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Decision 33: admin-web calls this server-to-server after a save that changes the live storefront.
 * Constant-time secret compare (on digests, so lengths never leak); only `os:<shopId>` is touched.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = storefrontSecrets().revalidateSecret;
  const given = request.headers.get("x-revalidate-secret");
  if (secret === null || given === null || !timingSafeEqual(digest(given), digest(secret))) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { shopId?: unknown } | null;
  const shopId = body?.shopId;
  if (typeof shopId !== "string" || !SHOP_ID.test(shopId)) {
    return Response.json({ code: "INVALID_SHOP" }, { status: 400 });
  }
  revalidateTag(`os:${shopId}`);
  return Response.json({ revalidated: true });
}
```

In `apps/storefront/src/middleware.ts`, change the matcher to
`matcher: ["/((?!_next/|favicon\\.ico|api/tls-allowed|api/revalidate).*)"],` (Task 9 keeps this line).

Append to the root `.env.example`, after the `STOREFRONT_URL=` block:

```bash
# Project 4 — Online Store. Storefront: signs the unlock cookie (HMAC) and guards /api/revalidate.
# At least 32 bytes each; required outside APP_ENV=local|development (the storefront refuses to boot).
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
STOREFRONT_ACCESS_SECRET=
# Shared by the storefront and admin-web: admin-web calls the storefront's POST /api/revalidate.
STOREFRONT_REVALIDATE_SECRET=
# Storefront: the admin origin allowed to frame preview pages, and the "Log in to the admin" link.
ADMIN_ORIGIN=http://localhost:3100
# admin-web: where to reach the storefront server-to-server for revalidation (defaults to STOREFRONT_URL).
STOREFRONT_INTERNAL_URL=
```

- [ ] **Step 4: Run, typecheck, lint**

Run: `pnpm install`
Run: `pnpm --filter storefront exec vitest run src/lib/online-store.test.ts src/lib/storefront-env.test.ts src/app/api/revalidate/route.test.ts` — PASS.
Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/package.json apps/storefront/next.config.ts pnpm-lock.yaml \
  apps/storefront/src/lib/runtime-api.ts apps/storefront/src/lib/online-store.ts apps/storefront/src/lib/online-store.test.ts \
  apps/storefront/src/lib/storefront-env.ts apps/storefront/src/lib/storefront-env.test.ts \
  apps/storefront/src/instrumentation.ts apps/storefront/src/app/api/revalidate apps/storefront/src/middleware.ts .env.example
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): read the online-store shell per shop with a tagged cache and a revalidate route

unstable_cache keyed by shop id with tag os:<shopId> and a 60 s TTL, no-store previews, sanitised
input, a secret-guarded POST /api/revalidate and production assertions for the new secrets.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Storefront — the `(store)` route group, one shell layout, header, footer, metadata, fonts and the brand fix

Model tier: **standard** (mechanical moves plus specified components; the risk is a missed import).

**Files:**

- Move (`git mv`, URLs unchanged): `apps/storefront/src/app/{page.tsx,account,cart,checkout,collections,products,search}` → `apps/storefront/src/app/(store)/…`
- Modify: every moved file that imports `@/app/<moved>/…`, and `src/components/{add-to-cart-button,add-to-wishlist-button,auth-form,cart-view,checkout-view,clear-checkout-session-cookie,sign-out-button,signup-complete-form}.tsx` and their tests (import paths → `@/app/(store)/…`)
- Modify: the 14 pages that render `<SiteHeader>` (remove it; read the locale through `getRequestLocale()`)
- Create: `apps/storefront/src/app/(store)/layout.tsx`
- Create: `apps/storefront/src/lib/request-locale.ts`, `request-locale.test.ts`
- Create: `apps/storefront/src/lib/shell-presentation.ts`, `shell-presentation.test.ts`
- Create: `apps/storefront/src/lib/preview-href.ts`, `preview-href.test.ts`
- Create: `apps/storefront/src/components/store-chrome.tsx`, `site-footer.tsx`, `site-footer.test.tsx`, `site-header.test.tsx`
- Modify: `apps/storefront/src/components/site-header.tsx`
- Modify: `apps/storefront/src/app/layout.tsx`; Delete: `apps/storefront/src/app/layout.test.ts` (replaced by `shell-presentation.test.ts`)
- Modify: `apps/storefront/src/app/not-found.tsx`, `apps/storefront/src/app/globals.css`
- Modify: `apps/storefront/src/lib/i18n.ts` (`DEFAULT_LOCALE = "ar"`), `i18n.test.ts`
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`
- Modify: `apps/storefront/src/app/(store)/checkout/confirmation/page.test.tsx` (mock `@/lib/request-locale`)
- Modify: `apps/storefront/package.json` (five `@fontsource/*` families)

**Interfaces:**

- Consumes: Task 7 (`getStorefrontShell`, `StorefrontShell`, `PREVIEW_HEADER`); Task 1 (`brandStyleSheet`, `pickText`, `SOCIAL_NETWORKS`).
- Produces:
  - `request-locale.ts`: `getPreviewToken(): Promise<string | null>`, `getRequestShell(): Promise<StorefrontShell>`, `getRequestLocale(): Promise<Locale>` (all React-`cache`d per request).
  - `shell-presentation.ts`: `brandStyleFor(shell): string | null`, `metadataFor(shell, locale, t): Metadata`, `logoSize(image, widthPx): { width: number; height: number | undefined }`.
  - `preview-href.ts`: `withPreview(path: string, token: string | null): string`.
  - `StoreChrome({ shell, locale, previewToken, children })` (server component; Task 9 adds the preview banner and provider inside it), `SiteHeader({ t, locale, shell, previewToken })`, `SiteFooter({ t, locale, shell })`.
  - Dictionary keys (both locales): `footer.{poweredBy, social, networks.{facebook,instagram,tiktok,x,youtube,snapchat}}`, `meta.fallbackTitle`, `preview.{banner, expires, expired, unavailable}`, `password.{title, defaultMessage, label, submit, incorrect, tooMany, unavailable, ownerPrompt, ownerLink}`.

- [ ] **Step 1: Move the pages into `(store)` and fix import paths**

```bash
cd apps/storefront/src/app
mkdir "(store)"
git mv page.tsx account cart checkout collections products search "(store)/"
cd ../..
grep -rlE '@/app/(account|cart|checkout|collections|products|search)/' src | \
  xargs sed -i -E 's#@/app/(account|cart|checkout|collections|products|search)/#@/app/(store)/\1/#g'
```

`app/actions.ts`, `app/api/*`, `app/layout.tsx`, `app/not-found.tsx` and `app/globals.css` stay at the root. Run `pnpm --filter storefront typecheck` now: it must only complain about things Steps 6–8 change (nothing about a missing module).

- [ ] **Step 2: Write the failing tests for the pure helpers and components**

`src/lib/shell-presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FALLBACK_SHELL, type StorefrontShell } from "./online-store";
import { brandStyleFor, logoSize, metadataFor } from "./shell-presentation";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

const branded: StorefrontShell = {
  ...FALLBACK_SHELL,
  branded: true,
  storeName: "Nour",
  preferences: {
    homeTitle: { ar: "متجر النور" },
    homeMetaDescription: { en: "Hand-made lamps" },
    shareImage: { url: "https://cdn.test/og.jpg", alt: "Lamps", width: 1200, height: 630 },
  },
  brand: {
    ...FALLBACK_SHELL.brand,
    favicon: { url: "https://cdn.test/f.png", alt: null, width: 64, height: 64 },
  },
};

describe("brandStyleFor", () => {
  it("emits nothing for an unbranded shop (today's look, dark mode kept)", () => {
    expect(brandStyleFor(FALLBACK_SHELL)).toBeNull();
  });

  it("emits the validated sheet for a branded shop; a corrupt brand renders the default palette (Review Focus 1)", () => {
    const corrupt = {
      ...branded,
      brand: {
        ...branded.brand,
        style: { colors: { background: "#000000;}</style><script>" } } as never,
      },
    };
    const css = brandStyleFor(corrupt);
    expect(css).toMatch(/^:root:root:root\{/);
    expect(css).toContain("--background:#f8fafc");
    expect(css).not.toContain("<");
  });
});

describe("metadataFor", () => {
  it("titles with the home title in the request locale, else the other, with the store-name template", () => {
    expect(metadataFor(branded, "en", en).title).toEqual({
      default: "متجر النور",
      template: "%s | Nour",
    });
    expect(metadataFor(FALLBACK_SHELL, "en", en).title).toEqual({
      default: "Store",
      template: "%s",
    });
    expect(metadataFor({ ...FALLBACK_SHELL, storeName: "Nour" }, "ar", ar).title).toEqual({
      default: "Nour",
      template: "%s | Nour",
    });
  });

  it("sets description, Open Graph with the share image, Twitter and icons", () => {
    const meta = metadataFor(branded, "ar", ar);
    expect(meta.description).toBe("Hand-made lamps");
    expect(meta.openGraph).toEqual({
      siteName: "Nour",
      locale: "ar_EG",
      type: "website",
      title: "متجر النور",
      description: "Hand-made lamps",
      images: [{ url: "https://cdn.test/og.jpg", width: 1200, height: 630, alt: "Lamps" }],
    });
    expect(meta.twitter).toEqual({ card: "summary_large_image" });
    expect(meta.icons).toEqual({
      icon: [{ url: "https://cdn.test/f.png" }],
      apple: [{ url: "https://cdn.test/f.png" }],
    });
    expect(meta.robots).toBeUndefined();
  });

  it("noindexes a locked store, but not its preview", () => {
    expect(metadataFor({ ...branded, locked: true }, "en", en).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(
      metadataFor({ ...branded, locked: true, mode: "preview" }, "en", en).robots,
    ).toBeUndefined();
  });
});

describe("logoSize", () => {
  it("keeps the aspect ratio at the chosen width, and leaves height open when unknown", () => {
    expect(logoSize({ url: "u", alt: null, width: 800, height: 100 }, 160)).toEqual({
      width: 160,
      height: 20,
    });
    expect(logoSize({ url: "u", alt: null, width: null, height: null }, 160)).toEqual({
      width: 160,
      height: undefined,
    });
  });
});
```

`src/lib/preview-href.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withPreview } from "./preview-href";

describe("withPreview", () => {
  it("adds or replaces ?preview= and keeps query and hash", () => {
    expect(withPreview("/products/a", "tok")).toBe("/products/a?preview=tok");
    expect(withPreview("/search?q=x#top", "tok")).toBe("/search?q=x&preview=tok#top");
    expect(withPreview("/?preview=old", "new")).toBe("/?preview=new");
  });
  it("is the identity without a token", () => {
    expect(withPreview("/cart", null)).toBe("/cart");
  });
});
```

`src/lib/request-locale.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue.value === undefined ? undefined : { value: cookieValue.value }),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
const getStorefrontShell = vi.hoisted(() => vi.fn());
vi.mock("./online-store", () => ({ PREVIEW_HEADER: "x-morbeh-preview", getStorefrontShell }));
const { getRequestLocale } = await import("./request-locale");

beforeEach(() => {
  cookieValue.value = undefined;
  getStorefrontShell.mockResolvedValue({ defaultLocale: "en" });
});

describe("getRequestLocale (Ruling 22)", () => {
  it("prefers the shopper's cookie, else the shop's default language", async () => {
    cookieValue.value = "ar";
    expect(await getRequestLocale()).toBe("ar");
    cookieValue.value = "fr";
    expect(await getRequestLocale()).toBe("en");
    cookieValue.value = undefined;
    getStorefrontShell.mockResolvedValue({ defaultLocale: "ar" });
    expect(await getRequestLocale()).toBe("ar");
  });
});
```

`src/components/site-header.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => <span>lang</span> }));
vi.mock("@platform/ui", async (original) => ({
  ...(await original<typeof import("@platform/ui")>()),
  ThemeToggle: () => <span>theme-toggle</span>,
}));
const { SiteHeader } = await import("./site-header");

const logo = { url: "https://cdn.test/logo.png", alt: "ignored", width: 800, height: 100 };

describe("SiteHeader (spec 1.12)", () => {
  it("shows the logo with the store name as alt, sized from widthPx, never mirrored", () => {
    render(
      <SiteHeader
        t={ar}
        locale="ar"
        previewToken={null}
        shell={{
          ...FALLBACK_SHELL,
          branded: true,
          storeName: "النور",
          brand: { ...FALLBACK_SHELL.brand, logo: { image: logo, widthPx: 200 } },
        }}
      />,
    );
    const img = screen.getByRole("img", { name: "النور" });
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "25");
    expect(img.className).not.toMatch(/scale-x|rotate|mirror/);
    expect(img.className).toMatch(/max-h-10/);
    expect(screen.queryByText("theme-toggle")).toBeNull(); // branded ⇒ light only
  });

  it("shows the store name as text without a logo, and the platform brand without a name", () => {
    const { rerender } = render(
      <SiteHeader
        t={en}
        locale="en"
        previewToken={null}
        shell={{ ...FALLBACK_SHELL, storeName: "Nour" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Nour" })).toHaveAttribute("href", "/");
    expect(screen.getByText("theme-toggle")).toBeInTheDocument(); // unbranded keeps the toggle
    rerender(<SiteHeader t={ar} locale="ar" previewToken={null} shell={FALLBACK_SHELL} />);
    expect(screen.getByRole("link", { name: "مربح" })).toBeInTheDocument();
  });

  it("keeps preview on every shell link and in the search form", () => {
    render(<SiteHeader t={en} locale="en" previewToken="tok" shell={FALLBACK_SHELL} />);
    expect(screen.getByRole("link", { name: en.nav.cart })).toHaveAttribute(
      "href",
      "/cart?preview=tok",
    );
    expect(document.querySelector('input[name="preview"]')).toHaveValue("tok");
  });
});
```

`src/components/site-footer.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FALLBACK_SHELL } from "@/lib/online-store";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";
import { SiteFooter } from "./site-footer";

describe("SiteFooter (spec 1.12)", () => {
  it("renders name, note (dir=auto), only the set social links, copyright and Powered by", () => {
    render(
      <SiteFooter
        t={en}
        locale="en"
        shell={{
          ...FALLBACK_SHELL,
          storeName: "Nour",
          footer: { note: { ar: "توصيل لكل مصر" }, showSocial: true },
          brand: { ...FALLBACK_SHELL.brand, social: { instagram: "https://instagram.com/nour" } },
        }}
      />,
    );
    expect(screen.getByText("توصيل لكل مصر").closest("[dir='auto']")).not.toBeNull();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://instagram.com/nour");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveAccessibleName("Instagram");
    expect(screen.getByText(/©/)).toHaveTextContent(
      new RegExp(`© ${new Date().getFullYear()} Nour`),
    );
    expect(screen.getByText("Powered by Morbeh")).toBeInTheDocument();
  });

  it("formats the year for Arabic and hides social links when turned off", () => {
    render(
      <SiteFooter
        t={ar}
        locale="ar"
        shell={{
          ...FALLBACK_SHELL,
          footer: { note: {}, showSocial: false },
          brand: { ...FALLBACK_SHELL.brand, social: { x: "https://x.com/n" } },
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    const arabicYear = new Intl.NumberFormat("ar", { useGrouping: false }).format(
      new Date().getFullYear(),
    );
    expect(screen.getByText(/©/)).toHaveTextContent(arabicYear);
    expect(screen.getByText("بدعم من مربح")).toBeInTheDocument();
  });
});
```

Add to `src/lib/i18n.test.ts` (replace the `DEFAULT_LOCALE` expectation):

```ts
expect(DEFAULT_LOCALE).toBe("ar"); // Decision 11: Arabic when the shop saved no preference
```

and a brand test:

```ts
it("never spells the brand موربيه (the brand is مربح)", () => {
  expect(JSON.stringify(ar)).not.toContain("موربيه");
  expect(ar.brand).toBe("مربح");
  expect(en.brand).toBe("Morbeh");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/shell-presentation.test.ts src/lib/preview-href.test.ts src/lib/request-locale.test.ts src/components/site-header.test.tsx src/components/site-footer.test.tsx src/lib/i18n.test.ts`
Expected: FAIL.

- [ ] **Step 4: Dictionaries, locale default and fonts**

`src/lib/i18n.ts`: `export const DEFAULT_LOCALE: Locale = "ar";` with the comment `/** Decision 11: Arabic when the shop has no preference. Pages use getRequestLocale(), not this. */`.

`src/messages/en.ts` — change the two account subtitles to `"Sign in to your account."` and `"Create an account to save your wishlist and track your orders."` (Ruling 25), and add these sections after `language`:

```ts
  footer: {
    poweredBy: "Powered by Morbeh",
    social: "Follow us",
    networks: {
      facebook: "Facebook",
      instagram: "Instagram",
      tiktok: "TikTok",
      x: "X",
      youtube: "YouTube",
      snapchat: "Snapchat",
    },
  },
  meta: {
    fallbackTitle: "Store",
  },
  preview: {
    banner: "Preview — not visible to customers",
    expires: "Link expires at {time}",
    expired: "Preview link expired",
    unavailable: "Not available in preview",
  },
  password: {
    title: "Password",
    defaultMessage: "Opening soon",
    label: "Password",
    submit: "Enter",
    incorrect: "Incorrect password",
    tooMany: "Too many attempts, try again in {minutes} minutes",
    unavailable: "Temporarily unavailable. Try again shortly.",
    ownerPrompt: "Are you the store owner?",
    ownerLink: "Log in to the admin",
  },
```

`src/messages/ar.ts` (Modern Standard Arabic): `brand: "مربح"`; account subtitles `"سجّل الدخول إلى حسابك."` and `"أنشئ حساباً لحفظ قائمة أمنياتك وتتبّع طلباتك."`; and:

```ts
  footer: {
    poweredBy: "بدعم من مربح",
    social: "تابعنا",
    networks: {
      facebook: "فيسبوك",
      instagram: "إنستغرام",
      tiktok: "تيك توك",
      x: "إكس",
      youtube: "يوتيوب",
      snapchat: "سناب شات",
    },
  },
  meta: {
    fallbackTitle: "المتجر",
  },
  preview: {
    banner: "معاينة — غير ظاهرة للعملاء",
    expires: "تنتهي صلاحية الرابط في {time}",
    expired: "انتهت صلاحية رابط المعاينة",
    unavailable: "غير متاح أثناء المعاينة",
  },
  password: {
    title: "كلمة المرور",
    defaultMessage: "سيفتح المتجر قريبًا",
    label: "كلمة المرور",
    submit: "دخول",
    incorrect: "كلمة المرور غير صحيحة",
    tooMany: "محاولات كثيرة، حاول مرة أخرى بعد {minutes} دقائق",
    unavailable: "غير متاح مؤقتًا. حاول مرة أخرى بعد قليل.",
    ownerPrompt: "هل أنت مالك المتجر؟",
    ownerLink: "سجّل الدخول إلى لوحة التحكم",
  },
```

Fonts: `pnpm --filter storefront add @fontsource/cairo@^5 @fontsource/tajawal@^5 @fontsource/almarai@^5 @fontsource/readex-pro@^5 @fontsource/amiri@^5` (bundled at build time; no request to Google at runtime).

- [ ] **Step 5: Pure helpers**

`src/lib/preview-href.ts`:

```ts
/** Ruling 16: shell links keep the preview token. Relative paths only (they are ours). */
export function withPreview(path: string, token: string | null): string {
  if (token === null) return path;
  const url = new URL(path, "http://preview.invalid");
  url.searchParams.set("preview", token);
  return `${url.pathname}${url.search}${url.hash}`;
}
```

`src/lib/request-locale.ts`:

```ts
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./i18n";
import { getStorefrontShell, PREVIEW_HEADER, type StorefrontShell } from "./online-store";

/** The preview token the middleware forwarded (client-sent copies were stripped there). */
export const getPreviewToken = cache(async (): Promise<string | null> =>
  (await headers()).get(PREVIEW_HEADER),
);

export const getRequestShell = cache(async (): Promise<StorefrontShell> =>
  getStorefrontShell(await getPreviewToken()),
);

/** Ruling 22: the shopper's cookie, else the shop's default language (Arabic when unset). */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return (await getRequestShell()).defaultLocale;
});
```

`src/lib/shell-presentation.ts`:

```ts
import type { Metadata } from "next";
import { brandStyleSheet, pickText } from "@platform/storefront-content";
import type { Locale } from "./i18n";
import type { ShellImage, StorefrontShell } from "./online-store";
import type { Dictionary } from "@/messages/en";

/** Ruling 6: only a branded shop gets a brand sheet; the package re-validates every value. */
export function brandStyleFor(shell: StorefrontShell): string | null {
  return shell.branded ? brandStyleSheet(shell.brand.style) : null;
}

export function metadataFor(shell: StorefrontShell, locale: Locale, t: Dictionary): Metadata {
  const name = shell.storeName.trim();
  const title =
    pickText(shell.preferences.homeTitle, locale) ?? (name !== "" ? name : t.meta.fallbackTitle);
  const description = pickText(shell.preferences.homeMetaDescription, locale);
  const share = shell.preferences.shareImage;
  const favicon = shell.brand.favicon;
  return {
    title: { default: title, template: name !== "" ? `%s | ${name}` : "%s" },
    ...(description === null ? {} : { description }),
    openGraph: {
      ...(name === "" ? {} : { siteName: name }),
      locale: locale === "ar" ? "ar_EG" : "en_US",
      type: "website",
      title,
      ...(description === null ? {} : { description }),
      ...(share === null
        ? {}
        : {
            images: [
              {
                url: share.url,
                ...(share.width === null ? {} : { width: share.width }),
                ...(share.height === null ? {} : { height: share.height }),
                ...(share.alt === null ? {} : { alt: share.alt }),
              },
            ],
          }),
    },
    twitter: { card: "summary_large_image" },
    ...(favicon === null
      ? {}
      : { icons: { icon: [{ url: favicon.url }], apple: [{ url: favicon.url }] } }),
    // Decision 35: a locked store is noindex; its preview is not public anyway.
    ...(shell.locked && shell.mode === "live" ? { robots: { index: false, follow: false } } : {}),
  };
}

export function logoSize(
  image: ShellImage,
  widthPx: number,
): { width: number; height: number | undefined } {
  if (image.width === null || image.height === null) return { width: widthPx, height: undefined };
  return { width: widthPx, height: Math.round((widthPx * image.height) / image.width) };
}
```

- [ ] **Step 6: Header, footer, chrome, layouts**

`src/components/site-header.tsx` (replace the component; keep the existing doc comment's search-form rationale):

```tsx
import Link from "next/link";
import { SearchIcon, ShoppingCartIcon, UserIcon } from "lucide-react";
import { Button, Input, Label, ThemeToggle } from "@platform/ui";
import { LocaleSwitch } from "@/components/locale-switch";
import type { Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { withPreview } from "@/lib/preview-href";
import { logoSize } from "@/lib/shell-presentation";
import type { Dictionary } from "@/messages/en";

/**
 * Spec 1.12: the shop's header. Logo at the inline start (right in RTL), never mirrored, height
 * capped at 40 px (mobile) / 48 px (desktop), width from `widthPx`; else the store name; else the
 * platform brand. `ThemeToggle` only for an unbranded shop (Decision 16).
 */
export function SiteHeader({
  t,
  locale,
  shell,
  previewToken,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly shell: StorefrontShell;
  readonly previewToken: string | null;
}) {
  const name = shell.storeName.trim();
  const label = name !== "" ? name : t.brand;
  const logo = shell.brand.logo.image;
  const size = logo === null ? null : logoSize(logo, shell.brand.logo.widthPx);
  return (
    <header className="flex items-center justify-between gap-3">
      <Link
        href={withPreview("/", previewToken)}
        className="min-w-0 shrink-0"
        aria-label={logo === null ? undefined : label}
      >
        {logo !== null && size !== null ? (
          // A plain <img>: the media origin is the merchant's bucket, and next/image would need it configured.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.url}
            alt={label}
            width={size.width}
            {...(size.height === undefined ? {} : { height: size.height })}
            style={{ width: `${size.width}px` }}
            className="block h-auto max-h-10 max-w-full object-contain md:max-h-12 ltr:object-left rtl:object-right"
          />
        ) : (
          <bdi dir="auto" className="block truncate text-sm font-medium">
            {label}
          </bdi>
        )}
      </Link>
      <form action="/search" method="get" role="search" className="min-w-0 flex-1">
        <Label htmlFor="site-search" className="sr-only">
          {t.nav.searchLabel}
        </Label>
        {previewToken === null ? null : <input type="hidden" name="preview" value={previewToken} />}
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            id="site-search"
            type="search"
            name="q"
            placeholder={t.nav.searchPlaceholder}
            className="ps-9"
          />
          <button type="submit" className="sr-only">
            {t.nav.searchSubmit}
          </button>
        </div>
      </form>
      <div className="flex shrink-0 items-center gap-1">
        <Button asChild variant="ghost" size="icon" aria-label={t.nav.cart}>
          <Link href={withPreview("/cart", previewToken)}>
            <ShoppingCartIcon aria-hidden="true" className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="icon" aria-label={t.nav.account}>
          <Link href={withPreview("/account", previewToken)}>
            <UserIcon aria-hidden="true" className="size-4" />
          </Link>
        </Button>
        <LocaleSwitch locale={locale} label={t.language.switch} disabled={previewToken !== null} />
        {shell.branded ? null : <ThemeToggle />}
      </div>
    </header>
  );
}
```

In `src/components/locale-switch.tsx` add an optional `disabled?: boolean` prop and pass `disabled={pending || disabled === true}` to the trigger `Button` (Ruling 15: a language change is a POST, refused in preview).

`src/components/site-footer.tsx`:

```tsx
import {
  FacebookIcon,
  InstagramIcon,
  LinkIcon,
  TwitterIcon,
  YoutubeIcon,
  type LucideIcon,
} from "lucide-react";
import { pickText, SOCIAL_NETWORKS, type SocialNetwork } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import type { Dictionary } from "@/messages/en";

// lucide has no TikTok or Snapchat glyph; a generic link icon with the network's accessible name.
const ICONS: Readonly<Record<SocialNetwork, LucideIcon>> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  tiktok: LinkIcon,
  x: TwitterIcon,
  youtube: YoutubeIcon,
  snapchat: LinkIcon,
};

/** Spec 1.12: store name, footer note, social icons for the set fields, ©, "Powered by مربح". */
export function SiteFooter({
  t,
  locale,
  shell,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly shell: StorefrontShell;
}) {
  const name = shell.storeName.trim();
  const note = pickText(shell.footer.note, locale);
  const year = new Intl.NumberFormat(locale, { useGrouping: false }).format(
    new Date().getFullYear(),
  );
  const networks = shell.footer.showSocial
    ? SOCIAL_NETWORKS.filter((n) => shell.brand.social[n] !== undefined)
    : [];
  return (
    <footer className="border-border mt-12 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm">
        {name === "" ? null : (
          <p className="text-foreground font-medium">
            <bdi dir="auto">{name}</bdi>
          </p>
        )}
        {note === null ? null : (
          <p dir="auto" className="whitespace-pre-line">
            <bdi>{note}</bdi>
          </p>
        )}
        {networks.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label={t.footer.social}>
            {networks.map((network) => {
              const Icon = ICONS[network];
              return (
                <li key={network}>
                  <a
                    href={shell.brand.social[network]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t.footer.networks[network]}
                    className="hover:text-foreground inline-flex size-9 items-center justify-center rounded-md"
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <p>
          © {year} <bdi dir="auto">{name !== "" ? name : t.brand}</bdi>
        </p>
        <p className="text-xs">{t.footer.poweredBy}</p>
      </div>
    </footer>
  );
}
```

`src/components/store-chrome.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@platform/ui";
import { dictionaryFor, type Locale } from "@/lib/i18n";
import type { StorefrontShell } from "@/lib/online-store";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** The one shell around every store page (and the root not-found page, Ruling 23). */
export function StoreChrome({
  shell,
  locale,
  previewToken,
  children,
}: {
  readonly shell: StorefrontShell;
  readonly locale: Locale;
  readonly previewToken: string | null;
  readonly children: ReactNode;
}) {
  const t = dictionaryFor(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      <div
        className={cn(
          "bg-background/95 border-border z-30 border-b backdrop-blur-sm",
          shell.header.sticky && "sticky top-0",
        )}
      >
        <div className="mx-auto max-w-5xl px-4 py-3">
          <SiteHeader t={t} locale={locale} shell={shell} previewToken={previewToken} />
        </div>
      </div>
      <div className="flex-1">{children}</div>
      <SiteFooter t={t} locale={locale} shell={shell} />
    </div>
  );
}
```

`src/app/(store)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { StoreChrome } from "@/components/store-chrome";
import { getPreviewToken, getRequestLocale, getRequestShell } from "@/lib/request-locale";

/** Spec 1.12 "Route structure": every store page renders inside the shop's shell. */
export default async function StoreLayout({ children }: { readonly children: ReactNode }) {
  const [shell, locale, token] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPreviewToken(),
  ]);
  const previewToken = token !== null && shell.mode === "preview" ? token : null;
  return (
    <StoreChrome shell={shell} locale={locale} previewToken={previewToken}>
      {children}
    </StoreChrome>
  );
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
// The merchant's choice among six bundled families (spec 1.3). @font-face downloads lazily, so a shop
// only fetches the families its CSS variables name.
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/almarai/400.css";
import "@fontsource/almarai/700.css";
import "@fontsource/readex-pro/400.css";
import "@fontsource/readex-pro/700.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "./globals.css";
import { ThemeProvider } from "@platform/ui";
import { dictionaryFor, directionFor } from "@/lib/i18n";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";
import { brandStyleFor, metadataFor } from "@/lib/shell-presentation";

export async function generateMetadata(): Promise<Metadata> {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  return metadataFor(shell, locale, dictionaryFor(locale));
}

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  const brandCss = brandStyleFor(shell);
  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={GeistSans.variable}
      suppressHydrationWarning
    >
      <head>{brandCss === null ? null : <style id="brand">{brandCss}</style>}</head>
      <body>
        <ThemeProvider {...(shell.branded ? { forcedTheme: "light" } : {})}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Delete `src/app/layout.test.ts` (its four title cases are superseded by `shell-presentation.test.ts`; the "never shows the old placeholder" check is covered by the `Store` fallback case).

`src/app/not-found.tsx`:

```tsx
import { CompassIcon } from "lucide-react";
import { StatePanel } from "@/components/state-panel";
import { StoreChrome } from "@/components/store-chrome";
import { dictionaryFor } from "@/lib/i18n";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";

/** Ruling 23: unmatched URLs render here (outside any group), inside the same store chrome. */
export default async function NotFound() {
  const [shell, locale] = await Promise.all([getRequestShell(), getRequestLocale()]);
  const t = dictionaryFor(locale);
  return (
    <StoreChrome shell={shell} locale={locale} previewToken={null}>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <StatePanel
          icon={<CompassIcon className="size-6" />}
          title={t.notFound.title}
          body={t.notFound.body}
          action={{ href: "/", label: t.notFound.backHome }}
        />
      </main>
    </StoreChrome>
  );
}
```

`src/app/globals.css` — append:

```css
/*
 * Project 4 (Ruling 4): @platform/design inlines --radius-* into utilities (@theme inline), so a
 * runtime override would do nothing. The storefront re-declares the scale through --shop-radius-*,
 * which only a branded shop's <style id="brand"> sets; the fallbacks are the design values.
 */
@theme inline {
  --radius-xs: var(--shop-radius-xs, 4px);
  --radius-sm: var(--shop-radius-sm, 6px);
  --radius-md: var(--shop-radius-md, 8px);
  --radius-lg: var(--shop-radius-lg, 12px);
  --radius-xl: var(--shop-radius-xl, 16px);
  --radius-2xl: var(--shop-radius-2xl, 20px);
  --radius-3xl: var(--shop-radius-3xl, 28px);
}

@layer base {
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-heading, var(--font-sans));
  }
}
```

and in the existing `body` rule change `font-size: 14px;` to `font-size: var(--shop-base-size, 14px);`.

- [ ] **Step 7: Strip the 14 per-page headers and read the locale once**

For each of these files under `src/app/(store)/`: `page.tsx`, `account/page.tsx`, `account/login/page.tsx`, `account/loyalty/page.tsx`, `account/register/page.tsx`, `account/signup/complete/page.tsx`, `account/wishlist/page.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `checkout/confirmation/page.tsx`, `collections/[slug]/page.tsx`, `products/[slug]/page.tsx`, `search/page.tsx`:

1. Delete `import { SiteHeader } from "@/components/site-header";` and every `<SiteHeader t={t} locale={locale} />` line (some files render it in two or three branches).
2. Replace the two locale lines (`const stored = …LOCALE_COOKIE…` and `const locale… = isLocale(stored) ? stored : DEFAULT_LOCALE;`) with `const locale = await getRequestLocale();` and add `import { getRequestLocale } from "@/lib/request-locale";`.
3. Keep `const jar = await cookies();` where the page still reads another cookie from `jar` (account, login, loyalty, register, wishlist, cart, checkout, confirmation); otherwise delete it and the `cookies` import.
4. Remove now-unused imports (`DEFAULT_LOCALE`, `isLocale`, `LOCALE_COOKIE`, `type Locale`) — `pnpm --filter storefront lint` lists them.
5. Pages keep their own `<main className="mx-auto … max-w-2xl …">`; change `min-h-dvh` to nothing on those `<main>` elements (the chrome owns the page height).

In `src/app/(store)/checkout/confirmation/page.test.tsx`, replace the `site-header` mock with:

```ts
vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => (jar.get("morbeh-storefront-locale") === "ar" ? "ar" : "en"),
}));
```

Run: `grep -rn "SiteHeader\|DEFAULT_LOCALE" apps/storefront/src/app` — no output (the header lives only in `StoreChrome`; locales come from `getRequestLocale()`).

- [ ] **Step 8: Run the storefront suite, typecheck and lint**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint` — PASS/clean.
Run: `grep -rn "موربيه" apps/storefront/src` — nothing.

- [ ] **Step 9: Commit**

```bash
git add -A apps/storefront/src/app apps/storefront/src/components apps/storefront/src/lib apps/storefront/src/messages \
  apps/storefront/package.json pnpm-lock.yaml
git status --short   # confirm only storefront files are staged; unstage anything else
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): render every store page in the shop's shell

Pages move into app/(store) under one layout with the shop's header and footer, brand CSS
variables and fonts from the published theme, metadata from preferences, and the brand مربح.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Storefront — the lock gate, the unlock cookie, the password page and view-only preview

Model tier: **strong** (Edge middleware, HMAC, fail-closed caching, cross-shop isolation).

**Files:**

- Create: `apps/storefront/src/lib/access-cookie.ts`, `access-cookie.test.ts`
- Create: `apps/storefront/src/lib/access-cache.ts`, `access-cache.test.ts`
- Create: `apps/storefront/src/lib/return-to.ts`, `return-to.test.ts`
- Modify: `apps/storefront/src/middleware.ts`; Create: `apps/storefront/src/middleware.test.ts`
- Create: `apps/storefront/src/app/(gate)/layout.tsx`, `apps/storefront/src/app/(gate)/password/page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `apps/storefront/src/components/password-form.tsx`, `password-form.test.tsx`
- Create: `apps/storefront/src/components/preview-mode.tsx`, `preview-banner.tsx`, `preview-link-keeper.tsx`, `preview-link-keeper.test.tsx`
- Modify: `apps/storefront/src/components/store-chrome.tsx` (banner, provider, link keeper), `apps/storefront/src/app/(store)/layout.tsx` (expired preview on a locked store → `/password`)
- Modify: `apps/storefront/src/components/add-to-cart-button.tsx`, `add-to-cart-button.test.tsx`
- Modify: `apps/storefront/src/app/(store)/cart/page.tsx`, `apps/storefront/src/app/(store)/checkout/page.tsx` (preview notice)

**Interfaces:**

- Consumes: Task 7 (`storefrontSecrets`, `RUNTIME_API_URL`, `currentShopId`, `getPublicAccess`, `PREVIEW_HEADER`); Task 8 (`StoreChrome`, `getRequestShell`, `getPreviewToken`, `getRequestLocale`, `withPreview`, dictionary keys `preview.*`, `password.*`); `createShopResolver`, `fetchShopFromRuntime`, `SHOP_ID_HEADER`, `PLATFORM_TENANT_ID`, `normalizeHost` (`lib/shop-host.ts`).
- Produces:
  - `access-cookie.ts`: `ACCESS_COOKIE = "morbeh-storefront-access"`, `ACCESS_COOKIE_MAX_AGE_SECONDS = 604800`, `signAccessCookie({ secret, shopId, accessVersion, expUnix }): Promise<string>`, `verifyAccessCookie(value: string | undefined, { secret: string | null, shopId, accessVersion, nowUnix }): Promise<boolean>` (Web Crypto, Edge-safe).
  - `access-cache.ts`: `interface AccessState { locked: boolean; accessVersion: number }`, `createAccessReader({ fetchAccess, now, ttlMs, staleMs, maxEntries? }): (shopId: string) => Promise<AccessState>`, `fetchAccessFromRuntime(runtimeApiUrl): (shopId) => Promise<AccessState>`.
  - `return-to.ts`: `safeReturnTo(raw: unknown): string`.
  - `unlockAction(previous: UnlockState, formData: FormData): Promise<UnlockState>` with `UnlockState = { status: "idle" | "incorrect" | "unavailable" } | { status: "rate_limited"; minutes: number }`.
  - `PreviewModeProvider({ token, children })`, `usePreviewMode(): { active: boolean }`, `PreviewBanner`, `PreviewLinkKeeper({ token })`.

- [ ] **Step 1: Write the failing unit tests**

`src/lib/access-cookie.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { signAccessCookie, verifyAccessCookie } from "./access-cookie";

const secret = "k".repeat(32);
const now = 1_800_000_000;

describe("unlock cookie (spec 1.5)", () => {
  it("is v1.<version>.<exp>.<base64url hmac> and verifies for the same shop, version and time", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "shop-a",
      accessVersion: 3,
      expUnix: now + 60,
    });
    expect(value).toMatch(/^v1\.3\.1800000060\.[A-Za-z0-9_-]{43}$/);
    expect(
      await verifyAccessCookie(value, { secret, shopId: "shop-a", accessVersion: 3, nowUnix: now }),
    ).toBe(true);
  });

  it("a cookie for shop A never verifies for shop B (Review Focus 2)", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "shop-a",
      accessVersion: 3,
      expUnix: now + 60,
    });
    expect(
      await verifyAccessCookie(value, { secret, shopId: "shop-b", accessVersion: 3, nowUnix: now }),
    ).toBe(false);
  });

  it("refuses expired, old-version, tampered, malformed, and any cookie without a usable secret", async () => {
    const value = await signAccessCookie({
      secret,
      shopId: "s",
      accessVersion: 3,
      expUnix: now + 60,
    });
    const ok = { secret, shopId: "s", accessVersion: 3, nowUnix: now };
    expect(await verifyAccessCookie(value, { ...ok, nowUnix: now + 61 })).toBe(false);
    expect(await verifyAccessCookie(value, { ...ok, accessVersion: 4 })).toBe(false);
    expect(
      await verifyAccessCookie(
        value.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        ok,
      ),
    ).toBe(false);
    expect(
      await verifyAccessCookie(value.replace("v1.3.", "v1.4."), { ...ok, accessVersion: 4 }),
    ).toBe(false);
    for (const bad of [undefined, "", "v1", "v2.3.1.x", "v1.x.y.z", "v1.3.1800000060"]) {
      expect(await verifyAccessCookie(bad, ok)).toBe(false);
    }
    expect(await verifyAccessCookie(value, { ...ok, secret: null })).toBe(false);
    await expect(
      signAccessCookie({ secret: "short", shopId: "s", accessVersion: 1, expUnix: now }),
    ).rejects.toThrow();
  });
});
```

`src/lib/access-cache.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAccessReader } from "./access-cache";

const locked = { locked: true, accessVersion: 2 };

describe("createAccessReader (spec 1.12, Review Focus 3)", () => {
  it("caches for 15 s, then asks again", async () => {
    let t = 0;
    const fetchAccess = vi.fn(async () => locked);
    const read = createAccessReader({ fetchAccess, now: () => t, ttlMs: 15_000, staleMs: 300_000 });
    await read("s");
    t = 14_999;
    await read("s");
    expect(fetchAccess).toHaveBeenCalledTimes(1);
    t = 15_000;
    await read("s");
    expect(fetchAccess).toHaveBeenCalledTimes(2);
  });

  it("serves the last known value for up to 5 minutes while the Runtime fails, then throws", async () => {
    let t = 0;
    const fetchAccess = vi
      .fn<(shopId: string) => Promise<typeof locked>>()
      .mockResolvedValueOnce(locked)
      .mockRejectedValue(new Error("down"));
    const read = createAccessReader({ fetchAccess, now: () => t, ttlMs: 15_000, staleMs: 300_000 });
    await read("s");
    t = 299_000;
    expect(await read("s")).toEqual(locked);
    t = 300_001;
    await expect(read("s")).rejects.toThrow();
  });

  it("never caches a failure, and never shares an entry between shops", async () => {
    const fetchAccess = vi
      .fn<(shopId: string) => Promise<typeof locked>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(async (shop) => ({ locked: shop === "a", accessVersion: 1 }));
    const read = createAccessReader({ fetchAccess, now: () => 0, ttlMs: 15_000, staleMs: 300_000 });
    await expect(read("a")).rejects.toThrow();
    expect(await read("a")).toEqual({ locked: true, accessVersion: 1 });
    expect(await read("b")).toEqual({ locked: false, accessVersion: 1 });
  });
});
```

`src/lib/return-to.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo (spec 1.5)", () => {
  it.each([
    ["/products/a?x=1", "/products/a?x=1"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example/", "/"],
    ["javascript:alert(1)", "/"],
    ["products", "/"],
    ["", "/"],
    [null, "/"],
    ["/%0d%0aSet-Cookie:x", "/%0d%0aSet-Cookie:x"],
  ])("%j → %j", (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });
});
```

`src/middleware.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signAccessCookie } from "./lib/access-cookie";

const SECRET = "m".repeat(32);
const TOKEN = "T".repeat(43);
let access: Record<string, { locked: boolean; accessVersion: number } | "fail">;
let hosts: Record<string, string>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  access = { "shop-a": { locked: false, accessVersion: 1 } };
  hosts = { "a.example": "shop-a", "b.example": "shop-b" };
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "off");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", SECRET);
  vi.stubEnv("ADMIN_ORIGIN", "https://admin.example");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { headers?: Record<string, string> }) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/public/domains/resolve")) {
        const shop = hosts[url.searchParams.get("host") ?? ""];
        return shop === undefined
          ? json({}, 404)
          : json({ shopId: shop, hostname: "h", primaryHostname: "h", shopStatus: "active" });
      }
      const state = access[init?.headers?.["x-tenant-id"] ?? ""];
      if (state === "fail" || state === undefined) return json({}, 503);
      return json({ ...state, message: {} });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function run(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    host?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { middleware } = await import("./middleware");
  const headers = new Headers(options.headers ?? {});
  if (options.cookie !== undefined)
    headers.set("cookie", `morbeh-storefront-access=${options.cookie}`);
  headers.set("host", options.host ?? "a.example");
  return middleware(
    new NextRequest(new URL(path, `https://${options.host ?? "a.example"}`), {
      method: options.method ?? "GET",
      headers,
    }),
  );
}
const cookieFor = (
  shopId: string,
  accessVersion: number,
  expUnix = Math.floor(Date.now() / 1000) + 3600,
) => signAccessCookie({ secret: SECRET, shopId, accessVersion, expUnix });
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("storefront middleware (spec 1.12)", () => {
  it("an unlocked shop passes; responses forbid framing except by itself", async () => {
    const res = await run("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });

  it("strips client-sent x-shop-id and x-morbeh-preview", async () => {
    const res = await run("/", {
      headers: { "x-shop-id": "shop-evil", "x-morbeh-preview": "forged" },
    });
    expect(forwarded(res, "x-morbeh-preview")).toBeNull();
    expect(forwarded(res, "x-shop-id")).toBeNull();
  });

  describe("locked shop", () => {
    beforeEach(() => {
      access["shop-a"] = { locked: true, accessVersion: 3 };
    });

    it("GET without a cookie → 302 /password?return_to=<path> (preview param dropped)", async () => {
      const res = await run("/products/lamp?color=red");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "https://a.example/password?return_to=%2Fproducts%2Flamp%3Fcolor%3Dred",
      );
    });

    it("POST without a cookie → 403", async () => {
      expect((await run("/cart", { method: "POST" })).status).toBe(403);
    });

    it("a valid cookie passes; expired, other shop, old version or no secret do not", async () => {
      expect(
        (await run("/", { cookie: await cookieFor("shop-a", 3) })).headers.get("location"),
      ).toBeNull();
      expect((await run("/", { cookie: await cookieFor("shop-a", 3, 1) })).status).toBe(302);
      expect((await run("/", { cookie: await cookieFor("shop-b", 3) })).status).toBe(302);
      expect((await run("/", { cookie: await cookieFor("shop-a", 2) })).status).toBe(302);
      const valid = await cookieFor("shop-a", 3);
      vi.stubEnv("STOREFRONT_ACCESS_SECRET", "");
      expect((await run("/", { cookie: valid })).status).toBe(302); // fail closed
    });

    it("exempt paths stay reachable: /password, /policies/*, robots, sitemap", async () => {
      for (const path of [
        "/password",
        "/password?return_to=%2F",
        "/policies/refund-policy",
        "/robots.txt",
        "/sitemap.xml",
      ]) {
        expect((await run(path)).headers.get("location"), path).toBeNull();
      }
    });

    it("a GET with a preview token passes to the layout, private and frameable by the admin only", async () => {
      const res = await run(`/products/lamp?preview=${TOKEN}`);
      expect(res.headers.get("location")).toBeNull();
      expect(forwarded(res, "x-morbeh-preview")).toBe(TOKEN);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'self' https://admin.example",
      );
    });

    it("a malformed preview value is ignored (gated like any GET)", async () => {
      expect((await run("/?preview=<script>")).status).toBe(302);
    });
  });

  it("any POST carrying ?preview= is refused, locked or not (view-only preview, Ruling 15)", async () => {
    expect((await run(`/products/lamp?preview=${TOKEN}`, { method: "POST" })).status).toBe(403);
  });

  it("unknown access with a failing Runtime → 503 (fail closed)", async () => {
    access["shop-a"] = "fail";
    expect((await run("/")).status).toBe(503);
  });

  it("host routing on: A's cookie on B's host is redirected (Review Focus 2)", async () => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    access["shop-a"] = { locked: true, accessVersion: 3 };
    access["shop-b"] = { locked: true, accessVersion: 3 };
    const aCookie = await cookieFor("shop-a", 3);
    expect(
      (await run("/", { host: "a.example", cookie: aCookie })).headers.get("location"),
    ).toBeNull();
    expect((await run("/", { host: "b.example", cookie: aCookie })).status).toBe(302);
    expect((await run("/", { host: "nowhere.example" })).status).toBe(404);
  });
});
```

`src/app/(gate)/password/actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setCookie = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
);
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: setCookie }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("next/navigation", () => ({ redirect }));
const { unlockAction } = await import("./actions");

const form = (password: string, returnTo = "/products/lamp") => {
  const f = new FormData();
  f.set("password", password);
  f.set("return_to", returnTo);
  return f;
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "off");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", "a".repeat(32));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setCookie.mockReset();
  redirect.mockClear();
});

describe("unlockAction", () => {
  it("sets the HttpOnly host-only cookie and redirects to a safe return_to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { accessVersion: 4 })),
    );
    await expect(
      unlockAction({ status: "idle" }, form("open sesame", "//evil.example")),
    ).rejects.toThrow("REDIRECT:/");
    const [name, value, options] = setCookie.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("morbeh-storefront-access");
    expect(value).toMatch(/^v1\.4\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain("sesame");
    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  });

  it("maps 401 → incorrect and 429 → minutes to wait", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(401, { code: "PASSWORD_INCORRECT" })),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "incorrect" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(429, { code: "RATE_LIMITED", retryAfterMs: 90_000 }, { "retry-after": "90" }),
      ),
    );
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({
      status: "rate_limited",
      minutes: 2,
    });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("without a signing secret says temporarily unavailable and never calls the Runtime", async () => {
    vi.stubEnv("STOREFRONT_ACCESS_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await unlockAction({ status: "idle" }, form("x"))).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

`src/components/preview-link-keeper.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PreviewLinkKeeper } from "./preview-link-keeper";

afterEach(() => vi.restoreAllMocks());

describe("PreviewLinkKeeper (Ruling 16)", () => {
  it("turns an internal link click into a full navigation that keeps ?preview=", () => {
    const assign = vi.fn();
    render(
      <>
        <PreviewLinkKeeper token="tok" navigate={assign} />
        <a href="/products/lamp?c=1">lamp</a>
        <a href="https://instagram.com/x">ig</a>
        <a href="/cart" target="_blank">
          new tab
        </a>
      </>,
    );
    fireEvent.click(screen.getByText("lamp"));
    expect(assign).toHaveBeenCalledWith("/products/lamp?c=1&preview=tok");
    fireEvent.click(screen.getByText("ig"));
    fireEvent.click(screen.getByText("new tab"));
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
```

Append to `src/components/add-to-cart-button.test.tsx`:

```tsx
it("is disabled with a note in preview (view-only)", () => {
  render(
    <PreviewModeProvider token="tok">
      <AddToCartButton productId="p" outOfStock={false} t={en} />
    </PreviewModeProvider>,
  );
  expect(screen.getByRole("button")).toBeDisabled();
  expect(screen.getByText(en.preview.unavailable)).toBeInTheDocument();
});
```

(import `PreviewModeProvider` from `./preview-mode`; reuse the file's existing `en` import and mocks.)

`src/components/password-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";
import { ar } from "@/messages/ar";

vi.mock("@/app/(gate)/password/actions", () => ({ unlockAction: vi.fn() }));
const { PasswordFormView } = await import("./password-form");

describe("PasswordFormView", () => {
  it("labels the field and the button, and keeps return_to hidden", () => {
    render(
      <PasswordFormView
        t={ar}
        locale="ar"
        returnTo="/cart"
        state={{ status: "idle" }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByLabelText("كلمة المرور")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "دخول" })).toBeInTheDocument();
    expect(document.querySelector('input[name="return_to"]')).toHaveValue("/cart");
  });

  it("shows the incorrect and rate-limited messages, the minutes formatted for the locale", () => {
    const { rerender } = render(
      <PasswordFormView
        t={en}
        locale="en"
        returnTo="/"
        state={{ status: "incorrect" }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password");
    rerender(
      <PasswordFormView
        t={ar}
        locale="ar"
        returnTo="/"
        state={{ status: "rate_limited", minutes: 2 }}
        action={() => undefined}
        pending={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("بعد ٢ دقائق");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/access-cookie.test.ts src/lib/access-cache.test.ts src/lib/return-to.test.ts src/middleware.test.ts "src/app/(gate)/password/actions.test.ts" src/components/preview-link-keeper.test.tsx src/components/password-form.test.tsx src/components/add-to-cart-button.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the cookie, cache and return-to helpers**

`src/lib/access-cookie.ts`:

```ts
import { MIN_SECRET_BYTES } from "./storefront-env";

export const ACCESS_COOKIE = "morbeh-storefront-access";
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  if (encoder.encode(secret).length < MIN_SECRET_BYTES)
    throw new Error("STOREFRONT_ACCESS_SECRET is too short");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const payload = (shopId: string, accessVersion: number, expUnix: number) =>
  encoder.encode(`${shopId}|${accessVersion}|${expUnix}`);

/** Spec 1.5: `v1.<accessVersion>.<expUnix>.<base64url(HMAC-SHA256(secret, shopId|accessVersion|expUnix))>`. */
export async function signAccessCookie(input: {
  readonly secret: string;
  readonly shopId: string;
  readonly accessVersion: number;
  readonly expUnix: number;
}): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(input.secret),
    payload(input.shopId, input.accessVersion, input.expUnix),
  );
  return `v1.${input.accessVersion}.${input.expUnix}.${toBase64Url(signature)}`;
}

/** Edge-safe; `crypto.subtle.verify` compares in constant time. No secret ⇒ nothing verifies (fail closed). */
export async function verifyAccessCookie(
  value: string | undefined,
  expected: {
    readonly secret: string | null;
    readonly shopId: string;
    readonly accessVersion: number;
    readonly nowUnix: number;
  },
): Promise<boolean> {
  if (value === undefined || expected.secret === null) return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const version = Number(parts[1]);
  const exp = Number(parts[2]);
  if (!Number.isInteger(version) || !Number.isInteger(exp)) return false;
  if (version !== expected.accessVersion || exp <= expected.nowUnix) return false;
  const signature = fromBase64Url(parts[3] ?? "");
  if (signature === null) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await key(expected.secret),
      signature,
      payload(expected.shopId, version, exp),
    );
  } catch {
    return false;
  }
}
```

`src/lib/access-cache.ts`:

```ts
export interface AccessState {
  readonly locked: boolean;
  readonly accessVersion: number;
}

/**
 * The middleware's own view of the lock (spec 1.12): fresh for `ttlMs` (15 s); when the Runtime fails,
 * the last known value is served for up to `staleMs` (5 min); a failure is never cached, and with no
 * known value the caller gets the error (→ 503, fail closed). One entry per shop id.
 */
export function createAccessReader(deps: {
  readonly fetchAccess: (shopId: string) => Promise<AccessState>;
  readonly now: () => number;
  readonly ttlMs: number;
  readonly staleMs: number;
  readonly maxEntries?: number;
}): (shopId: string) => Promise<AccessState> {
  const cache = new Map<string, { value: AccessState; fetchedAt: number }>();
  const maxEntries = deps.maxEntries ?? 5000;
  return async (shopId) => {
    const hit = cache.get(shopId);
    if (hit !== undefined && deps.now() - hit.fetchedAt < deps.ttlMs) return hit.value;
    try {
      const value = await deps.fetchAccess(shopId);
      cache.set(shopId, { value, fetchedAt: deps.now() });
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return value;
    } catch (error) {
      if (hit !== undefined && deps.now() - hit.fetchedAt <= deps.staleMs) return hit.value;
      throw error;
    }
  };
}

export function fetchAccessFromRuntime(
  runtimeApiUrl: string,
): (shopId: string) => Promise<AccessState> {
  return async (shopId) => {
    const response = await fetch(`${runtimeApiUrl}/api/v1/public/online-store/access`, {
      headers: { "x-tenant-id": shopId },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`access read failed with ${response.status}`);
    const body = (await response.json()) as { locked?: unknown; accessVersion?: unknown };
    if (typeof body.locked !== "boolean" || typeof body.accessVersion !== "number")
      throw new Error("access read: bad shape");
    return { locked: body.locked, accessVersion: body.accessVersion };
  };
}
```

`src/lib/return-to.ts`:

```ts
/** Spec 1.5: a relative path starting with `/` and not `//` (or `/\`), otherwise `/`. */
export function safeReturnTo(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\")
  )
    return "/";
  return raw;
}
```

- [ ] **Step 4: Rewrite the middleware**

`src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, verifyAccessCookie } from "./lib/access-cookie";
import { createAccessReader, fetchAccessFromRuntime } from "./lib/access-cache";
import {
  PLATFORM_TENANT_ID,
  SHOP_ID_HEADER,
  createShopResolver,
  fetchShopFromRuntime,
  normalizeHost,
} from "./lib/shop-host";
import { storefrontSecrets } from "./lib/storefront-env";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const DEFAULT_SHOP_ID = process.env.TENANT_DEFAULT_ID ?? "tenant-local";
/** Same name as lib/online-store.ts PREVIEW_HEADER (redefined: middleware must stay Edge-light). */
const PREVIEW_HEADER = "x-morbeh-preview";
const PREVIEW_SHAPE = /^[A-Za-z0-9_-]{32,100}$/;

const resolveShop = createShopResolver({
  fetchShop: fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID),
  now: () => Date.now(),
  ttlMs: 60_000,
});
const readAccess = createAccessReader({
  fetchAccess: fetchAccessFromRuntime(RUNTIME_API_URL),
  now: () => Date.now(),
  ttlMs: 15_000,
  staleMs: 5 * 60_000,
});

const text = (status: number, body: string) =>
  new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** Spec 1.12 step 4 / Decision 34: reachable while locked. */
function isExempt(pathname: string): boolean {
  return (
    pathname === "/password" ||
    pathname.startsWith("/password/") ||
    pathname.startsWith("/policies/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/_next/")
  );
}

function framing(response: NextResponse, preview: boolean): NextResponse {
  if (preview) {
    const admin = storefrontSecrets().adminOrigin;
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set(
      "Content-Security-Policy",
      admin === null ? "frame-ancestors 'self'" : `frame-ancestors 'self' ${admin}`,
    );
  } else {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  }
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(SHOP_ID_HEADER); // never trust a client-sent shop id
  headers.delete(PREVIEW_HEADER); // nor a client-sent preview token header

  // 1. The shop (spec: the new steps run in both modes; routing off ⇒ the deployment shop).
  let shopId = DEFAULT_SHOP_ID;
  if (process.env.STOREFRONT_HOST_ROUTING === "on") {
    const host = normalizeHost(request.headers.get("host"));
    if (host === null) return framing(text(400, "Bad request"), false);
    let shop;
    try {
      shop = await resolveShop(host);
    } catch {
      return framing(text(503, "Temporarily unavailable / غير متاح مؤقتاً"), false);
    }
    if (shop === null) return framing(text(404, "Store not found / المتجر غير موجود"), false);
    if (shop.shopStatus !== "active")
      return framing(text(503, "This store is unavailable / هذا المتجر غير متاح"), false);
    headers.set(SHOP_ID_HEADER, shop.shopId);
    shopId = shop.shopId;
  }

  // 2. Preview: view-only. Every POST that carries ?preview= is refused (Ruling 15).
  const isRead = request.method === "GET" || request.method === "HEAD";
  const previewParam = request.nextUrl.searchParams.get("preview");
  if (previewParam !== null && !isRead)
    return framing(text(403, "Not available in preview / غير متاح أثناء المعاينة"), false);
  const preview = isRead && previewParam !== null && PREVIEW_SHAPE.test(previewParam);
  if (preview) headers.set(PREVIEW_HEADER, previewParam);

  // 3. The lock gate.
  const { pathname } = request.nextUrl;
  if (!isExempt(pathname)) {
    let state;
    try {
      state = await readAccess(shopId);
    } catch {
      return framing(text(503, "Temporarily unavailable / غير متاح مؤقتاً"), false); // fail closed
    }
    if (state.locked && !preview) {
      const unlocked = await verifyAccessCookie(request.cookies.get(ACCESS_COOKIE)?.value, {
        secret: storefrontSecrets().accessSecret,
        shopId,
        accessVersion: state.accessVersion,
        nowUnix: Math.floor(Date.now() / 1000),
      });
      if (!unlocked) {
        if (!isRead) return framing(text(403, "Forbidden"), false);
        const back = new URL(request.nextUrl);
        back.searchParams.delete("preview");
        const target = new URL("/password", request.url);
        target.searchParams.set("return_to", `${back.pathname}${back.search}`);
        return framing(NextResponse.redirect(target, 302), false);
      }
    }
  }

  return framing(NextResponse.next({ request: { headers } }), preview);
}

export const config = {
  // Static assets, Caddy's TLS "ask" endpoint and the revalidation hook never need a shop.
  matcher: ["/((?!_next/|favicon\\.ico|api/tls-allowed|api/revalidate).*)"],
};
```

Note: the password page itself (exempt) still has the shop resolved, so it renders the right brand.

- [ ] **Step 5: The password page, action and form**

`src/app/(gate)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

/** Spec 1.12: the gate has the brand (root layout) but not the shop's header and footer. */
export default function GateLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      {children}
    </main>
  );
}
```

`src/app/(gate)/password/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE_SECONDS,
  signAccessCookie,
} from "@/lib/access-cookie";
import { safeReturnTo } from "@/lib/return-to";
import { currentShopId, RUNTIME_API_URL } from "@/lib/runtime-api";
import { storefrontSecrets } from "@/lib/storefront-env";

export type UnlockState =
  | { readonly status: "idle" | "incorrect" | "unavailable" }
  | { readonly status: "rate_limited"; readonly minutes: number };

/** Spec 1.5: the password goes to the Runtime once; only an HMAC proof is stored in the cookie. */
export async function unlockAction(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const secret = storefrontSecrets().accessSecret;
  if (secret === null) return { status: "unavailable" };
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 200)
    return { status: "incorrect" };
  const shopId = await currentShopId();
  let response: Response;
  try {
    response = await fetch(`${RUNTIME_API_URL}/api/v1/public/online-store/unlock`, {
      method: "POST",
      headers: { "x-tenant-id": shopId, "content-type": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store",
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "incorrect" };
  if (response.status === 429) {
    const body = (await response.json().catch(() => null)) as { retryAfterMs?: unknown } | null;
    const ms =
      typeof body?.retryAfterMs === "number"
        ? body.retryAfterMs
        : Number(response.headers.get("retry-after") ?? "60") * 1000;
    return { status: "rate_limited", minutes: Math.max(1, Math.ceil(ms / 60_000)) };
  }
  if (!response.ok) return { status: "unavailable" };
  const body = (await response.json().catch(() => null)) as { accessVersion?: unknown } | null;
  if (typeof body?.accessVersion !== "number") return { status: "unavailable" };
  const value = await signAccessCookie({
    secret,
    shopId,
    accessVersion: body.accessVersion,
    expUnix: Math.floor(Date.now() / 1000) + ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  (await cookies()).set(ACCESS_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  redirect(safeReturnTo(formData.get("return_to")));
}
```

`src/components/password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@platform/ui";
import { unlockAction, type UnlockState } from "@/app/(gate)/password/actions";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

const INITIAL: UnlockState = { status: "idle" };

export function PasswordFormView({
  t,
  locale,
  returnTo,
  state,
  action,
  pending,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly returnTo: string;
  readonly state: UnlockState;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const error =
    state.status === "incorrect"
      ? t.password.incorrect
      : state.status === "unavailable"
        ? t.password.unavailable
        : state.status === "rate_limited"
          ? t.password.tooMany.replace(
              "{minutes}",
              new Intl.NumberFormat(locale).format(state.minutes),
            )
          : null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="return_to" value={returnTo} />
      <Label htmlFor="storefront-password">{t.password.label}</Label>
      <Input
        id="storefront-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={100}
        aria-invalid={error !== null}
      />
      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" loading={pending}>
        {t.password.submit}
      </Button>
    </form>
  );
}

export function PasswordForm(props: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly returnTo: string;
}) {
  const [state, action, pending] = useActionState(unlockAction, INITIAL);
  return <PasswordFormView {...props} state={state} action={action} pending={pending} />;
}
```

`src/app/(gate)/password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pickText } from "@platform/storefront-content";
import { PasswordForm } from "@/components/password-form";
import { dictionaryFor } from "@/lib/i18n";
import { getPublicAccess } from "@/lib/online-store";
import { getRequestLocale, getRequestShell } from "@/lib/request-locale";
import { safeReturnTo } from "@/lib/return-to";
import { storefrontSecrets } from "@/lib/storefront-env";

/** Decision 35: the password page is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly return_to?: string }>;
}) {
  const [shell, locale, access, params] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPublicAccess(),
    searchParams,
  ]);
  const returnTo = safeReturnTo(params.return_to);
  if (access !== null && !access.locked) redirect(returnTo); // unlocked meanwhile
  const t = dictionaryFor(locale);
  const name = shell.storeName.trim();
  const logo = shell.brand.logo.image;
  const message =
    (access === null ? null : pickText(access.message, locale)) ?? t.password.defaultMessage;
  const adminOrigin = storefrontSecrets().adminOrigin;
  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        {logo === null ? (
          <h1 className="text-xl font-semibold">
            <bdi dir="auto">{name !== "" ? name : t.brand}</bdi>
          </h1>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.url}
            alt={name !== "" ? name : t.brand}
            style={{ width: `${shell.brand.logo.widthPx}px` }}
            className="h-auto max-h-12 max-w-full object-contain"
          />
        )}
        <p dir="auto" className="text-muted-foreground whitespace-pre-line">
          <bdi>{message}</bdi>
        </p>
      </div>
      <PasswordForm t={t} locale={locale} returnTo={returnTo} />
      {adminOrigin === null ? null : (
        <p className="text-muted-foreground text-center text-xs">
          {t.password.ownerPrompt}{" "}
          <a href={adminOrigin} className="underline">
            {t.password.ownerLink}
          </a>
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 6: Preview mode pieces and their wiring**

`src/components/preview-mode.tsx`:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

const PreviewModeContext = createContext<{ readonly active: boolean }>({ active: false });

export function PreviewModeProvider({
  token,
  children,
}: {
  readonly token: string | null;
  readonly children: ReactNode;
}) {
  return (
    <PreviewModeContext.Provider value={{ active: token !== null }}>
      {children}
    </PreviewModeContext.Provider>
  );
}

export function usePreviewMode(): { readonly active: boolean } {
  return useContext(PreviewModeContext);
}
```

`src/components/preview-link-keeper.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { withPreview } from "@/lib/preview-href";

/**
 * Ruling 16: in preview, a click on a same-origin link becomes a full navigation that keeps
 * `?preview=`. Capture phase on `document`, so it runs before React's own root listener (which would
 * otherwise client-navigate through <Link> and drop the parameter).
 */
export function PreviewLinkKeeper({
  token,
  navigate = (url: string) => window.location.assign(url),
}: {
  readonly token: string;
  /** Test seam; the default is a full page load. */
  readonly navigate?: (url: string) => void;
}) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.getAttribute("href") ?? "", window.location.origin);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(withPreview(`${url.pathname}${url.search}${url.hash}`, token));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [token, navigate]);
  return null;
}
```

`src/components/preview-banner.tsx` (server component):

```tsx
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export function PreviewBanner({
  t,
  locale,
  expiresAt,
  expired,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly expiresAt: string | null;
  readonly expired: boolean;
}) {
  const time =
    expiresAt === null
      ? null
      : new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
          new Date(expiresAt),
        );
  return (
    <div role="status" className="bg-foreground text-background px-4 py-1.5 text-center text-xs">
      {expired
        ? t.preview.expired
        : `${t.preview.banner}${time === null ? "" : ` · ${t.preview.expires.replace("{time}", time)}`}`}
    </div>
  );
}
```

`StoreChrome` (Task 8) gains a `previewExpired: boolean` prop and renders, as its first child, `{previewToken !== null || previewExpired ? <PreviewBanner t={t} locale={locale} expiresAt={shell.previewExpiresAt} expired={previewExpired} /> : null}`; wraps everything in `<PreviewModeProvider token={previewToken}>`; and renders `{previewToken === null ? null : <PreviewLinkKeeper token={previewToken} />}`. `not-found.tsx` passes `previewExpired={false}`.

`src/app/(store)/layout.tsx` becomes:

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { StoreChrome } from "@/components/store-chrome";
import { getPreviewToken, getRequestLocale, getRequestShell } from "@/lib/request-locale";

export default async function StoreLayout({ children }: { readonly children: ReactNode }) {
  const [shell, locale, token] = await Promise.all([
    getRequestShell(),
    getRequestLocale(),
    getPreviewToken(),
  ]);
  // Spec 1.12: middleware let the preview GET through a locked store; an invalid token lands on the gate.
  if (token !== null && shell.previewExpired && shell.locked) redirect("/password");
  const previewToken = token !== null && shell.mode === "preview" ? token : null;
  return (
    <StoreChrome
      shell={shell}
      locale={locale}
      previewToken={previewToken}
      previewExpired={token !== null && shell.previewExpired}
    >
      {children}
    </StoreChrome>
  );
}
```

`src/components/add-to-cart-button.tsx`: `const preview = usePreviewMode();`, the button gets `disabled={outOfStock || isPending || preview.active}`, and when `preview.active` render `<p className="text-muted-foreground text-xs">{t.preview.unavailable}</p>` under it.

`src/app/(store)/cart/page.tsx` and `src/app/(store)/checkout/page.tsx`: after the locale line, `if ((await getPreviewToken()) !== null) return <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8"><StatePanel title={t.preview.unavailable} /></main>;` (import `getPreviewToken` from `@/lib/request-locale` and `StatePanel`; adapt to `StatePanel`'s required props — give it the `ShoppingCartIcon` the cart page already imports).

- [ ] **Step 7: Run the storefront suite, typecheck and lint**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint` — PASS/clean.

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/lib/access-cookie.ts apps/storefront/src/lib/access-cookie.test.ts \
  apps/storefront/src/lib/access-cache.ts apps/storefront/src/lib/access-cache.test.ts \
  apps/storefront/src/lib/return-to.ts apps/storefront/src/lib/return-to.test.ts \
  apps/storefront/src/middleware.ts apps/storefront/src/middleware.test.ts "apps/storefront/src/app/(gate)" \
  "apps/storefront/src/app/(store)/layout.tsx" "apps/storefront/src/app/(store)/cart/page.tsx" \
  "apps/storefront/src/app/(store)/checkout/page.tsx" apps/storefront/src/app/not-found.tsx \
  apps/storefront/src/components/password-form.tsx apps/storefront/src/components/password-form.test.tsx \
  apps/storefront/src/components/preview-mode.tsx apps/storefront/src/components/preview-banner.tsx \
  apps/storefront/src/components/preview-link-keeper.tsx apps/storefront/src/components/preview-link-keeper.test.tsx \
  apps/storefront/src/components/store-chrome.tsx apps/storefront/src/components/add-to-cart-button.tsx \
  apps/storefront/src/components/add-to-cart-button.test.tsx
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): lock the store behind a password and add view-only preview

Middleware gate with a host-only HMAC unlock cookie (7 days, revoked by access version), fail-closed
access cache, /password page, ?preview= handling with private no-store framing for the admin only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: admin-web — form primitives, the API client, revalidation, navigation, role gates, CSP and Online Store → Preferences

Model tier: **standard** (server/client boundary rules are the main risk; every string is given).

**Files:**

- Create: `packages/ui/src/components/ui/textarea.tsx`, `native-select.tsx`, `switch.tsx`, `color-field.tsx`, `form-controls.test.tsx`; Modify: `packages/ui/src/index.ts`
- Modify: `apps/admin-web/package.json` (`"@platform/storefront-content": "workspace:*"`), `apps/admin-web/next.config.ts` (`transpilePackages` += `"@platform/storefront-content"`; CSP `frame-src`), `apps/admin-web/src/next-config.test.ts`
- Modify: `apps/admin-web/src/lib/api/client.ts` (422 on binary uploads), `apps/admin-web/src/lib/api/media.ts` (`UploadProductImageResult` gains `invalid`)
- Create: `apps/admin-web/src/lib/api/online-store.ts`, `online-store.test.ts`
- Create: `apps/admin-web/src/lib/storefront-revalidate.ts`, `storefront-revalidate.test.ts`
- Create: `apps/admin-web/src/lib/online-store/codes.ts`, `upload-rules.ts`, `upload-rules.test.ts`
- Modify: `apps/admin-web/src/components/navigation.ts`, `navigation.test.tsx`
- Modify: `apps/admin-web/src/middleware.ts`, `middleware.test.ts`
- Modify: `apps/admin-web/src/app/settings/general/actions.ts`, `actions.test.ts` (revalidate after save)
- Create: `apps/admin-web/src/app/online-store/actions.ts` (image upload, shared with Task 11), `actions.test.ts`
- Create: `apps/admin-web/src/app/online-store/preferences/page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/components/online-store/localized-text-field.tsx`, `image-upload-field.tsx`, `preferences-form.tsx`, `password-protection-card.tsx`, `preferences-form.test.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts` (brand fix; `nav.*`; `onlineStore`, `onlineStorePreferences`)

**Interfaces:**

- Consumes: Task 5 routes; Task 1 (`LocalizedText`, `ThemeDocument`, `ContrastWarning`, `readThemeDocument`, `normalizeHex`); `getAdminApi`, `mutateAdminApi`, `sendAdminBinary`, `currentTenantRef` (`lib/api/client.ts`); `newIdempotencyKey`, `toFormState`, `FormState` (`lib/api/mutation.ts`); `requireProdEnv` (`lib/env.ts`); `fetchWithTimeout`; `readSession`, `highestRole` (`lib/auth/session.ts`); `getCurrentUser`; `AppShell`.
- Produces:
  - `@platform/ui`: `Textarea`, `NativeSelect`, `Switch` (props `checked`, `onCheckedChange?`, plus input props; `role="switch"`), `ColorField` (props `id`, `value: string`, `onChange(hex: string)`, `label`, `textLabel`).
  - `lib/api/online-store.ts` (server only): DTO types `OnlineStoreImageDto`, `PreferencesDto`, `AccessDto`, `ThemeStateDto`, `SaveDraftResultDto`, `ReleaseDto`, `PreviewTokenDto`, `OnlineStoreImagePurpose`; functions `fetchPreferences()`, `updatePreferences(body, key)`, `fetchAccess()`, `updateAccess(body, key)`, `fetchThemeState()`, `saveThemeDraft(document, expectedVersion, key)`, `discardThemeDraft(expectedVersion, key)`, `publishTheme(expectedDraftRevision, key)`, `fetchThemeReleases()`, `restoreThemeRelease(releaseNumber, expectedVersion, key)`, `issuePreviewToken()`, `uploadOnlineStoreImage({ bytes, contentType, fileName, purpose, idempotencyKey })`.
  - `revalidateStorefront(shopId?: string): Promise<boolean>` (best effort, 2 s, never throws).
  - `codeOf(message: string): string | null`; `UPLOAD_RULES` and `checkUpload(file: { type: string; size: number }, purpose): "ok" | "too_large" | "unsupported"`.
  - `uploadOnlineStoreImageAction(formData): Promise<OnlineStoreUploadState>` with `OnlineStoreUploadState = { status: "ok"; image: OnlineStoreImageDto } | { status: "error"; reason: "unavailable" | "too_large" | "unsupported" | "bad_dimensions" | "forbidden" | "failed" }`.
  - `savePreferencesAction(previous: FormState, formData)`, `saveAccessAction(previous: FormState, formData)`.
  - Nav ids: `online-store-themes`, `online-store-preferences`; `ROUTE_ROLE_REQUIREMENTS` entries `["/online-store/themes/customize", "operator"]`, `["/online-store", "viewer"]`.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/components/ui/form-controls.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorField } from "./color-field";
import { NativeSelect } from "./native-select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

describe("form controls (Project 4)", () => {
  it("Switch is a checkbox with the switch role and reports changes", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Lock" checked={false} onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole("switch", { name: "Lock" });
    expect(control).toHaveAttribute("type", "checkbox");
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("ColorField normalises #RRGGBB / RRGGBB to lower case and refuses anything else", () => {
    const onChange = vi.fn();
    render(
      <ColorField id="c" label="Primary" textLabel="Hex" value="#635bff" onChange={onChange} />,
    );
    const text = screen.getByLabelText("Hex");
    fireEvent.change(text, { target: { value: "AABBCC" } });
    fireEvent.blur(text);
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
    fireEvent.change(text, { target: { value: "red" } });
    fireEvent.blur(text);
    expect(text).toHaveAttribute("aria-invalid", "true");
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Primary"), { target: { value: "#00ff00" } });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("NativeSelect and Textarea are the native elements", () => {
    render(
      <>
        <NativeSelect aria-label="Font" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </NativeSelect>
        <Textarea aria-label="Note" defaultValue="x" />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Font" })).toHaveValue("b");
    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe("TEXTAREA");
  });
});
```

`apps/admin-web/src/lib/api/online-store.test.ts` (mirrors `store-settings.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));
const api = await import("./online-store");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("online-store API client", () => {
  it("reads the theme state and canonicalises both documents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, {
          draft: { garbage: true },
          published: null,
          draftRevision: 0,
          draftSavedAt: null,
          publishedDraftRevision: null,
          releaseNumber: 0,
          publishedAt: null,
          publishedBy: null,
          hasUnpublishedChanges: false,
          images: {},
          version: 0,
        }),
      ),
    );
    const result = await api.fetchThemeState();
    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") expect(result.data.draft.schemaVersion).toBe(1);
  });

  it("mints a preview token WITHOUT an idempotency key", async () => {
    const fetchMock = vi.fn(async () =>
      json(201, { token: "t".repeat(43), expiresAt: "2026-10-27T11:00:00.000Z", url: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await api.issuePreviewToken()).outcome).toBe("ok");
    const init = fetchMock.mock.calls[0]?.[1] as {
      headers: Record<string, string>;
      method: string;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBeUndefined();
  });

  it("uploads with the purpose in the query and maps 422 to invalid with its code", async () => {
    const fetchMock = vi.fn(async () =>
      json(422, {
        code: "BAD_DIMENSIONS",
        min: { width: 32, height: 32 },
        max: 1024,
        square: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.uploadOnlineStoreImage({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
      fileName: "f.png",
      purpose: "favicon",
      idempotencyKey: "k",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://runtime.test/api/v1/online-store/images?purpose=favicon",
    );
    expect(result).toEqual({
      outcome: "invalid",
      code: "BAD_DIMENSIONS",
      detail: { code: "BAD_DIMENSIONS", min: { width: 32, height: 32 }, max: 1024, square: true },
    });
  });
});
```

`apps/admin-web/src/lib/storefront-revalidate.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateStorefront } from "./storefront-revalidate";

beforeEach(() => {
  vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "r".repeat(40));
  vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("revalidateStorefront (Decision 33)", () => {
  it("posts { shopId } with the secret to the internal URL when set, else STOREFRONT_URL", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await revalidateStorefront()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("https://shop.example/api/revalidate");
    expect(init.headers["x-revalidate-secret"]).toBe("r".repeat(40));
    expect(JSON.parse(String(init.body))).toEqual({ shopId: "shop-a" });
    vi.stubEnv("STOREFRONT_INTERNAL_URL", "http://storefront:3000");
    await revalidateStorefront();
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      "http://storefront:3000/api/revalidate",
    );
  });

  it("never throws: network errors, timeouts and missing config are false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await revalidateStorefront()).toBe(false);
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", "");
    expect(await revalidateStorefront()).toBe(false);
  });
});
```

`apps/admin-web/src/lib/online-store/upload-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkUpload } from "./upload-rules";

describe("checkUpload (browser pre-check; the server decides)", () => {
  it.each([
    [{ type: "image/png", size: 1000 }, "favicon", "ok"],
    [{ type: "image/jpeg", size: 1000 }, "favicon", "unsupported"],
    [{ type: "image/png", size: 2 * 1024 * 1024 }, "favicon", "too_large"],
    [{ type: "image/webp", size: 1000 }, "share_image", "unsupported"],
    [{ type: "image/svg+xml", size: 10 }, "logo", "unsupported"],
    [{ type: "image/webp", size: 1000 }, "logo", "ok"],
  ] as const)("%j as %s → %s", (file, purpose, expected) => {
    expect(checkUpload(file, purpose)).toBe(expected);
  });
});
```

`apps/admin-web/src/app/online-store/preferences/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/api/mutation";

const api = vi.hoisted(() => ({ updatePreferences: vi.fn(), updateAccess: vi.fn() }));
const revalidate = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({
  revalidateStorefront: revalidate.revalidateStorefront,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidate.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
const { saveAccessAction, savePreferencesAction } = await import("./actions");

const idle: FormState = { status: "idle" };
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

beforeEach(() => {
  api.updatePreferences.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  api.updateAccess.mockReset().mockResolvedValue({ outcome: "ok", data: {} });
  revalidate.revalidateStorefront.mockReset().mockResolvedValue(true);
});

describe("preferences actions", () => {
  it("sends both locales, the share image and the version with one key, then revalidates the storefront", async () => {
    const state = await savePreferencesAction(
      idle,
      form({
        "homeTitle.ar": "متجر",
        "homeTitle.en": "",
        "homeMetaDescription.ar": "",
        "homeMetaDescription.en": "Lamps",
        shareImageId: "img-1",
        defaultLocale: "en",
        expectedVersion: "3",
      }),
    );
    expect(state).toEqual({ status: "success" });
    expect(api.updatePreferences).toHaveBeenCalledWith(
      {
        homeTitle: { ar: "متجر", en: "" },
        homeMetaDescription: { ar: "", en: "Lamps" },
        shareImageId: "img-1",
        defaultLocale: "en",
        expectedVersion: 3,
      },
      expect.any(String),
    );
    expect(revalidate.revalidateStorefront).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate after a failure, and explains a version conflict", async () => {
    api.updatePreferences.mockResolvedValue({
      outcome: "conflict",
      message: "VERSION_CONFLICT: changed",
    });
    const state = await savePreferencesAction(
      idle,
      form({ defaultLocale: "ar", expectedVersion: "0" }),
    );
    expect(state).toMatchObject({
      status: "error",
      message: "This was changed in another window. Reload to continue.",
    });
    expect(revalidate.revalidateStorefront).not.toHaveBeenCalled();
  });

  it("access: an empty password field means keep (null), and the lock switch is a checkbox", async () => {
    await saveAccessAction(
      idle,
      form({
        locked: "on",
        password: "",
        "message.ar": "قريبًا",
        "message.en": "",
        expectedVersion: "1",
      }),
    );
    expect(api.updateAccess).toHaveBeenCalledWith(
      { locked: true, password: null, message: { ar: "قريبًا", en: "" }, expectedVersion: 1 },
      expect.any(String),
    );
    await saveAccessAction(idle, form({ password: "1234", expectedVersion: "2" }));
    expect(api.updateAccess).toHaveBeenLastCalledWith(
      { locked: false, password: "1234", message: { ar: "", en: "" }, expectedVersion: 2 },
      expect.any(String),
    );
  });

  it("access: PASSWORD_REQUIRED becomes a field message", async () => {
    api.updateAccess.mockResolvedValue({
      outcome: "invalid",
      message: "PASSWORD_REQUIRED: Set a password",
      fields: [{ field: "password", message: "PASSWORD_REQUIRED" }],
    });
    const state = await saveAccessAction(idle, form({ locked: "on", expectedVersion: "0" }));
    expect(state).toEqual({
      status: "error",
      message: "Set a password before locking the store.",
      fieldErrors: { password: "Set a password before locking the store." },
    });
  });
});
```

`apps/admin-web/src/components/online-store/preferences-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { en } from "@/messages/en";

vi.mock("@/app/online-store/preferences/actions", () => ({
  savePreferencesAction: vi.fn(),
  saveAccessAction: vi.fn(),
}));
vi.mock("@/app/online-store/actions", () => ({ uploadOnlineStoreImageAction: vi.fn() }));
const { PasswordProtectionCard } = await import("./password-protection-card");
const { PreferencesForm } = await import("./preferences-form");

const access = {
  locked: true,
  passwordSet: true,
  passwordUpdatedAt: "2026-10-20T09:00:00.000Z",
  message: { ar: "قريبًا" },
  version: 2,
};
const prefs = {
  homeTitle: { ar: "متجر" },
  homeMetaDescription: {},
  shareImage: null,
  defaultLocale: "ar" as const,
  storeName: "Nour",
  version: 1,
};

describe("Preferences screens", () => {
  it("an operator sees the password card read-only, with the admin-only hint", () => {
    render(<PasswordProtectionCard t={en} locale="en" access={access} isAdmin={false} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByLabelText(en.onlineStorePreferences.newPassword)).toBeNull();
    expect(screen.getByText(en.onlineStorePreferences.adminOnly)).toBeInTheDocument();
  });

  it("an admin gets the switch and an empty, never pre-filled password field", () => {
    render(<PasswordProtectionCard t={en} locale="en" access={access} isAdmin />);
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByLabelText(en.onlineStorePreferences.newPassword)).toHaveValue("");
  });

  it("shows the store name read-only with a link to Settings → General, and counters", () => {
    render(
      <PreferencesForm
        t={en}
        locale="en"
        preferences={prefs}
        canEdit
        storefrontUrl="https://shop.example"
      />,
    );
    expect(screen.getByText("Nour")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: en.onlineStorePreferences.changeStoreName }),
    ).toHaveAttribute("href", "/settings/general");
    expect(screen.getByText("4/70")).toBeInTheDocument(); // "متجر" is 4 characters
    expect(screen.getByText("0/320")).toBeInTheDocument();
  });
});
```

Add to `apps/admin-web/src/middleware.test.ts`:

```ts
it("Online Store: viewers reach every sidebar link; the editor needs an operator (Project 4)", async () => {
  const { ONLINE_STORE_NAV } = await import("@/components/navigation");
  jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
  for (const href of [
    ONLINE_STORE_NAV.href,
    ...(ONLINE_STORE_NAV.children ?? []).map((c) => c.href),
  ]) {
    const response = await middleware(requestFor(href, "good.token"));
    expect(response.headers.get("location"), href).toBeNull();
  }
  const denied = await middleware(requestFor("/online-store/themes/customize", "good.token"));
  expect(denied.headers.get("location")).toContain("/forbidden");
  jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
  expect(
    (await middleware(requestFor("/online-store/themes/customize", "good.token"))).headers.get(
      "location",
    ),
  ).toBeNull();
});
```

Add to `apps/admin-web/src/next-config.test.ts`:

```ts
it("allows framing the storefront preview (frame-src), never framing the admin itself (Ruling 18)", async () => {
  vi.stubEnv("STOREFRONT_URL", "http://localhost:3000/shop");
  const config = await loadConfig();
  const rules = await config.headers!();
  const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
  expect(csp.split("; ")).toContain("frame-src 'self' https: http://localhost:3000");
  expect(csp.split("; ")).toContain("frame-ancestors 'none'");
});
```

Replace the navigation test "puts Theme, Pages and SEO under the Online Store sales channel" with:

```tsx
it("puts Themes, Pages, Preferences and SEO under Online Store, in Shopify's order", () => {
  renderNav("online-store-preferences");
  const channels = screen.getByRole("navigation", { name: en.nav.salesChannels });
  expect(within(channels).getByRole("link", { name: en.nav.onlineStore })).toHaveAttribute(
    "href",
    "/online-store/themes",
  );
  const labels = within(channels)
    .getAllByRole("link")
    .map((link) => link.textContent);
  expect(labels).toEqual(
    expect.arrayContaining([en.nav.themes, en.nav.pages, en.nav.preferences, en.nav.seo]),
  );
  expect(within(channels).getByRole("link", { name: en.nav.preferences })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("lists the raw theme tokens under Platform tools", () => {
  renderNav("dashboard", { showPlatformTools: true });
  const tools = screen.getByRole("navigation", { name: en.nav.platformTools });
  expect(within(tools).getByRole("link", { name: en.nav.themeTokens })).toHaveAttribute(
    "href",
    "/theme",
  );
});
```

Add to `apps/admin-web/src/app/settings/general/actions.test.ts`: mock `@/lib/storefront-revalidate` and assert `revalidateStorefront` is called once after a successful save and not after a failed one (Ruling 24).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/ui exec vitest run src/components/ui/form-controls.test.tsx`
Run: `pnpm --filter admin-web exec vitest run src/lib/api/online-store.test.ts src/lib/storefront-revalidate.test.ts src/lib/online-store src/app/online-store src/components/online-store src/middleware.test.ts src/next-config.test.ts src/components/navigation.test.tsx src/app/settings/general/actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: The four `@platform/ui` primitives**

`textarea.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/** Native textarea with the Input's border, radius and focus ring. Pair with a <Label htmlFor>. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "border-input bg-card text-foreground flex min-h-20 w-full rounded-xl border px-3.5 py-2 text-base",
        "placeholder:text-muted-foreground hover:border-foreground/40",
        "disabled:bg-muted aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
```

`native-select.tsx`:

```tsx
import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

/** The native <select> (accessible, RTL-correct, no dependency), styled like Input. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "border-input bg-card text-foreground flex h-9 w-full rounded-xl border px-3 text-base",
        "hover:border-foreground/40 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";
```

`switch.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/focus";

export interface SwitchProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "role" | "onChange"
> {
  readonly onCheckedChange?: (checked: boolean) => void;
}

/** A checkbox with `role="switch"`: submits like a checkbox (`name=on`), reads as a switch. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      className={cn(
        "bg-border-strong checked:bg-primary relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full transition-colors",
        "before:bg-card before:absolute before:start-0.5 before:top-0.5 before:size-4 before:rounded-full before:transition-transform",
        "checked:before:translate-x-4 disabled:cursor-not-allowed disabled:opacity-60 rtl:checked:before:-translate-x-4",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Switch.displayName = "Switch";
```

`color-field.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "../../lib/cn";
import { Input } from "./input";

const HEX = /^#?([0-9a-fA-F]{6})$/;

export interface ColorFieldProps {
  readonly id: string;
  readonly label: string;
  readonly textLabel: string;
  readonly value: string;
  readonly onChange: (hex: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Native colour input plus a hex field. Only `#rrggbb` (lower case) ever leaves this control. */
export function ColorField({
  id,
  label,
  textLabel,
  value,
  onChange,
  disabled,
  className,
}: ColorFieldProps) {
  const [text, setText] = React.useState(value);
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const match = HEX.exec(text.trim());
    if (match === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const hex = `#${(match[1] ?? "").toLowerCase()}`;
    if (hex !== value) onChange(hex);
  };
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        id={id}
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value.toLowerCase())}
        className="border-input h-9 w-12 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
      />
      <Input
        aria-label={textLabel}
        dir="ltr"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="w-28 font-mono uppercase"
        maxLength={7}
      />
    </div>
  );
}
```

`packages/ui/src/index.ts` — add `export * from "./components/ui/color-field";`, `"./components/ui/native-select"`, `"./components/ui/switch"`, `"./components/ui/textarea"`.

- [ ] **Step 4: API client, binary 422, revalidation, codes and upload rules**

In `apps/admin-web/src/lib/api/client.ts`: add to `BinaryResult<T>` the member `| { readonly outcome: "invalid"; readonly code: string; readonly detail: unknown }`, and in `sendAdminBinary`, before the `!response.ok` check:

```ts
if (response.status === 422) {
  const detail: unknown = await response.json().catch(() => null);
  const code =
    typeof (detail as { code?: unknown } | null)?.code === "string"
      ? (detail as { code: string }).code
      : "INVALID";
  return { outcome: "invalid", code, detail };
}
```

In `lib/api/media.ts`, add `| { readonly outcome: "invalid"; readonly code: string; readonly detail: unknown }` to `UploadProductImageResult` (the product route never answers 422, so `uploadProductImageAction`'s `default: "failed"` branch is unchanged).

`apps/admin-web/src/lib/api/online-store.ts`:

```ts
import {
  readThemeDocument,
  type ContrastWarning,
  type LocalizedText,
  type ThemeDocument,
} from "@platform/storefront-content";
import {
  getAdminApi,
  mutateAdminApi,
  sendAdminBinary,
  type ApiResult,
  type BinaryResult,
  type MutationResult,
} from "./client";

/** Server only (Global Constraint 7): client components import TYPES from here, never values. */
export type OnlineStoreImagePurpose = "logo" | "favicon" | "share_image" | "section_image";

export interface OnlineStoreImageDto {
  readonly id?: string;
  readonly url: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}
export interface PreferencesDto {
  readonly homeTitle: LocalizedText;
  readonly homeMetaDescription: LocalizedText;
  readonly shareImage: OnlineStoreImageDto | null;
  readonly defaultLocale: "ar" | "en";
  readonly storeName: string;
  readonly version: number;
}
export interface AccessDto {
  readonly locked: boolean;
  readonly passwordSet: boolean;
  readonly passwordUpdatedAt: string | null;
  readonly message: LocalizedText;
  readonly version: number;
}
export interface ThemeStateDto {
  readonly draft: ThemeDocument;
  readonly published: ThemeDocument | null;
  readonly draftRevision: number;
  readonly draftSavedAt: string | null;
  readonly publishedDraftRevision: number | null;
  readonly releaseNumber: number;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly hasUnpublishedChanges: boolean;
  readonly images: Readonly<Record<string, OnlineStoreImageDto>>;
  readonly version: number;
}
export interface SaveDraftResultDto {
  readonly draftRevision: number;
  readonly version: number;
  readonly warnings: readonly ContrastWarning[];
}
export interface DraftRevisionDto {
  readonly draftRevision: number;
  readonly version: number;
}
export interface PublishResultDto {
  readonly releaseNumber: number;
  readonly publishedAt: string;
}
export interface ReleaseDto {
  readonly releaseNumber: number;
  readonly publishedAt: string;
  readonly publishedByName: string | null;
}
export interface PreviewTokenDto {
  readonly token: string;
  readonly expiresAt: string;
  readonly url: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isPreferences(v: unknown): v is PreferencesDto {
  return (
    isObject(v) &&
    isObject(v["homeTitle"]) &&
    isObject(v["homeMetaDescription"]) &&
    (v["defaultLocale"] === "ar" || v["defaultLocale"] === "en") &&
    typeof v["storeName"] === "string" &&
    isNumber(v["version"])
  );
}
function isAccess(v: unknown): v is AccessDto {
  return (
    isObject(v) &&
    typeof v["locked"] === "boolean" &&
    typeof v["passwordSet"] === "boolean" &&
    isObject(v["message"]) &&
    isNumber(v["version"])
  );
}
function isThemeState(v: unknown): v is ThemeStateDto {
  return (
    isObject(v) &&
    "draft" in v &&
    isNumber(v["draftRevision"]) &&
    isNumber(v["version"]) &&
    typeof v["hasUnpublishedChanges"] === "boolean" &&
    isObject(v["images"])
  );
}
const isDraftRevision = (v: unknown): v is DraftRevisionDto =>
  isObject(v) && isNumber(v["draftRevision"]) && isNumber(v["version"]);
const isSaveDraft = (v: unknown): v is SaveDraftResultDto =>
  isDraftRevision(v) && Array.isArray((v as Record<string, unknown>)["warnings"]);
const isPublish = (v: unknown): v is PublishResultDto =>
  isObject(v) && isNumber(v["releaseNumber"]) && typeof v["publishedAt"] === "string";
const isReleases = (v: unknown): v is { releases: ReleaseDto[] } =>
  isObject(v) && Array.isArray(v["releases"]);
const isToken = (v: unknown): v is PreviewTokenDto =>
  isObject(v) && typeof v["token"] === "string" && typeof v["expiresAt"] === "string";
const isImage = (v: unknown): v is OnlineStoreImageDto =>
  isObject(v) && typeof v["id"] === "string" && typeof v["url"] === "string";

export function fetchPreferences(): Promise<ApiResult<PreferencesDto>> {
  return getAdminApi("/api/v1/online-store/preferences", isPreferences);
}

export function updatePreferences(
  body: {
    homeTitle: LocalizedText;
    homeMetaDescription: LocalizedText;
    shareImageId: string | null;
    defaultLocale: "ar" | "en";
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<MutationResult<PreferencesDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/preferences",
    { method: "PUT", body, idempotencyKey },
    isPreferences,
  );
}

export function fetchAccess(): Promise<ApiResult<AccessDto>> {
  return getAdminApi("/api/v1/online-store/access", isAccess);
}

export function updateAccess(
  body: {
    locked: boolean;
    password: string | null;
    message: LocalizedText;
    expectedVersion: number;
  },
  idempotencyKey: string,
): Promise<MutationResult<AccessDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/access",
    { method: "PUT", body, idempotencyKey },
    isAccess,
  );
}

/** The documents are re-read through the shared reader, so the editor always holds a canonical shape. */
export async function fetchThemeState(): Promise<ApiResult<ThemeStateDto>> {
  const result = await getAdminApi("/api/v1/online-store/theme", isThemeState);
  if (result.outcome !== "ok") return result;
  return {
    outcome: "ok",
    data: {
      ...result.data,
      draft: readThemeDocument(result.data.draft),
      published: result.data.published === null ? null : readThemeDocument(result.data.published),
    },
  };
}

export function saveThemeDraft(
  document: ThemeDocument,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<SaveDraftResultDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/draft",
    { method: "PUT", body: { document, expectedVersion }, idempotencyKey },
    isSaveDraft,
  );
}

export function discardThemeDraft(
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<DraftRevisionDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/discard-draft",
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isDraftRevision,
  );
}

export function publishTheme(
  expectedDraftRevision: number,
  idempotencyKey: string,
): Promise<MutationResult<PublishResultDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/theme/publish",
    { method: "POST", body: { expectedDraftRevision }, idempotencyKey },
    isPublish,
  );
}

export async function fetchThemeReleases(): Promise<ApiResult<readonly ReleaseDto[]>> {
  const result = await getAdminApi("/api/v1/online-store/theme/releases", isReleases);
  return result.outcome === "ok" ? { outcome: "ok", data: result.data.releases } : result;
}

export function restoreThemeRelease(
  releaseNumber: number,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MutationResult<DraftRevisionDto>> {
  return mutateAdminApi(
    `/api/v1/online-store/theme/releases/${encodeURIComponent(String(releaseNumber))}/restore`,
    { method: "POST", body: { expectedVersion }, idempotencyKey },
    isDraftRevision,
  );
}

/** NOT idempotent on purpose (binding lesson): no Idempotency-Key, so a token is never replayed. */
export function issuePreviewToken(): Promise<MutationResult<PreviewTokenDto>> {
  return mutateAdminApi(
    "/api/v1/online-store/preview-tokens",
    { method: "POST", body: {} },
    isToken,
  );
}

export function uploadOnlineStoreImage(input: {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly purpose: OnlineStoreImagePurpose;
  readonly idempotencyKey: string;
}): Promise<BinaryResult<OnlineStoreImageDto>> {
  return sendAdminBinary(
    `/api/v1/online-store/images?purpose=${encodeURIComponent(input.purpose)}`,
    {
      body: input.bytes,
      contentType: input.contentType,
      idempotencyKey: input.idempotencyKey,
      headers: { "x-file-name": encodeURIComponent(input.fileName) },
    },
    isImage,
  );
}
```

Check `getAdminApi`'s exact signature in `client.ts` and adapt the generic if it differs (`getAdminApi<T>(path, isValid)` returning `ApiResult<T>` is what `store-settings.ts` uses).

`apps/admin-web/src/lib/storefront-revalidate.ts`:

```ts
import { currentTenantRef } from "@/lib/api/client";
import { requireProdEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const TIMEOUT_MS = 2_000;

/**
 * Decision 33 / spec 1.11: after a save that changes the live storefront, ask the storefront to drop
 * its cached shell for this shop. Best effort: 2 s timeout, never throws, never fails the action
 * (the storefront's 60 s TTL is the safety net). The secret is never logged.
 */
export async function revalidateStorefront(shopId: string = currentTenantRef()): Promise<boolean> {
  try {
    const secret = requireProdEnv("STOREFRONT_REVALIDATE_SECRET", "");
    const base = (
      process.env["STOREFRONT_INTERNAL_URL"]?.trim() ||
      process.env["STOREFRONT_URL"]?.trim() ||
      ""
    ).replace(/\/+$/, "");
    if (secret === "" || base === "") return false;
    const response = await fetchWithTimeout(
      `${base}/api/revalidate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": secret },
        body: JSON.stringify({ shopId }),
        cache: "no-store",
      },
      TIMEOUT_MS,
    );
    if (!response.ok) console.warn("storefront revalidation refused", { status: response.status });
    return response.ok;
  } catch (error) {
    console.warn("storefront revalidation failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
```

`apps/admin-web/src/lib/online-store/codes.ts`:

```ts
/** Ruling 9: the API prefixes its messages with `CODE:`; a conflict carries only the message. */
export function codeOf(message: string): string | null {
  return /^([A-Z][A-Z_]+):/.exec(message)?.[1] ?? null;
}
```

`apps/admin-web/src/lib/online-store/upload-rules.ts` (pure, safe in client components):

```ts
import type { OnlineStoreImagePurpose } from "@/lib/api/online-store";

const MB = 1024 * 1024;

/** A mirror of the server's per-purpose policy (spec 1.7) for a friendly early message only. */
export const UPLOAD_RULES: Readonly<
  Record<OnlineStoreImagePurpose, { readonly types: readonly string[]; readonly maxBytes: number }>
> = {
  logo: { types: ["image/png", "image/webp", "image/jpeg"], maxBytes: 2 * MB },
  favicon: { types: ["image/png"], maxBytes: 1 * MB },
  share_image: { types: ["image/jpeg", "image/png"], maxBytes: 5 * MB },
  section_image: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8 * MB },
};

export function checkUpload(
  file: { readonly type: string; readonly size: number },
  purpose: OnlineStoreImagePurpose,
): "ok" | "too_large" | "unsupported" {
  const rule = UPLOAD_RULES[purpose];
  if (!rule.types.includes(file.type)) return "unsupported";
  return file.size > rule.maxBytes ? "too_large" : "ok";
}
```

(`import type` only — this file is imported by client components.)

- [ ] **Step 5: Navigation, role gates, CSP, revalidation after Settings → General**

`components/navigation.ts`:

```ts
export const ONLINE_STORE_NAV: NavItem = {
  id: "online-store",
  label: (t) => t.nav.onlineStore,
  href: "/online-store/themes",
  Icon: StoreIcon,
  children: [
    {
      id: "online-store-themes",
      label: (t) => t.nav.themes,
      href: "/online-store/themes",
      Icon: PaletteIcon,
    },
    { id: "pages", label: (t) => t.nav.pages, href: "/pages", Icon: FileIcon },
    {
      id: "online-store-preferences",
      label: (t) => t.nav.preferences,
      href: "/online-store/preferences",
      Icon: SlidersHorizontalIcon,
    },
    { id: "seo", label: (t) => t.nav.seo, href: "/seo/profiles", Icon: SearchIcon },
  ],
};
```

(import `SlidersHorizontalIcon` from `lucide-react`). Add to `PLATFORM_TOOLS_NAV`, first entry: `{ id: "theme", label: (t) => t.nav.themeTokens, href: "/theme", Icon: PaletteIcon },` — the existing `/theme` pages keep `activeNavId="theme"` and their routes (spec 1.11).

`middleware.ts` — in `ROUTE_ROLE_REQUIREMENTS`, before `["/theme/new", "operator"]`:

```ts
  ["/online-store/themes/customize", "operator"],
  ["/online-store", "viewer"],
```

`next.config.ts` — after `mediaOrigin`: `const storefrontOrigin = authOrigin("STOREFRONT_URL", "");` and add to `CONTENT_SECURITY_POLICY`, after the `connect-src` line:

```ts
  // Ruling 18: the customize editor frames the storefront preview, which runs on the shop's primary
  // hostname (any verified custom domain). The framed page's own frame-ancestors is the control.
  ["frame-src 'self' https:", storefrontOrigin].filter((part) => part.length > 0).join(" "),
```

and add `"@platform/storefront-content"` to `transpilePackages`.

`app/settings/general/actions.ts`: after `revalidatePath("/settings/general");` add `await revalidateStorefront();` (import from `@/lib/storefront-revalidate`) — the store name is in the cached shell (Ruling 24).

- [ ] **Step 6: Dictionaries (admin-web Arabic is Egyptian)**

`messages/ar.ts`: `brand: "مربح"`; replace "وموربيه" with "ومربح" in `contactEmailHint`, and "موربيه" with "مربح" in the platform-tools body (three occurrences in total).

Add to `nav` in `en.ts` / `ar.ts`:

```ts
    themes: "Themes",                 // ar: "الثيمات"
    preferences: "Preferences",       // ar: "التفضيلات"
    themeTokens: "Theme tokens (raw)", // ar: "توكنز الثيم (خام)"
```

Add a new section `onlineStorePreferences` — `en.ts`:

```ts
  onlineStorePreferences: {
    title: "Preferences",
    subtitle: "How your store appears in search results and when it is shared.",
    storeNameLabel: "Store name",
    changeStoreName: "Change in Settings → General",
    homeTitleCard: "Home page title and meta description",
    homeTitle: "Home page title",
    homeDescription: "Home page meta description",
    arabic: "Arabic",
    english: "English",
    counter: "{count}/{max}",
    searchPreview: "Search engine listing preview",
    shareCard: "Social sharing image",
    shareHint: "Shown when your store link is shared on WhatsApp, Facebook and others. Recommended size: 1200 × 630 px, JPG or PNG.",
    shareRemove: "Remove image",
    languageCard: "Store language",
    languageHint: "Customers see this language first. They can switch at any time.",
    languageArabic: "Arabic",
    languageEnglish: "English",
    save: "Save",
    saving: "Saving…",
    saved: "Saved. Changes reach your store within a minute.",
    conflict: "This was changed in another window. Reload to continue.",
    passwordCard: "Password protection",
    lockSwitch: "Restrict access to visitors with the password",
    newPassword: "Set new password",
    passwordHint: "4 to 100 characters. Leave empty to keep the current password.",
    passwordSetOn: "Password set on {date}",
    passwordNotSet: "No password set yet",
    visitorMessage: "Message for your visitors",
    accessNote: "Changes reach your store within a minute.",
    adminOnly: "Only admins can change password protection.",
    passwordRequired: "Set a password before locking the store.",
    passwordLength: "Use 4 to 100 characters.",
    upload: "Upload image",
    uploading: "Uploading…",
    uploadErrors: {
      unavailable: "Image storage isn't set up yet.",
      too_large: "This image is too large.",
      unsupported: "This image type isn't accepted here.",
      bad_dimensions: "This image's size doesn't fit here.",
      forbidden: "You don't have permission to upload images.",
      failed: "The upload failed. Try again.",
    },
  },
```

`ar.ts` (Egyptian):

```ts
  onlineStorePreferences: {
    title: "التفضيلات",
    subtitle: "إزاي متجرك بيظهر في نتايج البحث ولما حد يشاركه.",
    storeNameLabel: "اسم المتجر",
    changeStoreName: "غيّره من الإعدادات ← عام",
    homeTitleCard: "عنوان الصفحة الرئيسية ووصفها",
    homeTitle: "عنوان الصفحة الرئيسية",
    homeDescription: "وصف الصفحة الرئيسية",
    arabic: "عربي",
    english: "إنجليزي",
    counter: "{count}/{max}",
    searchPreview: "شكل متجرك في نتايج البحث",
    shareCard: "صورة المشاركة",
    shareHint: "بتظهر لما حد يبعت لينك متجرك على واتساب أو فيسبوك. المقاس المناسب ١٢٠٠ × ٦٣٠، JPG أو PNG.",
    shareRemove: "شيل الصورة",
    languageCard: "لغة المتجر",
    languageHint: "العميل هيشوف اللغة دي الأول، ويقدر يغيّرها في أي وقت.",
    languageArabic: "العربي",
    languageEnglish: "الإنجليزي",
    save: "احفظ",
    saving: "بنحفظ…",
    saved: "اتحفظ. التغيير هيوصل للمتجر في خلال دقيقة.",
    conflict: "حد عدّل هنا من شباك تاني. اعمل ريفرش وكمّل.",
    passwordCard: "حماية بكلمة سر",
    lockSwitch: "اقفل المتجر وخلّي الدخول بكلمة سر بس",
    newPassword: "كلمة سر جديدة",
    passwordHint: "من ٤ لـ ١٠٠ حرف. سيبها فاضية لو مش عايز تغيّرها.",
    passwordSetOn: "اتعملت كلمة السر يوم {date}",
    passwordNotSet: "لسه مفيش كلمة سر",
    visitorMessage: "رسالة للزوار",
    accessNote: "التغيير هيوصل للمتجر في خلال دقيقة.",
    adminOnly: "الأدمن بس هو اللي يقدر يغيّر حماية كلمة السر.",
    passwordRequired: "اعمل كلمة سر الأول قبل ما تقفل المتجر.",
    passwordLength: "من ٤ لـ ١٠٠ حرف.",
    upload: "ارفع صورة",
    uploading: "بنرفع…",
    uploadErrors: {
      unavailable: "تخزين الصور لسه مش متظبط.",
      too_large: "الصورة دي كبيرة أوي.",
      unsupported: "نوع الصورة ده مش مقبول هنا.",
      bad_dimensions: "مقاس الصورة مش مناسب هنا.",
      forbidden: "معندكش صلاحية ترفع صور.",
      failed: "الرفع مانجحش. جرّب تاني.",
    },
  },
```

Add `"onlineStorePreferences.counter"` to `SHARED_VERBATIM` in `lib/i18n.test.ts` (placeholders only).

- [ ] **Step 7: The shared upload action and the Preferences actions**

`apps/admin-web/src/app/online-store/actions.ts`:

```ts
"use server";

import {
  uploadOnlineStoreImage,
  type OnlineStoreImageDto,
  type OnlineStoreImagePurpose,
} from "@/lib/api/online-store";
import { newIdempotencyKey } from "@/lib/api/mutation";
import { checkUpload } from "@/lib/online-store/upload-rules";

export type OnlineStoreUploadState =
  | { readonly status: "ok"; readonly image: OnlineStoreImageDto }
  | {
      readonly status: "error";
      readonly reason:
        "unavailable" | "too_large" | "unsupported" | "bad_dimensions" | "forbidden" | "failed";
    };

const PURPOSES: readonly OnlineStoreImagePurpose[] = [
  "logo",
  "favicon",
  "share_image",
  "section_image",
];

/** Ruling 19: the original bytes are sent (no WebP re-encode); the server sniffs and decides. */
export async function uploadOnlineStoreImageAction(
  formData: FormData,
): Promise<OnlineStoreUploadState> {
  const file = formData.get("file");
  const purpose = formData.get("purpose");
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    !PURPOSES.includes(purpose as OnlineStoreImagePurpose)
  )
    return { status: "error", reason: "unsupported" };
  const early = checkUpload(file, purpose as OnlineStoreImagePurpose);
  if (early !== "ok") return { status: "error", reason: early };
  const result = await uploadOnlineStoreImage({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    fileName: file.name,
    purpose: purpose as OnlineStoreImagePurpose,
    idempotencyKey: newIdempotencyKey(),
  });
  switch (result.outcome) {
    case "ok":
      return { status: "ok", image: result.data };
    case "unauthorized":
      return { status: "error", reason: "forbidden" };
    case "unavailable":
    case "too_large":
    case "unsupported":
      return { status: "error", reason: result.outcome };
    case "invalid":
      return { status: "error", reason: "bad_dimensions" };
    default:
      return { status: "error", reason: "failed" };
  }
}
```

`apps/admin-web/src/app/online-store/actions.test.ts` asserts: a JPEG favicon is refused locally (`unsupported`) without calling the API; a PNG favicon calls `uploadOnlineStoreImage` with `purpose: "favicon"` and the file's own `contentType` (no re-encode); `invalid` → `bad_dimensions`; `unauthorized` → `forbidden`. (Mock `@/lib/api/online-store` as the preferences test does.)

`apps/admin-web/src/app/online-store/preferences/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { updateAccess, updatePreferences } from "@/lib/api/online-store";
import { newIdempotencyKey, toFormState, type FormState } from "@/lib/api/mutation";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { codeOf } from "@/lib/online-store/codes";
import { revalidateStorefront } from "@/lib/storefront-revalidate";

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const localized = (formData: FormData, name: string) => ({
  ar: text(formData, `${name}.ar`),
  en: text(formData, `${name}.en`),
});
const version = (formData: FormData): number => {
  const n = Number(text(formData, "expectedVersion"));
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

async function dictionary() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return dictionaryFor(isLocale(stored) ? stored : DEFAULT_LOCALE);
}

export async function savePreferencesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const shareImageId = text(formData, "shareImageId").trim();
  const result = await updatePreferences(
    {
      homeTitle: localized(formData, "homeTitle"),
      homeMetaDescription: localized(formData, "homeMetaDescription"),
      shareImageId: shareImageId === "" ? null : shareImageId,
      defaultLocale: text(formData, "defaultLocale") === "en" ? "en" : "ar",
      expectedVersion: version(formData),
    },
    newIdempotencyKey(),
  );
  if (result.outcome === "conflict" && codeOf(result.message) === "VERSION_CONFLICT") {
    return { status: "error", message: t.onlineStorePreferences.conflict, fieldErrors: {} };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath("/online-store/preferences");
  await revalidateStorefront();
  return { status: "success" };
}

/** Admin only (the API enforces it). An empty password field keeps the current one (Ruling 10). */
export async function saveAccessAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await dictionary();
  const password = text(formData, "password");
  const result = await updateAccess(
    {
      locked: formData.get("locked") === "on",
      password: password.trim() === "" ? null : password,
      message: localized(formData, "message"),
      expectedVersion: version(formData),
    },
    newIdempotencyKey(),
  );
  if (result.outcome === "conflict" && codeOf(result.message) === "VERSION_CONFLICT") {
    return { status: "error", message: t.onlineStorePreferences.conflict, fieldErrors: {} };
  }
  if (result.outcome === "invalid") {
    const code = codeOf(result.message);
    const message =
      code === "PASSWORD_REQUIRED"
        ? t.onlineStorePreferences.passwordRequired
        : code === "PASSWORD_LENGTH"
          ? t.onlineStorePreferences.passwordLength
          : null;
    if (message !== null) return { status: "error", message, fieldErrors: { password: message } };
  }
  if (result.outcome !== "ok") return toFormState(result, t.formErrors);
  revalidatePath("/online-store/preferences");
  await revalidateStorefront();
  return { status: "success" };
}
```

(The tests mock `next/headers` without a cookie, so `DEFAULT_LOCALE` — `"en"` in admin-web — gives the English messages the test expects.)

- [ ] **Step 8: The Preferences page and its client components**

`apps/admin-web/src/components/online-store/localized-text-field.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input, Label, Textarea } from "@platform/ui";
import type { LocalizedText } from "@platform/storefront-content";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * ar/en tabs over ONE field (spec 1.11). Both inputs stay mounted (the hidden one too), so the form
 * always submits `<name>.ar` and `<name>.en`. Counters are formatted for the admin's locale.
 */
export function LocalizedTextField({
  t,
  locale,
  name,
  label,
  max,
  value,
  multiline = false,
  disabled = false,
  onChange,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly name: string;
  readonly label: string;
  readonly max: number;
  readonly value: LocalizedText;
  readonly multiline?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (value: LocalizedText) => void;
}) {
  const [tab, setTab] = useState<"ar" | "en">("ar");
  const [current, setCurrent] = useState<{ ar: string; en: string }>({
    ar: value.ar ?? "",
    en: value.en ?? "",
  });
  const number = new Intl.NumberFormat(locale);
  const set = (key: "ar" | "en", text: string) => {
    const next = { ...current, [key]: text };
    setCurrent(next);
    onChange?.({
      ...(next.ar === "" ? {} : { ar: next.ar }),
      ...(next.en === "" ? {} : { en: next.en }),
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${name}-${tab}`}>{label}</Label>
        <div role="tablist" className="flex gap-1 text-xs">
          {(["ar", "en"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "bg-secondary rounded-md px-2 py-0.5 font-medium"
                  : "text-muted-foreground px-2 py-0.5"
              }
            >
              {key === "ar" ? t.onlineStorePreferences.arabic : t.onlineStorePreferences.english}
            </button>
          ))}
        </div>
      </div>
      {(["ar", "en"] as const).map((key) => {
        const common = {
          id: `${name}-${key}`,
          name: `${name}.${key}`,
          dir: key === "ar" ? "rtl" : "ltr",
          lang: key,
          value: current[key],
          disabled,
          hidden: tab !== key,
          maxLength: max * 2,
        };
        return multiline ? (
          <Textarea key={key} {...common} onChange={(e) => set(key, e.currentTarget.value)} />
        ) : (
          <Input key={key} {...common} onChange={(e) => set(key, e.currentTarget.value)} />
        );
      })}
      <p
        className={
          current[tab].length > max ? "text-destructive text-xs" : "text-muted-foreground text-xs"
        }
      >
        {t.onlineStorePreferences.counter
          .replace("{count}", number.format(current[tab].length))
          .replace("{max}", number.format(max))}
      </p>
    </div>
  );
}
```

`apps/admin-web/src/components/online-store/image-upload-field.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@platform/ui";
import { uploadOnlineStoreImageAction } from "@/app/online-store/actions";
import type { OnlineStoreImageDto, OnlineStoreImagePurpose } from "@/lib/api/online-store";
import { UPLOAD_RULES } from "@/lib/online-store/upload-rules";
import type { Dictionary } from "@/messages/en";

/** Upload → returns the media id; `name` (if given) carries it in the surrounding form. */
export function ImageUploadField({
  t,
  purpose,
  name,
  image,
  disabled = false,
  onChange,
}: {
  readonly t: Dictionary;
  readonly purpose: OnlineStoreImagePurpose;
  readonly name?: string;
  readonly image: (OnlineStoreImageDto & { readonly id: string }) | null;
  readonly disabled?: boolean;
  readonly onChange: (image: (OnlineStoreImageDto & { readonly id: string }) | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", purpose);
    start(async () => {
      const result = await uploadOnlineStoreImageAction(form);
      if (result.status === "ok" && typeof result.image.id === "string") {
        setError(null);
        onChange({ ...result.image, id: result.image.id });
      } else if (result.status === "error") {
        setError(t.onlineStorePreferences.uploadErrors[result.reason]);
      }
      if (input.current !== null) input.current.value = "";
    });
  };
  return (
    <div className="flex flex-col gap-2">
      {name === undefined ? null : <input type="hidden" name={name} value={image?.id ?? ""} />}
      {image === null ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={image.alt ?? ""}
          className="border-border max-h-32 w-auto rounded-lg border object-contain"
        />
      )}
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept={UPLOAD_RULES[purpose].types.join(",")}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => onFile(e.currentTarget.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          loading={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? t.onlineStorePreferences.uploading : t.onlineStorePreferences.upload}
        </Button>
        {image === null || disabled ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t.onlineStorePreferences.shareRemove}
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
```

`apps/admin-web/src/components/online-store/preferences-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { pickText, type LocalizedText } from "@platform/storefront-content";
import { savePreferencesAction } from "@/app/online-store/preferences/actions";
import type { OnlineStoreImageDto, PreferencesDto } from "@/lib/api/online-store";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ImageUploadField } from "./image-upload-field";
import { LocalizedTextField } from "./localized-text-field";

const IDLE: FormState = { status: "idle" };

export function PreferencesForm({
  t,
  locale,
  preferences,
  canEdit,
  storefrontUrl,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly preferences: PreferencesDto;
  readonly canEdit: boolean;
  readonly storefrontUrl: string | null;
}) {
  const p = t.onlineStorePreferences;
  const [state, action, pending] = useActionState(savePreferencesAction, IDLE);
  const [title, setTitle] = useState<LocalizedText>(preferences.homeTitle);
  const [description, setDescription] = useState<LocalizedText>(preferences.homeMetaDescription);
  const [share, setShare] = useState<(OnlineStoreImageDto & { id: string }) | null>(
    preferences.shareImage === null || preferences.shareImage.id === undefined
      ? null
      : { ...preferences.shareImage, id: preferences.shareImage.id },
  );
  const shownTitle = pickText(title, locale) ?? preferences.storeName;
  const shownDescription = pickText(description, locale) ?? "";
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="expectedVersion" value={preferences.version} />
      <Card>
        <CardHeader>
          <CardTitle>{p.storeNameLabel}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <bdi dir="auto" className="font-medium">
            {preferences.storeName}
          </bdi>
          <Link href="/settings/general" className="text-primary text-sm underline">
            {p.changeStoreName}
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.homeTitleCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LocalizedTextField
            t={t}
            locale={locale}
            name="homeTitle"
            label={p.homeTitle}
            max={70}
            value={preferences.homeTitle}
            disabled={!canEdit}
            onChange={setTitle}
          />
          <LocalizedTextField
            t={t}
            locale={locale}
            name="homeMetaDescription"
            label={p.homeDescription}
            max={320}
            value={preferences.homeMetaDescription}
            multiline
            disabled={!canEdit}
            onChange={setDescription}
          />
          <section aria-label={p.searchPreview} className="bg-surface rounded-lg p-3">
            <p className="text-muted-foreground text-xs" dir="ltr">
              {storefrontUrl ?? ""}
            </p>
            <p className="text-info-foreground truncate text-base" dir="auto">
              <bdi>{shownTitle}</bdi>
            </p>
            <p className="text-muted-foreground line-clamp-2 text-sm" dir="auto">
              <bdi>{shownDescription}</bdi>
            </p>
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.shareCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">{p.shareHint}</p>
          <ImageUploadField
            t={t}
            purpose="share_image"
            name="shareImageId"
            image={share}
            disabled={!canEdit}
            onChange={setShare}
          />
          <div className="border-border max-w-sm overflow-hidden rounded-lg border">
            {share === null ? null : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={share.url} alt="" className="aspect-[1200/630] w-full object-cover" />
            )}
            <div className="bg-surface p-2 text-sm">
              <p className="font-medium" dir="auto">
                <bdi>{shownTitle}</bdi>
              </p>
              <p className="text-muted-foreground line-clamp-1" dir="auto">
                <bdi>{shownDescription}</bdi>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{p.languageCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{p.languageHint}</p>
          {(["ar", "en"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="defaultLocale"
                value={value}
                defaultChecked={preferences.defaultLocale === value}
                disabled={!canEdit}
              />
              {value === "ar" ? p.languageArabic : p.languageEnglish}
            </label>
          ))}
        </CardContent>
      </Card>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-success-foreground text-sm">
          {p.saved}
        </p>
      ) : null}
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            {pending ? p.saving : p.save}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
```

`apps/admin-web/src/components/online-store/password-protection-card.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@platform/ui";
import { saveAccessAction } from "@/app/online-store/preferences/actions";
import type { AccessDto } from "@/lib/api/online-store";
import type { FormState } from "@/lib/api/mutation";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { LocalizedTextField } from "./localized-text-field";

const IDLE: FormState = { status: "idle" };

/** Admin-only lock (Decision 9). Others see the same card read-only with a hint. */
export function PasswordProtectionCard({
  t,
  locale,
  access,
  isAdmin,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly access: AccessDto;
  readonly isAdmin: boolean;
}) {
  const p = t.onlineStorePreferences;
  const [state, action, pending] = useActionState(saveAccessAction, IDLE);
  const [locked, setLocked] = useState(access.locked);
  const setOn =
    access.passwordUpdatedAt === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(access.passwordUpdatedAt),
        );
  return (
    <form action={action}>
      <input type="hidden" name="expectedVersion" value={access.version} />
      <Card>
        <CardHeader>
          <CardTitle>{p.passwordCard}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch
              name="locked"
              checked={locked}
              onCheckedChange={setLocked}
              disabled={!isAdmin}
            />
            {p.lockSwitch}
          </label>
          <p className="text-muted-foreground text-sm">
            {access.passwordSet && setOn !== null
              ? p.passwordSetOn.replace("{date}", setOn)
              : p.passwordNotSet}
          </p>
          {isAdmin ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="storefront-password">{p.newPassword}</Label>
              <Input
                id="storefront-password"
                name="password"
                type="password"
                autoComplete="new-password"
                defaultValue=""
                maxLength={100}
                aria-invalid={state.status === "error" && "password" in state.fieldErrors}
              />
              <p className="text-muted-foreground text-xs">{p.passwordHint}</p>
            </div>
          ) : null}
          <LocalizedTextField
            t={t}
            locale={locale}
            name="message"
            label={p.visitorMessage}
            max={500}
            value={access.message}
            multiline
            disabled={!isAdmin}
          />
          <p className="text-muted-foreground text-xs">{isAdmin ? p.accessNote : p.adminOnly}</p>
          {state.status === "error" ? (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          ) : null}
          {state.status === "success" ? (
            <p role="status" className="text-success-foreground text-sm">
              {p.saved}
            </p>
          ) : null}
          {isAdmin ? (
            <div className="flex justify-end">
              <Button type="submit" loading={pending}>
                {pending ? p.saving : p.save}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </form>
  );
}
```

`apps/admin-web/src/app/online-store/preferences/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { AlertTriangleIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PasswordProtectionCard } from "@/components/online-store/password-protection-card";
import { PreferencesForm } from "@/components/online-store/preferences-form";
import { fetchAccess, fetchPreferences } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Online Store → Preferences (spec 1.11). Viewer-readable; edits need operator; the lock needs admin. */
export default async function OnlineStorePreferencesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, preferences, access] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchPreferences(),
    fetchAccess(),
  ]);
  const role = highestRole(session?.roles ?? []);
  const canEdit = role === "operator" || role === "admin";
  const storefrontUrl = process.env["STOREFRONT_URL"]?.trim() || null;
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-preferences" user={user}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.onlineStorePreferences.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.onlineStorePreferences.subtitle}</p>
        </header>
        {preferences.outcome === "ok" ? (
          <PreferencesForm
            t={t}
            locale={locale}
            preferences={preferences.data}
            canEdit={canEdit}
            storefrontUrl={storefrontUrl}
          />
        ) : (
          <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
            <AlertTriangleIcon className="size-4" aria-hidden="true" />
            {t.formErrors.unexpected}
          </p>
        )}
        {access.outcome === "ok" ? (
          <PasswordProtectionCard
            t={t}
            locale={locale}
            access={access.data}
            isAdmin={role === "admin"}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
```

(Check `readSession()`'s return shape in `lib/auth/session.ts`; `roles` is what `getCurrentUser` already reads.)

- [ ] **Step 9: Run, typecheck, lint, client-bundle grep**

Run: `pnpm install`
Run: `pnpm --filter @platform/ui test && pnpm --filter @platform/ui typecheck && pnpm --filter @platform/ui lint`
Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
Run the client-bundle grep from Commands — only the three known pre-existing hits (`upload-rules.ts` and the components use `import type` from `@/lib/api/online-store`).
Run: `grep -rn "موربيه" apps/admin-web/src` — nothing.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src apps/admin-web/package.json apps/admin-web/next.config.ts apps/admin-web/src/next-config.test.ts \
  apps/admin-web/src/lib/api/client.ts apps/admin-web/src/lib/api/media.ts apps/admin-web/src/lib/api/online-store.ts \
  apps/admin-web/src/lib/api/online-store.test.ts apps/admin-web/src/lib/storefront-revalidate.ts \
  apps/admin-web/src/lib/storefront-revalidate.test.ts apps/admin-web/src/lib/online-store \
  apps/admin-web/src/lib/i18n.test.ts apps/admin-web/src/components/navigation.ts \
  apps/admin-web/src/components/navigation.test.tsx apps/admin-web/src/middleware.ts apps/admin-web/src/middleware.test.ts \
  apps/admin-web/src/app/settings/general apps/admin-web/src/app/online-store/actions.ts \
  apps/admin-web/src/app/online-store/actions.test.ts apps/admin-web/src/app/online-store/preferences \
  apps/admin-web/src/components/online-store apps/admin-web/src/messages pnpm-lock.yaml
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add Online Store preferences, the online-store API client and storefront revalidation

Form primitives in @platform/ui, the Online Store navigation and role gates, a frame-src for the
preview, the Preferences screen with the admin-only password lock, and the brand مربح.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: admin-web — Online Store → Themes and the customize editor (autosave, live preview, publish)

Model tier: **strong** (concurrency in the UI: debounce, one request in flight, 409 handling, publish binding).

**Files:**

- Create: `apps/admin-web/src/lib/online-store/autosave.ts`, `autosave.test.ts`
- Create: `apps/admin-web/src/app/online-store/themes/page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/app/online-store/themes/customize/page.tsx`, `layout.tsx`
- Create: `apps/admin-web/src/components/online-store/theme-card.tsx`, `theme-card.test.tsx`, `release-history.tsx`
- Create: `apps/admin-web/src/components/online-store/customize-editor.tsx`, `customize-panels.tsx`, `customize-editor.test.tsx`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts` (`onlineStoreThemes`, `onlineStoreCustomize`)
- Modify: `apps/admin-web/package.json` (five `@fontsource/*` families)

**Interfaces:**

- Consumes: Task 10 (`fetchThemeState`, `saveThemeDraft`, `publishTheme`, `discardThemeDraft`, `restoreThemeRelease`, `fetchThemeReleases`, `issuePreviewToken`, `fetchAccess`, `fetchPreferences`, `ThemeStateDto`, `ReleaseDto`, `codeOf`, `revalidateStorefront`, `ImageUploadField`, `LocalizedTextField`, `ColorField`, `NativeSelect`, `Switch`); Task 1 (`ThemeDocument`, `checkBrandContrast`, `bestTextOn`, `FONT_KEYS`, `FONT_FAMILIES`, `fontStack`, `SOCIAL_NETWORKS`, `COLOR_KEYS`, `LOGO_WIDTH`, `BASE_SIZES`, `CORNER_STYLES`, `RADIUS_SCALES`).
- Produces:
  - `createAutosaver<T>({ delayMs, save, onState }): { schedule(value: T): void; flush(): Promise<void>; dispose(): void }`, `type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict"`, `type SaveOutcome = "ok" | "conflict" | "error"`.
  - Server actions: `saveThemeDraftAction({ document, expectedVersion }): Promise<DraftSaveResult>`, `publishThemeAction(expectedDraftRevision): Promise<PublishActionResult>`, `discardThemeDraftAction(expectedVersion)`, `restoreReleaseAction(releaseNumber, expectedVersion)`, `previewUrlAction(): Promise<{ status: "ok"; url: string; expiresAt: string } | { status: "error" }>`.
  - Components: `ThemeCard`, `ReleaseHistory`, `CustomizeEditor`.

- [ ] **Step 1: Write the failing tests**

`apps/admin-web/src/lib/online-store/autosave.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type AutosaveState, type SaveOutcome } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(outcomes: (() => Promise<SaveOutcome>)[] = []) {
  const saved: string[] = [];
  const states: AutosaveState[] = [];
  const saver = createAutosaver<string>({
    delayMs: 1000,
    save: (value) => {
      saved.push(value);
      return (outcomes.shift() ?? (async () => "ok"))();
    },
    onState: (s) => states.push(s),
  });
  return { saver, saved, states };
}

describe("createAutosaver (Decision 36)", () => {
  it("saves once, 1 s after the LAST change, with the latest value", async () => {
    const { saver, saved, states } = setup();
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["b"]);
    expect(states).toEqual(["saving", "saved"]);
  });

  it("keeps one request in flight; a change made meanwhile saves right after", async () => {
    let release!: (o: SaveOutcome) => void;
    const { saver, saved } = setup([() => new Promise<SaveOutcome>((r) => (release = r))]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toEqual(["a"]);
    release("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["a", "b"]);
  });

  it("stops on a conflict and ignores later changes", async () => {
    const { saver, saved, states } = setup([async () => "conflict"]);
    saver.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.schedule("b");
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual(["a"]);
    expect(states.at(-1)).toBe("conflict");
  });

  it("flush saves now (used before Publish and Preview)", async () => {
    const { saver, saved } = setup();
    saver.schedule("a");
    await saver.flush();
    expect(saved).toEqual(["a"]);
  });
});
```

`apps/admin-web/src/app/online-store/themes/actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  saveThemeDraft: vi.fn(),
  publishTheme: vi.fn(),
  discardThemeDraft: vi.fn(),
  restoreThemeRelease: vi.fn(),
  issuePreviewToken: vi.fn(),
}));
const side = vi.hoisted(() => ({ revalidateStorefront: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/api/online-store", () => api);
vi.mock("@/lib/storefront-revalidate", () => ({ revalidateStorefront: side.revalidateStorefront }));
vi.mock("next/cache", () => ({ revalidatePath: side.revalidatePath }));
const actions = await import("./actions");

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  side.revalidateStorefront.mockReset().mockResolvedValue(true);
  vi.stubEnv("STOREFRONT_URL", "https://shop.example/");
});
afterEach(() => vi.unstubAllEnvs());

describe("theme actions", () => {
  it("draft save maps ok, VERSION_CONFLICT and field issues", async () => {
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "ok",
      data: { draftRevision: 4, version: 7, warnings: [] },
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({ status: "ok", draftRevision: 4, version: 7, warnings: [] });
    expect(api.saveThemeDraft).toHaveBeenCalledWith({}, 6, expect.any(String));
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "conflict",
      message: "VERSION_CONFLICT: x",
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({ status: "conflict" });
    api.saveThemeDraft.mockResolvedValueOnce({
      outcome: "invalid",
      message: "INVALID_CONTENT: x",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    expect(
      await actions.saveThemeDraftAction({ document: {} as never, expectedVersion: 6 }),
    ).toEqual({
      status: "invalid",
      fields: [{ field: "brand.colors.primary", message: "INVALID_COLOR" }],
    });
    expect(side.revalidateStorefront).not.toHaveBeenCalled(); // a draft never changes the live store
  });

  it("publish: DRAFT_CHANGED and NOTHING_TO_PUBLISH are distinct; only success revalidates the storefront", async () => {
    api.publishTheme.mockResolvedValueOnce({ outcome: "conflict", message: "DRAFT_CHANGED: x" });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "draft_changed" });
    api.publishTheme.mockResolvedValueOnce({
      outcome: "conflict",
      message: "NOTHING_TO_PUBLISH: x",
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "nothing_to_publish" });
    api.publishTheme.mockResolvedValueOnce({ outcome: "forbidden" });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "forbidden" });
    expect(side.revalidateStorefront).not.toHaveBeenCalled();
    api.publishTheme.mockResolvedValueOnce({
      outcome: "ok",
      data: { releaseNumber: 2, publishedAt: "2026-10-27T10:00:00.000Z" },
    });
    expect(await actions.publishThemeAction(3)).toEqual({ status: "ok", releaseNumber: 2 });
    expect(side.revalidateStorefront).toHaveBeenCalledTimes(1);
  });

  it("preview url: the primary-host url, else STOREFRONT_URL + ?preview=, else an error", async () => {
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "a/b", expiresAt: "x", url: "https://nour.example/?preview=tok" },
    });
    expect(await actions.previewUrlAction()).toEqual({
      status: "ok",
      url: "https://nour.example/?preview=tok",
      expiresAt: "x",
    });
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "a/b", expiresAt: "x", url: null },
    });
    expect(await actions.previewUrlAction()).toEqual({
      status: "ok",
      url: "https://shop.example/?preview=a%2Fb",
      expiresAt: "x",
    });
    vi.stubEnv("STOREFRONT_URL", "");
    api.issuePreviewToken.mockResolvedValueOnce({
      outcome: "ok",
      data: { token: "t", expiresAt: "x", url: null },
    });
    expect(await actions.previewUrlAction()).toEqual({ status: "error" });
  });
});
```

`apps/admin-web/src/components/online-store/theme-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { en } from "@/messages/en";

vi.mock("@/app/online-store/themes/actions", () => ({
  publishThemeAction: vi.fn(),
  previewUrlAction: vi.fn(),
  restoreReleaseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ThemeCard } = await import("./theme-card");

const state = {
  draft: DEFAULT_THEME_DOCUMENT,
  published: null,
  draftRevision: 2,
  draftSavedAt: null,
  publishedDraftRevision: 1,
  releaseNumber: 1,
  publishedAt: "2026-10-20T09:00:00.000Z",
  publishedBy: "staff-1",
  hasUnpublishedChanges: true,
  images: {},
  version: 3,
};

describe("ThemeCard (spec 1.11)", () => {
  it("shows the current theme, the unpublished badge and Customize for operators", () => {
    render(<ThemeCard t={en} locale="en" state={state} role="operator" />);
    expect(screen.getByText("Morbeh Classic")).toBeInTheDocument();
    expect(screen.getByText(en.onlineStoreThemes.unpublishedChanges)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.onlineStoreThemes.customize })).toHaveAttribute(
      "href",
      "/online-store/themes/customize",
    );
  });

  it("Publish is disabled with the admin-only tooltip for operators and enabled for admins", () => {
    const { rerender } = render(<ThemeCard t={en} locale="en" state={state} role="operator" />);
    const publish = screen.getByRole("button", { name: en.onlineStoreThemes.publish });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyPublish);
    rerender(<ThemeCard t={en} locale="en" state={state} role="admin" />);
    expect(screen.getByRole("button", { name: en.onlineStoreThemes.publish })).toBeEnabled();
  });

  it("hides Publish when there is nothing to publish, and Customize for viewers", () => {
    render(
      <ThemeCard
        t={en}
        locale="en"
        state={{ ...state, hasUnpublishedChanges: false }}
        role="viewer"
      />,
    );
    expect(screen.queryByRole("button", { name: en.onlineStoreThemes.publish })).toBeNull();
    expect(screen.queryByRole("link", { name: en.onlineStoreThemes.customize })).toBeNull();
  });
});
```

`apps/admin-web/src/components/online-store/customize-editor.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_THEME_DOCUMENT } from "@platform/storefront-content";
import { en } from "@/messages/en";

const actions = vi.hoisted(() => ({
  saveThemeDraftAction: vi.fn(),
  publishThemeAction: vi.fn(),
  previewUrlAction: vi.fn(),
  discardThemeDraftAction: vi.fn(),
  restoreReleaseAction: vi.fn(),
}));
vi.mock("@/app/online-store/themes/actions", () => actions);
vi.mock("@/app/online-store/actions", () => ({ uploadOnlineStoreImageAction: vi.fn() }));
const { CustomizeEditor } = await import("./customize-editor");

const state = {
  draft: DEFAULT_THEME_DOCUMENT,
  published: null,
  draftRevision: 1,
  draftSavedAt: null,
  publishedDraftRevision: null,
  releaseNumber: 0,
  publishedAt: null,
  publishedBy: null,
  hasUnpublishedChanges: true,
  images: {},
  version: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  actions.previewUrlAction.mockResolvedValue({
    status: "ok",
    url: "https://shop.example/?preview=tok",
    expiresAt: "x",
  });
  actions.saveThemeDraftAction.mockResolvedValue({
    status: "ok",
    draftRevision: 2,
    version: 2,
    warnings: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
  for (const fn of Object.values(actions)) fn.mockReset();
});

const renderEditor = (role: "operator" | "admin" = "admin") =>
  render(<CustomizeEditor t={en} locale="en" state={state} role={role} storeName="Nour" />);

describe("CustomizeEditor", () => {
  it("autosaves 1 s after the last change with the current version, and reloads the preview", async () => {
    renderEditor();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.accent), {
      target: { value: "#ffcc00" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(actions.saveThemeDraftAction).toHaveBeenCalledTimes(1);
    const [arg] = actions.saveThemeDraftAction.mock.calls[0] as [
      { document: typeof DEFAULT_THEME_DOCUMENT; expectedVersion: number },
    ];
    expect(arg.expectedVersion).toBe(1);
    expect(arg.document.brand.colors.primary).toBe("#112233");
    expect(arg.document.brand.colors.accent).toBe("#ffcc00");
    expect(screen.getByText(en.onlineStoreCustomize.saved)).toBeInTheDocument();
    expect(screen.getByTitle(en.onlineStoreCustomize.previewTitle)).toHaveAttribute(
      "src",
      "https://shop.example/?preview=tok&v=2",
    );
  });

  it("a 409 shows the reload message (Decision 36)", async () => {
    actions.saveThemeDraftAction.mockResolvedValue({ status: "conflict" });
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.primary), {
      target: { value: "#112233" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.conflict);
  });

  it("unreadable body text is flagged, and Auto-fix picks black on a light background", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(en.onlineStoreCustomize.colors.foreground), {
      target: { value: "#f8fafc" },
    });
    expect(screen.getByText(en.onlineStoreCustomize.contrastBlocked)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: en.onlineStoreCustomize.autoFix })[0]!);
    expect(screen.getByLabelText(en.onlineStoreCustomize.colors.foreground)).toHaveValue("#000000");
  });

  it("a DRAFT_CHANGED publish shows the reload message (Review Focus 4)", async () => {
    actions.publishThemeAction.mockResolvedValue({ status: "draft_changed" });
    renderEditor("admin");
    fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.publish }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en.onlineStoreCustomize.confirmPublish }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.publishThemeAction).toHaveBeenCalledWith(1);
    expect(screen.getByRole("alert")).toHaveTextContent(en.onlineStoreCustomize.draftChanged);
  });

  it("operators cannot publish", () => {
    renderEditor("operator");
    const publish = screen.getByRole("button", { name: en.onlineStoreCustomize.publish });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("title", en.onlineStoreThemes.adminOnlyPublish);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter admin-web exec vitest run src/lib/online-store/autosave.test.ts src/app/online-store/themes src/components/online-store/theme-card.test.tsx src/components/online-store/customize-editor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The autosaver**

`apps/admin-web/src/lib/online-store/autosave.ts`:

```ts
export type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict";
export type SaveOutcome = "ok" | "conflict" | "error";

/**
 * Decision 36: save `delayMs` after the LAST change, one request in flight at a time, the latest
 * value wins; a conflict stops autosave (the editor asks for a reload) instead of overwriting.
 */
export function createAutosaver<T>(options: {
  readonly delayMs: number;
  readonly save: (value: T) => Promise<SaveOutcome>;
  readonly onState: (state: AutosaveState) => void;
}) {
  let pending: { readonly value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const run = async (): Promise<void> => {
    timer = null;
    if (stopped || pending === null || inFlight !== null) return;
    const { value } = pending;
    pending = null;
    options.onState("saving");
    inFlight = (async () => {
      const outcome = await options.save(value).catch((): SaveOutcome => "error");
      if (outcome === "conflict") {
        stopped = true;
        options.onState("conflict");
      } else if (outcome === "error") {
        options.onState("error");
      } else if (pending === null) {
        options.onState("saved");
      }
    })();
    await inFlight;
    inFlight = null;
    if (!stopped && pending !== null && timer === null) await run();
  };

  return {
    schedule(value: T): void {
      if (stopped) return;
      pending = { value };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), options.delayMs);
    },
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (inFlight !== null) await inFlight;
      await run();
      if (inFlight !== null) await inFlight;
    },
    dispose(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 4: Server actions**

`apps/admin-web/src/app/online-store/themes/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { ContrastWarning, ThemeDocument } from "@platform/storefront-content";
import type { FieldIssue } from "@/lib/api/client";
import { newIdempotencyKey } from "@/lib/api/mutation";
import {
  discardThemeDraft,
  issuePreviewToken,
  publishTheme,
  restoreThemeRelease,
  saveThemeDraft,
} from "@/lib/api/online-store";
import { codeOf } from "@/lib/online-store/codes";
import { revalidateStorefront } from "@/lib/storefront-revalidate";

export type DraftSaveResult =
  | {
      readonly status: "ok";
      readonly draftRevision: number;
      readonly version: number;
      readonly warnings: readonly ContrastWarning[];
    }
  | { readonly status: "conflict" }
  | { readonly status: "invalid"; readonly fields: readonly FieldIssue[] }
  | { readonly status: "error" };

export type PublishActionResult =
  | { readonly status: "ok"; readonly releaseNumber: number }
  | { readonly status: "draft_changed" | "nothing_to_publish" | "forbidden" | "error" };

export type DraftRevisionResult =
  | { readonly status: "ok"; readonly draftRevision: number; readonly version: number }
  | { readonly status: "conflict" | "not_found" | "forbidden" | "error" };

/** A draft never touches the live storefront, so no revalidation here. */
export async function saveThemeDraftAction(input: {
  readonly document: ThemeDocument;
  readonly expectedVersion: number;
}): Promise<DraftSaveResult> {
  const result = await saveThemeDraft(input.document, input.expectedVersion, newIdempotencyKey());
  switch (result.outcome) {
    case "ok":
      return { status: "ok", ...result.data };
    case "conflict":
      return { status: "conflict" };
    case "invalid":
      return { status: "invalid", fields: result.fields };
    default:
      return { status: "error" };
  }
}

export async function publishThemeAction(
  expectedDraftRevision: number,
): Promise<PublishActionResult> {
  const result = await publishTheme(expectedDraftRevision, newIdempotencyKey());
  if (result.outcome === "ok") {
    revalidatePath("/online-store/themes");
    await revalidateStorefront();
    return { status: "ok", releaseNumber: result.data.releaseNumber };
  }
  if (result.outcome === "conflict") {
    const code = codeOf(result.message);
    if (code === "DRAFT_CHANGED") return { status: "draft_changed" };
    if (code === "NOTHING_TO_PUBLISH") return { status: "nothing_to_publish" };
  }
  if (result.outcome === "forbidden" || result.outcome === "unauthorized")
    return { status: "forbidden" };
  return { status: "error" };
}

function revisionResult(
  result: Awaited<ReturnType<typeof discardThemeDraft>>,
): DraftRevisionResult {
  switch (result.outcome) {
    case "ok":
      return { status: "ok", ...result.data };
    case "conflict":
      return { status: "conflict" };
    case "not_found":
      return { status: "not_found" };
    case "forbidden":
    case "unauthorized":
      return { status: "forbidden" };
    default:
      return { status: "error" };
  }
}

export async function discardThemeDraftAction(
  expectedVersion: number,
): Promise<DraftRevisionResult> {
  const result = revisionResult(await discardThemeDraft(expectedVersion, newIdempotencyKey()));
  if (result.status === "ok") revalidatePath("/online-store/themes");
  return result;
}

/** Restore goes into the DRAFT (Decision 29); the live store changes only on Publish. */
export async function restoreReleaseAction(
  releaseNumber: number,
  expectedVersion: number,
): Promise<DraftRevisionResult> {
  const result = revisionResult(
    await restoreThemeRelease(releaseNumber, expectedVersion, newIdempotencyKey()),
  );
  if (result.status === "ok") revalidatePath("/online-store/themes");
  return result;
}

/** Spec 1.6: the API's primary-host url, else STOREFRONT_URL + ?preview=<token>. */
export async function previewUrlAction(): Promise<
  | { readonly status: "ok"; readonly url: string; readonly expiresAt: string }
  | { readonly status: "error" }
> {
  const result = await issuePreviewToken();
  if (result.outcome !== "ok") return { status: "error" };
  if (result.data.url !== null)
    return { status: "ok", url: result.data.url, expiresAt: result.data.expiresAt };
  const base = process.env["STOREFRONT_URL"]?.trim().replace(/\/+$/, "") ?? "";
  if (base === "") return { status: "error" };
  return {
    status: "ok",
    url: `${base}/?preview=${encodeURIComponent(result.data.token)}`,
    expiresAt: result.data.expiresAt,
  };
}
```

- [ ] **Step 5: Dictionaries**

`en.ts` — add:

```ts
  onlineStoreThemes: {
    title: "Themes",
    currentTheme: "Current theme",
    themeName: "Morbeh Classic",
    lastPublished: "Last published {date} by {name}",
    neverPublished: "Not published yet — your store shows the default look.",
    staff: "Staff",
    unpublishedChanges: "Unpublished changes",
    customize: "Customize",
    preview: "Preview",
    publish: "Publish",
    publishTitle: "Publish this theme?",
    publishBody: "This replaces your live store's look.",
    confirmPublish: "Publish",
    cancel: "Cancel",
    adminOnlyPublish: "Only admins can publish",
    published: "Published. Your store updates within a minute.",
    nothingToPublish: "There are no changes to publish.",
    previewFailed: "Couldn't create a preview link. Check STOREFRONT_URL.",
    history: "Release history",
    releaseNumber: "Release",
    releaseDate: "Published",
    releaseBy: "By",
    restore: "Restore to draft",
    restored: "Restored to the draft. Preview it, then publish.",
    noReleases: "No releases yet.",
    lockedBanner: "Your store is password protected.",
    lockedLink: "Manage in Preferences",
    loadError: "Couldn't load the theme. Try refreshing the page.",
  },
  onlineStoreCustomize: {
    exit: "Exit",
    desktop: "Desktop",
    mobile: "Mobile",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Couldn't save",
    conflict: "This theme was changed in another window. Reload to continue.",
    draftChanged: "The draft changed after you previewed it. Preview it again, then publish.",
    preview: "Preview",
    previewTitle: "Store preview",
    publish: "Publish",
    confirmPublish: "Publish",
    publishBody: "This replaces your live store's look.",
    cancel: "Cancel",
    published: "Published",
    logoPanel: "Logo & favicon",
    logo: "Logo",
    logoWidth: "Logo width",
    favicon: "Favicon",
    faviconHint: "Square PNG, at least 32 × 32.",
    colorsPanel: "Colors",
    colors: {
      background: "Background",
      foreground: "Text",
      primary: "Buttons and links",
      primaryForeground: "Text on buttons",
      accent: "Accent",
      accentForeground: "Text on accent",
    },
    hex: "{name} hex code",
    contrastOk: "Readable",
    contrastLow: "Low contrast ({ratio}:1)",
    contrastBlocked: "Unreadable text — choose a darker or lighter color",
    autoFix: "Auto-fix",
    typographyPanel: "Typography",
    headingFont: "Headings font",
    bodyFont: "Body font",
    fontSample: "مربح Morbeh 123",
    baseSize: "Text size",
    sizes: { small: "Small", medium: "Medium", large: "Large" },
    cornersPanel: "Corners",
    corners: { square: "Square", rounded: "Rounded", pill: "Pill" },
    socialPanel: "Social links",
    socialInvalid: "Use a full https:// link.",
    footerPanel: "Header & footer",
    stickyHeader: "Keep the header visible when scrolling",
    footerNote: "Footer note",
    showSocial: "Show social links in the footer",
  },
```

`ar.ts` (Egyptian):

```ts
  onlineStoreThemes: {
    title: "الثيمات",
    currentTheme: "الثيم الحالي",
    themeName: "مربح كلاسيك",
    lastPublished: "آخر نشر {date} بواسطة {name}",
    neverPublished: "لسه ما اتنشرش — المتجر ظاهر بالشكل الافتراضي.",
    staff: "فريق العمل",
    unpublishedChanges: "تعديلات مش منشورة",
    customize: "تخصيص",
    preview: "معاينة",
    publish: "نشر",
    publishTitle: "تنشر الثيم ده؟",
    publishBody: "ده هيغيّر شكل متجرك اللي العملاء شايفينه.",
    confirmPublish: "انشر",
    cancel: "إلغاء",
    adminOnlyPublish: "مسموح للأدمن بس ينشر",
    published: "اتنشر. المتجر هيتحدّث في خلال دقيقة.",
    nothingToPublish: "مفيش تعديلات تتنشر.",
    previewFailed: "معرفناش نعمل لينك معاينة. اتأكد من STOREFRONT_URL.",
    history: "سجل النسخ",
    releaseNumber: "النسخة",
    releaseDate: "اتنشرت",
    releaseBy: "بواسطة",
    restore: "رجّعها للمسودة",
    restored: "رجعت للمسودة. عاينها وبعدين انشر.",
    noReleases: "لسه مفيش نسخ.",
    lockedBanner: "متجرك مقفول بكلمة سر.",
    lockedLink: "اتحكم فيها من التفضيلات",
    loadError: "معرفناش نحمّل الثيم. جرّب تعمل ريفرش.",
  },
  onlineStoreCustomize: {
    exit: "خروج",
    desktop: "كمبيوتر",
    mobile: "موبايل",
    saving: "بنحفظ…",
    saved: "اتحفظ",
    saveError: "ماتحفظش",
    conflict: "الثيم ده اتعدّل من شباك تاني. اعمل ريفرش وكمّل.",
    draftChanged: "المسودة اتغيّرت بعد ما عاينتها. عاينها تاني وبعدين انشر.",
    preview: "معاينة",
    previewTitle: "معاينة المتجر",
    publish: "نشر",
    confirmPublish: "انشر",
    publishBody: "ده هيغيّر شكل متجرك اللي العملاء شايفينه.",
    cancel: "إلغاء",
    published: "اتنشر",
    logoPanel: "اللوجو والأيقونة",
    logo: "اللوجو",
    logoWidth: "عرض اللوجو",
    favicon: "أيقونة المتصفح",
    faviconHint: "صورة PNG مربعة، ٣٢ × ٣٢ على الأقل.",
    colorsPanel: "الألوان",
    colors: {
      background: "الخلفية",
      foreground: "الكلام",
      primary: "الزراير واللينكات",
      primaryForeground: "الكلام على الزراير",
      accent: "لون مميز",
      accentForeground: "الكلام على اللون المميز",
    },
    hex: "كود لون {name}",
    contrastOk: "واضح",
    contrastLow: "التباين قليل ({ratio}:1)",
    contrastBlocked: "الكلام مش هيتقري — اختار لون أغمق أو أفتح",
    autoFix: "ظبّطها لوحدك",
    typographyPanel: "الخطوط",
    headingFont: "خط العناوين",
    bodyFont: "خط الكلام",
    fontSample: "مربح Morbeh 123",
    baseSize: "حجم الكلام",
    sizes: { small: "صغير", medium: "متوسط", large: "كبير" },
    cornersPanel: "الزوايا",
    corners: { square: "حادة", rounded: "مدوّرة", pill: "مدوّرة جدًا" },
    socialPanel: "لينكات السوشيال",
    socialInvalid: "اكتب لينك كامل بيبدأ بـ https://",
    footerPanel: "الهيدر والفوتر",
    stickyHeader: "خلّي الهيدر ظاهر وانت بتنزل",
    footerNote: "ملاحظة الفوتر",
    showSocial: "اعرض لينكات السوشيال في الفوتر",
  },
```

Add `"onlineStoreCustomize.fontSample"` to `SHARED_VERBATIM` in `lib/i18n.test.ts` (a font specimen, deliberately the same in both).

Fonts: `pnpm --filter admin-web add @fontsource/cairo@^5 @fontsource/tajawal@^5 @fontsource/almarai@^5 @fontsource/readex-pro@^5 @fontsource/amiri@^5`.

- [ ] **Step 6: Themes page, theme card, release history**

`apps/admin-web/src/components/online-store/theme-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import { previewUrlAction, publishThemeAction } from "@/app/online-store/themes/actions";
import type { ThemeStateDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export type StaffRole = "viewer" | "operator" | "admin";

/** Opens the preview in a new tab without giving it a handle back to the admin (noopener). */
export async function openPreview(onError: () => void): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  const result = await previewUrlAction();
  if (result.status !== "ok" || tab === null) {
    tab?.close();
    onError();
    return;
  }
  tab.opener = null;
  tab.location.href = result.url;
}

export function ThemeCard({
  t,
  locale,
  state,
  role,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly state: ThemeStateDto;
  readonly role: StaffRole;
}) {
  const s = t.onlineStoreThemes;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isAdmin = role === "admin";
  const date =
    state.publishedAt === null
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(state.publishedAt),
        );
  const publish = () =>
    start(async () => {
      const result = await publishThemeAction(state.draftRevision);
      setConfirming(false);
      setMessage(
        result.status === "ok"
          ? s.published
          : result.status === "nothing_to_publish"
            ? s.nothingToPublish
            : result.status === "draft_changed"
              ? t.onlineStoreCustomize.draftChanged
              : t.formErrors.unexpected,
      );
      router.refresh();
    });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs">{s.currentTheme}</p>
          <CardTitle>{s.themeName}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {date === null
              ? s.neverPublished
              : s.lastPublished.replace("{date}", date).replace("{name}", s.staff)}
          </p>
        </div>
        {state.hasUnpublishedChanges ? (
          <Badge variant="warning">{s.unpublishedChanges}</Badge>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {role === "viewer" ? null : (
          <Button asChild>
            <Link href="/online-store/themes/customize">{s.customize}</Link>
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void openPreview(() => setMessage(s.previewFailed))}
        >
          {s.preview}
        </Button>
        {state.hasUnpublishedChanges ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!isAdmin}
            title={isAdmin ? undefined : s.adminOnlyPublish}
            onClick={() => setConfirming(true)}
          >
            {s.publish}
          </Button>
        ) : null}
        {message === null ? null : (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.publishTitle}</DialogTitle>
            <DialogDescription>{s.publishBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {s.cancel}
            </Button>
            <Button type="button" loading={pending} onClick={publish}>
              {s.confirmPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

`apps/admin-web/src/components/online-store/release-history.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import { restoreReleaseAction } from "@/app/online-store/themes/actions";
import type { ReleaseDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export function ReleaseHistory({
  t,
  locale,
  releases,
  version,
  isAdmin,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly releases: readonly ReleaseDto[];
  readonly version: number;
  readonly isAdmin: boolean;
}) {
  const s = t.onlineStoreThemes;
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const number = new Intl.NumberFormat(locale);
  const restore = (releaseNumber: number) =>
    start(async () => {
      const result = await restoreReleaseAction(releaseNumber, version);
      setMessage(
        result.status === "ok"
          ? s.restored
          : result.status === "conflict"
            ? t.onlineStoreCustomize.conflict
            : t.formErrors.unexpected,
      );
      router.refresh();
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.history}</CardTitle>
      </CardHeader>
      <CardContent>
        {releases.length === 0 ? (
          <p className="text-muted-foreground text-sm">{s.noReleases}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{s.releaseNumber}</TableHead>
                <TableHead>{s.releaseDate}</TableHead>
                <TableHead>{s.releaseBy}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.map((release) => (
                <TableRow key={release.releaseNumber}>
                  <TableCell>{number.format(release.releaseNumber)}</TableCell>
                  <TableCell>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(release.publishedAt))}
                  </TableCell>
                  <TableCell>{release.publishedByName ?? s.staff}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!isAdmin || pending}
                      title={isAdmin ? undefined : s.adminOnlyPublish}
                      onClick={() => restore(release.releaseNumber)}
                    >
                      {s.restore}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {message === null ? null : (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/admin-web/src/app/online-store/themes/page.tsx`:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { LockIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ReleaseHistory } from "@/components/online-store/release-history";
import { ThemeCard, type StaffRole } from "@/components/online-store/theme-card";
import { fetchAccess, fetchThemeReleases, fetchThemeState } from "@/lib/api/online-store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Online Store → Themes (Shopify's Themes page, spec 1.11). */
export default async function OnlineStoreThemesPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [user, session, theme, releases, access] = await Promise.all([
    getCurrentUser(),
    readSession(),
    fetchThemeState(),
    fetchThemeReleases(),
    fetchAccess(),
  ]);
  const role: StaffRole = highestRole(session?.roles ?? []) ?? "viewer";
  return (
    <AppShell t={t} locale={locale} activeNavId="online-store-themes" user={user}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t.onlineStoreThemes.title}</h1>
        {access.outcome === "ok" && access.data.locked ? (
          <div
            role="status"
            className="bg-warning-subtle text-warning-foreground flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          >
            <LockIcon aria-hidden="true" className="size-4" />
            {t.onlineStoreThemes.lockedBanner}{" "}
            <Link href="/online-store/preferences" className="underline">
              {t.onlineStoreThemes.lockedLink}
            </Link>
          </div>
        ) : null}
        {theme.outcome === "ok" ? (
          <>
            <ThemeCard t={t} locale={locale} state={theme.data} role={role} />
            <ReleaseHistory
              t={t}
              locale={locale}
              releases={releases.outcome === "ok" ? releases.data : []}
              version={theme.data.version}
              isAdmin={role === "admin"}
            />
          </>
        ) : (
          <p role="alert" className="text-destructive text-sm">
            {t.onlineStoreThemes.loadError}
          </p>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 7: The customize editor**

`apps/admin-web/src/app/online-store/themes/customize/layout.tsx`:

```tsx
import type { ReactNode } from "react";
// Ruling 29: the font picker shows each family in itself. @font-face downloads lazily.
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/700.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/tajawal/700.css";
import "@fontsource/almarai/400.css";
import "@fontsource/almarai/700.css";
import "@fontsource/readex-pro/400.css";
import "@fontsource/readex-pro/700.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";

export default function CustomizeLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
```

`apps/admin-web/src/app/online-store/themes/customize/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { CustomizeEditor } from "@/components/online-store/customize-editor";
import type { StaffRole } from "@/components/online-store/theme-card";
import { fetchPreferences, fetchThemeState } from "@/lib/api/online-store";
import { highestRole, readSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Full-screen editor outside AppShell (spec 1.11). Middleware already requires operator. */
export default async function CustomizePage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const [session, theme, prefs] = await Promise.all([
    readSession(),
    fetchThemeState(),
    fetchPreferences(),
  ]);
  const role: StaffRole = highestRole(session?.roles ?? []) ?? "viewer";
  if (theme.outcome !== "ok")
    return (
      <p role="alert" className="text-destructive p-6 text-sm">
        {t.onlineStoreThemes.loadError}
      </p>
    );
  return (
    <CustomizeEditor
      t={t}
      locale={locale}
      state={theme.data}
      role={role}
      storeName={prefs.outcome === "ok" ? prefs.data.storeName : ""}
    />
  );
}
```

`apps/admin-web/src/components/online-store/customize-panels.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Badge, Button, ColorField, Label, NativeSelect, Switch } from "@platform/ui";
import {
  BASE_SIZES,
  bestTextOn,
  checkBrandContrast,
  COLOR_KEYS,
  CORNER_STYLES,
  FONT_FAMILIES,
  FONT_KEYS,
  fontStack,
  LOGO_WIDTH,
  RADIUS_SCALES,
  SOCIAL_NETWORKS,
  type ColorKey,
  type ThemeDocument,
} from "@platform/storefront-content";
import type { OnlineStoreImageDto } from "@/lib/api/online-store";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ImageUploadField } from "./image-upload-field";
import { LocalizedTextField } from "./localized-text-field";

type Update = (change: (doc: ThemeDocument) => ThemeDocument) => void;
type Images = Readonly<Record<string, OnlineStoreImageDto>>;
interface PanelProps {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly doc: ThemeDocument;
  readonly update: Update;
  readonly disabled: boolean;
}

const withBrand = (doc: ThemeDocument, brand: Partial<ThemeDocument["brand"]>): ThemeDocument => ({
  ...doc,
  brand: { ...doc.brand, ...brand },
});

export function LogoPanel({
  t,
  doc,
  update,
  disabled,
  images,
  onImage,
}: PanelProps & {
  readonly images: Images;
  readonly onImage: (image: OnlineStoreImageDto & { id: string }) => void;
}) {
  const c = t.onlineStoreCustomize;
  const imageOf = (id: string | null) =>
    id === null || images[id] === undefined ? null : { ...images[id]!, id };
  return (
    <section className="flex flex-col gap-3">
      <Label>{c.logo}</Label>
      <ImageUploadField
        t={t}
        purpose="logo"
        image={imageOf(doc.brand.logo.imageRef)}
        disabled={disabled}
        onChange={(image) => {
          if (image !== null) onImage(image);
          update((d) => withBrand(d, { logo: { ...d.brand.logo, imageRef: image?.id ?? null } }));
        }}
      />
      <Label htmlFor="logo-width">{c.logoWidth}</Label>
      <input
        id="logo-width"
        type="range"
        min={LOGO_WIDTH.min}
        max={LOGO_WIDTH.max}
        step={10}
        value={doc.brand.logo.widthPx}
        disabled={disabled}
        onChange={(e) => {
          const widthPx = Number(e.currentTarget.value);
          update((d) => withBrand(d, { logo: { ...d.brand.logo, widthPx } }));
        }}
      />
      <Label>{c.favicon}</Label>
      <p className="text-muted-foreground text-xs">{c.faviconHint}</p>
      <ImageUploadField
        t={t}
        purpose="favicon"
        image={imageOf(doc.brand.favicon.imageRef)}
        disabled={disabled}
        onChange={(image) => {
          if (image !== null) onImage(image);
          update((d) => withBrand(d, { favicon: { imageRef: image?.id ?? null } }));
        }}
      />
    </section>
  );
}

/** Text key → the fill it sits on (the three pairs the contrast rules check). */
const PAIRS: readonly [
  ColorKey,
  ColorKey,
  "foreground" | "primaryForeground" | "accentForeground",
][] = [
  ["foreground", "background", "foreground"],
  ["primaryForeground", "primary", "primaryForeground"],
  ["accentForeground", "accent", "accentForeground"],
];

export function ColorsPanel({ t, locale, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const contrast = checkBrandContrast(doc.brand.colors);
  const blocked = contrast.blocking.length > 0;
  const ratio = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const setColor = (key: ColorKey, hex: string) =>
    update((d) => withBrand(d, { colors: { ...d.brand.colors, [key]: hex } }));
  return (
    <section className="flex flex-col gap-3">
      {COLOR_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <ColorField
            id={`color-${key}`}
            label={c.colors[key]}
            textLabel={c.hex.replace("{name}", c.colors[key])}
            value={doc.brand.colors[key]}
            disabled={disabled}
            onChange={(hex) => setColor(key, hex)}
          />
        </div>
      ))}
      {PAIRS.map(([text, fill, pair]) => {
        const warning = contrast.warnings.find((w) => w.pair === pair);
        const isBlocked = pair === "foreground" && blocked;
        if (!isBlocked && warning === undefined)
          return (
            <Badge key={pair} variant="success">
              {c.colors[text]} · {c.contrastOk}
            </Badge>
          );
        return (
          <div key={pair} className="flex items-center gap-2">
            <Badge variant={isBlocked ? "destructive" : "warning"}>
              {isBlocked
                ? c.contrastBlocked
                : c.contrastLow.replace("{ratio}", ratio.format(warning?.ratio ?? 0))}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setColor(text, bestTextOn(doc.brand.colors[fill]))}
            >
              {c.autoFix}
            </Button>
          </div>
        );
      })}
    </section>
  );
}

export function TypographyPanel({ t, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const setTypography = (patch: Partial<ThemeDocument["brand"]["typography"]>) =>
    update((d) => withBrand(d, { typography: { ...d.brand.typography, ...patch } }));
  return (
    <section className="flex flex-col gap-3">
      {(["headingFont", "bodyFont"] as const).map((field) => (
        <div key={field} className="flex flex-col gap-1">
          <Label htmlFor={field}>{field === "headingFont" ? c.headingFont : c.bodyFont}</Label>
          <NativeSelect
            id={field}
            value={doc.brand.typography[field]}
            disabled={disabled}
            onChange={(e) =>
              setTypography({ [field]: e.currentTarget.value as (typeof FONT_KEYS)[number] })
            }
          >
            {FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                {FONT_FAMILIES[key]}
              </option>
            ))}
          </NativeSelect>
          {/* The family comes from the fixed key → family map only (spec 1.3), never from input. */}
          <p className="text-lg" style={{ fontFamily: fontStack(doc.brand.typography[field]) }}>
            {c.fontSample}
          </p>
        </div>
      ))}
      <fieldset className="flex gap-2">
        <legend className="mb-1 text-sm font-medium">{c.baseSize}</legend>
        {BASE_SIZES.map((size) => (
          <Button
            key={size}
            type="button"
            size="sm"
            variant={doc.brand.typography.baseSize === size ? "default" : "secondary"}
            aria-pressed={doc.brand.typography.baseSize === size}
            disabled={disabled}
            onClick={() => setTypography({ baseSize: size })}
          >
            {c.sizes[size]}
          </Button>
        ))}
      </fieldset>
    </section>
  );
}

export function CornersPanel({ t, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  return (
    <section className="flex gap-2">
      {CORNER_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          aria-pressed={doc.brand.corners === style}
          disabled={disabled}
          onClick={() => update((d) => withBrand(d, { corners: style }))}
          className="border-border aria-pressed:border-primary flex flex-col items-center gap-1 rounded-lg border p-2 text-xs"
        >
          <span
            className="bg-primary block h-6 w-12"
            style={{ borderRadius: `${RADIUS_SCALES[style][4] ?? 0}px` }}
          />
          {c.corners[style]}
        </button>
      ))}
    </section>
  );
}

export function SocialPanel({ t, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  const [text, setText] = useState<Record<string, string>>(() => ({ ...doc.brand.social }));
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const commit = (network: (typeof SOCIAL_NETWORKS)[number], value: string) => {
    const trimmed = value.trim();
    let ok = trimmed === "";
    try {
      ok = ok || (new URL(trimmed).protocol === "https:" && trimmed.length <= 500);
    } catch {
      ok = false;
    }
    setInvalid((s) => ({ ...s, [network]: !ok }));
    if (!ok) return;
    update((d) => {
      const social = { ...d.brand.social };
      if (trimmed === "") delete social[network];
      else social[network] = trimmed;
      return withBrand(d, { social });
    });
  };
  return (
    <section className="flex flex-col gap-3">
      {SOCIAL_NETWORKS.map((network) => (
        <div key={network} className="flex flex-col gap-1">
          <Label htmlFor={`social-${network}`}>
            {t.onlineStoreCustomize.socialPanel} · {network}
          </Label>
          <input
            id={`social-${network}`}
            type="url"
            dir="ltr"
            className="border-input bg-card h-9 rounded-xl border px-3"
            value={text[network] ?? ""}
            disabled={disabled}
            aria-invalid={invalid[network] === true}
            onChange={(e) => setText((s) => ({ ...s, [network]: e.currentTarget.value }))}
            onBlur={(e) => commit(network, e.currentTarget.value)}
          />
          {invalid[network] === true ? (
            <p className="text-destructive text-xs">{c.socialInvalid}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

export function FooterPanel({ t, locale, doc, update, disabled }: PanelProps) {
  const c = t.onlineStoreCustomize;
  return (
    <section className="flex flex-col gap-4">
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={doc.header.sticky}
          disabled={disabled}
          onCheckedChange={(sticky) => update((d) => ({ ...d, header: { ...d.header, sticky } }))}
        />
        {c.stickyHeader}
      </label>
      <LocalizedTextField
        t={t}
        locale={locale}
        name="footer-note"
        label={c.footerNote}
        max={200}
        multiline
        value={doc.footer.note}
        disabled={disabled}
        onChange={(note) => update((d) => ({ ...d, footer: { ...d.footer, note } }))}
      />
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={doc.footer.showSocial}
          disabled={disabled}
          onCheckedChange={(showSocial) =>
            update((d) => ({ ...d, footer: { ...d.footer, showSocial } }))
          }
        />
        {c.showSocial}
      </label>
    </section>
  );
}
```

(Network names in `SocialPanel` labels: use `t.onlineStoreCustomize.socialPanel` plus the network key; if a reviewer asks for translated network names, reuse the storefront's list — out of scope for Part 1. Check `Button`'s variant names in `packages/ui/src/components/ui/button.tsx`; replace `"default"`/`"secondary"` with the actual primary/secondary variant names if they differ.)

`apps/admin-web/src/components/online-store/customize-editor.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@platform/ui";
import type { ThemeDocument } from "@platform/storefront-content";
import {
  previewUrlAction,
  publishThemeAction,
  saveThemeDraftAction,
} from "@/app/online-store/themes/actions";
import type { OnlineStoreImageDto, ThemeStateDto } from "@/lib/api/online-store";
import { createAutosaver, type AutosaveState } from "@/lib/online-store/autosave";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import {
  ColorsPanel,
  CornersPanel,
  FooterPanel,
  LogoPanel,
  SocialPanel,
  TypographyPanel,
} from "./customize-panels";
import type { StaffRole } from "./theme-card";

const AUTOSAVE_DELAY_MS = 1000;
const PREVIEW_REFRESH_MS = 50 * 60 * 1000; // tokens live 60 minutes

/**
 * Spec 1.11: Theme settings panels on the start side, the storefront preview on the end side. Every
 * change autosaves the DRAFT (never the live store); the iframe reloads after each successful save.
 */
export function CustomizeEditor({
  t,
  locale,
  state,
  role,
  storeName,
}: {
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly state: ThemeStateDto;
  readonly role: StaffRole;
  readonly storeName: string;
}) {
  const c = t.onlineStoreCustomize;
  const canEdit = role !== "viewer";
  const isAdmin = role === "admin";
  const [doc, setDoc] = useState<ThemeDocument>(state.draft);
  const docRef = useRef(doc);
  const versionRef = useRef(state.version);
  const revisionRef = useRef(state.draftRevision);
  const [images, setImages] = useState<Record<string, OnlineStoreImageDto>>({ ...state.images });
  const [saveState, setSaveState] = useState<AutosaveState>("idle");
  const [alert, setAlert] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [frameVersion, setFrameVersion] = useState(state.draftRevision);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const saver = useMemo(
    () =>
      createAutosaver<ThemeDocument>({
        delayMs: AUTOSAVE_DELAY_MS,
        onState: (s) => {
          setSaveState(s);
          if (s === "conflict") setAlert(c.conflict);
        },
        save: async (document) => {
          const result = await saveThemeDraftAction({
            document,
            expectedVersion: versionRef.current,
          });
          if (result.status === "ok") {
            versionRef.current = result.version;
            revisionRef.current = result.draftRevision;
            setFrameVersion(result.draftRevision);
            return "ok";
          }
          return result.status === "conflict" ? "conflict" : "error";
        },
      }),
    [c.conflict],
  );
  useEffect(() => () => saver.dispose(), [saver]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await previewUrlAction();
      if (active && result.status === "ok") setPreviewUrl(result.url);
    };
    void load();
    const timer = setInterval(() => void load(), PREVIEW_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const update = (change: (d: ThemeDocument) => ThemeDocument) => {
    if (!canEdit) return;
    const next = change(docRef.current);
    docRef.current = next;
    setDoc(next);
    saver.schedule(next);
  };

  const publish = async () => {
    setPublishing(true);
    await saver.flush();
    const result = await publishThemeAction(revisionRef.current);
    setPublishing(false);
    setConfirming(false);
    if (result.status === "ok") setAlert(c.published);
    else if (result.status === "draft_changed") setAlert(c.draftChanged);
    else if (result.status === "nothing_to_publish") setAlert(t.onlineStoreThemes.nothingToPublish);
    else setAlert(t.formErrors.unexpected);
  };

  const frameSrc =
    previewUrl === null
      ? undefined
      : `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${frameVersion}`;
  const stateLabel =
    saveState === "saving"
      ? c.saving
      : saveState === "saved"
        ? c.saved
        : saveState === "error"
          ? c.saveError
          : null;
  const panels = { t, locale, doc, update, disabled: !canEdit };

  return (
    <div className="bg-background flex h-dvh flex-col">
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/online-store/themes">{c.exit}</Link>
        </Button>
        <bdi dir="auto" className="truncate text-sm font-medium">
          {storeName}
        </bdi>
        <div className="ms-auto flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant={device === "desktop" ? "secondary" : "ghost"}
            aria-label={c.desktop}
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            <MonitorIcon aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={device === "mobile" ? "secondary" : "ghost"}
            aria-label={c.mobile}
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            <SmartphoneIcon aria-hidden="true" className="size-4" />
          </Button>
          {stateLabel === null ? null : (
            <span role="status" className="text-muted-foreground text-xs">
              {stateLabel}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={previewUrl === null}
            onClick={async () => {
              await saver.flush();
              if (previewUrl !== null) window.open(previewUrl, "_blank", "noopener");
            }}
          >
            {c.preview}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isAdmin}
            title={isAdmin ? undefined : t.onlineStoreThemes.adminOnlyPublish}
            onClick={() => setConfirming(true)}
          >
            {c.publish}
          </Button>
        </div>
      </header>
      {alert === null ? null : (
        <p role="alert" className="bg-warning-subtle text-warning-foreground px-4 py-2 text-sm">
          {alert}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="border-border w-80 shrink-0 overflow-y-auto border-e p-4">
          <details open className="mb-4">
            <summary className="mb-2 font-medium">{c.logoPanel}</summary>
            <LogoPanel
              {...panels}
              images={images}
              onImage={(image) => setImages((m) => ({ ...m, [image.id]: image }))}
            />
          </details>
          <details open className="mb-4">
            <summary className="mb-2 font-medium">{c.colorsPanel}</summary>
            <ColorsPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.typographyPanel}</summary>
            <TypographyPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.cornersPanel}</summary>
            <CornersPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.socialPanel}</summary>
            <SocialPanel {...panels} />
          </details>
          <details className="mb-4">
            <summary className="mb-2 font-medium">{c.footerPanel}</summary>
            <FooterPanel {...panels} />
          </details>
        </aside>
        <main className="bg-surface flex min-w-0 flex-1 justify-center overflow-auto p-4">
          {frameSrc === undefined ? null : (
            <iframe
              key={frameVersion}
              title={c.previewTitle}
              src={frameSrc}
              className="bg-card h-full rounded-lg border"
              style={{ width: device === "desktop" ? "100%" : "390px" }}
            />
          )}
        </main>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.publish}</DialogTitle>
            <DialogDescription>{c.publishBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {c.cancel}
            </Button>
            <Button type="button" loading={publishing} onClick={() => void publish()}>
              {c.confirmPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

The editor ignores the `warnings` in the save response on purpose: the per-pair badges in `ColorsPanel` run `checkBrandContrast` in the browser on every change, the same function the API runs, so they are never behind it.

- [ ] **Step 8: Run, typecheck, lint, client-bundle grep**

Run: `pnpm install`
Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
Run the client-bundle grep from Commands — only the three known pre-existing hits (`customize-editor.tsx`, `theme-card.tsx`, `release-history.tsx`, `image-upload-field.tsx` import only `type`s from `@/lib/api/*`; they call server actions).

If a jsdom limitation breaks the `Dialog` portal in the editor test, render with `container: document.body` or query by role from `screen` (Radix portals into `document.body`, which `screen` covers).

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/src/lib/online-store/autosave.ts apps/admin-web/src/lib/online-store/autosave.test.ts \
  apps/admin-web/src/app/online-store/themes apps/admin-web/src/components/online-store/theme-card.tsx \
  apps/admin-web/src/components/online-store/theme-card.test.tsx apps/admin-web/src/components/online-store/release-history.tsx \
  apps/admin-web/src/components/online-store/customize-editor.tsx apps/admin-web/src/components/online-store/customize-panels.tsx \
  apps/admin-web/src/components/online-store/customize-editor.test.tsx apps/admin-web/src/lib/i18n.test.ts \
  apps/admin-web/src/messages apps/admin-web/package.json pnpm-lock.yaml
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add Online Store themes and the customize editor

Current theme card with preview and admin-only publish, release history with restore to draft,
and a full-screen editor that autosaves the draft and reloads a live storefront preview.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 11)

- [ ] `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/online-store test && pnpm --filter @platform/media test && pnpm --filter @platform/db exec vitest run src/schema-migration-consistency.test.ts && pnpm --filter @platform/auth test`
- [ ] `pnpm --filter @platform/admin test` and `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`
- [ ] `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint`
- [ ] `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`
- [ ] `pnpm --filter @platform/ui test` and `pnpm typecheck` at the root (turbo) — every package green.
- [ ] `DATABASE_URL=postgresql://u:p@localhost:5432/x DIRECT_URL=postgresql://u:p@localhost:5432/x pnpm --filter @platform/db exec prisma validate` — valid. **No `migrate`, no `db push`, no SQL.**
- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` — exactly the one known finding (`discounts.admin-controller.ts:166`).
- [ ] Client-bundle grep (Commands) — only the three known pre-existing hits; nothing under `components/online-store` or `app/online-store`.
- [ ] `grep -rn "موربيه" apps packages services` — no output.
- [ ] `grep -rn "dangerouslySetInnerHTML" apps/storefront/src apps/admin-web/src/components/online-store` — no new occurrence on merchant content.
- [ ] `git log --oneline origin/main..HEAD` — eleven task commits after the spec commit; `git status` clean except `.superpowers/`/`.claude/` (never staged).
- [ ] Owner hand-off note (in the PR description, not code): deploy `20261027000000_online_store_identity` from Railway's Console BEFORE this release; set `STOREFRONT_ACCESS_SECRET`, `STOREFRONT_REVALIDATE_SECRET` (both apps, same value) and `ADMIN_ORIGIN` on the storefront, and `STOREFRONT_REVALIDATE_SECRET` (+ optional `STOREFRONT_INTERNAL_URL`) on admin-web — a production storefront without them refuses to boot (Ruling 21); grant the nine new permission strings with `scripts/ops/seed-ory-network.mjs` where Ory/Keto is the access control.

## Self-review (done while writing this plan)

**1. Spec coverage (Part 1).** 1.2 data model → Task 2 (migration verbatim, five tables, RLS per table, no backfill, absent-row defaults in the repositories). 1.3 document, fonts, colours, contrast, derived tokens, dark mode, social, limits → Task 1 (+ Task 8 for light-only and fonts, Ruling 4 for radius). 1.4 preferences → Tasks 3, 10. 1.5 lock, unlock flow, rate limit, cookie, secret, assertion → Tasks 3, 6, 7, 9. 1.6 preview tokens → Tasks 2, 3, 5, 9, 11. 1.7 uploads → Tasks 4, 5, 10. 1.8 context, ports, use cases, events, optimistic publish, restore → Tasks 2, 3, 5. 1.9 admin API (12 routes) → Task 5. 1.10 public API → Task 6. 1.11 admin-web (nav, role gating, Themes, customize, Preferences, primitives, revalidation) → Tasks 10, 11. 1.12 storefront (route groups, root layout, header, footer, data access, caching, revalidation route, middleware, password page, preview, brand fix, environment) → Tasks 7, 8, 9. 1.13 testing → each task's tests; the E2E list is Part 3's. Permissions table → Task 2. Security section → Global Constraints + Tasks 2–9. Gaps knowingly deferred: scroll restore across preview reloads (Ruling 17, Part 3); `publishedByName` (Ruling 12).

**2. Placeholder scan.** No "TBD"/"similar to". Three adapt-to-reality notes remain where the exact local name must be read from the file (Button variant names, `getAdminApi` generic, `readSession` shape); each names the file to read.

**3. Type consistency.** `PublicShellView` (Task 3) ⇄ `sanitizeShell` input (Task 7): `mode`, `previewExpiresAt`, `branded`, `brand.logo.{image,widthPx}`, `brand.favicon`, `colors/typography/corners` (read via `readBrandStyle(brand)`), `social`, `header`, `footer`, `locked` — match. `OnlineStorePublicReads` (Task 3) is what Task 5 exposes and Task 6 calls. `ResolvePreviewToken` returns `Date | null` (Task 3) and nothing else calls it. `UploadImageInput.purpose` (Task 4) ⇄ route enum `ONLINE_STORE_IMAGE_PURPOSES` (Task 5) ⇄ `OnlineStoreImagePurpose` (Task 10). `saveThemeDraftAction({ document, expectedVersion })` (Task 11) ⇄ `saveThemeDraft(document, expectedVersion, key)` (Task 10). `StaffRole` is defined once in `theme-card.tsx`.

**4. Review Focus.** Each of the five lines is pinned by a named test in its owning task (Tasks 1/8, 7/9, 9, 3/11, 4/5). The spec's own Review Focus items for Part 1 are covered too: huge/lying images (Task 4), malformed colours (Tasks 1, 7, 8), locked store and bots (Tasks 8 noindex, 9 302), RTL logo (Task 8 header test), cross-shop leakage (Tasks 2, 7, 9), preview token leakage (no-referrer + no-store in Task 9, expiry in Task 3), unlock brute force (Task 6), stale caches (Tasks 7, 9, 10), bilingual gaps (`pickText`, Task 1), draft/publish races (Tasks 3, 11), middleware exemptions (Task 9), old documents (Task 1 reader). Items for menus, rich text and sections are Parts 2–3.
