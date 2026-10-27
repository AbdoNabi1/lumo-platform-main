# Online Store (Storefront Customization) — Design Spec (Project 4)

**Status:** Decided on the owner's behalf (2026-10-27). The owner delegated every decision; each one
is marked **Our call:** with a one-line reason, and all of them are listed at the end for the owner
to check. Ready for implementation plans, one per part.
**Author:** Claude (this session).
**Branch:** `morbeh/storefront-customization`. See "Read this first" about its base.
**Relationship to prior work:** Shopify parity programme. It builds on Plan 1A (shop domains and
host → shop resolution), Plan 1B-2 (fixed staff roles), Plan 2C-3 (image upload and public media
URLs), Plan 3C (Settings → General store settings, `GET /public/store`) and ADR-0014 (per-request
tenant). It runs alongside Project 1 (merchant onboarding) and Project 3 (order operations), which
are not merged yet. The custom domain itself is done (Plan 1A) and is out of scope here.

> **ملخص للمالك:**
>
> المشروع ده بيخلّي التاجر يحس إن المتجر بتاعه هو، زي "Online Store" في شوبيفاي، على 3 أجزاء كل واحد بيتسلّم لوحده:
> (1) **هوية المتجر:** اللوجو والأيقونة والألوان والخطوط (خطوط عربي + إنجليزي جاهزة)، وعنوان ووصف الصفحة
> الرئيسية وصورة المشاركة على واتساب وفيسبوك. وكمان قفل المتجر بكلمة سر ("هنفتح قريب")، مع معاينة للأدمن
> من غير ما يفتح القفل. هيدر وفوتر موحدين بإسم المتجر الحقيقي بدل "Lumo".
> (2) **القوائم والمحتوى:** قائمة الهيدر والفوتر (تحت كل عنصر مستوى واحد)، وصفحات السياسات (الاسترجاع والشحن
> والخصوصية والشروط والتواصل) بنماذج جاهزة بالعربي أو الإنجليزي تعدّلها، وصفحات زي "من نحن" بمحتوى حقيقي،
> وخريطة الموقع لجوجل.
> (3) **محرر الصفحة الرئيسية:** سكاشن جاهزة (بانر، مجموعة مميزة، منتجات، صورة مع نص، آراء العملاء، مميزات
> زي "الدفع عند الاستلام"، زرار واتساب، شريط إعلانات). تضيف وترتّب وتخفي وتعدّل، وتشوف معاينة حية، والأدمن
> بس هو اللي ينشر.

---

## Read this first: the branch base and the survey

The worktree was cut from **local** `main` at `1fe88fd7`. That commit is **366 commits behind
`origin/main` (`d6196c48`, 2026-10-16)**. The survey
(`p4-survey.md`) was taken on that stale tree, so several of its findings are out of date. This spec is
written against `origin/main`. **The first step of the Part 1 plan is to reset the (still empty)
branch onto `origin/main`**, and then onto whichever of Project 1 and Project 3 has merged by then.
That is a planning instruction. This spec changed nothing in git.

Survey findings that are wrong on `origin/main`:

| Survey says (stale tree)                           | `origin/main` actually has                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One tenant per process; `TENANT_MODE=multi` throws | ADR-0014: tenant resolved per request, repositories take `tenantId` per call and read through `runReadScoped`. Multi mode is possible but not yet enabled (T10.5 pending). `tenant-mode-guard.ts` walks the composed graph for `tenantId` fields, and `tenancy` is the only exemption       |
| Storefront hardcodes `x-tenant-id`                 | `apps/storefront/src/middleware.ts` + `lib/shop-host.ts`: Host → shop through `GET /public/domains/resolve` (60 s cache), `x-shop-id` request header, stripped from client input. Only active with `STOREFRONT_HOST_ROUTING=on`; otherwise `TENANT_DEFAULT_ID`                              |
| No RLS anywhere                                    | `20260823000000_rls_tenant_isolation` (loop over existing tables) and an explicit `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy on every new table since (`20261005000000_tenancy_shop_domains`, `20261012000000_order_numbers`, `20261013000000_store_shipping_taxes`) |
| No upload route; only signed GET                   | `POST /media/uploads` (raw body, `binaryBody` 8 MB cap, `sniffImage` decides type and size, JPEG/PNG/WebP/GIF, never SVG), immutable keys, `MEDIA_PUBLIC_BASE_URL` → `publicMediaUrl()`, and `ResolveMediaImages` (one batched tenant-scoped read, ids → `{url, alt, width, height}`)       |
| No store settings                                  | `tenancy.store_settings` (store name, contact email, currency, time zone, weight unit), Settings → General, and `GET /public/store` (name and currency). The storefront `generateMetadata` already shows the shop name                                                                      |
| Flat admin nav                                     | `ONLINE_STORE_NAV` (Online Store → Theme, Pages, SEO), `SETTINGS_NAV`, `PLATFORM_TOOLS_NAV`, sections with `children`                                                                                                                                                                       |
| Brand "Lumo", cookies `lumo-*`                     | Brand "Morbeh" / **"موربيه"** (wrong: the brand is **مربح**; Part 1 fixes it), cookies `morbeh-storefront-*`                                                                                                                                                                                |

What the survey has right, and still holds: `services/theme` is a raw multi-theme token store with
no "live" pointer. `services/experience` and `services/components` are unused by any screen.
`services/pages` has no body. There are no menus, no policies, no password lock, no `robots`/`sitemap`.
Every storefront read is `cache: "no-store"`. 14 storefront pages each render their own
`<SiteHeader>`, and there is no footer. `@platform/ui` has no textarea, select, switch or colour
input.

## Why

1. **The storefront does not look like the merchant's shop.** It has no logo, uses platform
   colours and fonts, has a text-only header and no footer. A shop selling over Instagram ads cannot
   send traffic to a page that looks like a template.
2. **Customers cannot navigate.** The storefront has no menus, so there is no path to collections,
   "About us" or the return policy.
3. **Payment gateways and buyers need policies.** Egyptian gateways (Paymob, Fawry, Kashier) review a
   merchant's refund, shipping and privacy pages during onboarding. Today there is nowhere to write
   them and no URL to give them.
4. **Shops cannot prepare before launch.** There is no "Opening soon" lock, so a half-built shop is
   public the moment its domain resolves.
5. **The homepage is hard-coded** (`app/page.tsx`: a product list, categories, collections). The
   merchant cannot add a banner for a sale or a WhatsApp button.

## What already exists (and is reused)

| Area                | What exists on `origin/main`                                                                                                                                                                                               | Reused for                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Image upload        | `UploadProductImage` (`services/media`), `sniffImage`, `MAX_UPLOAD_BYTES`, `IMMUTABLE_CACHE_CONTROL`, `publicMediaUrl`, `ResolveMediaImages`, `binaryBody` routes, admin-web `uploadProductImageAction` + `media-card.tsx` | Logo, favicon, share image, section images (generalised, 1.7)                         |
| Storage namespaces  | `brand-assets`, `theme-assets` in `packages/contracts/src/object-storage.ts`; `StorageKeyFactory`                                                                                                                          | Keys for the new image purposes                                                       |
| Shop resolution     | storefront `middleware.ts`, `createShopResolver` (TTL cache, never caches failures), `SHOP_ID_HEADER`                                                                                                                      | The lock gate and the preview header live in the same middleware                      |
| Store name          | `tenancy.store_settings.store_name`, `GET /public/store`                                                                                                                                                                   | Name shown in the header, the `<title>` fallback, logo alt text, and policy templates |
| Shop domains        | Plan 1A `tenancy.shop_domains` (primary verified hostname)                                                                                                                                                                 | Absolute preview URL and canonical/sitemap host                                       |
| Design tokens       | `packages/design/src/styles.css` semantic CSS vars resolved through `var()` at runtime; `semantic.ts`; `contrast.ts` (`contrastRatio`, `meetsContrast`)                                                                    | Brand colours are overrides of the same vars; save-time contrast check                |
| Password hashing    | `ScryptPasswordHasher` (`services/security`), constant-cost compare                                                                                                                                                        | Storefront password (injected through a port)                                         |
| Rate limiting       | `RateLimiter` port + instance passed to `publicAuthRoutes` (`rl:${tenantId}:signup:${email}` pattern, 429 envelope with `retry-after`)                                                                                     | Unlock attempts                                                                       |
| Public-read seam    | `WiredAdmin.publicReads` (controllers and closures, e.g. shippable countries), `public: true` routes                                                                                                                       | `publicReads.onlineStore`, `publicReads.pages`                                        |
| Pages               | `services/pages` `Page` (`routePath` unique per tenant, draft/published/archived), admin-web `/pages`                                                                                                                      | Page bodies (2.4)                                                                     |
| Roles               | `ROLE_PERMISSIONS` (`packages/auth/src/role-table-access-control.ts`): operator `<resource>:*` for shop resources, viewer `:read`, everything else admin-only                                                              | Permission split (below)                                                              |
| Link tokens pattern | Project 3 `checkout_links`: 256-bit token, SHA-256 at rest, expiry                                                                                                                                                         | Preview tokens (same shape)                                                           |

## Goals

- A merchant brands the storefront without code: logo, favicon, colours, fonts, corners and social
  links. Changes are previewed as a draft and go live on **Publish**.
- Header and footer menus link to the shop's own collections, products, pages, policies, the home
  page, search, and safe external URLs.
- The five Shopify policies exist at Shopify's URLs, with bilingual templates to start from.
- Pages such as "About us" have real content at `/pages/<handle>`.
- Preferences cover the home title and meta description, the social share image, the storefront's
  default language, and the password lock.
- The homepage is built from a fixed, typed section library with add, reorder, hide, configure and
  remove, a draft/published split and a live preview.
- Every read and write is tenant-scoped per request, and nothing new is pinned.
- Each of the three parts is planned, built, reviewed and deployed on its own, in order.

## Non-goals

- Several themes, a theme store, duplicating themes, or editing theme code (Liquid/CSS). Morbeh ships
  **one** storefront codebase, and only its settings are customisable.
- Sections on product, collection, cart or checkout pages. Only the homepage gets sections; other
  templates keep their fixed layout and take the brand.
- Blog, contact form, newsletter sign-up, custom CSS or JS, merchant-uploaded fonts, Google Fonts at
  runtime, mega menus (more than 2 levels), scheduled publishing, undo/redo history in the editor,
  drag-and-drop reordering, image resizing or derivatives.
- Enforcing the lock inside the Runtime API. The lock is a storefront gate, and the public catalog
  API stays readable.
- Consuming `services/seo` stored sitemaps, robots policies and redirects in the storefront.
- Making new shops locked by default. That is Project 1's launch step to decide.
- Per-market or per-domain content, and hreflang (the locale is a cookie on one URL).

## Anti-goals (must not happen)

- No raw HTML stored or rendered from merchant input. No `dangerouslySetInnerHTML` on merchant content.
- No merchant-typed string reaches a CSS block, a `<script>`, a `style` attribute or a font URL. Only
  validated hex colours and enum keys do.
- No password, password hash, preview token or signing key in a DTO, log line, URL that persists, or
  cookie. The unlock cookie carries an HMAC proof, never the password.
- No draft content served without a valid, unexpired preview token for that shop.
- No cached storefront response or data entry shared between two shops.
- No new construction-time `tenantId` anywhere in the composed graph (the tenant-mode guard's
  exemption list stays at one entry).
- No behaviour change to the existing `POST /media/uploads` for product images.

## Global constraints (apply to every part)

1. **Migrations:** hand-written, additive SQL in `packages/db/prisma/schema/migrations/<ts>_<name>/
migration.sql`. The agent never runs them against a real DB; the owner deploys before the release
   that reads them. Every new tenant table gets `tenant_id TEXT NOT NULL`, then
   `ENABLE` + `FORCE ROW LEVEL SECURITY`, then `DROP POLICY IF EXISTS tenant_isolation …; CREATE POLICY
tenant_isolation … FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK
(same)`, exactly as `20261005000000_tenancy_shop_domains` and `20261013000000_store_shipping_taxes`
   do. A new schema starts with `CREATE SCHEMA IF NOT EXISTS`. Prisma models go in the matching
   `*.prisma` file; the datasource `schemas` list gains `online_store`; `schema-migration-consistency.test.ts`
   covers the new tables.
2. **Per-request tenant (ADR-0014):** new repositories take `tenantId` per call, read through
   `runReadScoped` (or the caller's `tx`) and write through the unit of work. Outbox writes attach the
   tenant at write time (`{ ...context, tenantId }`, Amendment 7). Each Prisma repository gets a
   `tenant-isolation.test.ts` case. Nothing on `WiredAdmin` outside `tenancy` has a field named
   `tenantId` (or `defaultTenantId`/`pinnedTenantId`). Public reads are closures that take `tenantId`
   as an argument.
3. **Layering:** `apps/*` never import `services/*` except `apps/admin`. Services never import other
   services; cross-context reads are ports in the service with adapters in
   `apps/admin/src/infrastructure/cross-context/`. Shared pure types and validators live in a
   package (`@platform/storefront-content`, below), so they are not hand-copied into admin-web.
4. **admin-web:** the runtime API is called only from server code (pages, server actions, route
   handlers). Client components never value-import `lib/api/*` or `lib/auth/*` (type imports only;
   they call server actions). Every string goes in `messages/en.ts` and `messages/ar.ts` (Egyptian
   Arabic). CSS is logical (`ms-`/`pe-`/`start`/`end`). One idempotency key per submit.
5. **Storefront:** server components and server actions only, with no browser-side runtime-API
   calls. Copy goes in `messages/{en,ar}.ts` (Modern Standard Arabic) with parity enforced by
   `Dictionary`. Layout is RTL-first. Merchant text is rendered with `dir="auto"`.
6. **Brand:** the platform name is **مربح** / **Morbeh** everywhere. Part 1 fixes the storefront
   dictionary's `"موربيه"`.

## Where the code lives

**Our call:** one new bounded context, `services/online-store` (`@platform/online-store`, Postgres
schema `online_store`), owns preferences, access lock, preview tokens, the storefront theme document
(brand, header, footer, homepage), menus and policies. Reason: these are the Shopify "Online Store"
sales-channel concerns, change together, and one context means one wiring, one schema and one
`tenant-isolation` suite.

**Our call:** `services/theme` is left untouched. Its admin screens (`/theme`, raw key/value
variables) move to Platform tools, and Online Store → Themes points at the new editor. Reason: its
multi-theme status machine has no live pointer, cannot re-publish an active theme, and stores
untyped variables. Bending it into "one live theme with a draft" would change its semantics and
tests for no gain. The new document uses the same token vocabulary (`@platform/design` semantic var
names), which is what "built on the theme tokens" means here.

**Our call:** pages get their body in `services/pages` (2.4), not in the new context. Reason: `Page`
already owns routing, status and admin screens; a second "page" concept would split one Shopify
object across two contexts.

**Our call:** a new pure package, `packages/storefront-content` (`@platform/storefront-content`, no
runtime dependencies), holds the theme-document types, the font and colour enums, the `LinkRef` and
`LocalizedText` types, the rich-text parser and validators, and the section library definitions. It
is imported by `services/online-store`, `services/pages`, admin-web and the storefront. Reason: the
same validator must run in the editor, the API and the renderer. The house's hand-copy practice
(`lib/theme-lifecycle.ts`) would let them drift on a security boundary.

Shared value types (in the package):

```ts
type Locale = "ar" | "en";
type LocalizedText = { readonly ar?: string; readonly en?: string }; // trimmed; empty string = absent
/** Shown in the request locale, else the other locale, else nothing (the element is omitted). */
function pickText(text: LocalizedText, locale: Locale): string | null;
```

**Our call:** merchant-written text is stored per locale in the same field (`{ ar, en }`), not via
`services/localization` translation sets. Reason: the storefront is bilingual by default and a
side-by-side ar/en input is what a merchant can manage; translation sets are a platform tool.

## Permissions (all parts)

`online_store` joins `SHOP_RESOURCES` in `role-table-access-control.ts`, so a viewer gets
`online_store:read` and an operator gets `online_store:*`. The admin-only actions use the resource
`online_store_admin`. It is deliberately **not** in `SHOP_RESOURCES`, so only `admin` (`*:*`) has it.

| Permission                         | Roles                   | Used by                                                                                                  |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `online_store:read`                | viewer, operator, admin | read preferences, access status (never the hash), theme, releases, menus, policies; mint a preview token |
| `online_store:update_preferences`  | operator, admin         | home title/description, share image, default language                                                    |
| `online_store:upload_image`        | operator, admin         | `POST /online-store/images`                                                                              |
| `online_store:edit_theme`          | operator, admin         | save or discard the theme draft (brand, header, footer, homepage sections)                               |
| `online_store:manage_menus`        | operator, admin         | create, update and delete menus                                                                          |
| `online_store:manage_policies`     | operator, admin         | edit policies, generate templates                                                                        |
| `online_store_admin:publish_theme` | admin                   | publish the draft; restore a release into the draft                                                      |
| `online_store_admin:update_access` | admin                   | lock/unlock, set the password, edit the visitor message                                                  |
| `pages:update_page` (new action)   | operator, admin         | page title, body and meta description (2.4)                                                              |

**Our call:** publishing the theme is admin-only. Operators edit the draft and share preview links.
Reason: publish swaps the whole live look (logo, colours, homepage) in one click; it is the one
action here that can visibly break the store, while menus, policies and pages are routine content.

**Our call:** the password lock is admin-only. Reason: it takes the whole storefront offline for
customers.

**Our call:** minting a preview token needs only `online_store:read`. Reason: preview shows staff
content they can already read in the admin, and expires in 60 minutes.

Every new permission string is added to `PERMISSIONS` in `scripts/ops/seed-ory-network.mjs`, and to
the plan doc list it mirrors. `role-table-access-control.test.ts` asserts that an operator lacks both
`online_store_admin:*` permissions and a viewer lacks every write.

---

## Part 1 — Store identity and the storefront shell

### 1.1 Scope

Online-store preferences, the brand part of the theme document (logo, favicon, colours, fonts,
corners, social links), the draft/publish/release mechanism, preview tokens, the password lock, the
generalised image upload, and the shared storefront shell (layout, header, footer, metadata). It
also covers per-shop CSS variables and fonts, the caching and revalidation scheme, and the brand-name
fix.

### 1.2 Data model

Migration `20261027000000_online_store_identity`:

```sql
CREATE SCHEMA IF NOT EXISTS "online_store";

CREATE TABLE "online_store"."storefront_preferences" (
  "tenant_id"             TEXT         NOT NULL,
  "home_title"            JSONB        NOT NULL DEFAULT '{}',   -- LocalizedText, each ≤ 70
  "home_meta_description" JSONB        NOT NULL DEFAULT '{}',   -- LocalizedText, each ≤ 320
  "share_image_ref"       TEXT,                                 -- media asset id (bare ref)
  "default_locale"        TEXT         NOT NULL DEFAULT 'ar',
  "version"               INTEGER      NOT NULL DEFAULT 0,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_preferences_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_preferences_default_locale_check" CHECK ("default_locale" IN ('ar', 'en'))
);

CREATE TABLE "online_store"."storefront_access" (
  "tenant_id"           TEXT         NOT NULL,
  "locked"              BOOLEAN      NOT NULL DEFAULT false,
  "password_hash"       TEXT,                                   -- scrypt, encoded by the hasher
  "password_updated_at" TIMESTAMP(3),
  "message"             JSONB        NOT NULL DEFAULT '{}',     -- LocalizedText, each ≤ 500, plain text
  "access_version"      INTEGER      NOT NULL DEFAULT 1,        -- bumps on password change and on lock→unlock→lock
  "version"             INTEGER      NOT NULL DEFAULT 0,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_access_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "storefront_access_locked_needs_password_check" CHECK (NOT "locked" OR "password_hash" IS NOT NULL)
);

CREATE TABLE "online_store"."storefront_themes" (
  "tenant_id"                TEXT         NOT NULL,
  "draft"                    JSONB        NOT NULL,             -- ThemeDocument
  "draft_revision"           INTEGER      NOT NULL DEFAULT 1,   -- +1 on every draft save
  "draft_saved_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published"                JSONB,                             -- ThemeDocument; NULL = never published
  "published_draft_revision" INTEGER,                           -- the draft_revision that was published
  "release_number"           INTEGER      NOT NULL DEFAULT 0,   -- count of publishes
  "published_at"             TIMESTAMP(3),
  "published_by"             TEXT,                              -- staff principal id
  "version"                  INTEGER      NOT NULL DEFAULT 0,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_themes_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "online_store"."storefront_theme_releases" (
  "id"             UUID         NOT NULL,
  "tenant_id"      TEXT         NOT NULL,
  "release_number" INTEGER      NOT NULL,
  "document"       JSONB        NOT NULL,
  "published_at"   TIMESTAMP(3) NOT NULL,
  "published_by"   TEXT         NOT NULL,
  CONSTRAINT "storefront_theme_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storefront_theme_releases_tenant_id_release_number_key"
  ON "online_store"."storefront_theme_releases" ("tenant_id", "release_number");

CREATE TABLE "online_store"."preview_tokens" (
  "id"         UUID         NOT NULL,
  "tenant_id"  TEXT         NOT NULL,
  "token_hash" TEXT         NOT NULL,                           -- hex SHA-256; the token is never stored
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preview_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "online_store"."preview_tokens" ("token_hash");
CREATE INDEX "preview_tokens_tenant_id_expires_at_idx" ON "online_store"."preview_tokens" ("tenant_id", "expires_at");

-- + ENABLE + FORCE ROW LEVEL SECURITY and the tenant_isolation policy on all five tables
--   (global constraint 1), written out per table.
```

There are no FKs to other schemas (house rule: bare-id refs). There is no backfill, so existing
shops behave as follows:

| Row absent               | Meaning                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `storefront_preferences` | No home title (the `<title>` falls back to the store name), no description, no share image, default language Arabic |
| `storefront_access`      | Unlocked                                                                                                            |
| `storefront_themes`      | The **default document** (1.3) is both draft and live; the first draft save inserts the row                         |

**Our call:** the default storefront language is Arabic when no preference is saved. Reason: the
platform targets Arab merchants. Today's hard-coded `"en"` default is a placeholder, and a shop
switches it in one click.

**Our call:** single-row-per-shop JSON documents for the theme (draft + published) instead of
section rows. Reason: publish is one atomic copy, preview reads one row, and validation is one typed
function over the whole document.

**Our call:** keep the last **20** releases (pruned in the publish transaction). Reason: enough to roll
back a bad week of edits at about 20 × ≤ 256 KB per shop.

### 1.3 The theme document (Part 1 fields)

Defined in `@platform/storefront-content/theme-document`. `schemaVersion` allows later upcasting, and
the reader upcasts old documents on load.

```ts
interface ThemeDocument {
  readonly schemaVersion: 1;
  readonly brand: {
    readonly logo: { readonly imageRef: string | null; readonly widthPx: number }; // 60..320, default 140
    readonly favicon: { readonly imageRef: string | null };
    readonly colors: {
      readonly background: HexColor;
      readonly foreground: HexColor; // page, body text
      readonly primary: HexColor;
      readonly primaryForeground: HexColor; // buttons, links
      readonly accent: HexColor;
      readonly accentForeground: HexColor; // badges, sale, announcement
    };
    readonly typography: {
      readonly headingFont: FontKey;
      readonly bodyFont: FontKey;
      readonly baseSize: "small" | "medium" | "large"; // 14 / 15 / 16 px
    };
    readonly corners: "square" | "rounded" | "pill";
    readonly social: Partial<
      Record<"facebook" | "instagram" | "tiktok" | "x" | "youtube" | "snapchat", string>
    >; // https URLs
  };
  readonly header: { readonly sticky: boolean /* Part 2: menuHandle; Part 3: announcement */ };
  readonly footer: {
    readonly note: LocalizedText /* ≤ 200 */;
    readonly showSocial: boolean; /* Part 2: menuHandle, showPolicyLinks */
  };
  readonly homepage: { readonly sections: readonly Section[] }; // Part 3; [] until then (storefront keeps today's homepage)
}
type HexColor = `#${string}`; // exactly /^#[0-9a-f]{6}$/ after normalisation (uppercase accepted, stored lowercase)
```

The **default document** is the current `@platform/design` light palette mapped onto the six colours,
`ibm-plex-sans-arabic` for both fonts, `medium`, `rounded`, no logo, no social links. A shop that
never opens the editor looks exactly as it does today.

**Fonts.** **Our call:** a curated set of six self-hosted families, each with Arabic and Latin glyphs:

| `FontKey`              | Family               | Character                                     | Weights         |
| ---------------------- | -------------------- | --------------------------------------------- | --------------- |
| `ibm-plex-sans-arabic` | IBM Plex Sans Arabic | neutral, current default                      | 400 500 600 700 |
| `cairo`                | Cairo                | the most used in Egyptian e-commerce, rounded | 400 700         |
| `tajawal`              | Tajawal              | light, modern                                 | 400 700         |
| `almarai`              | Almarai              | geometric, Gulf-market look                   | 400 700         |
| `readex-pro`           | Readex Pro           | wide, friendly (Lexend Latin)                 | 400 700         |
| `amiri`                | Amiri                | classic Naskh, for headings of luxury shops   | 400 700         |

Reason: every family covers both scripts, so one choice serves the bilingual storefront. Packages are
`@fontsource/*` (arabic + latin subsets, `font-display: swap`), bundled at build time with no request
to Google. `@font-face` downloads lazily, so a shop only fetches the families it uses. A font is
referenced only through a fixed `FontKey → CSS family` map; merchant text never becomes a font name.
Geist stays only as the platform fallback in the stack.

**Colours: validation.** Each colour must match `^#[0-9a-fA-F]{6}$` (no `rgb()`, names, alpha or
3-digit form). The admin colour field normalises, and the server rejects anything else with
`INVALID_COLOR` per field. Contrast is checked with `packages/design/src/contrast.ts`:

- `foreground` on `background` below **3:1** → rejected (`CONTRAST_TOO_LOW`). Below 4.5:1 → warning.
- `primaryForeground` on `primary` and `accentForeground` on `accent` below 4.5:1 → warning only, shown
  in the editor with an "Auto-fix" button that picks black or white.

**Our call:** only unreadable body text blocks a save; the rest warns. Reason: brand colours are the
merchant's identity, and the platform should stop the illegible case, not every taste.

**Derived tokens.** The storefront computes the remaining semantic vars (`--muted`, `--border`,
`--card`, `--ring`, `--primary-hover`, `--accent` family, `--radius-*`) from the six colours and
`corners` with a pure function `brandToCssVars(brand)` in the package. It is unit-tested for every
default and for edge colours (pure black or white).

**Dark mode.** **Our call:** a shop with a **published** brand renders in the light scheme only (the
`ThemeToggle` is hidden, `next-themes` forced to `light`). Shops still on the default document keep
today's toggle. Reason: a merchant's chosen palette is the design. An automatic dark inversion of it
would show colours the merchant never chose; a merchant wanting dark picks dark colours.

**Social links.** Each value must be an `https:` URL of at most 500 characters. The host is not
restricted, since links go through brand URL shorteners. The footer renders icons for the set
fields only.

**Limits.** The serialised document is at most 256 KB (`DOCUMENT_TOO_LARGE`). Unknown keys are
rejected (`.strict()` on the route, and the domain validator rejects them too).

### 1.4 Preferences

`StorefrontPreferences` aggregate: `homeTitle`, `homeMetaDescription`, `shareImageRef`,
`defaultLocale`. Saving is live (no draft), matching Shopify's Preferences page.

- Title: at most 70 characters per locale. Description: at most 320. Both plain text with control
  characters stripped.
- `shareImageRef` must be one of the shop's own active media assets (checked through `ImageRefsPort.
existingIds`, 1.8). Upload purpose `share_image` (1.7).

**Our call:** logo and favicon belong to the theme (draft, preview, publish), while title,
description and share image belong to Preferences (live on save). Reason: this is Shopify's split,
and the visual items benefit from preview while SEO text does not.

**Our call:** there is no second "store name" field. The storefront shows Settings → General's store
name, and Preferences shows it read-only with a link. Reason: one source of truth; a second name
field would drift from invoices, emails and the admin.

### 1.5 Password lock

`StorefrontAccess` aggregate: `locked`, `passwordHash`, `passwordUpdatedAt`, `message`,
`accessVersion`.

- `UpdateStorefrontAccess { locked, password?: string | null, message }`. A non-empty `password`
  replaces the hash. Omitted means keep the current one. `locked = true` with no hash on record →
  `PASSWORD_REQUIRED`. Password: 4–100 characters, trimmed, any script.
- `accessVersion` is incremented when the password changes and when `locked` goes from false to true.
  That invalidates every unlock cookie at once.
- Hashing goes through a port `StorefrontPasswordHasher { hash(plain); verify(plain, hash) }`.
  `apps/admin` composition adapts `ScryptPasswordHasher` from `@platform/security`; in-memory tests use
  a fake.
- Neither the hash nor the password is ever returned. The admin DTO carries `passwordSet: boolean`
  and `passwordUpdatedAt`.

**Our call:** the password is stored hashed and cannot be shown again; the merchant can only replace
it. Reason: this is the stated security constraint. Shopify shows it in plain text, but a forgotten
password is solved by setting a new one.

**Unlock flow.**

1. The storefront `/password` page posts to a server action, which calls `POST /public/online-store/unlock
{ password }` (public, `.strict()`).
2. The route consumes the existing `RateLimiter` with key `rl:${tenantId}:storefront-unlock`, **20
   attempts per 10 minutes per shop**, and answers 429 `RATE_LIMITED` with `retry-after`, as signup
   does. A wrong password, no lock, or no hash all return the same 401 `{ code: "PASSWORD_INCORRECT" }`.
   A hash is always computed (against a fixed dummy when absent), so timing does not reveal state.
3. On success: 200 `{ accessVersion }`.
4. The storefront signs the unlock cookie (below) and redirects to `return_to`. `return_to` must be a
   relative path starting with `/` and not `//`, otherwise `/`.

**Our call:** the rate limit is per shop, not per IP. Reason: the Runtime API only sees the
storefront server's IP (the public limiter keys on `request.ip`), so a per-IP key would be one
shared bucket anyway. A per-shop cap stops guessing. Its only cost is that a flood can delay real
visitors of a pre-launch shop, which is acceptable.

**Unlock cookie.** Name `morbeh-storefront-access`, value
`v1.<accessVersion>.<expUnix>.<base64url(HMAC-SHA256(STOREFRONT_ACCESS_SECRET, shopId|accessVersion|expUnix))>`.
Flags: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain` (host-only, so shop A's cookie never
reaches shop B on a sibling subdomain), `Max-Age` 7 days. The middleware verifies the HMAC with Web
Crypto (Edge-safe), plus the shop id, the expiry, and that `accessVersion` equals the current one.

**Our call:** the storefront signs the cookie with its own secret, and the cookie holds no password,
hash or token. Reason: verification then runs locally in middleware on every request with no Runtime
call, and the cookie is a short proof rather than a secret.

**Our call:** the unlock lasts 7 days. Reason: a merchant's testers reopen the shop over a launch
week without re-entering the password; changing the password revokes it immediately.

`STOREFRONT_ACCESS_SECRET` (at least 32 bytes) is required in production. When it is missing, the
gate still holds (fail closed) and unlock answers "temporarily unavailable". There is a boot-time
production assertion like the runtime's `assertProduction*`.

### 1.6 Preview tokens

- `IssuePreviewToken { createdBy, tenantId }` creates a 32-byte `crypto.randomBytes` token, base64url
  encoded, stores only `sha256(token)`, and sets a **60-minute** expiry. It deletes this shop's expired
  rows in the same transaction.
- `ResolvePreviewToken { token, tenantId }` looks up the hash inside the request tenant's scope (RLS).
  A token from shop A is unknown in shop B. It returns usable or not; there is no reason detail.
- Admin route `POST /online-store/preview-tokens` (`online_store:read`) → 201
  `{ token, expiresAt, url: string | null }`. `url` is `https://<primary verified hostname>/?preview=<token>`
  from the tenancy domains read (the tenancy exemption applies there, as in Project 3 decision 22).
  When it is `null`, admin-web prefixes its `STOREFRONT_URL`. The route is not idempotent, so a token
  is never replayed from the idempotency cache.

**Our call:** preview travels as a `?preview=<token>` query parameter on every preview request, not
as a cookie. Reason: the editor shows the storefront in an iframe on the admin's origin. Browsers block
third-party cookies there, so a preview cookie would silently fail in Safari and Chrome.

**Our call:** the preview token is opaque, hashed at rest and valid for 60 minutes; it is not a signed
stateless token. Reason: it reuses Project 3's link-token shape, can be revoked (rows are deletable),
and is short enough that a leaked URL dies quickly.

Preview mode on the storefront (1.12) is **view-only**: server actions (add to cart, checkout) are
refused while previewing.

### 1.7 Image uploads

**Our call:** reuse and generalise the existing server-proxied upload (`POST /media/uploads`: raw
bytes through the runtime, sniffed, stored under an immutable key on the public bucket) instead of
issuing `packages/storage` signed PUT URLs. Reason: with direct-to-bucket PUTs the server cannot
inspect the bytes before they are publicly served. It would need a second verify-then-delete step and
bucket CORS. The existing path already validates type and size server-side and is in production.

In `services/media`, `UploadProductImage` becomes `UploadImage { bytes, fileName?, purpose, tenantId }`.
`UploadProductImage` stays exported as `purpose: "product"` for the existing route, unchanged.
Per-purpose policy, checked **after sniffing** (the bytes decide, never the client's content type):

| `purpose`       | Namespace        | Types             | Max bytes | Dimensions                          |
| --------------- | ---------------- | ----------------- | --------- | ----------------------------------- |
| `product`       | `product-images` | JPEG PNG WebP GIF | 8 MB      | as today                            |
| `logo`          | `brand-assets`   | PNG WebP JPEG     | 2 MB      | 32–4000 px each side                |
| `favicon`       | `brand-assets`   | PNG               | 1 MB      | square, 32–1024 px                  |
| `share_image`   | `brand-assets`   | JPEG PNG          | 5 MB      | ≥ 600 × 315; 1200 × 630 recommended |
| `section_image` | `theme-assets`   | JPEG PNG WebP     | 8 MB      | ≥ 200 px each side                  |

For every purpose, `width × height ≤ 40 megapixels` (`IMAGE_TOO_LARGE_DIMENSIONS`). That protects
browsers and any future transformer from decompression bombs. Errors: `too_large` (413),
`unsupported` (415), `bad_dimensions` (422 with `{ min, max, square }`), `unavailable` (503 when the
bucket or `MEDIA_PUBLIC_BASE_URL` is not set, as today).

**Our call:** favicons are PNG only, with no `.ico` conversion and no server resizing. Reason: there is
no image transformer yet (G-28), and every current browser accepts a PNG `<link rel="icon">`.

**Our call:** share images are JPEG or PNG only. Reason: WhatsApp and some link-preview crawlers still
skip WebP and GIF, and WhatsApp is the main sharing channel for Egyptian shops.

Route `POST /online-store/images?purpose=logo|favicon|share_image|section_image`
(`online_store:upload_image`, `binaryBody { maxBytes: 8 MB, contentTypes: [image/jpeg, image/png,
image/webp] }`, idempotent) → `{ id, url, width, height, alt }`. The route lives in
`online-store-routes.ts` and delegates to `admin.mediaLibrary.uploadImage`. The asset is a normal
Media Library asset, so it shows in the library and its alt text is editable via the existing `PATCH`.

Images are referenced by media asset id. Every write that stores an image ref checks ownership via
`ImageRefsPort.existingIds(ids, tenantId)`, backed by `ResolveMediaImages.existingIds`. A foreign,
archived or unknown id gives `IMAGE_NOT_FOUND`. Reads resolve ids to `{ url, alt, width, height }`
with **one** batched `ResolveMediaImages` call per response. A missing image resolves to `null`, and
the element is omitted. Storage keys and tenant ids never appear on the wire.

### 1.8 Domain, ports and use cases (`services/online-store`)

Layout copies `services/theme`: `domain/`, `application/`, `infrastructure/` (in-memory and Prisma
repositories, mappers, event translator), `interfaces/online-store.controller.ts`, `composition.ts`
(`wireOnlineStore(deps)` → `{ controller, publicReads, drainOutbox, deliveredEventTypes }`), `index.ts`.

- Aggregates: `StorefrontPreferences`, `StorefrontAccess`, `StorefrontTheme` (draft, published,
  revisions; `saveDraft(doc, expectedDraftRevision)`, `publish(expectedDraftRevision, by, now)` →
  `ThemeRelease`, `discardDraft()`, `restoreRelease(release)` → draft), `PreviewToken`.
- Repositories (all `tenantId` per call): `PreferencesRepository`, `AccessRepository`,
  `ThemeRepository` (`get`, `save` with optimistic `version`), `ThemeReleaseRepository` (`append`,
  `list(first 20)`, `get(releaseNumber)`, `pruneBeyond(20)`), `PreviewTokenRepository`.
- Ports (adapters in `apps/admin/src/infrastructure/cross-context/online-store.adapters.ts`):
  - `ImageRefsPort { existingIds(ids, tenantId); resolve(ids, tenantId) }`, backed by media.
  - `StorefrontPasswordHasher`, backed by security's scrypt hasher.
  - `ShopHostPort { primaryHostname(tenantId) }`, backed by tenancy domains.
  - `StoreIdentityPort { storeName(tenantId) }`, backed by tenancy store settings. See "what stays
    pinned" in the security section.
  - Part 2 adds `LinkTargetsPort`.
- Use cases: `GetPreferences`, `UpdatePreferences`, `GetAccessStatus`, `UpdateAccess`,
  `VerifyStorefrontPassword`, `GetPublicAccess`, `GetTheme`, `SaveThemeDraft`, `PublishTheme`,
  `DiscardThemeDraft`, `ListThemeReleases`, `RestoreThemeRelease`, `IssuePreviewToken`,
  `ResolvePreviewToken`, `GetStorefrontShell` (live or preview).
- Events (outbox, same transaction): `online_store.theme.published { releaseNumber }`,
  `online_store.access.changed { locked }`, `online_store.preferences.updated`. No consumer in this
  project. They exist for the audit trail and later webhooks.

**Our call:** publish is optimistic on the draft the merchant previewed. `PublishTheme` takes
`expectedDraftRevision`; if the draft changed since (another tab, another staff member), the answer is
409 `DRAFT_CHANGED`. Reason: you publish exactly what you looked at.

**Our call:** "Restore" copies a release into the **draft** (never straight to live), and publishing it
is a separate step. Reason: the merchant previews the old version before it replaces the live store.

### 1.9 Admin API (`apps/admin/src/http/online-store-routes.ts`)

| Route                                                      | Permission                         | Shape                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /online-store/preferences`                            | `online_store:read`                | `PreferencesDto { homeTitle, homeMetaDescription, shareImage: ImageDto \| null, defaultLocale, storeName }`                                                                                              |
| `PUT /online-store/preferences`                            | `online_store:update_preferences`  | `{ homeTitle, homeMetaDescription, shareImageId: string \| null, defaultLocale, expectedVersion }`                                                                                                       |
| `GET /online-store/access`                                 | `online_store:read`                | `{ locked, passwordSet, passwordUpdatedAt, message, version }`                                                                                                                                           |
| `PUT /online-store/access`                                 | `online_store_admin:update_access` | `{ locked, password?: string, message, expectedVersion }` → same DTO                                                                                                                                     |
| `GET /online-store/theme`                                  | `online_store:read`                | `ThemeStateDto { draft, published \| null, draftRevision, draftSavedAt, publishedDraftRevision, releaseNumber, publishedAt, publishedBy, hasUnpublishedChanges, images: Record<id, ImageDto>, version }` |
| `PUT /online-store/theme/draft`                            | `online_store:edit_theme`          | `{ document, expectedVersion }` → `{ draftRevision, version, warnings: ContrastWarning[] }`                                                                                                              |
| `POST /online-store/theme/discard-draft`                   | `online_store:edit_theme`          | `{ expectedVersion }`                                                                                                                                                                                    |
| `POST /online-store/theme/publish`                         | `online_store_admin:publish_theme` | `{ expectedDraftRevision }` → `{ releaseNumber, publishedAt }`                                                                                                                                           |
| `GET /online-store/theme/releases`                         | `online_store:read`                | `{ releases: { releaseNumber, publishedAt, publishedByName }[] }` (last 20)                                                                                                                              |
| `POST /online-store/theme/releases/:releaseNumber/restore` | `online_store_admin:publish_theme` | `{ expectedVersion }` → into draft                                                                                                                                                                       |
| `POST /online-store/images?purpose=`                       | `online_store:upload_image`        | 1.7                                                                                                                                                                                                      |
| `POST /online-store/preview-tokens`                        | `online_store:read`                | 1.6                                                                                                                                                                                                      |

All bodies use `.strict()`, and writes are `idempotent: true` except preview tokens. DTO mappers are
explicit, so no aggregate reaches the wire. `publishedByName` comes from the staff directory read when
available, otherwise `null` ("Staff").

### 1.10 Public API (`apps/admin/src/http/public-online-store-routes.ts`)

| Route                              | Shape                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/online-store`         | `PublicShellDto` (below). With header `x-preview-token`: the draft when the token resolves; an invalid token → 401 `PREVIEW_INVALID` (storefront falls back to live) |
| `GET /public/online-store/access`  | `{ locked, accessVersion, message: LocalizedText }`. `message` is the visitor text, never anything else                                                              |
| `POST /public/online-store/unlock` | 1.5                                                                                                                                                                  |

```ts
PublicShellDto = {
  mode: "live" | "preview",
  storeName: string, // Settings → General; "" when unset
  defaultLocale: "ar" | "en",
  preferences: {
    homeTitle: LocalizedText,
    homeMetaDescription: LocalizedText,
    shareImage: ImageDto | null,
  },
  brand: {
    logo: { image: ImageDto | null, widthPx: number },
    favicon: ImageDto | null,
    colors,
    typography,
    corners,
    social,
  },
  header: { sticky: boolean }, // Part 2: menu; Part 3: announcement
  footer: { note: LocalizedText, showSocial: boolean }, // Part 2: menu, policies
  locked: boolean,
};
ImageDto = { url: string, alt: string | null, width: number | null, height: number | null };
```

There is no tenant id, storage key, revision counter, hash or `accessVersion` in the shell. The routes
are wired as `admin.publicReads.onlineStore.shell(tenantId, previewToken?)` and siblings, which are
**closures** over the wired controller (constraint 2). A test asserts that the DTO has no aggregate
internals, as `public-catalog-routes.test.ts` does.

### 1.11 admin-web

- **Navigation.** `ONLINE_STORE_NAV` changes to `href: "/online-store/themes"` with children
  **Themes** (`/online-store/themes`, "الثيمات"), **Pages** (`/pages`), **Navigation** (Part 2,
  `/online-store/navigation`, "القوائم"), **Preferences** (`/online-store/preferences`, "التفضيلات"),
  **SEO** (kept). The old `/theme` screens move to `PLATFORM_TOOLS_NAV` as "Theme tokens (raw)".
  Their routes are unchanged.
- **Role gating** (`middleware.ts`, longest prefix, plus `middleware.test.ts`):
  `["/online-store/themes/customize", "operator"]`, `["/online-store", "viewer"]`. Viewers see
  read-only forms; buttons they cannot use are disabled with a tooltip ("Only admins can publish" /
  "مسموح للأدمن بس ينشر").
- **`/online-store/themes`** (Shopify's Themes page): a **Current theme** card ("Morbeh Classic" /
  "مربح كلاسيك", last published date and by whom, a "Unpublished changes" badge). Buttons:
  **Customize** / **تخصيص** (operator+), **Preview** / **معاينة** (mints a token, opens the URL in a new
  tab), and **Publish** / **نشر** (admin only, shown when there are unpublished changes; the confirm
  dialog says "This replaces your live store's look"). Below is a **Release history** table (number,
  date, by) with **Restore to draft** (admin). The store-lock state is shown as a banner ("Your store
  is password protected", linking to Preferences), as Shopify does.
- **`/online-store/themes/customize`** is a full-screen editor outside `AppShell`. In Part 1 it shows
  the **Theme settings** panels only; Part 3 adds the section tree.
  - Top bar: **Exit**, desktop/mobile toggle (iframe width 100% / 390 px), save state ("Saved" /
    "Saving…" / "Couldn't save"), **Preview** (new tab), **Publish** (admin).
  - Left panel: **Logo & favicon** (upload, width slider, live alt = store name), **Colours** (six
    swatches: native `<input type=color>` plus a hex text field; contrast badges with Auto-fix),
    **Typography** (heading and body font selects showing a sample "مربح Morbeh 123" in each font,
    base size), **Corners** (three visual options), **Social links**, **Footer note**.
  - Right panel: the preview iframe (1.12). After each successful draft save it reloads, keeping the
    scroll position.
  - **Our call:** the draft autosaves 1 second after the last change, one request in flight at a time,
    each carrying `expectedVersion`. A 409 shows "This theme was changed in another window. Reload to
    continue." Reason: a live preview needs the draft saved; a manual Save button would make preview
    lag behind every edit. Only the draft autosaves, never the live store.
- **`/online-store/preferences`**: **Home page title and meta description** card (ar/en tabs,
  counters 70/320, a Google snippet preview). **Social sharing image** card (upload, recommended size
  hint, a WhatsApp/Facebook card preview). **Store language** (default ar/en). **Password
  protection** card: for admins, a switch "Restrict access to visitors with the password" ("اقفل
  المتجر وخلّي الدخول بكلمة سر بس"), a "Set new password" field (never pre-filled), the visitor
  message (ar/en) and the note "Changes reach your store within a minute"; for others, the same
  read-only. Store name is read-only with "Change in Settings → General".
- **UI primitives** added to `@platform/ui` (native elements, no new dependencies): `Textarea`,
  `NativeSelect`, `Switch` (checkbox-based), `ColorField` (colour input + hex input). Server actions
  in `app/online-store/*/actions.ts`; `lib/api/online-store.ts` (server only; the route-contract
  test covers it).
- After any successful save that affects the live storefront (preferences, access, publish, restore
  then publish; in Part 2 menus, policies and pages), the server action calls
  `revalidateStorefront(tenantId)` (1.12, best effort, 2 s timeout, never fails the action).

### 1.12 Storefront

**Route structure.** **Our call:** existing pages move under a route group `app/(store)/`, whose
`layout.tsx` renders the shell (header, children, footer). The password page lives in
`app/(gate)/password/`. URLs are unchanged. Reason: the password page needs the brand (fonts,
colours, logo) without the shop's header and footer, which a root layout cannot vary by path. The
14 per-page `<SiteHeader>` calls are removed.

**Root layout** (`app/layout.tsx`):

1. Reads the shop (`x-shop-id`, or `TENANT_DEFAULT_ID` with host routing off) and
   `getStorefrontShell(preview)` (cached, below).
2. Picks the locale from the cookie, else `shell.defaultLocale`. Sets `lang`/`dir`.
3. Emits `<style id="brand">:root{…}</style>` from `brandToCssVars(shell.brand)` and the two font
   stacks from the `FontKey` map. The storefront **re-validates** every colour and enum with the
   package validator and falls back to defaults on any failure, as defence in depth.
4. `generateMetadata`:
   - title default is `pickText(homeTitle)` or the store name, with template `%s | <storeName>`;
   - description;
   - `openGraph` (site name, locale `ar_EG`/`en_US`, image with width and height, type `website`);
   - `twitter: summary_large_image`;
   - `icons` (favicon as `icon` and `apple-touch-icon`).

   A locked store (not previewing) also gets `robots: { index: false, follow: false }`.

**Header** (`components/site-header.tsx`, now driven by the shell): logo image (`height` capped at
48 px desktop / 40 px mobile, width from `widthPx`, `alt = storeName`, never mirrored in RTL), or the
store name as text when there is no logo, or the dictionary brand "مربح" when the store has no name.
Then search, account, cart and the language switch. The `ThemeToggle` is shown only when the shop has
no published brand. Optionally sticky. The logo sits at the inline start (right in RTL).

**Footer** (`components/site-footer.tsx`, new): store name, footer note, social icons, "©
<year> <storeName>", and "Powered by مربح" (Part 2 adds the menu and policy links).

**Our call:** the footer carries a small "Powered by مربح / Powered by Morbeh" line. Reason: free brand
reach on every shop; removing it can become a plan perk later.

**Data access** (`lib/online-store.ts`):

- `getStorefrontShell(previewToken?)`:
  - live: `unstable_cache(fetchShell, ["online-store", shopId, "shell"], { tags: [`os:${shopId}`],
revalidate: 60 })`;
  - preview: `cache: "no-store"` with header `x-preview-token`. On 401 `PREVIEW_INVALID` it returns
    the live shell plus `previewExpired: true`.
- `getStorefrontAccess()` is used **only by middleware**. It has its own in-memory TTL cache
  (`createShopResolver` pattern, 15 s, keeps the last known value for up to 5 minutes when the
  Runtime errors, and never caches a failure).

**Our call:** cached public reads use `unstable_cache` with the shop id in the **key parts** and a
`os:<shopId>` tag, plus a 60-second TTL. Reason: the shop id is explicit in the key, so there is no
reliance on fetch-cache header hashing. The TTL bounds staleness on multi-instance deployments, where
on-demand revalidation reaches only one instance.

**Our call:** on-demand revalidation goes through a storefront route handler `POST /api/revalidate`.
admin-web calls it server-to-server with header `x-revalidate-secret: <STOREFRONT_REVALIDATE_SECRET>`
(constant-time compare) and body `{ shopId }`, and the handler calls `revalidateTag('os:'+shopId)`.
Reason: a merchant who presses Publish expects to see it now, and the 60 s TTL is only the safety net.
Uses `STOREFRONT_INTERNAL_URL ?? STOREFRONT_URL`. Failure is logged and ignored.

Catalog reads (product pages, cart, checkout) stay `no-store` as today. Part 3 decides the homepage
section reads.

**Middleware** (extends `apps/storefront/src/middleware.ts`):

1. As today: strip a client-sent `x-shop-id`, then resolve the shop when host routing is on. **The new
   steps run in both modes.** With routing off, the shop is `TENANT_DEFAULT_ID`; today's early return
   moves below them.
2. Strip any client-sent `x-morbeh-preview`. If the request is a `GET` with `?preview=<token>` (at most
   100 chars, base64url), set `x-morbeh-preview: <token>` on the forwarded request. On the response,
   set `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and
   `Content-Security-Policy: frame-ancestors 'self' <ADMIN_ORIGIN>`.
3. All other responses get `Content-Security-Policy: frame-ancestors 'self'` (clickjacking
   protection, including on `/password`).
4. Lock gate: these paths are exempt:
   - `/password`;
   - `/policies/*` (Part 2, see the decision below);
   - `/robots.txt`, `/sitemap.xml`;
   - `/_next/*`;
   - `/api/tls-allowed`, `/api/revalidate` (both also excluded from shop resolution by the matcher).

   For every other path, read access (cached).

   | Request                    | Locked and no valid unlock cookie                                                                                      |
   | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `GET` with a preview token | Passes. The `(store)` layout validates the token. If it is invalid and the store is locked, it `redirect("/password")` |
   | Any other `GET`            | `302` to `/password?return_to=<path>`                                                                                  |
   | `POST` (server actions)    | `403`                                                                                                                  |

   With no access state known and the Runtime failing, the answer is `503` (fail closed, as the shop
   resolver does).

**Our call:** policy pages stay reachable while the store is locked. Reason: payment gateways review
the refund, shipping and privacy URLs during merchant onboarding, which happens before launch.

**Our call:** a locked store redirects with 302 to `/password`, as Shopify does, and the password page
is `noindex`. Reason: matches Shopify and the expectations of bots and link previews. robots and
sitemap (Part 2) close the rest.

**Password page** (`app/(gate)/password/page.tsx`): logo or store name, the merchant's message (plain
text, `dir="auto"`), or the default "سيفتح المتجر قريبًا" / "Opening soon". A password field with
**Enter** / **دخول**. Errors are "Incorrect password" / "كلمة المرور غير صحيحة" and "Too many attempts,
try again in N minutes". A small "Are you the store owner? Log in to the admin" link to `ADMIN_ORIGIN`.

**Preview mode.**

- The `(store)` layout reads `x-morbeh-preview`. If present, it uses the preview shell.
- A thin top banner reads "Preview — not visible to customers" ("معاينة — غير ظاهرة للعملاء") with
  the expiry. On an expired token the banner reads "Preview link expired" and the page shows live.
- All internal links go through `href(path)`, which appends `?preview=` in preview mode, so navigation
  stays in preview.
- Cart and checkout buttons are disabled with "Not available in preview" ("غير متاح أثناء المعاينة").
  The middleware's `403` on `POST` while locked covers locked stores; for unlocked stores in preview,
  the actions check the header and refuse.

**Brand fix:** storefront `ar.brand` becomes "مربح" (en "Morbeh"). admin-web dictionaries are checked
for the same and fixed in this part.

**Environment:**

- storefront: `STOREFRONT_ACCESS_SECRET`, `STOREFRONT_REVALIDATE_SECRET`, `ADMIN_ORIGIN`;
- admin-web: `STOREFRONT_REVALIDATE_SECRET`, optional `STOREFRONT_INTERNAL_URL`.

All are documented in each app's `.env.example`, with production assertions.

### 1.13 Testing (Part 1)

- **Package:** document validator (every field, unknown keys, limits, 256 KB), hex parsing, contrast
  rules, `brandToCssVars` snapshots and edge colours, `pickText` fallback, font map completeness.
- **Domain/use cases:** draft save and revision bump; publish with stale revision → 409; release
  pruning at 21; restore into draft; access rules (`PASSWORD_REQUIRED`, version bump on password
  change and on re-lock); password never in any DTO; preview token issue, expiry and hash-only storage;
  image ref ownership.
- **Repositories:** Prisma integration for each table; `tenant-isolation.test.ts` for each (shop A
  cannot read B's theme, preview hash or access row).
- **Media:** per-purpose limits (each type, size, dimension and 40 MP rule; favicon square; share
  image rejects WebP); product route unchanged.
- **Routes:** permissions per route (viewer refused writes; operator refused publish and access);
  unlock rate limit (21st attempt → 429), uniform 401, dummy-hash timing path; shell DTO
  leak test (no tenant, key, hash or version); preview header → draft, bad token → 401.
- **Tenant-mode guard:** the composed graph still has only the `tenancy` exemption.
- **Storefront:** middleware matrix (locked × cookie valid/expired/wrong shop/old version × GET/POST ×
  preview × exempt paths × routing on/off); cookie sign/verify on Edge Web Crypto; `return_to`
  sanitisation; layout CSS from shell and fallback on corrupt data; metadata (title template, OG,
  icons, noindex when locked); header logo in RTL and LTR; `unstable_cache` key includes the shop
  (two shops → two entries); `/api/revalidate` secret check.
- **admin-web:** editor panels, autosave debounce and 409 state, contrast badges and Auto-fix,
  role-disabled Publish and Password controls, `middleware.test.ts` entries, en/ar parity.

---

## Part 2 — Navigation and content

### 2.1 Rich text format

**Our call:** merchant rich text is a **restricted Markdown subset** ("Morbeh text"), stored as plain
text and parsed by our own parser in `@platform/storefront-content/rich-text` into a typed AST. That
AST is rendered to React elements, never to an HTML string. Reason: Markdown is readable and editable
in a plain textarea with a small toolbar (no editor dependency). Policy templates are easy to author in
it. With no HTML passthrough and React rendering, XSS is impossible by construction. A JSON block
format would need a block editor UI this project does not otherwise need.

Supported syntax:

| Element         | Syntax                                         |
| --------------- | ---------------------------------------------- |
| Paragraphs      | blank-line separated                           |
| Headings        | `##` and `###` only (the page title is the h1) |
| Emphasis        | `**bold**`, `*italic*`                         |
| Lists           | `- item` and `1. item`, one level              |
| Links           | `[text](url)`                                  |
| Horizontal rule | `---`                                          |
| Line breaks     | a hard break inside a paragraph                |

Anything else, including `<`, backticks and images, renders as literal text. There is no HTML.

Link URLs allow only `https:`, `mailto:`, `tel:`, and relative paths starting with a single `/`.
Anything else (`javascript:`, `data:`, `http:`, `//host`) makes the link render as plain text, and the
API rejects it on save with `UNSAFE_LINK` at a line number. External links render with
`rel="noopener noreferrer nofollow"` and `target="_blank"`.

The parser is linear-time, with no backtracking regexes. Limits: 100,000 characters per locale for
policies and pages, 5,000 for section bodies. The same `validateRichText` runs in the API (reject),
in admin-web (inline errors and preview), and in the storefront (render-time safety).

### 2.2 Menus

Model in `services/online-store`:

```ts
Menu { id, handle /* ^[a-z0-9]+(-[a-z0-9]+)*$, ≤ 60 */, title /* ≤ 100 */, items: MenuItem[], version }
MenuItem { id /* uuid */, label: LocalizedText /* each ≤ 60, at least one locale */, link: LinkRef,
           children: MenuItem[] /* children have children = [] */ }
LinkRef =
  | { type: "home" } | { type: "search" }
  | { type: "collection"; id: string } | { type: "product"; id: string } | { type: "page"; id: string }
  | { type: "policy"; policy: PolicyType }
  | { type: "url"; url: string }   // https:, mailto:, tel: only; ≤ 2,000; no credentials (user:pass@)
```

- **Depth:** at most two levels, enforced in the validator (a child with children → `MENU_TOO_DEEP`).
  At most 30 top-level items, 30 children per item, 150 items in total.
- **No loops by construction:** an item links to a resource, never to another menu or item, and depth
  is capped. Duplicate item ids → `DUPLICATE_ITEM_ID`.
- **Our call:** `main-menu` and `footer` always exist. When there is no row they are served as virtual
  defaults, and the first save inserts the row. They cannot be deleted or renamed, though their title
  can change. Other menus are free to create (for later templates) and delete. Reason: the header and
  footer can always rely on their handles, and no seed migration is needed.
  - Default `main-menu`: Home, Search.
  - Default `footer`: Search, plus one item per policy that has content.
- **Links resolve at read time.** Items store ids, and the public shell resolves them through
  `LinkTargetsPort.resolve(refs, tenantId)` (one batched read per kind) to `{ href, published }`:
  collection → `/collections/<slug>`, product → `/products/<slug>`, page → `/pages/<handle>`,
  policy → `/policies/<slug>`, home → `/`, search → `/search`. A target that is missing, unpublished
  or archived is **dropped** from the public menu, and the admin shows it with a "Broken link" badge.
  **Our call:** reference by id, resolve on read. Reason: renaming a product's slug never breaks a
  menu (Shopify's behaviour), and the cost is one batched read per kind inside a 60 s cache.
- The `LinkTargetsPort` adapter uses the catalog product and collection reads and the pages read. If
  the catalog has no by-ids read, add `GetProductsByIds` / `GetCollectionsByIds` (one tenant-scoped
  query each).
- Resource picker for the admin: `GET /online-store/link-targets?type=collection|product|page|policy&q=`
  (`online_store:read`) → at most 20 `{ id, title, subtitle }`. This closes the survey gap that
  collections have no authenticated list route.

The theme document's `header` gains `menuHandle: string` (default `"main-menu"`), and `footer` gains
`menuHandle` (default `"footer"`) and `showPolicyLinks: boolean` (default true). Both are edited in
the customize editor (header and footer panels) and published with the theme.

**Our call:** menus themselves are live on save (no draft), but which menu the header and footer use
is a theme setting. Reason: Shopify works this way; menu edits are routine content, and swapping the
menu is a design change.

### 2.3 Policies

```ts
type PolicyType = "refund" | "shipping" | "privacy" | "terms" | "contact";
Policy { type, body: LocalizedText /* Morbeh text, each ≤ 100,000 */, updatedAt, updatedBy, version }
```

Storefront URLs follow Shopify exactly: `/policies/refund-policy`, `/policies/shipping-policy`,
`/policies/privacy-policy`, `/policies/terms-of-service`, `/policies/contact-information`.
Titles are fixed and translated by the storefront dictionary:

| Type       | English             | Arabic (storefront, MSA) |
| ---------- | ------------------- | ------------------------ |
| `refund`   | Refund policy       | سياسة الاسترجاع          |
| `shipping` | Shipping policy     | سياسة الشحن              |
| `privacy`  | Privacy policy      | سياسة الخصوصية           |
| `terms`    | Terms of service    | شروط الخدمة              |
| `contact`  | Contact information | معلومات التواصل          |

A policy with no text in either locale is "not set": it returns 404 publicly and is hidden from
footers and menus. A policy with only one locale is shown in that locale for both, as with any
`LocalizedText`. The page shows "Last updated <date>".

**Templates.** `POST /online-store/policies/:type/template` (`online_store:manage_policies`), body
`{ locale: "ar" | "en", inputs }`, returns `{ body }`. **It does not save.** The editor puts the text
into the field, and the merchant reviews and saves.

**Our call:** generate-then-edit, never auto-save. Reason: a legal text must be read by the merchant
before it is published under their name.

`inputs` are prefilled from Settings → General and shipping, and the merchant can edit each:

- store name;
- contact email;
- contact phone/WhatsApp;
- business address (free text);
- return window in days (default **14**);
- who pays return shipping (customer / store);
- refund method (original payment / store credit / cash for COD);
- cash on delivery offered (yes/no);
- delivery time range in days (default 2–5 within Egypt);
- whether the shop ships outside its country.

Templates live in code (`services/online-store/src/domain/policy-templates/{ar,en}.ts`), written in
Morbeh text with `{placeholder}` substitution. Every substituted value is **escaped** for Markdown
(`*`, `[`, `]`, `#`, `` ` ``, `\`), so a store name cannot inject a link. The Arabic templates are
written in MSA (customer-facing). Every generated text starts with a merchant-visible reminder in the
**editor** (not in the body): "This is a starting template, not legal advice. Review it for your
business." ("ده نموذج مبدئي مش استشارة قانونية — راجعه حسب نشاطك").

**Our call:** the default return window is 14 days. Reason: it matches the consumer's return right
under Egypt's Consumer Protection Law (No. 181 of 2018), the common baseline for Egyptian shops. The
merchant can change it.

The contact-information template lists the store name, address, email and phone. **There is no
contact form** (non-goal).

### 2.4 Pages (extend `services/pages`)

`Page` gains:

- `title: LocalizedText` (each ≤ 255; it defaults to `{ [shop default locale]: name }` when empty);
- `body: LocalizedText` (Morbeh text, each ≤ 100,000);
- `metaDescription: LocalizedText` (each ≤ 320);
- `publishedAt: Date | null` (set on the first `draft → published`).

- New use case `UpdatePageContent { pageId, title, body, metaDescription, expectedVersion }`, allowed
  in `draft` and `published` (an edit to a published page is live, as in Shopify).
- New reads `GetPublishedPageByPath(routePath, tenantId)` and `ListPublishedPages(tenantId, first ≤ 500)`
  (for the sitemap).
- **Our call:** the storefront serves pages at `/pages/<handle>` by looking up `routePath =
"/pages/<handle>"`, so no new handle column is added. admin-web's "Add page" derives the route path
  from the title (`/pages/` + slug, Arabic titles transliterated or `page-<n>`) and lets the merchant
  edit it. Pages with any other route path are not served, and the admin labels them "Not on your
  storefront". Reason: `routePath` is already unique per shop and validated, and a second identifier
  would need its own uniqueness and migration.

### 2.5 Migration (Part 2)

`20261027010000_online_store_content`:

```sql
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
-- + ENABLE + FORCE RLS and tenant_isolation on both tables.

ALTER TABLE "pages"."pages" ADD COLUMN "title"            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "body"             JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "meta_description" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pages"."pages" ADD COLUMN "published_at"     TIMESTAMP(3);
CREATE INDEX "pages_tenant_id_status_idx" ON "pages"."pages" ("tenant_id", "status");
```

`pages.pages` already has its policy from `20260823000000_rls_tenant_isolation`. The plan verifies
that, and if it does not, this migration adds the explicit policy too. No backfill: empty
`title` falls back to `name`, and `published_at` stays NULL for already-published rows (shown as
"—").

### 2.6 API (Part 2)

| Route                                        | Permission                     | Shape                                                                                                                               |
| -------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /online-store/menus`                    | `online_store:read`            | `{ menus: { id \| null, handle, title, itemCount, isDefault }[] }` (virtual defaults included)                                      |
| `GET /online-store/menus/:handle`            | `online_store:read`            | `MenuDto` with items and, per item, `broken: boolean` and `targetTitle`                                                             |
| `POST /online-store/menus`                   | `online_store:manage_menus`    | `{ handle, title, items }` → 201                                                                                                    |
| `PUT /online-store/menus/:handle`            | `online_store:manage_menus`    | `{ title, items, expectedVersion }` (upsert for the two defaults)                                                                   |
| `DELETE /online-store/menus/:handle`         | `online_store:manage_menus`    | 409 `MENU_PROTECTED` for `main-menu`/`footer`; 409 `MENU_IN_USE` if the published or draft theme references it                      |
| `GET /online-store/link-targets`             | `online_store:read`            | 2.2                                                                                                                                 |
| `GET /online-store/policies`                 | `online_store:read`            | `{ policies: { type, set: boolean, locales: Locale[], updatedAt }[] }`                                                              |
| `GET /online-store/policies/:type`           | `online_store:read`            | `PolicyDto { type, body, updatedAt, version }`                                                                                      |
| `PUT /online-store/policies/:type`           | `online_store:manage_policies` | `{ body, expectedVersion }`; `UNSAFE_LINK` / `TOO_LONG` per locale                                                                  |
| `POST /online-store/policies/:type/template` | `online_store:manage_policies` | 2.3 (not idempotent; pure)                                                                                                          |
| `PUT /pages/:pageId/content`                 | `pages:update_page`            | 2.4                                                                                                                                 |
| `GET /pages/:pageId`                         | `pages:read`                   | `PageDto` gains `title`, `body`, `metaDescription`, `publishedAt`                                                                   |
| `GET /public/online-store`                   | public                         | shell gains `header.menu` and `footer.menu: ResolvedMenuItem[]`, `footer.policies: PolicyType[]` (set ones, when `showPolicyLinks`) |
| `GET /public/policies/:type`                 | public                         | `{ type, body: LocalizedText, updatedAt }` or 404                                                                                   |
| `GET /public/pages/:handle`                  | public                         | published page `{ handle, title, body, metaDescription, updatedAt }` or 404                                                         |
| `GET /public/pages`                          | public                         | `{ pages: { handle, updatedAt }[] }` (≤ 500, for the sitemap)                                                                       |

`ResolvedMenuItem = { label: LocalizedText, href: string, external: boolean, children: ResolvedMenuItem[] }`.
Public routes go through `publicReads.onlineStore.*` and `publicReads.pages.*` closures.

### 2.7 admin-web (Part 2)

- **`/online-store/navigation`** (Shopify's Navigation): a table of menus (title, items summary such as
  "Home, Search"), and **Add menu**. In Arabic the screen is "القوائم", with "القائمة الرئيسية" and
  "الفوتر" for the two defaults.
- **`/online-store/navigation/[handle]`**: title field and the item tree. Each row shows its label
  (ar/en), the link target as a chip, and actions: **Edit**, **Add sub-item** (top level only),
  **Move up**/**Move down** (keyboard accessible), **Delete**. **Add menu item** opens a dialog:
  - label ar/en;
  - "Link" combobox grouped Home / Search / Collections / Products / Pages / Policies / Web address,
    with search through `link-targets`;
  - the web address field shows inline errors ("Only https://, mailto: and tel: links are allowed" /
    "مسموح بلينكات https:// و mailto: و tel: بس").

  Broken items show a red badge "Link target removed". A save bar ("Unsaved changes", **Discard** /
  **Save**) follows the house pattern.

- **Policies: `/settings/policies`** (Shopify's location, Settings → Policies, "السياسات"). One card
  per policy:
  - ar/en tabs over a `Textarea` with a toolbar (H2, H3, bold, italic, list, numbered, link) that
    inserts Morbeh text;
  - a **Preview** tab rendering the AST with the storefront's typography;
  - **Create from template** / **إنشاء من نموذج**, a dialog with the template inputs and a locale
    picker that fills the tab;
  - **Save**.

  `middleware.ts` gets `["/settings/policies", "viewer"]` (a longest-prefix override of `/settings`
  admin), and the Settings index lists **Policies**. **Our call:** Settings → Policies, open to
  operators, with a "Store policies" link also on Online Store → Pages. Reason: it is Shopify's place,
  and policies are content operators maintain, while the rest of Settings stays admin-only.

- **Pages** (`/pages/[pageId]`): becomes Shopify's page editor:
  - title (ar/en), content (the same Morbeh text editor), "Search engine listing" (meta description);
  - visibility (Draft / Published, via the existing transition);
  - "View on store" link when published and the route is `/pages/*`.

  `/pages/new` becomes title + content with an auto route path.

- **Customize editor:** the Header and Footer panels gain a menu select, and the Footer panel gains
  "Show policy links".

### 2.8 Storefront (Part 2)

- **Header:** desktop shows a horizontal menu with a dropdown for children (`<details>`/`<summary>`,
  no client JS, keyboard and RTL aware). Mobile shows a drawer (the only client component: open and
  close state), with children as nested disclosure. Labels use `pickText` and `dir="auto"`. Items whose
  label is empty in both locales are skipped.
- **Footer:** the footer menu as columns (each top-level item with children becomes a column with its
  children as links; items without children are grouped under "Links"), then the policy links row.
- **`app/(store)/policies/[slug]/page.tsx`:** the slug maps to the type (unknown → `notFound()`).
  Renders the title and "Last updated" from the dictionary, then the body through `<RichText ast>`.
  `generateMetadata` gives `<policy> | <store>`. Cached with `unstable_cache` keyed by shop and type,
  tag `os:<shopId>`.
- **`app/(store)/pages/[handle]/page.tsx`:** same pattern, tag `pages:<shopId>`. The pages save
  action revalidates both tags through the endpoint (`{ shopId, tags: ["pages"] }`).
- **`<RichText>`** (`components/rich-text.tsx`): a server component mapping AST nodes to
  `h2/h3/p/strong/em/ul/ol/li/a/hr/br`, with the storefront prose styles.
- **`app/robots.ts`** (dynamic, reads the host):
  - locked → `User-agent: * / Disallow: /`;
  - else allow `/`, disallow `/cart`, `/checkout`, `/account`, `/c/`, `/password`, plus
    `Sitemap: https://<host>/sitemap.xml`.
- **`app/sitemap.ts`:**
  - locked → empty;
  - else home, `/search`, published collections, products (paged through
    `/public/products`), `/pages/*` from `GET /public/pages`, and set policies, with `lastModified`
    where known;
  - capped at 5,000 URLs, cached 1 hour per shop (`unstable_cache` key and tag
    `sitemap:<shopId>`), absolute URLs on the request host.

  **Our call:** the storefront generates sitemap and robots from live data and does not consume
  `services/seo`'s stored sitemaps and robots policies. Reason: it is cheap and always current; the
  SEO context's records are caller-supplied URL lists with no public read, and wiring them is a
  separate SEO project.

### 2.9 Testing (Part 2)

- **Rich text:**
  - parser golden tests (every construct, nesting limits, unclosed markers, Arabic and mixed bidi
    text, very long input in linear time);
  - XSS corpus (`<script>`, `<img onerror>`, `javascript:` in every case and encoding, `data:`,
    `//evil`, entity tricks) → rendered as text or as a plain-text link;
  - property test: render output never contains an element outside the allow-list.
- **Menus:** validator (depth, counts, ids, URL schemes incl. `JAVASCRIPT:`, `https://user:pass@`,
  whitespace and control characters); virtual defaults; delete protections; resolution drops broken
  targets and follows slug changes; tenant isolation.
- **Policies:** template generation per type and locale with escaping (a store name containing
  `](javascript:` stays text); not-set → public 404; one-locale fallback.
- **Pages:** content update on draft and published; public read only for `/pages/*` and published;
  the sitemap list cap.
- **Routes:** permissions and DTO leak tests.
- **Storefront:**
  - header dropdown and drawer (RTL);
  - footer columns;
  - policy and page routes (404s, metadata);
  - robots locked/unlocked;
  - sitemap cap and locked;
  - `<RichText>` render tests.
- **admin-web:** menu editor (add, sub-item, reorder, broken badge, URL errors), link picker, policy
  editor and template dialog, page editor, `/settings/policies` role entry, en/ar parity.

---

## Part 3 — Homepage section editor

### 3.1 Reuse decision

**Our call:** a dedicated, typed section model inside the theme document; **not**
`services/experience` + `services/components`. Reasons:

1. `ComponentDefinition` is tenant data with a weak schema (`string|number|boolean|object|array`, no
   enums, ranges, image or link types). A fixed platform library would have to be seeded into every
   shop and kept in sync.
2. `Experience` has its own `draft → published → archived` lifecycle, with no re-publish of the same
   experience and no `hidden` flag. It would have to be kept consistent with the theme's draft and
   live pair across two contexts.
3. Generic `props: Record<string, unknown>` would push validation into the renderer, where the
   storefront must trust it.

Both contexts stay as platform tools. Nothing is deleted.

### 3.2 Section model

```ts
Section = {
  id: string /* uuid, unique in the document */,
  type: SectionType,
  hidden: boolean,
  settings: SettingsOf<type>,
};
```

Each section type is a **definition** in `@platform/storefront-content/sections`:
`{ type, labels (en, admin-ar), icon, maxPerPage, defaults(), fields: FieldDescriptor[] , validate() }`.
`FieldDescriptor` kinds are `localizedText{max}`, `richText{max}`, `image{purpose}`, `link`,
`collection`, `products{max}`, `number{min,max,step}`, `select{options}`, `boolean`, `phone`, and
`items{min,max,fields}`. One descriptor list drives the admin form, the API validation and the
storefront's typed props. Adding a type later means one definition plus one storefront component.

Section library v1:

| `type`                | Admin label (en / ar)              | Settings                                                                                                                                                                                                      | Limits             |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `announcement_bar`    | Announcement bar / شريط إعلانات    | `text` LT ≤ 120, `link?` LinkRef, `style` accent \| primary \| dark                                                                                                                                           | header only, max 1 |
| `hero`                | Image banner / بانر بصورة          | `image` (section_image), `mobileImage?`, `heading` LT ≤ 80, `subheading` LT ≤ 200, `button?` {label LT ≤ 30, link}, `height` small \| medium \| large, `contentAlign` start \| center, `overlay` 0–80 step 10 | max 3              |
| `featured_collection` | Featured collection / مجموعة مميزة | `collection`, `heading` LT ≤ 80, `productCount` 2–12 (8), `columns` 2–4 (4), `showViewAll` bool                                                                                                               | —                  |
| `featured_products`   | Products / منتجات                  | `source` newest \| manual, `products` (manual, 1–12), `count` 2–12, `heading`, `columns` 2–4                                                                                                                  | —                  |
| `collection_list`     | Collection list / قائمة المجموعات  | `source` all \| manual, `items` (manual, 1–8: {collection, image?}), `heading`, `columns` 2–4                                                                                                                 | —                  |
| `image_with_text`     | Image with text / صورة مع نص       | `image`, `heading` LT ≤ 80, `body` richText ≤ 2,000, `button?`, `imagePosition` start \| end                                                                                                                  | —                  |
| `rich_text`           | Rich text / نص                     | `heading?` LT ≤ 80, `body` richText ≤ 5,000, `button?`, `align` start \| center                                                                                                                               | —                  |
| `testimonials`        | Testimonials / آراء العملاء        | `heading`, `items` 1–8: {quote LT ≤ 400, author ≤ 60, rating 0–5 (0 = none)}                                                                                                                                  | —                  |
| `features`            | Store highlights / مميزات المتجر   | `heading?`, `items` 1–6: {icon cod \| shipping \| returns \| support \| secure \| quality \| gift, title LT ≤ 40, text LT ≤ 140}                                                                              | —                  |
| `whatsapp_cta`        | WhatsApp button / زرار واتساب      | `heading` LT, `text` LT ≤ 300, `buttonLabel` LT ≤ 30, `phone` (E.164 digits, 8–15), `message` LT ≤ 300 (prefilled)                                                                                            | max 2              |

LT = `LocalizedText`. The homepage holds at most **25** sections (`TOO_MANY_SECTIONS`). The
announcement bar lives in `header.announcement: Section | null` and appears on **every** page. The
rest live in `homepage.sections`.

**Our call:** the announcement bar is part of the header and shows site-wide. Reason: Shopify puts it
in the header group, and "free shipping above 500 EGP" belongs on every page, not only the home page.

**Our call:** there is no newsletter section in v1. Reason: there is no email sending until Project 8,
and collecting emails with no consent record and no sender is a personal-data liability with no
merchant benefit yet. It joins the library with Project 8. The WhatsApp CTA covers lead capture for
Egyptian shops now.

**Our call:** the `features` section ("Cash on delivery · Fast shipping · Easy returns") is in the
library. Reason: trust badges are the most common homepage block in Egyptian shops, where COD and
returns drive conversion.

**Phone normalisation** (`whatsapp_cta`): Arabic-Indic and Persian digits are converted, then
non-digits stripped. A national number with a leading 0 is completed from the shop country
(Project 3's `toWhatsAppDigits` table, moved into the package and shared). The result must be 8–15
digits. The rendered link is `https://wa.me/<digits>?text=<encoded message>`.

**Default homepage** (until a draft exists, and what "Reset" restores): `featured_products {source:
newest, count: 8}` then `collection_list {source: all}`, the current homepage expressed as sections.
Part 3 replaces the hard-coded `app/(store)/page.tsx` with the renderer, so an untouched shop looks
the same.

### 3.3 Editing rules

- **Add** (picker dialog with an icon, name and one-line description per type, as in Shopify),
  **reorder** (move up/down; keyboard: select then Alt+↑/↓), **hide/show** (eye toggle; hidden
  sections are kept but not rendered live, and in preview they show as a dashed placeholder only in
  the editor iframe), **duplicate**, **remove** (confirm), **configure** (generated form).
- Every change edits the draft document and autosaves (1.11). Publish and preview are those of
  Part 1, so there is one draft and one publish for brand, header, footer and homepage together.
  **Our call:** one theme-wide publish rather than per-section publishing. Reason: Shopify publishes
  the theme as a unit, and a single draft avoids mixed states between brand and sections.
- References in settings (collection, products, images, links) are validated for ownership on save.
  Ones that break **after** publish (a deleted product, an archived image) make the element (or the
  whole section, when its required content is gone) drop silently on the live store. The editor flags
  them ("This section has a removed collection").
- Unknown section types or settings (a document written by a newer build) are kept in storage, skipped
  by the renderer and shown in the editor as "Unsupported section". The validator preserves rather
  than strips them on round-trip only for types it does not know.

### 3.4 API (Part 3)

No new admin route. `PUT /online-store/theme/draft` now validates `homepage.sections` and
`header.announcement` with the section definitions. Errors carry a JSON pointer
(`/homepage/sections/3/settings/heading/ar`) so the editor can mark the field.

| Route                            | Shape                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/online-store/home`  | `{ mode, sections: PublicSection[] }`: visible sections only (or all, flagged, in preview), with references **resolved**: images → `ImageDto`, collections → `{ id, slug, name }`, products → ids for the catalog read, links → `href` (broken ones removed). Preview via `x-preview-token`, as the shell |
| `GET /public/products?ids=a,b,c` | **New filter** on the existing route: ≤ 50 ids, published only, in request order. Lets a manual product grid be one request                                                                                                                                                                               |

The shell's `header` gains `announcement: PublicSection | null`. The public home DTO carries no
draft-only fields (no `hidden` in live mode, no ids of removed references).

### 3.5 admin-web (Part 3)

`/online-store/themes/customize` becomes Shopify's editor layout:

- **Left sidebar, tab "Sections":** a tree with **Header** (announcement bar slot with "Add
  announcement", sticky, menu), **Template: Home page** (its sections in order, each row with a type
  icon, a title from the first heading or the type name, an eye toggle and a ⋯ menu with Duplicate /
  Remove, plus a final "+ Add section" row), and **Footer** (menu, policy links, social, note).
  Selecting a row opens its settings form in the same sidebar (Shopify's single-column flow on
  narrow screens; a second column at ≥ 1280 px). Arabic (admin, Egyptian): "ضيف سكشن", "اخفي",
  "اظهر", "كرر", "امسح", "الصفحة الرئيسية".
- **Tab "Theme settings":** the Part 1 panels.
- **Generated settings form:** one component per descriptor kind:
  - localized text: ar/en inputs side by side, with character counters;
  - rich text: the Part 2 editor;
  - image: an upload button through `uploadOnlineStoreImageAction(purpose)`, a choose-from-library
    dialog over `GET /media/assets`, alt text editing and a remove action;
  - link: the Part 2 picker;
  - collection/products: pickers over `link-targets`;
  - number: a slider plus a number input;
  - select: segmented buttons up to 3 options, otherwise `NativeSelect`;
  - boolean: `Switch`;
  - phone: a phone input with country hint;
  - items: repeatable sub-forms with add, remove and move.
- **Preview iframe:** reloads after each autosave. Selecting a section posts `{ type:
"morbeh:focus-section", id }` to the iframe, and the storefront preview scrolls to and outlines
  `[data-section-id=id]`. The storefront's listener runs only in preview mode and accepts messages
  only when `event.origin === ADMIN_ORIGIN`. **Our call:** reload-on-save plus focus messages, not
  client-side live rendering in the admin. Reason: the storefront renders server-side. Duplicating the
  renderer in the admin would split the truth, and a ~1 s save-and-reload is enough for a "simple"
  editor, which is what the roadmap asks for.
- **Our call:** reorder by Move up/down buttons and keyboard shortcuts, not drag-and-drop. Reason: the
  repo has no DnD library, buttons are accessible and RTL-safe by default, and drag can be added on
  top later.

### 3.6 Storefront (Part 3)

- `app/(store)/page.tsx` fetches `getHomepage(preview)` and renders `<Sections>`, which maps
  `type → component` in `components/sections/*.tsx` (server components). Unknown types are skipped.
- Each section fetches its own data in parallel (`Promise.all`). A failing section is omitted (logged),
  so it never breaks the page. Product data comes from the existing public catalog reads
  (`/public/collections/:slug/products`, `/public/products?ids=`, `/public/products?first=`).
- **Our call:** homepage section data (the home document and its product and collection reads) is
  cached 60 s per shop (`unstable_cache`, tags `os:<shopId>` and `catalog:<shopId>`), while product,
  cart and checkout pages stay `no-store`. Reason: the homepage is the highest-traffic page and
  tolerates a minute of price staleness, and checkout re-prices server-side anyway. There is no catalog
  revalidation hook in this project.
- Images use the product-image rendering pattern of Plan 2C-3 (width and height set to avoid layout
  shift, `sizes`, lazy below the fold, `fetchpriority="high"` on the first hero).
- The hero uses `mobileImage` under 768 px through `<picture>`. Overlay is a pseudo-element using
  `--foreground` at the chosen opacity. Text alignment is logical (`start` = right in RTL).
- Every merchant text node has `dir="auto"`. Testimonials and features stack on mobile. The WhatsApp
  CTA opens `wa.me` in a new tab.
- In preview, each section wraps `data-section-id`. Hidden sections render as a dashed placeholder
  "Hidden section" ("قسم مخفي") so the editor can still focus them. Live mode omits them entirely.

### 3.7 Testing (Part 3)

- **Definitions:** every type's defaults pass its own validator; every descriptor kind validates its
  edge values; JSON-pointer error paths; section count, `maxPerPage` and announcement rules;
  unknown-type preservation; the phone normaliser (Arabic-Indic digits, leading 0, too short or long).
- **API:** draft with invalid section → 422 with pointer; foreign image or collection → `IMAGE_NOT_FOUND`
  / `TARGET_NOT_FOUND`; public home resolves references and drops broken ones; `?ids=` filter (order,
  cap, unpublished excluded); preview vs live (hidden sections).
- **Storefront:** each section component (both locales, RTL, missing optional fields, broken
  references); one failing section does not break the page; the default homepage equals today's
  layout; preview placeholders; focus-message origin check.
- **admin-web:** add, reorder (buttons and keyboard), hide, duplicate, remove; generated forms per
  descriptor kind; image picker; autosave and conflict; Publish disabled for operators.
- **E2E (`apps/e2e`, when an environment exists):** the operator adds a hero and a featured
  collection, previews, and cannot publish; the admin publishes; the live homepage shows both; the
  admin locks the store; a fresh browser lands on `/password`, unlocks, and sees the store; robots
  turns to `Disallow: /` while locked.

---

## Security and multi-tenancy

- **Tenant scoping.** Every new table carries `tenant_id` with forced RLS `tenant_isolation`. Every
  repository method takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`.
  Preview-token lookup by hash runs inside the request tenant's scope. The storefront caches by shop id
  in the key, and the unlock cookie is host-only and bound to the shop id in its HMAC.
- **Composition.** `WiredAdmin` gains `onlineStore: OnlineStoreAdminController` (guarded) and
  `publicReads.onlineStore` / `publicReads.pages` (functions taking `tenantId`). Neither holds a
  `tenantId` field, the tenant-mode guard test proves the graph is clean, and the exemption list stays
  at `tenancy` alone.
- **What stays pinned (stated plainly).**
  1. The **store name** read (`StoreIdentityPort` → `tenancy.store_settings`) and `GET /public/store`
     go through the `tenancy` context, which is still pinned to `TENANT_DEFAULT_ID` under the ADR-0014
     8f exemption. In single-tenant mode this is correct. In multi mode every shop would show the
     deployment tenant's name until 8a–8d land. This project adds **no** new pinned read and does not
     change that one. The adapter is the single place to switch when tenancy is un-pinned.
  2. The primary-hostname read for preview URLs (`ShopHostPort`) is the same tenancy exemption.
  3. With `STOREFRONT_HOST_ROUTING` off, the storefront serves `TENANT_DEFAULT_ID`, as today.

  Everything in `online_store` and the `pages` changes is per request.

- **Uploads.** The server validates type and size from the bytes (sniffing), applies per-purpose type
  and size caps and dimension rules, and caps pixel count at 40 MP. SVG is never accepted. Keys are
  server-made and immutable, and the client file name is display-only.
- **Password lock.** scrypt hash only. Unlock is rate-limited per shop with a uniform error and
  dummy-hash timing. The cookie is an HMAC proof (no password, hash or token), and `accessVersion`
  revokes all unlocks. Locked means `302 /password` for GET, `403` for POST, `noindex`, and robots
  `Disallow: /`. Policies stay reachable.
- **Preview.** A 256-bit token is stored as SHA-256, lasts 60 minutes, is scoped to one shop and is
  view-only. It travels in the URL only during preview, with `Referrer-Policy: no-referrer` and
  `no-store`. Framing is allowed only for `ADMIN_ORIGIN` on preview responses; everything else is
  `frame-ancestors 'self'`. The postMessage listener checks the origin.
- **Content.** Rich text is a restricted Markdown AST rendered as React elements; links are limited to
  `https:`, `mailto:`, `tel:` and relative paths. Menu URLs are limited to `https:`, `mailto:` and
  `tel:`. Colours are strict hex, and fonts and other options are enums. The storefront re-validates
  everything it receives before it reaches CSS or markup. Template substitution escapes Markdown.
- **Permissions.** Viewer reads; operator edits drafts, menus, policies, pages and preferences; admin
  alone publishes, restores and changes the lock. Middleware role entries back them in admin-web.
- **Concurrency.** Optimistic `version` on every aggregate. Publish is bound to the previewed
  `draftRevision`. Autosave sends one request at a time, and a 409 is surfaced rather than
  overwritten.
- **Secrets.** `STOREFRONT_ACCESS_SECRET` and `STOREFRONT_REVALIDATE_SECRET` are env-only, at least 32
  bytes, asserted in production, never logged, and never sent to the browser.

## Review Focus (risky inputs to test and review)

1. **Huge images:** a 7.9 MB PNG of 20,000 × 20,000 (pixel bomb: header says one size, sniff checks
   dimensions) → 40 MP rule; a `Content-Length` lie; a truncated file; a JPEG declared as PNG; an SVG
   renamed `.png`; an animated GIF as favicon (refused: PNG only).
2. **Malformed colours:** `red`, `#fff`, `#ffffff80`, `rgb(…)`, `#000000;}</style><script>`, Unicode
   look-alike `＃`, and an empty string, both through the API (reject) and a corrupted DB row
   (storefront falls back to defaults).
3. **XSS in rich text:** `<script>`, `<img src=x onerror>`, `[x](javascript:alert(1))`, `[x](JaVaScRiPt:…)`,
   `[x](java&#x73;cript:…)`, `[x](//evil.com)`, `[x](data:text/html,…)`, nested brackets, 100k
   unclosed `**`, and a store name with Markdown in a policy template.
4. **Menu loops and abuse:** a child with children, 1,000 items, duplicate ids, a menu referencing its
   own handle as a URL, `https://user:pass@evil`, `http://` links, `tel:` with letters, labels that are
   only whitespace or bidi control characters, and a deleted target (must vanish, not 404 the header).
5. **Locked store and SEO bots:** Googlebot gets 302 → `/password` (noindex) and robots `Disallow: /`;
   the sitemap is empty; a WhatsApp link preview of a locked shop shows the store name and "Opening
   soon" only; unlocking flips robots within the access-cache TTL; policy pages stay indexable for
   gateway review.
6. **RTL logo:** wide logos (8:1), tall logos, logos with baked-in English text in an Arabic UI. Never
   mirrored, at the inline start, height-capped, no overlap with the menu or drawer at 320 px.
7. **Cross-shop leakage:** the same storefront instance serves shops A and B. Cache entries, unlock
   cookie, preview token and `/api/revalidate` for A never affect B; a client-sent `x-shop-id` or
   `x-morbeh-preview` header is stripped.
8. **Preview token leakage:** a token in an outbound link click (no referrer), in server logs
   (expires in 60 min), and reused after expiry (live view with the expired banner, and the password
   page if locked).
9. **Unlock brute force:** 21 attempts in 10 minutes → 429 with `retry-after`; a valid password during
   lockout is still refused; timing is equal for a wrong password vs no lock vs no hash.
10. **Stale caches:** publish then reload (on-demand tag), a multi-instance deployment (60 s
    ceiling), and a password change revoking open sessions (middleware access cache 15 s).
11. **Bilingual gaps:** a section with only Arabic text viewed in English (falls back), both empty
    (element omitted), long Arabic words in the hero at 320 px, and mixed Arabic and English in one
    label.
12. **Draft and publish races:** two tabs autosaving (409), publishing while an operator edits
    (`DRAFT_CHANGED`), restoring a release that references a since-deleted collection (flagged in the
    editor, dropped live).
13. **Middleware exemptions:** `favicon.ico` and `_next` are excluded from shop resolution (the
    favicon comes from `<link rel=icon>`, not `/favicon.ico`); `/api/revalidate` is reachable without a
    shop and only with the secret; `/c/<token>` recovery links (Project 3) are gated while locked.
14. **Old documents:** a `schemaVersion` from a newer build is read by an older one (unknown sections
    skipped, never crashing); a missing theme row (defaults).

## Delivery order

Each part has its own implementation plan, branch commits, review and deploy (migration first, then
the release that reads it). Later parts only add to earlier ones. Before Part 1: reset the branch onto
`origin/main` (see "Read this first") and on top of whichever of Project 1 and Project 3 merged. The
expected textual overlaps are storefront `messages/*`, `runtime-api.ts`, admin-web `navigation.ts`,
`middleware.ts`, the role table test and `seed-ory-network.mjs`.

| #   | Plan                                                                                                                                                                                                                                                                                                                      | Migration                                         | Depends on                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Store identity + shell: `services/online-store` (preferences, access, theme draft/publish/releases, preview tokens), `@platform/storefront-content` (document, fonts, colours), generalised uploads, storefront route groups, layout, header and footer, password gate, preview mode, caching and revalidation, brand fix | `20261027000000_online_store_identity`            | —                                                             |
| 2   | Navigation + content: rich text, menus and link targets, policies and templates, page bodies, `/policies/*`, `/pages/*`, robots and sitemap, Settings → Policies                                                                                                                                                          | `20261027010000_online_store_content`             | 1 (context, document header/footer, shell, revalidation)      |
| 3   | Homepage section editor: section library, editor tree and generated forms, public home read, `/public/products?ids=`, section renderer                                                                                                                                                                                    | none (sections live in the Part 1 theme document) | 1 (document, preview, uploads), 2 (rich text, links, pickers) |

## Decisions (for the owner to check)

1. The spec targets `origin/main` (d6196c48); the worktree's local `main` base (1fe88fd7) is 366 commits stale and the branch must be reset before Part 1.
2. One new context `services/online-store` (schema `online_store`) owns preferences, access, preview, theme document, menus and policies.
3. `services/theme` is left untouched; its raw screens move to Platform tools, and Online Store → Themes opens the new editor.
4. Page bodies extend `services/pages`, not a second page concept.
5. A shared pure package `@platform/storefront-content` holds types, validators, rich text and section definitions for API, admin-web and storefront.
6. Merchant text is stored per locale in the field (`{ar, en}`) with fallback to the other locale, not in translation sets.
7. New `online_store` resource in shop resources (viewer read, operator edit); admin-only actions under `online_store_admin`.
8. Theme publish and release restore are admin-only.
9. The password lock is admin-only.
10. Minting a preview token needs only `online_store:read`.
11. The default storefront language is Arabic when no preference is saved.
12. Theme draft and published are single-row JSON documents per shop, not section rows.
13. The last 20 releases are kept for rollback.
14. Six bundled Arabic+Latin fonts (IBM Plex Sans Arabic, Cairo, Tajawal, Almarai, Readex Pro, Amiri), self-hosted, no Google Fonts.
15. Six editable brand colours, strict 6-digit hex; only body-text contrast below 3:1 blocks a save, the rest warns with Auto-fix.
16. A shop with a published brand renders light-only (toggle hidden).
17. Logo and favicon are theme (draft/preview/publish); title, description and share image are Preferences (live on save).
18. No second store-name field; the storefront uses Settings → General's name.
19. The storefront password is hashed and can never be shown again, only replaced.
20. Unlock is rate-limited per shop (20 per 10 min), not per IP.
21. The storefront signs a host-only HMAC unlock cookie with its own secret; no password, hash or token in it.
22. Unlock lasts 7 days; a password change or re-lock revokes all unlocks.
23. Preview travels as a `?preview=` query parameter, not a cookie (third-party cookie blocking in the iframe).
24. Preview tokens are opaque, SHA-256 at rest, 60-minute expiry, view-only.
25. Uploads reuse the existing server-proxied, byte-sniffed pipeline, generalised by purpose, instead of signed PUT URLs.
26. Favicons are PNG only, with no `.ico` and no resizing.
27. Share images are JPEG or PNG only.
28. Publish is bound to the previewed draft revision (409 `DRAFT_CHANGED` otherwise).
29. Restoring a release goes into the draft, never straight to live.
30. Existing storefront pages move into an `(store)` route group; the password page lives in `(gate)`.
31. The footer carries a "Powered by مربح" line.
32. Public online-store reads are cached with `unstable_cache` keyed by shop id, tag `os:<shopId>`, 60 s TTL.
33. On-demand revalidation goes through a secret-protected storefront `/api/revalidate`, called by admin-web after saves and publishes.
34. Policy pages stay reachable while the store is locked (payment-gateway review).
35. A locked store does a 302 to `/password` (Shopify's behaviour), `noindex`, robots `Disallow: /`, empty sitemap, and 403 on POST.
36. The theme draft autosaves 1 s after the last change, one request in flight, conflict on 409.
37. Rich text is a restricted Markdown subset parsed to an AST and rendered as React elements; there is no HTML.
38. Menus reference targets by id and resolve on read; broken targets are dropped live and flagged in the admin.
39. `main-menu` and `footer` always exist as virtual defaults and cannot be deleted.
40. Menus are live on save; which menu the header and footer use is a theme setting.
41. Policy templates are generated into the editor and never auto-saved.
42. The default return window in templates is 14 days (Egypt Consumer Protection Law 181/2018).
43. Pages are served at `/pages/<handle>` via `routePath = /pages/<handle>`, with no new handle column.
44. Policies live at Settings → Policies (Shopify's place), open to operators by a middleware override.
45. Sitemap and robots are generated by the storefront from live data; `services/seo` records are not consumed.
46. A dedicated typed section model in the theme document; `services/experience` and `services/components` are not reused.
47. The announcement bar is a site-wide header section.
48. There is no newsletter section until Project 8 (email sending).
49. A `features` (trust badges: COD, shipping, returns) section is included.
50. One theme-wide publish covers brand, header, footer and homepage, with no per-section publishing.
51. Preview reloads after each autosave, with focus messages; there is no client-side live rendering in the admin.
52. Sections are reordered with Move up/down and keyboard shortcuts; there is no drag-and-drop.
53. Homepage section data is cached 60 s per shop; product, cart and checkout pages stay `no-store`.
54. New public `GET /public/products?ids=` filter (≤ 50) for manual product grids.
55. Three separate plans in the order 1 → 2 → 3; Part 3 adds no migration.
