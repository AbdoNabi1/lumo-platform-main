# Online Store — Part 3: Homepage Section Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant builds the storefront homepage from a fixed, typed section library (announcement bar, image banner, featured collection, products, collection list, image with text, rich text, testimonials, store highlights, WhatsApp button). In the customize editor they add, reorder (buttons and Alt+↑/↓), hide, duplicate, remove and configure sections, with live preview. The sections are saved in the existing theme draft and go live with the one theme-wide Publish. The storefront renders them from cached, per-shop reads. A shop that never opens the editor keeps its current homepage, as close as the spec's two default sections allow.

**Architecture:**

- `@platform/storefront-content` gains:
  - field descriptors and their validators (one per descriptor kind);
  - the ten section definitions, the public section DTO types and the WhatsApp phone normaliser;
  - theme document **schema version 2**: `header.announcement` and typed `homepage.sections`. Version-1 documents upcast to the default homepage.
- `services/online-store`:
  - checks new section references for ownership on save (`IMAGE_NOT_FOUND`, `TARGET_NOT_FOUND`);
  - returns section images and reference states to the editor;
  - resolves sections for a new public home read, `GET /public/online-store/home`, and adds the announcement to the shell.
- Catalog gains a newest-products read. `GET /public/products` gains `?ids=` and `?sort=newest`.
- The storefront replaces the hard-coded `app/(store)/page.tsx` with a section renderer. It has one server component per type, per-section data fetched in parallel and cached 60 s per shop, preview frames with hidden placeholders, and an origin-checked focus listener.
- admin-web turns the customize editor into Shopify's layout:
  - a **Sections** tab: a Header / Template / Footer tree, the add dialog and a settings form generated from the descriptors;
  - a **Theme settings** tab: the Part 1 panels.

  Focus messages go to the preview iframe.

**Tech Stack:** TypeScript, zod routes on `@platform/http` (Fastify), Prisma 6 (read only, no migration), Vitest, Next.js 15 App Router + React 19 (admin-web and storefront), Tailwind v4 (logical utilities), `@testing-library/react`, Playwright (written, not run).

**Spec:** `docs/superpowers/specs/2026-10-27-online-store-customization-design.md`. The binding parts are:

- Part 3 (§3.1–§3.7);
- "Where the code lives", "Permissions (all parts)", "Global constraints", "Anti-goals", "Security and multi-tenancy";
- "Review Focus" items 7, 8, 11, 12 and 14;
- "Delivery order", row 3: no migration;
- Decisions 46–55.

Read the spec and this plan together.

The branch `morbeh/storefront-customization` is at `34526820`, with Parts 1 and 2 complete:

- `docs/superpowers/plans/2026-10-27-online-store-part1-identity.md`;
- `docs/superpowers/plans/2026-11-04-online-store-part2-content.md`.

Where this plan and the spec differ, the code of Parts 1 and 2 is the ground truth, and a Ruling below says so.

## Rulings (decided on the owner's behalf; the spec is silent, ambiguous, or wrong against the code)

The owner delegated every decision. Each ruling is binding for the tasks that follow.

1. **Nothing new to deploy or grant: no migration, no permission string, no admin-web page — the sections live in the existing documents and the existing screens already cover them.**
   - Sections live in `online_store.storefront_themes.draft` / `published` and in the release documents (JSONB, spec 3.1, Delivery order row 3). Nothing new is deployed.
   - The editor uses `online_store:edit_theme`, `online_store:upload_image`, `online_store:read` and `online_store_admin:publish_theme`. The library dialog uses `media_library:read`. Part 1 already seeds and grants all of them.
   - The editor stays at `/online-store/themes/customize`, which Part 1 already lists as `["/online-store/themes/customize", "operator"]` in `ROUTE_ROLE_REQUIREMENTS`.

2. **Theme document schema version 2 — so documents saved before Part 3 keep today's homepage instead of an empty one.** Part 1's validator accepted only `homepage.sections: []`, so every stored draft, published document and release has `[]`, even where the merchant never touched the homepage. Reading `[]` literally after deploy would blank every live homepage.
   - The rule: `schemaVersion` 1 (or absent) means "the homepage was never edited", and the reader upcasts it to `DEFAULT_HOMEPAGE_SECTIONS`. `schemaVersion` 2 stores sections literally, so an empty list is an empty homepage.
   - The write path accepts:
     - version 1 with `sections: []`, upcast the same way (a stale admin tab open across the deploy);
     - version 1 with non-empty sections → `SECTIONS_NOT_SUPPORTED`, as today;
     - version 2.

     Anything else is `UNSUPPORTED_SCHEMA_VERSION`.

   - The reader reads a version above 2, from a newer build, as version 2: unknown sections are kept and nothing crashes (spec Review Focus 14).
   - Draft and published documents both pass through the same reader, so `canonicalDocumentJson` of a Part 1 document equals that of the same document with the default sections written out. `hasUnpublishedChanges` does not flip on deploy.

3. **The default homepage is exactly the spec's two sections — the spec lists them explicitly, and that list is binding over its claim that the page looks the same.** The two sections are:

   - `featured_products { source: newest, count: 8 }`;
   - then `collection_list { source: all }`.

   **Spec conflict:** §3.2 says this "looks the same" as today. Today's `app/(store)/page.tsx` also has:
   - a "Shop / Browse products and collections" card;
   - a Categories list;
   - every published product (≤ 100, oldest first), in a `max-w-2xl` column.

   The spec's explicit list is binding, so:
   - the welcome card goes: it is platform placeholder copy, not the merchant's;
   - the categories list goes: it has no section type and links nowhere;
   - products are the newest 8 (Ruling 11).

   What is kept for parity:
   - the default sections carry today's headings, `{ ar: "المنتجات", en: "Products" }` and `{ ar: "المجموعات", en: "Collections" }` (MSA, as in the storefront dictionary);
   - `columns: 2`, which renders today's `grid-cols-1 sm:grid-cols-2`;
   - today's `ProductCard` / `CollectionCard`;
   - today's empty-state copy;
   - the visually hidden `<h1>`.

   Sections render in a `max-w-5xl` container (the header's width). The default sections use the fixed ids `00000000-0000-4000-8000-000000000101` and `…102`.

4. **Error paths are dotted, not JSON pointers — that is the format the API and admin-web already use.** Every existing `INVALID_CONTENT` field issue is dotted: `brand.colors.primary`, `items.0.link.url`. admin-web keys its field errors that way. Section issues follow suit, for example `homepage.sections.3.settings.heading.ar`. **Spec conflict:** §3.4 writes `/homepage/sections/3/settings/heading/ar`. The information is the same, and one format is kept.

5. **Reference fields may be empty, and an empty or broken reference never fails a save.**
   - `image`, `collection` and `link` fields accept `null`. A `products` list may be `[]`. A `phone` may be `""`.
   - "Required" means the storefront drops the element, or the whole section, when the reference is empty or broken (Ruling 13). It never means a save error. So a section just added from its defaults, or switched to `source: manual`, autosaves.
   - List minimums that a source switch would break are not save errors either: manual products (spec 1–12) and manual collection items (spec 1–8).
   - `testimonials` (1–8) and `features` (1–6) keep their minimum. Their defaults hold items, and the editor disables removing the last one.

6. **Only new references are checked for ownership on save — so an item deleted after it was added never blocks autosave.**
   - `SaveThemeDraft` compares the new document's references with those already in the stored draft and in the published document (or the default). Only references that are new are checked:
     - images through `ImageRefsPort.existingIds` → `IMAGE_NOT_FOUND`;
     - collections, products and pages through `LinkTargetsPort.resolve` (absent from the map) → `TARGET_NOT_FOUND`.
   - Each issue carries its path.
   - Why: a collection deleted after it was added, or a restored release that names one (spec Review Focus 12), would otherwise refuse every later autosave, even a logo edit, until the merchant found the section. Instead it is flagged in the editor and dropped live.
   - This is safe: every reference entered the draft through a checked save, or through a release published from a checked draft.
   - A failed reference read throws: the route answers 500, and autosave retries it as transient. It is never a 422.

7. **Unknown section types are kept unchanged in `homepage.sections` only.**
   - The write path keeps an unknown type unchanged when it has:
     - an `id` matching `SECTION_ID_PATTERN` (uuid);
     - a `type` matching `^[a-z][a-z0-9_]{0,39}$`;
     - a boolean `hidden`;
     - a plain-object `settings` (any JSON).

     It counts toward the 25-section limit.

   - Known types are strict on write: unknown settings keys are `UNKNOWN_KEY`, and invalid values carry their code. Known types are lenient on read: unknown keys are dropped, and an invalid value becomes the type's default. So an older build drops a newer build's extra settings on its next save.
   - `header.announcement` accepts only `null` or an `announcement_bar`. On read, anything else becomes `null`.

8. **Buttons are two flat fields, and author names use a plain-text kind — so the spec's descriptor list needs no group kind.**
   - The spec's `button?` `{ label, link }` is stored as `buttonLabel: LocalizedText` (≤ 30) plus `buttonLink: LinkRef | null`, as `whatsapp_cta` already names its label. A button renders when both exist in the request locale.
   - The spec's descriptor list has no group kind and no plain-string kind. The testimonial `author` (≤ 60, a bare string in §3.2) gets a new `text{max}` kind.

9. **Settings shapes and defaults are fixed here (Task 2).** Defaults are customer-facing, so their text is MSA, in both locales.
   - `featured_products` defaults to `columns: 4` and `collection_list` to `3`. `DEFAULT_HOMEPAGE_SECTIONS` overrides both to `2` (Ruling 3).
   - Every `heading` is ≤ 80, including the three the spec leaves open (`featured_products`, `collection_list`, `whatsapp_cta`).

10. **WhatsApp numbers are normalised in the package, with Egypt's calling code by default — no shop-country setting exists to read.**
    - **Spec conflict:** Project 3's `toWhatsAppDigits` is not on this branch, and the shop has no country setting (`tenancy.store_settings` holds name, email, currency, time zone and weight unit).
    - `toWhatsAppDigits(raw, callingCode = "20")` is written fresh in the package. Egypt (`20`) completes a leading `0`.
    - The validator stores the normalised digits. The storefront builds `https://wa.me/<digits>?text=<encoded message in the request locale>` with `whatsAppHref`, re-checking the digits.

11. **"Newest" means descending product id.** **Spec gap:** `GET /public/products` lists by `id` ascending (oldest first; ids are UUIDv7 from `CryptoIdGenerator`) and has no sort.
    - A new catalog port, `NewestProductsReader.listNewestListed(limit, tenantId)`, reads `publishState = "published"` and not deleted, ordered by `id` descending. It is a separate port, like `ProductBatchReader`, so the product repository fakes need no new method.
    - It is served as `GET /public/products?sort=newest&first=<n>` (n 1–50, default 8).

12. **`GET /public/products?ids=a,b,c`:**
    - 1–50 distinct ids, each matching `^[A-Za-z0-9_-]{1,64}$`; empty segments are dropped and duplicates collapsed, keeping the first;
    - listed products only (published and not deleted, the same filter as the list);
    - in request order;
    - answered as `{ items, pageInfo: { hasNextPage: false, endCursor: null } }`.

    Combining it with `query`, `after`, `before`, `first`, `last` or `sort` is a 400 (zod), as are more than 50 ids or a malformed id.

13. **The public home DTO (Task 2's `PublicSection`):**
    - **What it carries:**
      - section ids, in both modes (React keys, `data-section-id`);
      - `hidden`, only in preview;
      - images as `ImageDto`;
      - collections as `{ id, slug, name }`, taken from the link target's new optional `slug` (Task 5);
      - products as the ids of live products;
      - links as `{ href, external }` (a canonical `safeHref` result);
      - the WhatsApp number as digits plus a `LocalizedText` message.
    - **What is dropped live and in preview alike:**
      - a broken image, a broken link, or a button without a label or link: the element is dropped;
      - `featured_collection` without a live collection;
      - manual `featured_products` / `collection_list` with no live item left;
      - `hero` / `image_with_text` / `rich_text` with no image, no text and no button;
      - `testimonials` / `features` with no item that has text;
      - `whatsapp_cta` without valid digits;
      - `announcement_bar` without text;
      - every unknown type.

      Preview mirrors the live result, so the editor's flags explain what is missing.

14. **The homepage always shows something:**
    - **The home read fails:** the storefront renders `DEFAULT_HOME`, the public form of the default sections, which needs no reference. It is never cached.
    - **`featured_products: newest` or `collection_list: all` has nothing to show:** the dictionary's empty copy renders (today's text), so a new shop's homepage is not blank.
    - **One section's data read fails:** that section is omitted and logged with `console.warn`, giving the shop id and the section type and never merchant text (spec 3.6).

15. **Caching:**
    - Live, cached 60 s per shop under the tags `os:<shopId>` and `catalog:<shopId>`:
      - the home document: key `["online-store", shopId, "home"]`;
      - each section data read: key `["online-store", shopId, "section-data", <kind>, …params]`.
    - Preview: the home document is `no-store`. The catalog reads stay cached, because they are live catalog data, never draft.
    - Inventory (`AvailabilityBook.load()`) stays as today: uncached, read outside any cache. Every read inside `unstable_cache` takes `shopId` explicitly and never calls `headers()`.
    - Nothing revalidates `catalog:` (spec 3.6). Publish revalidates `os:`.

16. **No merchant value reaches a `style` attribute.**
    - Overlay (0–80 step 10), columns, hero height, alignment and announcement style map to fixed Tailwind class strings in lookup tables (`section-styles.ts`).
    - The hero's box height comes from `height` (small/medium/large), with the image `object-cover` inside, so the layout never shifts, whatever the image's size.

17. **Hidden-section placeholders show in every preview.** §3.3 says "only in the editor iframe", but a preview tab and the iframe load the same URL, and the server cannot tell them apart. Both are staff-only.

18. **The preview keeps its place through a focus message.**
    - The editor posts `{ type: "morbeh:focus-section", id }` with `targetOrigin` set to the preview URL's origin (never `"*"`). It posts when a section is selected, and again on each iframe `load`, so the reload after a save returns to the section being edited.
    - This replaces Part 1 Ruling 17 ("no scroll restore"): spec 1.11's "keeping the scroll position" is met for the section being edited. With no selection, the reload starts at the top.
    - The storefront listener accepts a message only when all three hold:
      - `event.origin === ADMIN_ORIGIN`;
      - `event.source === window.parent`;
      - the id matches `SECTION_ID_PATTERN`.

19. **The image library uses `GET /media/assets`.**
    - Its items gain an additive `image: { url, alt, width, height } | null`, resolved through `admin.mediaImages` in one batched read per page. **Code conflict:** `lib/api/media.ts` says no list route exists; the route does exist, but has no URL.
    - The dialog shows the entries whose `image` is not null.
    - A library pick skips the upload-only dimension rules; the save checks ownership only.
    - Alt text is the asset's own, edited through the existing `PATCH /media/assets/:id` (spec 1.7), so it changes everywhere that image is used.

20. **Localized text fields in the section form show both languages at once (spec 3.5).** `LocalizedTextField` gains `layout?: "tabs" | "both"`. `both` stacks ar above en in the narrow sidebar, each with its own counter.

21. **The editor learns what the draft's references point to.**
    - `GET /online-store/theme` gains `targets`: for every collection, product and page reference in the **draft**, `{ title, live }`, in one batched resolve.
    - It is `null` when that read fails. The theme still loads, and no false "removed" flag shows.
    - Lookups use `Object.hasOwn`, because an id may be `__proto__`.

22. **How the tree is edited:**
    - **Each row's ⋯ menu** (`DropdownMenu`, portalled) holds Move up, Move down, Duplicate and Remove. Remove asks for confirmation.
    - **Alt+↑/↓** on a focused row moves the section.
    - **"+ Add section"** appends at the end and selects the new section. Duplicate inserts the copy below, with a new id, and selects it.
    - **Focus after each action:** after a move it stays on the moved row's select button; after a remove it goes to the next row, else the previous one, else "+ Add section"; after a duplicate it goes to the copy.
    - **Limits:** at the limits (25 sections, `maxPerPage`) the add options and Duplicate are disabled, with the reason.

23. **The tree's Header and Footer groups take over the Part 1 footer panel's settings.**
    - The **Header** group holds the announcement slot, `sticky` and the header menu.
    - The **Footer** group holds the footer menu, "Show policy links", "Show social links" and the footer note.
    - These are moved out of Part 1's `FooterPanel` into `HeaderPanel` and `FooterPanel`.
    - The social link URLs stay in the **Theme settings** tab with the other Part 1 panels.

24. **The E2E scenario of spec 3.7 is written, not run** (`apps/e2e/tests/online-store-sections.spec.ts`). It checks `typecheck` and `lint` only, because no environment exists. The e2e seed gains the Online Store permissions it needs.

25. **The announcement bar stays out of the locked store and respects `hidden`.**
    - `LockedFrame` never renders the announcement bar, because a locked view shows no shop chrome.
    - A hidden announcement is `null` in the live shell. In preview it is flagged `hidden` and renders as the placeholder.

## Global Constraints

These come from the spec and from the binding lessons of Parts 1 and 2. Every task's requirements include them.

1. **No migration (Ruling 1).** Never run `prisma migrate`, `db push`, or any SQL against any database. There is no database on this machine. DB-gated suites (`*.integration.test.ts`, `DATABASE_URL_TEST`) stay gated and skipped. Tests are unit tests with in-memory repositories and fakes. **All tasks.**
2. **Per-request tenant (ADR-0014):**
   - No object field named `tenantId` (or `defaultTenantId` / `pinnedTenantId`) anywhere on `WiredAdmin` outside the `tenancy` key. Cross-context seams are closures and per-call parameters (`publicReads.onlineStore.home(tenantId, previewToken?)`).
   - Every Prisma `findFirst`/`findMany`/`updateMany`/`deleteMany`/`count` names `tenantId` in a literal `where` (checked by `node scripts/dev/check-prisma-tenant-where.mjs`).
   - The tenant-mode guard test stays at one exemption (`tenancy`).

   **Tasks 4, 6.**

3. **The unit of work commits on an `err` Result.** `PrismaUnitOfWork.run` rolls back only on a throw.
   - Validate everything **before the first write**: document, contrast, version and references.
   - Never write and then return `err`.
   - A lost race throws `ConcurrencyError` and is answered 409 `VERSION_CONFLICT`.

   **Task 5.**

4. **Version guards:**
   - An absent theme row is version 0. The first save inserts it, and a duplicate insert is a `ConcurrencyError`.
   - The guarded `updateMany` returns `VERSION_CONFLICT`.
   - Publish stays bound to `expectedDraftRevision` (`DRAFT_CHANGED`).

   **Task 5.**

5. **Error codes travel in the envelope.** Every specific 404/409/422 message is `"CODE: text"`, and the presenter copies `CODE` into `body.code`. Field issues ride on the 422 with the code as the message, for example `{ field: "homepage.sections.2.settings.collection", message: "TARGET_NOT_FOUND" }`. The top code is the first issue's code. **Tasks 3, 5.**
6. **Merchant content, and the anti-goals verbatim:**
   - No raw HTML is stored or rendered from merchant input, and there is no `dangerouslySetInnerHTML` on merchant content.
   - No merchant-typed string reaches a CSS block, a `<script>`, a `style` attribute or a font URL (Ruling 16).
   - No draft content is served without a valid, unexpired preview token for that shop.
   - No cached storefront response or data entry is shared between two shops.
   - No new construction-time `tenantId` exists.
   - `POST /media/uploads` does not change behaviour.

   Rich text renders only through `<RichText>` (`renderRichText`). Every href renders only after `safeHref`. Every merchant text node has `dir="auto"`, and inline labels use `<bdi dir="auto">`. **Tasks 8, 9, 11, 12.**

7. **Limits and normalisers come from `@platform/storefront-content`, never from hand copies:**
   - descriptor `max` values;
   - `HOMEPAGE_SECTIONS_MAX`;
   - `maxPerPage`;
   - `toWhatsAppDigits` / `isWhatsAppDigits`;
   - `validateRichText`, `safeHref`, `pickText`.

   **All tasks.**

8. **admin-web:**
   - The runtime API is called only from server code. Client components never value-import `@/lib/api/*` or `@/lib/auth/*` (type imports only; checked by the client-bundle grep).
   - Every server action checks the shape of its arguments before calling the API.
   - A client call to an action goes through `settleAction` (localised fallback, pending reset, `unstable_rethrow`).
   - Keyboard focus is restored after every delete and move (tested with `document.activeElement`).
   - Per-keystroke server calls are debounced and cleaned up on unmount.
   - `aria-invalid` / `aria-describedby` use ids unique per section and per item.
   - Overlays inside a `backdrop-blur` ancestor are portalled (the `@platform/ui` `Dialog` / `DropdownMenu` portal).
   - Autosave stays Part 1's: one in flight, replayed under the same key, a 25 s send timeout, a `beforeunload` guard, and the version carried forward.
   - Every string goes in `messages/en.ts` and `messages/ar.ts` (**Egyptian** Arabic, brand "مربح").
   - CSS is logical (`ms-`/`me-`/`ps-`/`pe-`/`start`/`end`).

   **Tasks 10–12.**

9. **Storefront:**
   - Server components and server actions only. The client components are the section focus listener and the existing ones.
   - Copy goes in `messages/{en,ar}.ts` (**Modern Standard Arabic**), with parity enforced by `Dictionary`.
   - Layout is RTL-first.
   - Previews keep `noindex` (the existing `X-Robots-Tag` and the metadata `robots`) and `Referrer-Policy: no-referrer`.
   - Internal links keep the preview token (`withPreview` / `PreviewLinkKeeper`). External links never carry it and open with `rel="noopener noreferrer nofollow"`.
   - The middleware stays authoritative and fails closed. Part 3 adds no route and no exemption.

   **Tasks 7–9.**

10. **Brand:** **مربح** / **Morbeh**. "موربيه" must not appear anywhere in `apps/`, `packages/` or `services/`. **All tasks.**

**Part 3 numbers.** Spec values, verbatim:

| Limit                         | Value                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| Homepage sections             | ≤ 25 (`TOO_MANY_SECTIONS`)                                               |
| Announcement                  | header only, ≤ 1                                                         |
| `hero`                        | ≤ 3                                                                      |
| `whatsapp_cta`                | ≤ 2                                                                      |
| Rich-text bodies              | `image_with_text` ≤ 2,000; `rich_text` ≤ 5,000 (`RICH_TEXT_MAX.section`) |
| `announcement_bar.text`       | ≤ 120                                                                    |
| `hero` text                   | heading ≤ 80, subheading ≤ 200                                           |
| Button labels                 | ≤ 30                                                                     |
| `testimonials`                | quote ≤ 400, author ≤ 60, rating 0–5 (0 = none), 1–8 items               |
| `features`                    | title ≤ 40, text ≤ 140, 1–6 items                                        |
| `whatsapp_cta`                | text ≤ 300, message ≤ 300                                                |
| Product and collection counts | `productCount`/`count` 2–12, manual products ≤ 12, collection items ≤ 8  |
| Layout                        | `columns` 2–4, overlay 0–80 step 10                                      |
| Phone                         | 8–15 digits                                                              |
| `?ids=`                       | ≤ 50                                                                     |
| Caching                       | home cache 60 s, tags `os:<shopId>` and `catalog:<shopId>`               |

**Plan-level numbers.** From the Rulings:

| Item                     | Value                                      |
| ------------------------ | ------------------------------------------ |
| Schema version           | 2                                          |
| Default section ids      | `…000000000101`, `…000000000102`           |
| `?sort=newest`           | `first` 1–50, default 8                    |
| Default calling code     | `20`                                       |
| Library page size        | 24                                         |
| Resource search debounce | `LINK_SEARCH_DEBOUNCE_MS` (250 ms, Part 2) |

Permissions used (spec table, verbatim; all granted already, Ruling 1):

| Permission                         | Roles                   | Used by                                                  |
| ---------------------------------- | ----------------------- | -------------------------------------------------------- |
| `online_store:read`                | viewer, operator, admin | theme state (sections, `targets`), link-target search    |
| `online_store:edit_theme`          | operator, admin         | save the draft with sections                             |
| `online_store:upload_image`        | operator, admin         | `POST /online-store/images?purpose=section_image`        |
| `online_store_admin:publish_theme` | admin                   | publish (unchanged)                                      |
| `media_library:read`               | viewer, operator, admin | `GET /media/assets` (the library dialog)                 |
| `products:update`                  | operator, admin         | `PATCH /media/assets/:id` (alt text, the existing route) |

**Repository rules (from the owner):**

- **Committing:** commit with
  `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit`.
  - Conventional Commits, in lower case.
  - Body lines ≤ 100 characters.
  - The trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `--no-verify`, never push.
- **Staging:** stage only the task's own files (`git add <paths>`), never `.superpowers/` or `.claude/`. The pre-commit hook can take minutes, so commit in the foreground and wait.
- **Line endings:** files are CRLF in the owner's checkout (`core.autocrlf`). Keep each file's line endings, and discard unrelated prettier reformatting with `git checkout -- <file>`.
- **Invisible characters:** write invisible and bidi characters as `String.fromCharCode(…)` or as escapes. Check that `LC_ALL=C.UTF-8 grep -nP '[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]' <file>` prints nothing.

## Review Focus

These are the five failure modes the spec implies but its own test list does not pin, most likely first. Each names the task whose test pins it.

1. **Every live homepage blanks on deploy.**
   - **The risk:** a Part 1/2 draft, published document or release (`schemaVersion: 1`, `sections: []`) must render the default homepage, re-save without change, and keep `hasUnpublishedChanges` false.
   - **Pinned in:**
     - **Task 3:** `theme-document.test.ts` "a version-1 document reads as the default homepage and canonicalises like it";
     - **Task 5:** `theme.use-cases.test.ts` "a Part 1 draft equal to live has no unpublished changes after the upgrade";
     - **Task 7:** `homepage.test.ts` "a failed home read renders the default homepage and is not cached".
2. **A stale reference locks autosave.**
   - **The risk:** a restored release, or a collection deleted after it was added, must not make every later save (even a colour change) answer 422. A _new_ foreign id must still be refused, with nothing written.
   - **Pinned in:** **Task 5**, `theme.use-cases.test.ts`:
     - "a reference already in the draft is not re-checked (a deleted collection still saves)";
     - "a new foreign collection is TARGET_NOT_FOUND at its path, nothing written".
3. **The focus message is a cross-origin channel.**
   - **The risk:** a message from another origin, from a frame other than the parent, with a hostile id (`"] , body [x="`), or sent while not previewing, must do nothing. The editor must never post with `"*"`.
   - **Pinned in:**
     - **Task 8:** `section-focus.test.ts` "only the admin origin, from the parent, with a uuid";
     - **Task 8:** `store-chrome.test.tsx` "the listener is mounted only in preview with an admin origin";
     - **Task 12:** `customize-editor.test.tsx` "focus posts to the preview origin, again after each reload".
4. **One shop's homepage data reaches another shop.**
   - **The risk:** the home document and every section read (newest, by ids, collection products, collections) must key on the shop. A failure must never be stored. No read inside `unstable_cache` may touch `headers()`.
   - **Pinned in:** **Task 7**, `section-data.test.ts` and `homepage.test.ts`:
     - "two shops, two keys";
     - "errors are never cached";
     - "cached reads never read request headers".
5. **The editor loses the merchant's place.**
   - **The risk:** after Remove the focus must land on a real control, and after Alt+↓ it must stay on the moved row. A thrown server action must not leave the library dialog spinning. Typing in the product search must not fire one request per key, or after unmount.
   - **Pinned in:**
     - **Task 12:** `section-tree-panel.test.tsx` "focus after remove, move and duplicate";
     - **Task 11:** `media-library-dialog.test.tsx` "a thrown action shows the localised error and resets";
     - **Task 11:** `resource-picker.test.tsx` "debounced, and nothing after unmount".

---

## File Structure

**packages/storefront-content** (`@platform/storefront-content`)

- `src/phone.ts` (new): `toWhatsAppDigits`, `isWhatsAppDigits`, `whatsAppHref`.
- `src/section-fields.ts` (new): `FieldDescriptor`, the per-kind validators and lenient readers, and reference collection.
- `src/sections.ts` (new): the ten definitions, settings types, `Section`, `validateSection`, `readSection`, `newSection`, `DEFAULT_HOMEPAGE_SECTIONS` and `sectionRefsOf`.
- `src/public-sections.ts` (new): the public DTO types.
- `src/theme-document.ts`: schema version 2, `header.announcement`, sections and `documentRefsOf`.
- `src/menus.ts`: export `validateLinkRef` and `LINK_TARGET_ID_PATTERN`.
- `src/index.ts`; tests beside each file.

**services/catalog**

- `src/domain/product-repository.ts`: `NewestProductsReader`.
- `src/application/list-newest-products.use-case.ts` (+ test).
- `src/infrastructure/prisma-catalog-repositories.ts`, `in-memory-product-repository.ts`: `listNewestListed`.
- `src/interfaces/product.controller.ts`: `listNewest`.
- `src/composition.ts`, `src/index.ts`.

**services/online-store**

- `src/domain/errors.ts`: `referencesNotFound`.
- `src/application/ports.ts`: `LinkTarget.slug?`.
- `src/application/theme.use-cases.ts`: new-reference checks, section images, `targets`.
- `src/application/menu-resolution.ts`: export `resolveLinkRef`.
- `src/application/section-resolution.ts` (new), `home.use-case.ts` (new), `shell.use-case.ts` (announcement).
- `src/interfaces/online-store.controller.ts`, `src/composition.ts`, `src/index.ts`, `src/testing/fakes.ts`.

**apps/admin**

- `src/infrastructure/cross-context/online-store-link-targets.adapter.ts`: `slug`.
- `src/http/public-catalog-routes.ts`: `?ids=`, `?sort=newest`.
- `src/http/public-online-store-routes.ts`: `GET /public/online-store/home`.
- `src/http/media-library-routes.ts`: `image` on asset items.
- Tests beside each file, and `src/tenant-mode-guard.test.ts`.

**apps/storefront**

- `src/lib/shell-tag.ts` (`catalogTag`), `public-sections.ts` (new), `homepage.ts` (new), `section-data.ts` (new), `section-focus.ts` (new), `online-store.ts` (announcement).
- `src/components/sections/` (new):
  - `sections.tsx`, `section-frame.tsx`, `section-heading.tsx`, `section-button.tsx`, `section-styles.ts`;
  - `featured-products.tsx`, `featured-collection.tsx`, `collection-list.tsx`;
  - `hero.tsx`, `image-with-text.tsx`, `rich-text-section.tsx`, `testimonials.tsx`, `features.tsx`, `whatsapp-cta.tsx`, `announcement-bar.tsx`;
  - `section-focus-listener.tsx`.
- `src/components/store-chrome.tsx`, `collection-card.tsx` (optional image), `src/app/(store)/page.tsx`.
- `src/messages/en.ts`, `ar.ts`; tests beside each file.

**apps/admin-web**

- `src/lib/api/media.ts` (`fetchLibraryImages`), `src/lib/api/online-store.ts` (`targets`).
- `src/app/online-store/themes/actions.ts`: library, alt and argument checks.
- `src/lib/online-store/`:
  - `section-tree.ts`, `section-problems.ts` (new);
  - `theme-field-errors.ts` (new, moved out of `customize-editor.tsx`);
  - `preview-focus.ts` (new).
- `src/components/online-store/sections/` (new):
  - `section-settings-form.tsx`, `field-control.tsx`;
  - `image-field.tsx`, `media-library-dialog.tsx`, `resource-picker.tsx`;
  - `number-field.tsx`, `choice-field.tsx`, `phone-field.tsx`, `items-field.tsx`;
  - `section-tree-panel.tsx`, `add-section-dialog.tsx`, `section-icons.ts`.
- `src/components/online-store/localized-text-field.tsx` (`layout`), `customize-panels.tsx` (`HeaderPanel`, `FooterPanel`), `customize-editor.tsx`.
- `src/messages/en.ts`, `ar.ts`, `src/middleware.test.ts`.

**apps/e2e**

- `tests/online-store-sections.spec.ts` (new), `scripts/seed-e2e-identities.mjs`.

## Commands

- **Tests:**
  - all: `pnpm --filter <pkg> test`;
  - one file: `pnpm --filter <pkg> exec vitest run <file>`;
  - types and lint: `pnpm --filter <pkg> typecheck` and `pnpm --filter <pkg> lint`.

  Admin and admin-web lint need memory: `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint` (the same variable for `admin-web`).

- **Package filter names:** `@platform/storefront-content`, `@platform/catalog`, `@platform/online-store`, `@platform/admin`, `admin-web`, `storefront`, `@platform/e2e`.
- **Dependencies:** there is no new external dependency and no `package.json` change. If `node_modules` is being installed in the background, wait and retry. Never delete `node_modules` or the lockfile.
- **Tenant-filter guard:** `node scripts/dev/check-prisma-tenant-where.mjs`. Run the script directly: the guard test cannot load from a path with a space. On this base it reports ONE known finding, `apps/admin/src/interfaces/discounts/discounts.admin-controller.ts:166: promotions.update has no where`. Any other finding is yours to fix.
- **Route contracts,** run from each app's directory:
  - `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`;
  - `cd apps/storefront && pnpm exec vitest run src/lib/runtime-contract.test.ts`.

  The second one fails until the storefront calls a new public route the admin serves: Task 6 adds `/public/online-store/home`, and Task 7 calls it.

- **`next build` fails with `EPERM` on this machine.** Do not rely on it: `typecheck`, `lint` and `test` are the gates for admin-web and storefront.
- **Client-bundle grep (admin-web):**
  `grep -rlE '^"use client"' apps/admin-web/src | xargs grep -nE 'from "@/lib/(api|auth)/' | grep -v 'import type'`
  It matches the closing line of multi-line imports too, so inspect every hit. It prints exactly the three pre-existing hits Part 2 recorded:
  - `components/finance/finance-model-picker.tsx`;
  - `components/security/audit-actions.tsx`;
  - `components/security/identity-actions.tsx`.

  Nothing under `components/online-store` or `app/online-store` may appear.

Commit template used by every task (replace subject/body):

```bash
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
<type>(<scope>): <lower-case subject>

<body, lines <= 100 chars>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 1: `@platform/storefront-content` — WhatsApp numbers and field descriptors

Model tier: **strong** (a security boundary: every section value passes through these validators).

**Files:**

- Create: `packages/storefront-content/src/phone.ts`, `phone.test.ts`
- Create: `packages/storefront-content/src/section-fields.ts`, `section-fields.test.ts`
- Modify: `packages/storefront-content/src/menus.ts` (export `validateLinkRef`; rename the private `LINK_TARGET_ID` to the exported `LINK_TARGET_ID_PATTERN`)
- Modify: `packages/storefront-content/src/theme-document.ts` (rename the private `IMAGE_REF` to the exported `IMAGE_REF_PATTERN`; nothing else changes)
- Modify: `packages/storefront-content/src/index.ts` (`export * from "./phone"; export * from "./section-fields";`)

**Interfaces:**

- Consumes:
  - `normalizeLocalizedText`, `normalizePlainText`, `ContentIssue`, `LocalizedText` (`locale.ts`);
  - `validateRichText` (`rich-text.ts`);
  - `MAX_ISSUES`, `pathSegment` (`issues.ts`);
  - `LinkRef` (`menus.ts`).
- Produces:
  - `phone.ts`:
    - `WHATSAPP_DIGITS_MIN = 8`, `WHATSAPP_DIGITS_MAX = 15`, `DEFAULT_CALLING_CODE = "20"`;
    - `toWhatsAppDigits(raw: unknown, callingCode?: string): string | null`;
    - `isWhatsAppDigits(value: unknown): value is string`, matching `/^[1-9][0-9]{7,14}$/`;
    - `whatsAppHref(digits: string, message: string | null): string | null`.
  - `menus.ts`:
    - `export function validateLinkRef(raw: unknown, path: string, issues: ContentIssue[]): LinkRef | null` (unchanged body);
    - `export const LINK_TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/`.
  - `theme-document.ts`: `export const IMAGE_REF_PATTERN = /^[A-Za-z0-9-]{1,64}$/`.
  - `section-fields.ts`:

    ```ts
    export type FieldDescriptor =
      | { readonly kind: "localizedText"; readonly key: string; readonly max: number }
      | { readonly kind: "richText"; readonly key: string; readonly max: number }
      | { readonly kind: "image"; readonly key: string; readonly purpose: "section_image" }
      | { readonly kind: "link"; readonly key: string }
      | { readonly kind: "collection"; readonly key: string }
      | { readonly kind: "products"; readonly key: string; readonly max: number }
      | {
          readonly kind: "number";
          readonly key: string;
          readonly min: number;
          readonly max: number;
          readonly step: number;
        }
      | { readonly kind: "select"; readonly key: string; readonly options: readonly string[] }
      | { readonly kind: "boolean"; readonly key: string }
      | { readonly kind: "phone"; readonly key: string }
      | { readonly kind: "text"; readonly key: string; readonly max: number }
      | {
          readonly kind: "items";
          readonly key: string;
          readonly min: number;
          readonly max: number;
          readonly fields: readonly FieldDescriptor[];
        };
    export type FieldKind = FieldDescriptor["kind"];
    export interface SectionRef {
      readonly path: string;
      readonly id: string;
    }
    export interface SectionRefs {
      readonly image: SectionRef[];
      readonly collection: SectionRef[];
      readonly product: SectionRef[];
      readonly page: SectionRef[];
    }
    export function emptySectionRefs(): SectionRefs;
    /** The value a lenient read falls back to inside an item: {} / null / [] / min / options[0] / false / "". */
    export function emptyFieldValue(field: FieldDescriptor): unknown;
    /** Strict: an object with exactly the fields' keys; returns the stored values or null (issues pushed). */
    export function validateFields(
      fields: readonly FieldDescriptor[],
      raw: unknown,
      path: string,
      issues: ContentIssue[],
    ): Record<string, unknown> | null;
    /** Lenient (read path): never pushes; unknown keys dropped; an invalid value becomes fallback[key]. */
    export function readFields(
      fields: readonly FieldDescriptor[],
      raw: unknown,
      fallback: Readonly<Record<string, unknown>>,
    ): Record<string, unknown>;
    /** Appends every image, collection, product and page id the values name, with its dotted path. */
    export function collectFieldRefs(
      fields: readonly FieldDescriptor[],
      values: Readonly<Record<string, unknown>>,
      path: string,
      out: SectionRefs,
    ): void;
    ```

- [ ] **Step 1: Write the failing phone tests**: `packages/storefront-content/src/phone.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isWhatsAppDigits, toWhatsAppDigits, whatsAppHref } from "./phone";

describe("toWhatsAppDigits (spec 3.2, Ruling 10)", () => {
  it.each([
    ["+20 100 123 4567", "201001234567"],
    ["01001234567", "201001234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "201001234567"], // Arabic-Indic
    ["۰۱۰۰۱۲۳۴۵۶۷", "201001234567"], // Persian
    ["00201001234567", "201001234567"],
    ["(010) 0123-4567", "201001234567"],
    ["966501234567", "966501234567"],
  ])("%s → %s", (raw, digits) => expect(toWhatsAppDigits(raw)).toBe(digits));

  it("completes a leading 0 from the calling code it is given", () => {
    expect(toWhatsAppDigits("0501234567", "966")).toBe("966501234567");
  });

  it.each(["", "   ", "0", "1234567", "+1234567890123456", "0000000000", "abc", "+0123456789"])(
    "refuses %j (8–15 digits, never a leading 0)",
    (raw) => expect(toWhatsAppDigits(raw)).toBeNull(),
  );

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 201001234567, {}, ["01001234567"]]) {
      expect(toWhatsAppDigits(value)).toBeNull();
    }
  });
});

describe("whatsAppHref", () => {
  it("builds wa.me with the encoded message, or without one", () => {
    expect(whatsAppHref("201001234567", "مرحبًا، سؤال")).toBe(
      `https://wa.me/201001234567?text=${encodeURIComponent("مرحبًا، سؤال")}`,
    );
    expect(whatsAppHref("201001234567", null)).toBe("https://wa.me/201001234567");
    expect(whatsAppHref("201001234567", "")).toBe("https://wa.me/201001234567");
  });
  it("is null for digits that are not a WhatsApp number", () => {
    expect(whatsAppHref("0100", "x")).toBeNull();
    expect(whatsAppHref("20100/../x", null)).toBeNull();
    expect(isWhatsAppDigits("201001234567")).toBe(true);
    expect(isWhatsAppDigits("01001234567")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/phone.test.ts`
Expected: FAIL with `Cannot find module './phone'`.

- [ ] **Step 3: Implement `phone.ts`**

`toWhatsAppDigits` works in this order:

1. If the value is not a string, return null.
2. Map U+0660–0669 and U+06F0–06F9 to `0`–`9`.
3. Trim. `international` is true when the value starts with `+`.
4. Strip every non-digit.
5. If not international and the digits start with `00`, drop the `00`.
6. Else, if not international and they start with `0`, replace that `0` with `callingCode`.
7. Return the result if `isWhatsAppDigits` passes, else null.

`whatsAppHref` returns null unless `isWhatsAppDigits(digits)`. It appends `?text=` + `encodeURIComponent(message)` only for a non-empty message.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/phone.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing field tests**: `packages/storefront-content/src/section-fields.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ContentIssue } from "./locale";
import {
  collectFieldRefs,
  emptySectionRefs,
  readFields,
  validateFields,
  type FieldDescriptor,
} from "./section-fields";

function check(field: FieldDescriptor, raw: unknown) {
  const issues: ContentIssue[] = [];
  const values = validateFields([field], { [field.key]: raw }, "s", issues);
  return { value: values?.[field.key], issues };
}
const codes = (issues: readonly ContentIssue[]) => issues.map((i) => `${i.path}:${i.code}`);

describe("validateFields — one test per descriptor kind (spec 3.2)", () => {
  it("localizedText: trimmed, ≤ max per locale, ar/en only", () => {
    const f = { kind: "localizedText", key: "heading", max: 80 } as const;
    expect(check(f, { ar: "  عرض  ", en: "Sale" }).value).toEqual({ ar: "عرض", en: "Sale" });
    expect(check(f, {}).value).toEqual({});
    expect(check(f, { ar: "x".repeat(80) }).issues).toEqual([]);
    expect(codes(check(f, { en: "x".repeat(81) }).issues)).toEqual(["s.heading.en:TOO_LONG"]);
    expect(codes(check(f, { fr: "x" }).issues)).toEqual(["s.heading.fr:UNKNOWN_KEY"]);
  });

  it("richText: Morbeh text per locale; an unsafe link is UNSAFE_LINK on that locale", () => {
    const f = { kind: "richText", key: "body", max: 2000 } as const;
    expect(check(f, { ar: "سطر\n**عريض**" }).value).toEqual({ ar: "سطر\n**عريض**" });
    expect(codes(check(f, { en: "[x](javascript:alert(1))" }).issues)).toEqual([
      "s.body.en:UNSAFE_LINK",
    ]);
    expect(codes(check(f, { ar: "x".repeat(2001) }).issues)).toEqual(["s.body.ar:TOO_LONG"]);
  });

  it("image: null or a media id; never a path or a URL", () => {
    const f = { kind: "image", key: "image", purpose: "section_image" } as const;
    expect(check(f, null).value).toBeNull();
    expect(check(f, "asset-1").value).toBe("asset-1");
    for (const bad of ["../x", "https://x.example/a.png", "a".repeat(65), 7]) {
      expect(codes(check(f, bad).issues)).toEqual(["s.image:INVALID_VALUE"]);
    }
  });

  it("link: null or a menu LinkRef under the same rules", () => {
    const f = { kind: "link", key: "buttonLink" } as const;
    expect(check(f, null).value).toBeNull();
    expect(check(f, { type: "collection", id: "c-1" }).value).toEqual({
      type: "collection",
      id: "c-1",
    });
    expect(codes(check(f, { type: "url", url: "http://x.example" }).issues)).toEqual([
      "s.buttonLink.url:INVALID_URL",
    ]);
    expect(codes(check(f, { type: "constructor" }).issues)).toEqual([
      "s.buttonLink.type:INVALID_LINK",
    ]);
  });

  it("collection: null or a target id", () => {
    const f = { kind: "collection", key: "collection" } as const;
    expect(check(f, null).value).toBeNull();
    expect(codes(check(f, "c 1").issues)).toEqual(["s.collection:INVALID_VALUE"]);
  });

  it("products: distinct target ids, at most max; empty is allowed (Ruling 5)", () => {
    const f = { kind: "products", key: "products", max: 12 } as const;
    expect(check(f, []).value).toEqual([]);
    expect(
      codes(
        check(
          f,
          Array.from({ length: 13 }, (_, i) => `p${i}`),
        ).issues,
      ),
    ).toEqual(["s.products:TOO_MANY_ITEMS"]);
    expect(codes(check(f, ["p1", "p1"]).issues)).toEqual(["s.products.1:DUPLICATE_VALUE"]);
  });

  it("number: an integer inside [min, max] on the step", () => {
    const f = { kind: "number", key: "overlay", min: 0, max: 80, step: 10 } as const;
    expect(check(f, 0).value).toBe(0);
    expect(check(f, 80).value).toBe(80);
    for (const bad of [85, 90, -10, 10.5]) {
      expect(codes(check(f, bad).issues)).toEqual(["s.overlay:OUT_OF_RANGE"]);
    }
    expect(codes(check(f, "10").issues)).toEqual(["s.overlay:INVALID_VALUE"]);
  });

  it("select and boolean: exact values only", () => {
    const s = { kind: "select", key: "contentAlign", options: ["start", "center"] } as const;
    expect(check(s, "center").value).toBe("center");
    expect(codes(check(s, "middle").issues)).toEqual(["s.contentAlign:INVALID_VALUE"]);
    const b = { kind: "boolean", key: "showViewAll" } as const;
    expect(codes(check(b, "true").issues)).toEqual(["s.showViewAll:INVALID_VALUE"]);
  });

  it("phone: empty means not set; anything else is normalised or INVALID_PHONE", () => {
    const f = { kind: "phone", key: "phone" } as const;
    expect(check(f, "").value).toBe("");
    expect(check(f, "010 0123 4567").value).toBe("201001234567");
    expect(codes(check(f, "12").issues)).toEqual(["s.phone:INVALID_PHONE"]);
  });

  it("text: one line, plain, at most max", () => {
    const f = { kind: "text", key: "author", max: 60 } as const;
    expect(check(f, " Nour\nA. ").value).toBe("Nour A.");
    expect(codes(check(f, "x".repeat(61)).issues)).toEqual(["s.author:TOO_LONG"]);
  });

  it("items: count bounds, strict item keys, nested paths", () => {
    const f = {
      kind: "items",
      key: "items",
      min: 1,
      max: 8,
      fields: [{ kind: "localizedText", key: "quote", max: 400 }],
    } as const;
    expect(codes(check(f, []).issues)).toEqual(["s.items:TOO_FEW_ITEMS"]);
    expect(
      codes(
        check(
          f,
          Array.from({ length: 9 }, () => ({ quote: {} })),
        ).issues,
      ),
    ).toEqual(["s.items:TOO_MANY_ITEMS"]);
    expect(codes(check(f, [{ quote: {}, extra: 1 }]).issues)).toEqual([
      "s.items.0.extra:UNKNOWN_KEY",
    ]);
    expect(codes(check(f, [{ quote: {} }, { quote: { ar: "x".repeat(401) } }]).issues)).toEqual([
      "s.items.1.quote.ar:TOO_LONG",
    ]);
  });

  it("the settings object itself: missing and unknown keys; never more than MAX_ISSUES", () => {
    const fields = [{ kind: "boolean", key: "a" }] as const;
    const issues: ContentIssue[] = [];
    expect(validateFields(fields, { b: 1 }, "s", issues)).toBeNull();
    expect(codes(issues)).toEqual(["s.b:UNKNOWN_KEY", "s.a:MISSING"]);
    const flood: ContentIssue[] = [];
    validateFields(
      fields,
      Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 1])),
      "s",
      flood,
    );
    expect(flood.length).toBeLessThanOrEqual(50);
  });
});

describe("readFields — the lenient read path", () => {
  it("an invalid value falls back; an unknown key is dropped; items are cut to max", () => {
    const fields = [
      { kind: "number", key: "columns", min: 2, max: 4, step: 1 },
      {
        kind: "items",
        key: "items",
        min: 1,
        max: 2,
        fields: [{ kind: "text", key: "author", max: 60 }],
      },
    ] as const;
    const read = readFields(
      fields,
      { columns: 9, extra: "x", items: [{ author: 5 }, { author: "B" }, { author: "C" }] },
      { columns: 4, items: [] },
    );
    expect(read).toEqual({ columns: 4, items: [{ author: "" }, { author: "B" }] });
  });
});

describe("collectFieldRefs", () => {
  it("lists images, collections, products and page links with their paths", () => {
    const fields = [
      { kind: "image", key: "image", purpose: "section_image" },
      { kind: "collection", key: "collection" },
      { kind: "products", key: "products", max: 12 },
      { kind: "link", key: "buttonLink" },
      {
        kind: "items",
        key: "items",
        min: 0,
        max: 8,
        fields: [{ kind: "image", key: "image", purpose: "section_image" }],
      },
    ] as const;
    const out = emptySectionRefs();
    collectFieldRefs(
      fields,
      {
        image: "m1",
        collection: "c1",
        products: ["p1", "p2"],
        buttonLink: { type: "page", id: "pg1" },
        items: [{ image: null }, { image: "m2" }],
      },
      "s",
      out,
    );
    expect(out).toEqual({
      image: [
        { path: "s.image", id: "m1" },
        { path: "s.items.1.image", id: "m2" },
      ],
      collection: [{ path: "s.collection", id: "c1" }],
      product: [
        { path: "s.products.0", id: "p1" },
        { path: "s.products.1", id: "p2" },
      ],
      page: [{ path: "s.buttonLink.id", id: "pg1" }],
    });
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/section-fields.test.ts`
Expected: FAIL with `Cannot find module './section-fields'`.

- [ ] **Step 7: Implement `section-fields.ts`, and the two exports in `menus.ts` / `theme-document.ts`**

One function per kind, used by both `validateFields` (which pushes issues) and `readFields` (which swallows them, using `[]` as the sink, then the fallback).

| Kind            | Rule                                                                                                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localizedText` | `normalizeLocalizedText(raw, { path, max })`                                                                                                                                                                                                                                                                         |
| `richText`      | `normalizeLocalizedText(raw, { path, max, multiline: true })`, then for each present locale that normalising did not already report `TOO_LONG`, every `validateRichText(text, max)` issue becomes `{ path: <path>.<locale>, code }`; the line is dropped (Part 2 Ruling 9), and a locale never gets `TOO_LONG` twice |
| `image`         | `null`, or a string matching `IMAGE_REF_PATTERN`                                                                                                                                                                                                                                                                     |
| `collection`    | `null`, or a string matching `LINK_TARGET_ID_PATTERN`                                                                                                                                                                                                                                                                |
| `products`      | an array ≤ `max` (`TOO_MANY_ITEMS` on the list), each entry `LINK_TARGET_ID_PATTERN`, case-sensitive distinct (`DUPLICATE_VALUE` on the entry)                                                                                                                                                                       |
| `link`          | `null`, or `validateLinkRef`                                                                                                                                                                                                                                                                                         |
| `number`        | `typeof === "number"` (else `INVALID_VALUE`), then `Number.isInteger`, `min ≤ v ≤ max` and `(v - min) % step === 0` (else `OUT_OF_RANGE`)                                                                                                                                                                            |
| `select`        | one of `options`                                                                                                                                                                                                                                                                                                     |
| `boolean`       | a boolean                                                                                                                                                                                                                                                                                                            |
| `phone`         | `""` stays `""`; anything else is `toWhatsAppDigits` (`null` is `INVALID_PHONE`)                                                                                                                                                                                                                                     |
| `text`          | `normalizePlainText(value)` single line, ≤ `max`                                                                                                                                                                                                                                                                     |
| `items`         | an array; `TOO_FEW_ITEMS` / `TOO_MANY_ITEMS` on the list; each item is `validateFields(item.fields, entry, <path>.<i>, issues)`                                                                                                                                                                                      |

- Keys are checked as in `menus.ts`'s `checkKeys`: unknown keys, capped at `MAX_ISSUES` and named through `pathSegment`; missing keys are `MISSING`. Values are read with `Object.hasOwn`.
- `readFields`:
  - takes an item's fallback from `emptyFieldValue`;
  - cuts lists to `max`, but never pads them up to `min`;
  - ignores an over-long value instead of reporting it: it falls back.

- [ ] **Step 8: Run the package suite**

Run: `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/storefront-content lint`
Expected: PASS. The menu and theme-document suites are unchanged by the two renames.

- [ ] **Step 9: Commit**

```bash
git add packages/storefront-content/src/phone.ts packages/storefront-content/src/phone.test.ts \
  packages/storefront-content/src/section-fields.ts packages/storefront-content/src/section-fields.test.ts \
  packages/storefront-content/src/menus.ts packages/storefront-content/src/theme-document.ts \
  packages/storefront-content/src/index.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): add section field descriptors and whatsapp numbers

One validator per descriptor kind (strict on write, lenient on read) with dotted issue paths,
reference collection for ownership checks, and the shared WhatsApp digit normaliser.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `@platform/storefront-content` — the section library and the public section types

Model tier: **standard**.

**Files:**

- Create: `packages/storefront-content/src/sections.ts`, `sections.test.ts`
- Create: `packages/storefront-content/src/public-sections.ts` (types only; exercised by Tasks 6–9)
- Modify: `packages/storefront-content/src/index.ts` (`export * from "./sections"; export * from "./public-sections";`)

**Interfaces:**

- Consumes: Task 1's `FieldDescriptor`, `validateFields`, `readFields`, `collectFieldRefs`, `emptySectionRefs`, `SectionRefs`; `LinkRef`; `LocalizedText`; `pickText`; `RICH_TEXT_MAX`; `PolicyType` is not needed.
- Produces (`sections.ts`):
  - `SECTION_TYPES = ["announcement_bar", "hero", "featured_collection", "featured_products", "collection_list", "image_with_text", "rich_text", "testimonials", "features", "whatsapp_cta"] as const`, and `type SectionType`.
  - `FEATURE_ICONS = ["cod", "shipping", "returns", "support", "secure", "quality", "gift"] as const`, and `type FeatureIcon`.
  - Settings interfaces (all fields `readonly`; LT = `LocalizedText`):
    - `AnnouncementBarSettings { text: LT; link: LinkRef | null; style: "accent" | "primary" | "dark" }`
    - `HeroSettings { image: string | null; mobileImage: string | null; heading: LT; subheading: LT; buttonLabel: LT; buttonLink: LinkRef | null; height: "small" | "medium" | "large"; contentAlign: "start" | "center"; overlay: number }`
    - `FeaturedCollectionSettings { collection: string | null; heading: LT; productCount: number; columns: number; showViewAll: boolean }`
    - `FeaturedProductsSettings { source: "newest" | "manual"; products: readonly string[]; count: number; heading: LT; columns: number }`
    - `CollectionListSettings { source: "all" | "manual"; items: readonly { collection: string | null; image: string | null }[]; heading: LT; columns: number }`
    - `ImageWithTextSettings { image: string | null; heading: LT; body: LT; buttonLabel: LT; buttonLink: LinkRef | null; imagePosition: "start" | "end" }`
    - `RichTextSettings { heading: LT; body: LT; buttonLabel: LT; buttonLink: LinkRef | null; align: "start" | "center" }`
    - `TestimonialsSettings { heading: LT; items: readonly { quote: LT; author: string; rating: number }[] }`
    - `FeaturesSettings { heading: LT; items: readonly { icon: FeatureIcon; title: LT; text: LT }[] }`
    - `WhatsAppCtaSettings { heading: LT; text: LT; buttonLabel: LT; phone: string; message: LT }`
  - `interface SettingsByType { announcement_bar: AnnouncementBarSettings; hero: HeroSettings; … }`.
  - `type KnownSection = { [T in SectionType]: { readonly id: string; readonly type: T; readonly hidden: boolean; readonly settings: SettingsByType[T] } }[SectionType]`.
  - `type AnnouncementSection = Extract<KnownSection, { type: "announcement_bar" }>`.
  - `interface UnsupportedSection { readonly id: string; readonly type: string; readonly hidden: boolean; readonly settings: Readonly<Record<string, unknown>> }`, and `type Section = KnownSection | UnsupportedSection`.
  - `type SectionPlacement = "header" | "homepage"`, and `type SectionIcon = "megaphone" | "image" | "star" | "grid" | "folders" | "image-text" | "text" | "quote" | "badge-check" | "message-circle"`.
  - `interface SectionDefinition<T extends SectionType = SectionType> { readonly type: T; readonly labels: { readonly en: string; readonly ar: string }; readonly icon: SectionIcon; readonly placement: SectionPlacement; readonly maxPerPage: number | null; readonly fields: readonly FieldDescriptor[]; defaults(): SettingsByType[T]; validate(raw: unknown, path: string, issues: ContentIssue[]): SettingsByType[T] | null }`.
  - `SECTION_DEFINITIONS: readonly SectionDefinition[]` (library order, frozen); `sectionDefinition(type: string): SectionDefinition | null` (scans the list; never indexes by the untrusted string).
  - `isKnownSection(section: Section): section is KnownSection`.
  - `SECTION_ID_PATTERN` (the menu item uuid rule, case-insensitive); `UNSUPPORTED_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/`; `HOMEPAGE_SECTIONS_MAX = 25`.
  - `validateSection(raw: unknown, path: string, issues: ContentIssue[], placement: SectionPlacement): Section | null`.
  - `readSection(raw: unknown, placement: SectionPlacement): Section | null`.
  - `newSection<T extends SectionType>(type: T, id: string): Extract<KnownSection, { type: T }>`.
  - `DEFAULT_HOMEPAGE_SECTION_IDS = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"] as const`, and `DEFAULT_HOMEPAGE_SECTIONS: readonly KnownSection[]` (deep-frozen).
  - `sectionRefsOf(sections: readonly Section[], basePath: string): SectionRefs` (known sections only, hidden ones too).
  - `sectionHeading(section: Section, locale: Locale): string | null`.
- Produces (`public-sections.ts`, types only):

  ```ts
  export interface PublicImage {
    readonly url: string;
    readonly alt: string | null;
    readonly width: number | null;
    readonly height: number | null;
  }
  export interface PublicLink {
    readonly href: string;
    readonly external: boolean;
  }
  export interface PublicCollectionRef {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  }
  export interface PublicButton {
    readonly label: LocalizedText;
    readonly link: PublicLink;
  }
  export interface PublicSettingsByType {
    announcement_bar: {
      text: LT;
      link: PublicLink | null;
      style: AnnouncementBarSettings["style"];
    };
    hero: {
      image: PublicImage | null;
      mobileImage: PublicImage | null;
      heading: LT;
      subheading: LT;
      button: PublicButton | null;
      height: HeroSettings["height"];
      contentAlign: HeroSettings["contentAlign"];
      overlay: number;
    };
    featured_collection: {
      collection: PublicCollectionRef;
      heading: LT;
      productCount: number;
      columns: number;
      showViewAll: boolean;
    };
    featured_products:
      | { source: "newest"; count: number; heading: LT; columns: number }
      | { source: "manual"; productIds: readonly string[]; heading: LT; columns: number };
    collection_list:
      | { source: "all"; heading: LT; columns: number }
      | {
          source: "manual";
          items: readonly { collection: PublicCollectionRef; image: PublicImage | null }[];
          heading: LT;
          columns: number;
        };
    image_with_text: {
      image: PublicImage | null;
      heading: LT;
      body: LT;
      button: PublicButton | null;
      imagePosition: "start" | "end";
    };
    rich_text: { heading: LT; body: LT; button: PublicButton | null; align: "start" | "center" };
    testimonials: { heading: LT; items: TestimonialsSettings["items"] };
    features: { heading: LT; items: FeaturesSettings["items"] };
    whatsapp_cta: { heading: LT; text: LT; buttonLabel: LT; phone: string; message: LT };
  }
  /** `hidden` is present only in preview (Ruling 13). */
  export type PublicSection = {
    [T in SectionType]: {
      readonly id: string;
      readonly type: T;
      readonly hidden?: boolean;
      readonly settings: PublicSettingsByType[T];
    };
  }[SectionType];
  export type PublicAnnouncement = Extract<PublicSection, { type: "announcement_bar" }>;
  ```

- [ ] **Step 1: Write the failing library tests**: `packages/storefront-content/src/sections.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ContentIssue } from "./locale";
import {
  DEFAULT_HOMEPAGE_SECTIONS,
  HOMEPAGE_SECTIONS_MAX,
  newSection,
  readSection,
  SECTION_DEFINITIONS,
  SECTION_TYPES,
  sectionDefinition,
  sectionHeading,
  sectionRefsOf,
  validateSection,
} from "./sections";

const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const placementOf = (type: string) => (type === "announcement_bar" ? "header" : "homepage");
const run = (raw: unknown, placement: "header" | "homepage" = "homepage") => {
  const issues: ContentIssue[] = [];
  return { section: validateSection(raw, "x", issues, placement), issues };
};

describe("section library v1 (spec 3.2)", () => {
  it("has the ten types, in library order, each defined once", () => {
    expect(SECTION_DEFINITIONS.map((d) => d.type)).toEqual([...SECTION_TYPES]);
    expect(HOMEPAGE_SECTIONS_MAX).toBe(25);
  });

  it.each(SECTION_TYPES)("%s: its defaults pass its own validator unchanged", (type) => {
    const section = newSection(type, ID);
    const { section: back, issues } = run(section, placementOf(type));
    expect(issues).toEqual([]);
    expect(back).toEqual(section);
  });

  it.each(SECTION_TYPES)(
    "%s: the descriptor keys are exactly the default settings' keys",
    (type) => {
      const def = sectionDefinition(type)!;
      expect(def.fields.map((f) => f.key).sort()).toEqual(Object.keys(def.defaults()).sort());
    },
  );

  it("placement and per-page limits (spec table)", () => {
    const limits = Object.fromEntries(
      SECTION_DEFINITIONS.map((d) => [d.type, [d.placement, d.maxPerPage]]),
    );
    expect(limits).toEqual({
      announcement_bar: ["header", 1],
      hero: ["homepage", 3],
      featured_collection: ["homepage", null],
      featured_products: ["homepage", null],
      collection_list: ["homepage", null],
      image_with_text: ["homepage", null],
      rich_text: ["homepage", null],
      testimonials: ["homepage", null],
      features: ["homepage", null],
      whatsapp_cta: ["homepage", 2],
    });
  });

  it("the labels are the spec's (admin ar is Egyptian)", () => {
    expect(sectionDefinition("hero")!.labels).toEqual({ en: "Image banner", ar: "بانر بصورة" });
    expect(sectionDefinition("whatsapp_cta")!.labels).toEqual({
      en: "WhatsApp button",
      ar: "زرار واتساب",
    });
  });

  it("a section in the wrong place is SECTION_NOT_ALLOWED_HERE", () => {
    expect(run(newSection("announcement_bar", ID)).issues).toEqual([
      { path: "x.type", code: "SECTION_NOT_ALLOWED_HERE" },
    ]);
    expect(run(newSection("hero", ID), "header").issues).toEqual([
      { path: "x.type", code: "SECTION_NOT_ALLOWED_HERE" },
    ]);
  });

  it("a known type is strict: an unknown setting is UNKNOWN_KEY at its path", () => {
    const hero = newSection("hero", ID);
    expect(run({ ...hero, settings: { ...hero.settings, video: "x" } }).issues).toEqual([
      { path: "x.settings.video", code: "UNKNOWN_KEY" },
    ]);
  });

  it("an unknown type is kept verbatim, but its envelope is still checked (Ruling 7)", () => {
    const future = {
      id: ID,
      type: "countdown_timer",
      hidden: false,
      settings: { endsAt: "2027-01-01", nested: { a: [1] } },
    };
    expect(run(future).section).toEqual(future);
    expect(readSection(future, "homepage")).toEqual(future);
    expect(run({ ...future, id: "nope" }).issues).toEqual([
      { path: "x.id", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, type: "Bad Type" }).issues).toEqual([
      { path: "x.type", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, settings: [] }).issues).toEqual([
      { path: "x.settings", code: "INVALID_VALUE" },
    ]);
    expect(run({ ...future, hidden: "no" }).issues).toEqual([
      { path: "x.hidden", code: "INVALID_VALUE" },
    ]);
    expect(readSection(future, "header")).toBeNull(); // the header slot takes the announcement bar only
  });

  it("readSection is lenient: a bad field becomes the default, an unknown setting is dropped", () => {
    const hero = newSection("hero", ID);
    const read = readSection(
      { ...hero, settings: { ...hero.settings, overlay: 85, video: "x" } },
      "homepage",
    );
    expect(read).toEqual(hero); // default overlay 30, no `video`
  });

  it("DEFAULT_HOMEPAGE_SECTIONS: newest 8 products, then every collection (spec 3.2, Ruling 3)", () => {
    expect(DEFAULT_HOMEPAGE_SECTIONS).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000101",
        type: "featured_products",
        hidden: false,
        settings: {
          source: "newest",
          products: [],
          count: 8,
          heading: { ar: "المنتجات", en: "Products" },
          columns: 2,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        type: "collection_list",
        hidden: false,
        settings: {
          source: "all",
          items: [],
          heading: { ar: "المجموعات", en: "Collections" },
          columns: 2,
        },
      },
    ]);
    expect(Object.isFrozen(DEFAULT_HOMEPAGE_SECTIONS[0]!.settings)).toBe(true);
  });

  it("sectionRefsOf lists known sections' refs with paths, hidden ones too, unsupported never", () => {
    const hero = {
      ...newSection("hero", ID),
      hidden: true,
      settings: {
        ...newSection("hero", ID).settings,
        image: "m1",
        buttonLink: { type: "product", id: "p1" },
      },
    };
    const future = {
      id: ID.replace("6f", "7f"),
      type: "x_future",
      hidden: false,
      settings: { image: "m9" },
    };
    expect(sectionRefsOf([hero, future], "homepage.sections")).toEqual({
      image: [{ path: "homepage.sections.0.settings.image", id: "m1" }],
      collection: [],
      product: [{ path: "homepage.sections.0.settings.buttonLink.id", id: "p1" }],
      page: [],
    });
  });

  it("sectionHeading: the heading in the locale, else the other, else null; the bar uses its text", () => {
    const rich = newSection("rich_text", ID);
    expect(
      sectionHeading({ ...rich, settings: { ...rich.settings, heading: { en: "About" } } }, "ar"),
    ).toBe("About");
    expect(
      sectionHeading({ ...rich, settings: { ...rich.settings, heading: {} } }, "ar"),
    ).toBeNull();
    expect(sectionHeading(newSection("announcement_bar", ID), "en")).toBe(
      "Free shipping on orders over EGP 500",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/sections.test.ts`
Expected: FAIL with `Cannot find module './sections'`.

- [ ] **Step 3: Implement `sections.ts` and `public-sections.ts`**

Each definition's `fields` follow the settings interfaces above, in that order, with the spec's limits:

- `announcement_bar.text` 120;
- `hero`: heading 80, subheading 200, buttonLabel 30, overlay `{0, 80, 10}`, `mobileImage` an `image`;
- `featured_collection`: productCount `{2, 12, 1}`, columns `{2, 4, 1}`;
- `featured_products`: products `max 12`, count `{2, 12, 1}`;
- `collection_list`: items `{min 0, max 8, fields: collection, image}`;
- `image_with_text.body` `richText 2000`;
- `rich_text.body` `richText RICH_TEXT_MAX.section`;
- `testimonials.items` `{1, 8}`: quote 400, author `text 60`, rating `{0, 5, 1}`;
- `features.items` `{1, 6}`: icon `select FEATURE_ICONS`, title 40, text 140;
- `whatsapp_cta`: text 300, buttonLabel 30, message 300, phone `phone`.

Every `heading` is 80 (Ruling 9).

`validate` is `validateFields(fields, raw, path, issues)`, cast to the settings type. `validateSection` works in this order:

1. The envelope `{ id, type, hidden, settings }` must be strict: `UNKNOWN_KEY` and `MISSING` at the section path.
2. The id must match `SECTION_ID_PATTERN`.
3. `hidden` must be a boolean.
4. For a known type:
   - a placement other than the definition's is `SECTION_NOT_ALLOWED_HERE` on `<path>.type`;
   - otherwise `settings` is checked by `definition.validate(…, <path>.settings, …)`.
5. For an unknown type: placement `header` is `SECTION_NOT_ALLOWED_HERE`; `type` must match `UNSUPPORTED_TYPE_PATTERN`; `settings` must be a plain object, kept as given.

`readSection` uses the same envelope rules without reporting, `readFields(fields, raw.settings, definition.defaults())` for known types, and `null` for anything it cannot read.

The defaults are fixed copy (MSA for `ar`, Ruling 9):

| Type                  | Defaults                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `announcement_bar`    | text `{ ar: "شحن مجاني للطلبات فوق 500 جنيه", en: "Free shipping on orders over EGP 500" }`, link `null`, style `accent`                                                                                                                                                                                                                                                                                                            |
| `hero`                | images `null`; heading `{ ar: "أهلًا بك في متجرنا", en: "Welcome to our store" }`; subheading `{ ar: "اكتشف أحدث منتجاتنا", en: "Discover our latest products" }`; buttonLabel `{ ar: "تسوّق الآن", en: "Shop now" }`; buttonLink `{ type: "search" }`; `medium`, `center`, overlay `30`                                                                                                                                            |
| `featured_collection` | collection `null`; heading `{ ar: "مجموعة مميزة", en: "Featured collection" }`; productCount `8`; columns `4`; showViewAll `true`                                                                                                                                                                                                                                                                                                   |
| `featured_products`   | `newest`, products `[]`, count `8`, heading `{ ar: "المنتجات", en: "Products" }`, columns `4`                                                                                                                                                                                                                                                                                                                                       |
| `collection_list`     | `all`, items `[]`, heading `{ ar: "المجموعات", en: "Collections" }`, columns `3`                                                                                                                                                                                                                                                                                                                                                    |
| `image_with_text`     | image `null`; heading `{ ar: "صورة مع نص", en: "Image with text" }`; body `{ ar: "عرّف عملاءك بمتجرك وما يميّز منتجاتك.", en: "Tell customers about your store and what makes your products special." }`; buttonLabel `{}`, buttonLink `null`; `start`                                                                                                                                                                              |
| `rich_text`           | heading `{ ar: "عن متجرنا", en: "About our store" }`; body `{ ar: "اكتب هنا قصة متجرك.", en: "Share your store's story here." }`; buttonLabel `{}`, buttonLink `null`; `center`                                                                                                                                                                                                                                                     |
| `testimonials`        | heading `{ ar: "آراء العملاء", en: "What our customers say" }`; items `[{ quote: { ar: "منتجات رائعة وتوصيل سريع.", en: "Great products and fast delivery." }, author: "", rating: 5 }]`                                                                                                                                                                                                                                            |
| `features`            | heading `{}`; items: `cod` (`{ ar: "الدفع عند الاستلام", en: "Cash on delivery" }`, `{ ar: "ادفع نقدًا عند استلام طلبك.", en: "Pay in cash when your order arrives." }`), `shipping` (`{ ar: "شحن سريع", en: "Fast shipping" }`, `{ ar: "توصيل إلى جميع المحافظات.", en: "Delivery across the country." }`), `returns` (`{ ar: "إرجاع سهل", en: "Easy returns" }`, `{ ar: "إرجاع خلال 14 يومًا.", en: "Returns within 14 days." }`) |
| `whatsapp_cta`        | heading `{ ar: "تواصل معنا عبر واتساب", en: "Chat with us on WhatsApp" }`; text `{ ar: "نرد على أسئلتك بسرعة.", en: "We answer your questions quickly." }`; buttonLabel `{ ar: "راسلنا على واتساب", en: "Message us on WhatsApp" }`; phone `""`; message `{ ar: "مرحبًا، لدي سؤال عن منتج.", en: "Hello, I have a question about a product." }`                                                                                     |

- `DEFAULT_HOMEPAGE_SECTIONS` is `featured_products` defaults with `columns: 2`, then `collection_list` defaults with `columns: 2`, with the two fixed ids.
- `sectionHeading` reads `settings.heading`, or `settings.text` for `announcement_bar`, through `pickText`. It is null for an unsupported section.
- Icons: `announcement_bar` `megaphone`, `hero` `image`, `featured_collection` `star`, `featured_products` `grid`, `collection_list` `folders`, `image_with_text` `image-text`, `rich_text` `text`, `testimonials` `quote`, `features` `badge-check`, `whatsapp_cta` `message-circle`.

- [ ] **Step 4: Run the package suite**

Run: `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/storefront-content lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-content/src/sections.ts packages/storefront-content/src/sections.test.ts \
  packages/storefront-content/src/public-sections.ts packages/storefront-content/src/index.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): add the homepage section library

Ten typed section definitions with defaults, placement and per-page limits, unknown-type
preservation, the default homepage as sections, and the public section types.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `@platform/storefront-content` — theme document schema version 2

Model tier: **strong** (every stored document passes through this reader; Review Focus 1).

**Files:**

- Modify: `packages/storefront-content/src/theme-document.ts`, `theme-document.test.ts`, `theme-document.hardening.test.ts`
- Modify: `apps/admin-web/src/lib/api/online-store.test.ts` (the `schemaVersion` assertion becomes `2`)

**Interfaces:**

- Consumes: Task 2's `Section`, `AnnouncementSection`, `validateSection`, `readSection`, `DEFAULT_HOMEPAGE_SECTIONS`, `HOMEPAGE_SECTIONS_MAX`, `sectionDefinition`, `sectionRefsOf`, `isKnownSection`; Task 1's `SectionRefs`, `emptySectionRefs`.
- Produces:
  - `THEME_SCHEMA_VERSION = 2`;
  - `ThemeDocument.schemaVersion: 2`;
  - `ThemeDocument.header: { sticky: boolean; menuHandle: string; announcement: AnnouncementSection | null }`;
  - `ThemeDocument.homepage: { sections: readonly Section[] }`;
  - `DEFAULT_THEME_DOCUMENT`: `schemaVersion: 2`, `header.announcement: null`, `homepage.sections: DEFAULT_HOMEPAGE_SECTIONS`;
  - `documentRefsOf(doc: ThemeDocument): SectionRefs`: `brand.logo.imageRef`, `brand.favicon.imageRef`, `header.announcement.settings.link.id` when it names a page, collection or product, and `sectionRefsOf(doc.homepage.sections, "homepage.sections")`;
  - `imageRefsOf(doc)`: the distinct ids of `documentRefsOf(doc).image`. The signature is unchanged, so Part 1's callers now include section images.
  - New issue codes:
    - `TOO_MANY_SECTIONS` at `homepage.sections`;
    - `TOO_MANY_OF_TYPE` at `homepage.sections.<i>.type`, on each section past its `maxPerPage`;
    - `SECTION_NOT_ALLOWED_HERE`;
    - `DUPLICATE_SECTION_ID` at `<section path>.id`, counted across the announcement and the sections.

    Plus every code from Tasks 1 and 2.

- [ ] **Step 1: Write the failing tests**: add to `theme-document.test.ts`

```ts
import { DEFAULT_HOMEPAGE_SECTIONS, newSection } from "./sections";

const v1Doc = () => ({ ...structuredClone(DEFAULT_THEME_DOCUMENT_PART1_FIXTURE) }); // a literal Part 1 document: schemaVersion 1, no announcement, sections []
const id = (n: number) => `6f1b2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}`;
const v2 = (sections: unknown[], announcement: unknown = null) => ({
  ...structuredClone(DEFAULT_THEME_DOCUMENT),
  header: { ...DEFAULT_THEME_DOCUMENT.header, announcement },
  homepage: { sections },
});

describe("schema version 2 (Ruling 2)", () => {
  it("a version-1 document reads as the default homepage and canonicalises like it (Review Focus 1)", () => {
    const read = readThemeDocument(v1Doc());
    expect(read.schemaVersion).toBe(2);
    expect(read.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
    expect(read.header.announcement).toBeNull();
    expect(canonicalDocumentJson(v1Doc())).toBe(canonicalDocumentJson(DEFAULT_THEME_DOCUMENT));
  });

  it("a version-1 write with [] is upcast; with sections it is still SECTIONS_NOT_SUPPORTED", () => {
    const ok = validateThemeDocument(v1Doc());
    expect(ok.ok && ok.value.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
    const bad = validateThemeDocument({
      ...v1Doc(),
      homepage: { sections: [newSection("hero", id(1))] },
    });
    expect(bad).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections", code: "SECTIONS_NOT_SUPPORTED" }],
    });
  });

  it("version 2 stores sections literally: an empty homepage stays empty", () => {
    const out = validateThemeDocument(v2([]));
    expect(out.ok && out.value.homepage.sections).toEqual([]);
    expect(readThemeDocument(v2([])).homepage.sections).toEqual([]);
  });

  it("a newer version reads as 2 with unknown sections kept; the write path refuses it", () => {
    const future = { id: id(9), type: "countdown_timer", hidden: false, settings: { endsAt: "x" } };
    expect(readThemeDocument({ ...v2([future]), schemaVersion: 3 }).homepage.sections).toEqual([
      future,
    ]);
    expect(validateThemeDocument({ ...v2([]), schemaVersion: 3 })).toMatchObject({
      ok: false,
      issues: [{ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION" }],
    });
  });

  it("issue paths are dotted, down to the locale (Ruling 4)", () => {
    const hero = newSection("hero", id(1));
    const doc = v2([
      newSection("rich_text", id(2)),
      { ...hero, settings: { ...hero.settings, heading: { ar: "x".repeat(81) } } },
    ]);
    expect(validateThemeDocument(doc)).toEqual({
      ok: false,
      issues: [{ path: "homepage.sections.1.settings.heading.ar", code: "TOO_LONG" }],
    });
  });

  it("at most 25 sections, 3 heroes, 2 WhatsApp buttons; ids unique across the header and the page", () => {
    const many = Array.from({ length: 26 }, (_, i) => newSection("rich_text", id(i + 1)));
    expect(validateThemeDocument(v2(many))).toMatchObject({
      ok: false,
      issues: [{ path: "homepage.sections", code: "TOO_MANY_SECTIONS" }],
    });
    const heroes = Array.from({ length: 4 }, (_, i) => newSection("hero", id(i + 1)));
    expect(validateThemeDocument(v2(heroes))).toMatchObject({
      ok: false,
      issues: [{ path: "homepage.sections.3.type", code: "TOO_MANY_OF_TYPE" }],
    });
    const bar = newSection("announcement_bar", id(1));
    expect(validateThemeDocument(v2([newSection("rich_text", id(1))], bar))).toMatchObject({
      ok: false,
      issues: [{ path: "homepage.sections.0.id", code: "DUPLICATE_SECTION_ID" }],
    });
  });

  it("the announcement slot takes an announcement bar or null; absent is null", () => {
    const bar = newSection("announcement_bar", id(1));
    const ok = validateThemeDocument(v2([], bar));
    expect(ok.ok && ok.value.header.announcement).toEqual(bar);
    const { announcement: _a, ...headerWithout } = v2([]).header;
    const absent = validateThemeDocument({ ...v2([]), header: headerWithout });
    expect(absent.ok && absent.value.header.announcement).toBeNull();
    expect(validateThemeDocument(v2([], newSection("hero", id(2))))).toMatchObject({
      ok: false,
      issues: [{ path: "header.announcement.type", code: "SECTION_NOT_ALLOWED_HERE" }],
    });
  });

  it("a corrupt stored section is skipped on read; a duplicate id keeps the first", () => {
    const good = newSection("rich_text", id(1));
    const read = readThemeDocument(v2([good, { id: "bad" }, { ...newSection("features", id(1)) }]));
    expect(read.homepage.sections).toEqual([good]);
  });

  it("the 256 KB cap still holds with sections", () => {
    const big = newSection("rich_text", id(1));
    const doc = v2(
      Array.from({ length: 25 }, (_, i) => ({
        ...big,
        id: id(i + 1),
        settings: { ...big.settings, body: { ar: "س".repeat(5000), en: "x".repeat(5000) } },
      })),
    );
    expect(validateThemeDocument(doc)).toEqual({
      ok: false,
      issues: [{ path: "", code: "DOCUMENT_TOO_LARGE" }],
    });
  });

  it("documentRefsOf names brand images, the bar's link target and every section ref, with paths", () => {
    const bar = {
      ...newSection("announcement_bar", id(1)),
      settings: {
        ...newSection("announcement_bar", id(1)).settings,
        link: { type: "page", id: "pg1" },
      },
    };
    const refs = documentRefsOf(
      readThemeDocument({
        ...v2([], bar),
        brand: { ...DEFAULT_THEME_DOCUMENT.brand, logo: { imageRef: "logo1", widthPx: 140 } },
      }),
    );
    expect(refs.image).toEqual([{ path: "brand.logo.imageRef", id: "logo1" }]);
    expect(refs.page).toEqual([{ path: "header.announcement.settings.link.id", id: "pg1" }]);
  });
});
```

Define `DEFAULT_THEME_DOCUMENT_PART1_FIXTURE` in the test file as a literal: today's default brand, `header: { sticky: false }`, `footer: { note: {}, showSocial: true }`, `homepage: { sections: [] }`, `schemaVersion: 1`. Update the existing cases that expect `schemaVersion: 1` or `SECTIONS_NOT_SUPPORTED` for version 2. The hardening suite keeps its cases: an unknown top-level key, a non-object `homepage`, a `__proto__` section key.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/storefront-content exec vitest run src/theme-document.test.ts src/theme-document.hardening.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`validateThemeDocument` (write path):

1. Byte cap, as today.
2. `schemaVersion` absent or `1` means version 1. `2` means version 2. Anything else is `UNSUPPORTED_SCHEMA_VERSION`.
3. `header` keys gain `announcement`, optional.
4. **Version 1:** `announcement` must be absent, otherwise `UNKNOWN_KEY` at `header.announcement`. `sections` must be `[]`, as today. The output uses `DEFAULT_HOMEPAGE_SECTIONS`.
5. **Version 2:**
   - `sections` must be an array; more than `HOMEPAGE_SECTIONS_MAX` is `TOO_MANY_SECTIONS`, reported without validating the entries;
   - each entry is checked with `validateSection(…, "homepage.sections.<i>", issues, "homepage")`;
   - then per-type counts are taken against `maxPerPage`, in document order;
   - then ids are compared case-insensitively across `header.announcement` (when not null) and the sections.
6. **Issue order:** issues sort by top-level key, as today. `header` comes before `homepage`, and inside `homepage` they stay in index order.

`readThemeDocument` (read path):

- A numeric `schemaVersion >= 2` reads its sections with `readSection(…, "homepage")`: nulls are skipped, the first 25 kept, and a repeated id keeps its first section. Any other version gives `DEFAULT_HOMEPAGE_SECTIONS`.
- `header.announcement` is `readSection(raw, "header")` narrowed to an announcement bar, else `null`.
- The output `schemaVersion` is always `2`.

- [ ] **Step 4: Run the suites that read documents**

Run: `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/storefront-content typecheck && pnpm --filter @platform/online-store test && pnpm --filter admin-web exec vitest run src/lib/api/online-store.test.ts src/components/online-store`
Expected: PASS. Part 1/2 suites build documents from `DEFAULT_THEME_DOCUMENT`, so they now carry version 2 and the default sections. Fix only assertions that spelled out `schemaVersion: 1` or `sections: []`.

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-content/src/theme-document.ts packages/storefront-content/src/theme-document.test.ts \
  packages/storefront-content/src/theme-document.hardening.test.ts apps/admin-web/src/lib/api/online-store.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront-content): type homepage sections in theme document v2

Version-1 documents read as the default homepage, version 2 stores sections and the header's
announcement bar, with section limits, placement, unique ids and every reference's path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Catalog newest products, and `GET /public/products?ids=` / `?sort=newest`

Model tier: **standard**.

**Files:**

- Modify: `services/catalog/src/domain/product-repository.ts` (`NewestProductsReader`)
- Create: `services/catalog/src/application/list-newest-products.use-case.ts`, `list-newest-products.use-case.test.ts`
- Modify: `services/catalog/src/infrastructure/in-memory-product-repository.ts`, `prisma-catalog-repositories.ts` (`listNewestListed`); the existing DB-gated integration suite gains one case (stays gated)
- Modify: `services/catalog/src/interfaces/product.controller.ts` (`listNewest`), `services/catalog/src/composition.ts`, `services/catalog/src/index.ts`
- Modify: `apps/admin/src/http/public-catalog-routes.ts`, `public-catalog-routes.test.ts`

**Interfaces:**

- Consumes: `ProductBatchReader.findByIds`, `listedProductsOnly`, `mapProductPage`, `LIST_MEDIA`, `toProductDto` (all already in the route file).
- Produces:
  - `interface NewestProductsReader { listNewestListed(limit: number, tenantId: string, tx?: unknown): Promise<readonly Product[]> }`: listed (`publishState = "published"`), not deleted, ordered by `id` descending, `limit` clamped to 1–50.
  - `class ListNewestProducts implements UseCase<{ readonly limit: number; readonly tenantId: string }, readonly Product[], DomainError>`.
  - `ProductController.listNewest(input: { readonly limit: number; readonly tenantId: string }): Promise<ControllerResponse>` (200, body `readonly Product[]`).
  - `public-catalog-routes.ts`: `export const PUBLIC_PRODUCT_IDS_MAX = 50`, `export const NEWEST_PRODUCTS_MAX = 50`, `export function parseProductIds(raw: string): readonly string[] | null`. The last one gives the distinct ids in order, or null when there are none, more than 50, or a malformed one.

- [ ] **Step 1: Write the failing tests**

`list-newest-products.use-case.test.ts`, over the in-memory repository with five products created in id order (published, draft, published, unlisted, published, and one deleted published):

- `limit 2` gives the two highest-id published products, newest first;
- drafts, unlisted, deleted and other tenants' products never appear;
- `limit 0` and `limit 500` are clamped to 1 and 50.

`public-catalog-routes.test.ts` (existing harness):

```ts
describe("GET /public/products — ids and newest (spec 3.4, Rulings 11–12)", () => {
  it("?ids= returns listed products only, in request order, as one page", async () => {
    // seed p1 (published), p2 (draft), p3 (published), p4 (deleted)
    const res = await get("/api/v1/public/products?ids=p3,p2,p1,p3,p4,missing");
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual(["p3", "p1"]);
    expect(res.body.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
  it("more than 50 ids, a malformed id, or ids with query/after/first/sort is 400", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`).join(",");
    for (const q of [
      `ids=${many}`,
      "ids=a%20b",
      "ids=p1&query=x",
      "ids=p1&after=c",
      "ids=p1&first=3",
      "ids=p1&sort=newest",
      "ids=,,",
    ]) {
      expect((await get(`/api/v1/public/products?${q}`)).status, q).toBe(400);
    }
  });
  it("?sort=newest gives the newest listed products, first defaulting to 8 and capped at 50", async () => {
    const res = await get("/api/v1/public/products?sort=newest&first=2");
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual(["p3", "p1"]);
    expect((await get("/api/v1/public/products?sort=newest&first=51")).status).toBe(400);
    expect((await get("/api/v1/public/products?sort=newest&query=x")).status).toBe(400);
  });
  it("the projection is the list's (no storage key, no cost, no tenant)", async () => {
    // same SECURITY assertions as the existing list case, on an ?ids= answer
  });
  it("parseProductIds", () => {
    expect(parseProductIds(" a, b ,a,,c")).toEqual(["a", "b", "c"]);
    expect(parseProductIds("")).toBeNull();
    expect(parseProductIds("a/b")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/catalog exec vitest run src/application/list-newest-products.use-case.test.ts && pnpm --filter @platform/admin exec vitest run src/http/public-catalog-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Prisma `listNewestListed`:** `readScoped(prisma, tenantId, tx, (c) => c.product.findMany({ where: { tenantId, deletedAt: null, publishState: "published" }, include: { variants: true }, orderBy: { id: "desc" }, take: clamped }))`, mapped like `paginate`.
- **In-memory:** the same filter, sorted by id descending.
- **Composition:** `products` already has the reader's type (add `& NewestProductsReader` to the deps type), and is wired as `listNewestProducts: new ListNewestProducts({ products })`.
- **Route:**
  - `publicProductsQuery` gains `ids: z.string().optional()` and `sort: z.enum(["newest"]).optional()`.
  - A `superRefine` enforces Ruling 12's exclusivity, `parseProductIds` and `first ≤ NEWEST_PRODUCTS_MAX` when `sort` is set.
  - `ids` → `admin.publicReads.products.getByIds({ ids, tenantId })` → filter `isListed && !deleted` → order by the request → `mapProductPage(admin, tenantId, { status: 200, body: { items, pageInfo: { hasNextPage: false, endCursor: null } } }, { perProduct: LIST_MEDIA, variants: true }, toProductDto)`.
  - `sort=newest` → `listNewest({ limit: first ?? 8, tenantId })`, then the same `listedProductsOnly` and mapping.
  - The plain list is unchanged.

- [ ] **Step 4: Run, typecheck, lint, tenant guard**

Run: `pnpm --filter @platform/catalog test && pnpm --filter @platform/catalog typecheck && pnpm --filter @platform/admin exec vitest run src/http/public-catalog-routes.test.ts && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS, and the guard prints only the one known finding.

- [ ] **Step 5: Commit**

```bash
git add services/catalog/src apps/admin/src/http/public-catalog-routes.ts apps/admin/src/http/public-catalog-routes.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(catalog): add newest products and public product reads by ids

GET /public/products gains ?ids= (at most 50, listed only, request order) for manual product
grids and ?sort=newest for the default homepage's newest products.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: `services/online-store` — sections in the draft save and the theme read

Model tier: **strong** (validation before the first write; Review Focus 1 and 2).

**Files:**

- Modify: `services/online-store/src/domain/errors.ts`, `errors.test.ts`
- Modify: `services/online-store/src/application/ports.ts` (`LinkTarget.slug?`), `theme.use-cases.ts`, `theme.use-cases.test.ts`
- Modify: `services/online-store/src/testing/fakes.ts` (`fakeLinkTargets` returns `slug` for products and collections)
- Modify: `apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.ts`, `online-store-link-targets.adapter.test.ts` (fills `slug`)
- Modify: `services/online-store/src/index.ts` (exports `ThemeTargetsView`)

**Interfaces:**

- Consumes:
  - Task 3's `documentRefsOf`, `imageRefsOf`;
  - Task 1's `SectionRefs`;
  - `LinkTargetsPort.resolve`, `ImageRefsPort.existingIds` / `resolve`;
  - `CatalogLinkType`.
- Produces:
  - `LinkTarget` gains `readonly slug?: string`: the raw (unencoded) catalog slug for collections and products, absent for pages.
  - `referencesNotFound(issues: readonly ContentIssue[]): ValidationError`, with message `"<first code>: The highlighted item no longer exists in this store."` and fields `{ field: path, message: code }`.
  - `type ThemeTargetsView = Readonly<Record<CatalogLinkType, Readonly<Record<string, { readonly title: string; readonly live: boolean }>>>>`.
  - `ThemeStateView` gains `targets: ThemeTargetsView | null`.
  - `SaveThemeDraft.execute` keeps its signature and result. It now checks only new references (Ruling 6).

- [ ] **Step 1: Write the failing tests**: add to `theme.use-cases.test.ts` (Part 1's `harness`)

```ts
describe("sections in the draft (spec 3.3, 3.4, Ruling 6)", () => {
  const withSections = (sections: unknown[]) => ({
    ...docOf(DEFAULT_THEME_DOCUMENT),
    homepage: { sections },
  });
  const fc = (collection: string | null) => ({
    ...newSection("featured_collection", ID1),
    settings: { ...newSection("featured_collection", ID1).settings, collection },
  });

  it("saves a section that names the shop's own collection and image", async () => {
    const h = harness({
      images: { t1: ["m1"] },
      targets: { collection: { c1: live("Sale", "sale") } },
    });
    const hero = {
      ...newSection("hero", ID2),
      settings: { ...newSection("hero", ID2).settings, image: "m1" },
    };
    const res = await h.save(withSections([fc("c1"), hero]), 0);
    expect(res.ok).toBe(true);
  });

  it("a new foreign collection is TARGET_NOT_FOUND at its path, nothing written", async () => {
    const h = harness({ targets: { collection: {} } });
    const res = await h.save(withSections([fc("other-shop")]), 0);
    expect(res).toMatchObject({
      ok: false,
      error: {
        code: "TARGET_NOT_FOUND",
        fields: [{ field: "homepage.sections.0.settings.collection", message: "TARGET_NOT_FOUND" }],
      },
    });
    expect(h.writes()).toBe(0);
  });

  it("a new foreign image in an item is IMAGE_NOT_FOUND at the item's path", async () => {
    const list = {
      ...newSection("collection_list", ID1),
      settings: {
        ...newSection("collection_list", ID1).settings,
        source: "manual",
        items: [{ collection: null, image: "theirs" }],
      },
    };
    const res = await harness({ images: { t1: [] } }).save(withSections([list]), 0);
    expect(res).toMatchObject({
      ok: false,
      error: {
        fields: [
          { field: "homepage.sections.0.settings.items.0.image", message: "IMAGE_NOT_FOUND" },
        ],
      },
    });
  });

  it("a reference already in the draft is not re-checked (a deleted collection still saves)", async () => {
    const h = harness({ targets: { collection: { c1: live("Sale", "sale") } } });
    await h.save(withSections([fc("c1")]), 0);
    h.deleteTarget("collection", "c1");
    const res = await h.save(
      { ...withSections([fc("c1")]), brand: { ...DEFAULT_THEME_DOCUMENT.brand, corners: "pill" } },
      1,
    );
    expect(res.ok).toBe(true);
    expect(h.resolveCalls()).toHaveLength(1); // only the first save resolved; nothing new, so no call
  });

  it("a stale version is VERSION_CONFLICT before any reference read", async () => {
    const h = harness({ targets: { collection: {} } });
    expect(await h.save(withSections([fc("x")]), 7)).toMatchObject({
      ok: false,
      error: { code: "VERSION_CONFLICT" },
    });
    expect(h.resolveCalls()).toEqual([]);
  });

  it("a failed reference read throws (500, retried), never a 422, nothing written", async () => {
    const h = harness({ targetsFail: true });
    await expect(h.save(withSections([fc("c1")]), 0)).rejects.toThrow();
    expect(h.writes()).toBe(0);
  });

  it("a Part 1 draft equal to live has no unpublished changes after the upgrade (Review Focus 1)", async () => {
    const h = harness();
    h.seedThemeRow({ draft: PART1_V1_DOC, published: PART1_V1_DOC, version: 3 });
    const state = await h.getTheme();
    expect(state.ok && state.value.hasUnpublishedChanges).toBe(false);
    expect(state.ok && state.value.draft.homepage.sections).toEqual(DEFAULT_HOMEPAGE_SECTIONS);
  });

  it("the theme read resolves section images and the draft's targets in one call each", async () => {
    // a draft with a hero (m1), a featured collection (c1 live) and a product grid (p-gone)
    // → images has m1; targets.collection.c1 = { title: "Sale", live: true }; targets.product has no "p-gone"
  });

  it("a failed targets read gives targets: null, never a broken flag", async () => {
    // linkTargets.resolve rejects → state.ok, state.value.targets === null
  });
});
```

The `harness` gains:

- `targets`, a seeded `LinkTargetMap`;
- `targetsFail`;
- `deleteTarget`, `resolveCalls` and `seedThemeRow`, built on the in-memory repositories;
- `live(title, slug)`, a test helper: `{ href: "/collections/" + slug, title, published: true, slug }`.

`errors.test.ts` adds: `referencesNotFound` puts the first code first and keeps every field.

Adapter test adds: collection and product targets carry the raw slug, for example `"عروض"` unencoded while `href` stays encoded. Page targets carry no slug.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/application/theme.use-cases.test.ts src/domain/errors.test.ts && pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context/online-store-link-targets.adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SaveThemeDraft.execute`, in this order. Every step before 5 writes nothing.

1. `validateThemeDocument`, then contrast, as today.
2. `const current = await deps.themes.get(tenantId)`. When `current.snapshot().version !== expectedVersion` → `err(versionConflict())`.
3. `known` = per kind, the ids in `documentRefsOf(current draft)` and `documentRefsOf(published ?? DEFAULT_THEME_DOCUMENT)`. `fresh` = `documentRefsOf(doc)` entries whose id is not in `known[kind]`.
4. Check the fresh references:
   - fresh images → `existingIds(distinct ids)`; every fresh entry whose id is missing → `{ path, code: "IMAGE_NOT_FOUND" }`;
   - fresh collection, product and page ids → one `linkTargets.resolve`, skipped when all three are empty; every entry whose id is absent (`Object.hasOwn`) → `TARGET_NOT_FOUND`.
   - Issues keep the order images, collections, products, pages, each in document order, capped at `MAX_ISSUES`. Any issue → `err(referencesNotFound(issues))`.
5. `inUnitOfWork`: re-read in `tx`, the version check again (the race), `saveDraft`, `save`. This is unchanged.

`GetTheme` adds `targets`:

- from `documentRefsOf(s.draft)`, one `resolve` (none when the draft names no target);
- each entry maps to `{ title, live: published }`;
- a throw → `targets: null`, logged with `logger.warn` (tenant id and the message only).

`images` already uses `imageRefsOf`, which now includes section images (Task 3).

- [ ] **Step 4: Run, typecheck**

Run: `pnpm --filter @platform/online-store test && pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/admin exec vitest run src/infrastructure/cross-context src/http/online-store-routes.test.ts`
Expected: PASS. Part 1's "foreign logo / favicon → IMAGE_NOT_FOUND" cases still hold: those are new references.

- [ ] **Step 5: Commit**

```bash
git add services/online-store/src/domain/errors.ts services/online-store/src/domain/errors.test.ts \
  services/online-store/src/application/ports.ts services/online-store/src/application/theme.use-cases.ts \
  services/online-store/src/application/theme.use-cases.test.ts services/online-store/src/testing/fakes.ts \
  services/online-store/src/index.ts \
  apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.ts \
  apps/admin/src/infrastructure/cross-context/online-store-link-targets.adapter.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): check section references on draft save

New image, collection, product and page references are checked for ownership before the
first write, with their paths; the theme read resolves section images and the draft's targets.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: The public home read, the shell's announcement bar, and their route

Model tier: **strong** (a public, anonymous surface; Ruling 13's drop rules).

**Files:**

- Modify: `services/online-store/src/application/menu-resolution.ts` (export `resolveLinkRef`)
- Create: `services/online-store/src/application/section-resolution.ts`, `section-resolution.test.ts`
- Create: `services/online-store/src/application/home.use-case.ts`, `home.use-case.test.ts`
- Modify: `services/online-store/src/application/shell.use-case.ts`, `shell.use-case.test.ts`
- Modify: `services/online-store/src/interfaces/online-store.controller.ts`, `src/composition.ts`, `composition.test.ts`, `src/index.ts`
- Modify: `apps/admin/src/http/public-online-store-routes.ts`, `public-online-store-routes.test.ts`, `apps/admin/src/tenant-mode-guard.test.ts`

**Interfaces:**

- Consumes:
  - Task 2's `Section`, `isKnownSection`, `PublicSection`, `PublicAnnouncement`, `PublicImage`, `PublicLink`, `PublicCollectionRef`;
  - Task 1's `isWhatsAppDigits`;
  - Task 3's `documentRefsOf`;
  - Task 5's `LinkTarget.slug`;
  - `loadTargets` / `emptyTargets`, `ResolvePreviewToken`, `pickText`.
- Produces:
  - `menu-resolution.ts`: `export function resolveLinkRef(link: LinkRef, targets: LinkTargetMap, setPolicies: ReadonlySet<PolicyType>): PublicLink | null`. It is the live, safe `{ href, external }`, else null; it is the existing `resolveLink`, narrowed.
  - `section-resolution.ts`:
    - `interface ResolutionContext { readonly images: Readonly<Record<string, ImageDto>>; readonly targets: LinkTargetMap; readonly setPolicies: ReadonlySet<PolicyType> }`;
    - `function resolutionInputsOf(sections: readonly Section[]): { readonly imageIds: readonly string[]; readonly targets: Readonly<Record<CatalogLinkType, readonly string[]>>; readonly needsPolicies: boolean }`;
    - `async function loadResolutionContext(deps: Pick<OnlineStoreDeps, "imageRefs" | "linkTargets" | "policies">, sections: readonly Section[], tenantId: string): Promise<ResolutionContext>`. Each read degrades on its own: a failed image read gives `{}`, a failed target read gives `emptyTargets()`, a failed policy list gives no set policies. Each failure is logged.
    - `function resolveSection(section: Section, ctx: ResolutionContext, mode: "live" | "preview"): PublicSection | null`;
    - `function resolveSections(sections: readonly Section[], ctx: ResolutionContext, mode: "live" | "preview"): PublicSection[]`.
  - `home.use-case.ts`:
    - `interface PublicHomeView { readonly mode: "live" | "preview"; readonly sections: readonly PublicSection[] }`;
    - `type HomeOutcome = { readonly kind: "ok"; readonly home: PublicHomeView } | { readonly kind: "preview_invalid" }`;
    - `class GetStorefrontHome { constructor(deps: OnlineStoreDeps, resolvePreview: ResolvePreviewToken); execute(input: { readonly tenantId: string; readonly previewToken?: string }): Promise<HomeOutcome> }`.
  - `PublicShellView.header` gains `announcement: PublicAnnouncement | null`.
  - `OnlineStoreController.home(input: { readonly previewToken?: string } & Tenant): Promise<ControllerResponse>`: 200 `PublicHomeView`, or 401 `PREVIEW_INVALID`.
  - `OnlineStorePublicReads.home: (tenantId: string, previewToken?: string) => Promise<ControllerResponse>`.
  - The route `GET /public/online-store/home`: `public: true`, `permission: "online_store:read"`, not idempotent, `uncached(...)`, and the same repeated-header rule as the shell.

- [ ] **Step 1: Write the failing tests**

`section-resolution.test.ts`:

```ts
describe("resolveSection (spec 3.4, Ruling 13)", () => {
  const ctx = (over: Partial<ResolutionContext> = {}): ResolutionContext => ({
    images: { m1: IMG }, targets: targets({ collection: { c1: t("Sale", "sale", true), c2: t("Old", "old", false) }, product: { p1: t("Mug", "mug", true) }, page: { pg1: { href: "/pages/about", title: "About", published: true } } }),
    setPolicies: new Set(["refund"]), ...over,
  });

  it("a featured collection carries { id, slug, name }; without a live collection it is dropped", () => {
    expect(resolveSection(fc("c1"), ctx(), "live")).toMatchObject({ settings: { collection: { id: "c1", slug: "sale", name: "Sale" } } });
    for (const id of [null, "c2", "gone"]) expect(resolveSection(fc(id), ctx(), "live")).toBeNull();
  });

  it("manual products keep the live ids in order; none left drops the section; newest always stays", () => {
    expect(resolveSection(products("manual", ["gone", "p1"]), ctx(), "live")).toMatchObject({ settings: { source: "manual", productIds: ["p1"] } });
    expect(resolveSection(products("manual", ["gone"]), ctx(), "live")).toBeNull();
    expect(resolveSection(products("newest", []), ctx(), "live")).toMatchObject({ settings: { source: "newest", count: 8 } });
  });

  it("a hero drops a broken image and a button without a link; empty of everything it is dropped", () => {
    const out = resolveSection(hero({ image: "gone", buttonLink: { type: "collection", id: "gone" } }), ctx(), "live");
    expect(out).toMatchObject({ settings: { image: null, button: null } });
    expect(resolveSection(hero({ image: null, heading: {}, subheading: {}, buttonLabel: {} }), ctx(), "live")).toBeNull();
  });

  it("links resolve to canonical safe hrefs: page, policy (only when set), url, home", () => {
    expect(resolveSection(bar({ type: "page", id: "pg1" }), ctx(), "live")).toMatchObject({ settings: { link: { href: "/pages/about", external: false } } });
    expect(resolveSection(bar({ type: "policy", policy: "privacy" }), ctx(), "live")).toMatchObject({ settings: { link: null } });
    expect(resolveSection(bar({ type: "url", url: "https://wa.me/20100" }), ctx(), "live")).toMatchObject({ settings: { link: { href: "https://wa.me/20100", external: true } } });
  });

  it("WhatsApp needs valid digits; testimonials and features keep only items with text", () => { … });

  it("hidden: omitted live, flagged in preview; unknown types are never served", () => {
    const h = { ...rich(), hidden: true };
    expect(resolveSection(h, ctx(), "live")).toBeNull();
    expect(resolveSection(h, ctx(), "preview")).toMatchObject({ hidden: true });
    expect(resolveSection(rich(), ctx(), "live")).not.toHaveProperty("hidden");
    expect(resolveSection(UNSUPPORTED, ctx(), "preview")).toBeNull();
  });

  it("the DTO holds no image ref, no tenant, no removed id (leak test)", () => {
    const json = JSON.stringify(resolveSections([fc("c1"), hero({ image: "m1" }), products("manual", ["p1", "gone"])], ctx(), "live"));
    expect(json).not.toMatch(/"m1"|gone|tenant|imageRef|storageKey/);
  });
});
```

`home.use-case.test.ts`:

- a shop with no theme row serves `DEFAULT_HOMEPAGE_SECTIONS` resolved: `[featured_products newest 8, collection_list all]`, live;
- a published document is served live, and the draft is served only with a valid preview token;
- an invalid token → `preview_invalid`;
- each of images, targets and policies failing degrades only what needs it, and the answer is still `ok`;
- one `resolve` call and one image call for the whole page.

`shell.use-case.test.ts`:

- the announcement is resolved and its link joins the menus' single targets call;
- a hidden bar is `null` live and `hidden: true` in preview;
- no bar → `null`.

`public-online-store-routes.test.ts`:

- the table has four rows now: `/public/online-store/home` is public and not idempotent;
- the live home is anonymous, `uncached`, and lists exactly `mode` and `sections`;
- preview with a valid token → draft, `hidden` flags; a bad token → 401 `PREVIEW_INVALID`; a repeated header → 401;
- the shell's `header` lists exactly `sticky`, `menu` and `announcement`.

`tenant-mode-guard.test.ts`: the composed graph still has only the `tenancy` exemption (rerun the existing case; no new expectation needed beyond it passing).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/online-store exec vitest run src/application && pnpm --filter @platform/admin exec vitest run src/http/public-online-store-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `resolveSection` applies Ruling 13 type by type. Images come from `ctx.images` (`Object.hasOwn`), and links from `resolveLinkRef`.
  - **Collections:** `{ id, slug: target.slug, name: target.title }`, only when the target is present, `published`, and has a non-empty `slug`.
  - **Product ids:** present, `published`, case-sensitive distinct, in order.
  - **Buttons:** `{ label, link }` only when `buttonLabel` has text in either locale and the link resolves.
  - **Text emptiness:** "No text" means `pickText(x, "ar") === null`.
  - **Copies only:** every output object is built field by field, never by spreading stored settings.
- `GetStorefrontHome`:
  1. Resolve the preview, exactly as the shell does.
  2. Pick the document: `preview ? draft : (published ?? DEFAULT_THEME_DOCUMENT)`.
  3. Take the sections: live keeps only visible ones before loading; preview keeps all.
  4. `loadResolutionContext`, then `resolveSections`.
- Shell:
  - add the announcement's link ids to the single `targetsOf` call, through `linkRefTargetsOf` on a one-item pseudo-menu, or by merging the id lists;
  - reuse `menus.setPolicies`;
  - resolve with `resolveSection(doc.header.announcement, …)` narrowed to `PublicAnnouncement`.
- Controller and composition follow `shell` / `publicReadsOf` exactly (`home: (tenantId, previewToken) => controller.home({ tenantId, ...(previewToken === undefined ? {} : { previewToken }) })`).
- The route mirrors the shell route.

- [ ] **Step 4: Run, typecheck, lint, guard**

Run: `pnpm --filter @platform/online-store test && pnpm --filter @platform/online-store typecheck && pnpm --filter @platform/admin test && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint && node scripts/dev/check-prisma-tenant-where.mjs`
Expected: PASS, and the guard prints the one known finding. The storefront `runtime-contract.test.ts` now fails, because the admin serves `/public/online-store/home` and the storefront does not call it yet. Task 7 closes this. Do not run it here.

- [ ] **Step 5: Commit**

```bash
git add services/online-store/src apps/admin/src/http/public-online-store-routes.ts \
  apps/admin/src/http/public-online-store-routes.test.ts apps/admin/src/tenant-mode-guard.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(online-store): serve the resolved homepage and the announcement bar

GET /public/online-store/home resolves visible sections (all, flagged, in preview) with
images, collections, live product ids and safe links, and drops broken ones; the shell
carries the announcement bar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Storefront — homepage reads, section data reads and the shell's announcement

Model tier: **strong** (caching across shops; Review Focus 4).

**Files:**

- Modify: `apps/storefront/src/lib/shell-tag.ts` (`catalogTag`)
- Create: `apps/storefront/src/lib/public-sections.ts`, `public-sections.test.ts`
- Create: `apps/storefront/src/lib/homepage.ts`, `homepage.test.ts`
- Create: `apps/storefront/src/lib/section-data.ts`, `section-data.test.ts`
- Modify: `apps/storefront/src/lib/online-store.ts`, `online-store.test.ts` (`header.announcement`; export `imageOf`)

**Interfaces:**

- Consumes:
  - Task 2's `PublicSection` types and `DEFAULT_HOMEPAGE_SECTIONS`;
  - Task 1's `isWhatsAppDigits`;
  - `SECTION_DEFINITIONS` (for limits);
  - `safeHref`, `textOf`, `clip`, `imageOf`, `fetchJson` (from `lib/content.ts`), `currentShopId`, `shellTag`;
  - `PublishedProduct`, `PublishedCollection`, `ProductSummary`, `CollectionSummary`.
- Produces:
  - `shell-tag.ts`: `catalogTag = (shopId: string): string => \`catalog:${shopId}\``.
  - `public-sections.ts`:
    - `readPublicSection(raw: unknown, mode: "live" | "preview"): PublicSection | null`;
    - `readPublicSections(raw: unknown, mode: "live" | "preview"): readonly PublicSection[]` (at most 25, unknown types skipped, duplicate ids skipped).
  - `homepage.ts`:
    - `interface StorefrontHome { readonly mode: "live" | "preview"; readonly sections: readonly PublicSection[] }`;
    - `DEFAULT_HOME: StorefrontHome` (frozen; the public form of `DEFAULT_HOMEPAGE_SECTIONS`);
    - `parseHome(raw: unknown, mode: "live" | "preview"): StorefrontHome | null`;
    - `getHomepage: (previewToken: string | null) => Promise<StorefrontHome>` (React `cache`).
  - `section-data.ts`:
    - `interface HomeCollection { readonly id: string; readonly slug: string; readonly name: string; readonly productCount: number | null; readonly image: PublicImage | null }`;
    - `type SectionData = { readonly kind: "products"; readonly products: readonly PublishedProduct[] } | { readonly kind: "collections"; readonly collections: readonly HomeCollection[] } | { readonly kind: "none" }`;
    - `readNewestProducts(shopId: string, count: number): Promise<readonly PublishedProduct[]>`;
    - `readProductsByIds(shopId: string, ids: readonly string[]): Promise<readonly PublishedProduct[]>`;
    - `readCollectionProducts(shopId: string, slug: string, count: number): Promise<readonly PublishedProduct[]>`;
    - `readPublishedCollections(shopId: string): Promise<readonly PublishedCollection[]>`.

    Each of these four is cached and **throws** on failure.
    - `loadSectionData(shopId: string, sections: readonly PublicSection[]): Promise<ReadonlyMap<string, SectionData | "error">>`. Each failure maps to `"error"` and is logged with `console.warn("storefront home: section data unavailable", { shopId, type })`.

  - `StorefrontShell.header` gains `announcement: PublicAnnouncement | null`. `FALLBACK_SHELL` has `null`.

- [ ] **Step 1: Write the failing tests**

`section-data.test.ts`. Mock `next/cache`'s `unstable_cache` to record `(keyParts, options)` and run the function. Mock `next/headers` to **throw**. Mock `fetch`.

```ts
describe("section data reads (spec 3.6, Ruling 15)", () => {
  it("two shops, two keys, both tags (Review Focus 4)", async () => {
    await readNewestProducts("shop-a", 8);
    await readNewestProducts("shop-b", 8);
    expect(cacheCalls.map((c) => c.keyParts)).toEqual([
      ["online-store", "shop-a", "section-data", "newest", "8"],
      ["online-store", "shop-b", "section-data", "newest", "8"],
    ]);
    expect(cacheCalls[0]!.options).toEqual({ tags: ["os:shop-a", "catalog:shop-a"], revalidate: 60 });
  });
  it("cached reads never read request headers (they take the shop explicitly)", async () => {
    await expect(readProductsByIds("shop-a", ["p1"])).resolves.toBeDefined(); // next/headers throws if touched
    expect(fetchCalls[0]!.headers["x-tenant-id"]).toBe("shop-a");
    expect(fetchCalls[0]!.url).toContain("/api/v1/public/products?ids=p1");
  });
  it("errors are never cached: a 500, a timeout or garbage throws inside the cached function", async () => { … });
  it("keeps published products only, in order, capped at the count", async () => { … });
  it("collection products: /public/collections/<encoded slug>/products?first=<count>", async () => { … });
  it("loadSectionData runs every section's read in parallel and marks a failure as error, logged without merchant text", async () => {
    // featured_products(newest) ok, featured_collection fails → map: { s1: products, s2: "error" }; console.warn called with { shopId, type: "featured_collection" }
  });
  it("collection_list manual joins the collections list for counts; an item missing from it keeps its name", async () => { … });
  it("text-only sections need no read (kind none) and no fetch happens for them", async () => { … });
});
```

`homepage.test.ts`:

- live → `unstable_cache` with key `["online-store", shop, "home"]` and both tags;
- preview sends `x-preview-token` with `cache: "no-store"` and no `unstable_cache`;
- a 401 in preview → the live home;
- **"a failed home read renders the default homepage and is not cached":** a 500 or garbage gives `DEFAULT_HOME`, and nothing is stored;
- a body labelled with the other mode is unusable;
- `DEFAULT_HOME` matches `DEFAULT_HOMEPAGE_SECTIONS` (ids, headings, `newest` 8 and `columns` 2, `all` and `columns` 2).

`public-sections.test.ts`: the defence in depth.

- A `javascript:` href or `//evil` link becomes `null`.
- An `http:` image becomes `null`.
- A hero `overlay: 85` falls back to `0`.
- `columns: 9` falls back to the type's default.
- An unknown `style` falls back to `accent`.
- `phone: "0100"` drops the WhatsApp section.
- `hidden` is kept only in preview.
- 26 sections are cut to 25.
- An unknown type is skipped.
- A bidi override in a heading is stripped (through `textOf`).
- Product ids not matching `^[A-Za-z0-9_-]{1,64}$` are dropped.

`online-store.test.ts` adds:

- the shell's announcement is read through `readPublicSection(…, mode)` and anything else becomes `null`;
- `FALLBACK_SHELL.header.announcement` is `null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/section-data.test.ts src/lib/homepage.test.ts src/lib/public-sections.test.ts src/lib/online-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`readPublicSection` re-validates every field with the package limits:

- each text through `textOf(value, max, multiline)`, multiline for rich-text bodies;
- links through `safeHref`, with `external` recomputed;
- images through `imageOf`;
- numbers and enums against the definition's descriptors (`sectionDefinition(type).fields`), falling back to the definition's defaults;
- collection refs `{ id, slug, name }`, where `id` and `slug` are non-empty strings ≤ 200 and the name is clipped to 200;
- WhatsApp digits through `isWhatsAppDigits`.

It returns null when Ruling 13's required content is missing after the re-check.

`parseHome` reads `mode` from the body (as `parseShell` does) and `readPublicSections(body.sections, mode)`.

`getHomepage`:

1. `shopId = await currentShopId()`.
2. **Live:** `unstable_cache(async () => { fetch; status !== 200 or parse null → throw; }, ["online-store", shopId, "home"], { tags: [shellTag(shopId), catalogTag(shopId)], revalidate: 60 })`, wrapped in try/catch → `DEFAULT_HOME`.
3. **Preview:** `fetch` with `cache: "no-store"` and `x-preview-token`. A 200 with a preview body → it. A 401 → live. Anything else → live.

Section reads use `fetchJson(shopId, path)` (3 s timeout, explicit shop) inside `unstable_cache` with Ruling 15's keys:

| Read                | Path                                                                     | Key tail                              |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| newest              | `/public/products?sort=newest&first=<count>`                             | `["newest", String(count)]`           |
| by ids              | `/public/products?ids=<ids joined by ",">` (at most 12 here)             | `["by-ids", ids.join(",")]`           |
| collection products | `/public/collections/${encodeURIComponent(slug)}/products?first=<count>` | `["collection", slug, String(count)]` |
| collections         | `/public/collections?first=100`                                          | `["collections"]`                     |

Each one filters `status === "published"` and slices to its count.

`loadSectionData` decides per type:

- `featured_products`: newest or by ids;
- `featured_collection`: collection products;
- `collection_list`: the collections list, either shown whole (`all`) or joined with the manual items (`productCount` from `productIds.length`, `null` when the item is missing from the list);
- every other type: `none`.

- [ ] **Step 4: Run, typecheck, lint, runtime contract**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint && (cd apps/storefront && pnpm exec vitest run src/lib/runtime-contract.test.ts)`
Expected: PASS. The contract now sees `/public/online-store/home` called.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/shell-tag.ts apps/storefront/src/lib/public-sections.ts \
  apps/storefront/src/lib/public-sections.test.ts apps/storefront/src/lib/homepage.ts \
  apps/storefront/src/lib/homepage.test.ts apps/storefront/src/lib/section-data.ts \
  apps/storefront/src/lib/section-data.test.ts apps/storefront/src/lib/online-store.ts \
  apps/storefront/src/lib/online-store.test.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): read the homepage sections and their catalog data

The home document and each section's products and collections are cached 60 s per shop
(tags os: and catalog:), re-validated on arrival, never cached on failure; a failed home read
falls back to the default homepage.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Storefront — the section renderer, the commerce sections, the new homepage and preview focus

Model tier: **standard**.

**Files:**

- Create: `apps/storefront/src/components/sections/sections.tsx`, `sections.test.tsx`
- Create: `apps/storefront/src/components/sections/section-frame.tsx`, `section-heading.tsx`, `section-button.tsx`, `section-styles.ts`
- Create: `apps/storefront/src/components/sections/featured-products.tsx`, `featured-collection.tsx`, `collection-list.tsx`, `commerce-sections.test.tsx`
- Create: `apps/storefront/src/lib/section-focus.ts`, `section-focus.test.ts`; `apps/storefront/src/components/sections/section-focus-listener.tsx`
- Modify: `apps/storefront/src/components/collection-card.tsx`, `collection-card.test.tsx` (optional `image` and nullable count)
- Modify: `apps/storefront/src/components/store-chrome.tsx`, `store-chrome.test.tsx` (mounts the listener)
- Modify: `apps/storefront/src/app/(store)/page.tsx`, `page.test.tsx`
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes:
  - Task 7's `getHomepage`, `loadSectionData`, `SectionData`, `HomeCollection`;
  - `ProductCard`, `CollectionCard`, `AvailabilityBook`, `priceOf`, `MenuLink`, `withPreview`, `getPreviewToken`, `getRequestShell`, `getRequestLocale`, `currentShopId`;
  - `storefrontSecrets().adminOrigin`;
  - `SECTION_ID_PATTERN`.
- Produces:
  - `section-styles.ts` (pure class lookups, Ruling 16):
    - `GRID_COLUMNS: Readonly<Record<2 | 3 | 4, string>>`, with `2: "grid-cols-1 sm:grid-cols-2"` (today's grid), `3: "grid-cols-2 md:grid-cols-3"`, `4: "grid-cols-2 md:grid-cols-4"`;
    - `columnsClass(n: number): string`, which falls back to `2`.
  - `<SectionFrame id hidden preview t>`: `<section data-section-id={id}>` in preview. A hidden section in preview renders the dashed placeholder (`t.sections.hiddenPlaceholder`) instead of its children. Live renders the children with no attribute.
  - `<SectionHeading text locale id>`: an `h2` through `pickText`, with `dir="auto"`. It renders nothing when empty.
  - `<SectionButton button locale previewToken variant>`: a `MenuLink`-equivalent, with the label in `<bdi dir="auto">`.
  - `<Sections sections data availability t locale previewToken mode eagerHeroId>`: maps type → component and skips a section whose data is `"error"`. Task 9 extends the map.
  - `section-focus.ts`:
    - `FOCUS_MESSAGE_TYPE = "morbeh:focus-section"`;
    - `focusTargetOf(event: { readonly origin: string; readonly source: unknown; readonly data: unknown }, adminOrigin: string, parent: unknown): string | null`.
  - `<SectionFocusListener adminOrigin>` (`"use client"`):
    - listens for `message`, and on a valid target `querySelector('[data-section-id="<id>"]')` (the id is uuid-checked, so no escaping is needed);
    - `scrollIntoView({ block: "center", behavior: prefersReducedMotion ? "auto" : "smooth" })`;
    - sets `data-section-focused="true"` on it and removes the attribute from the previous one;
    - removes the listener on unmount.
  - `CollectionCard` props gain `image?: PublicImage | null`, and `productCount` may be `null` (the count line is omitted).
  - Storefront dictionary `sections`: `hiddenPlaceholder`, `viewAll`.

- [ ] **Step 1: Write the failing tests**

`section-focus.test.ts`:

```ts
const ADMIN = "https://admin.morbeh.test";
const parent = {};
const ok = {
  origin: ADMIN,
  source: parent,
  data: { type: "morbeh:focus-section", id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
};
it("only the admin origin, from the parent, with a uuid (Review Focus 3)", () => {
  expect(focusTargetOf(ok, ADMIN, parent)).toBe(ok.data.id);
  expect(focusTargetOf({ ...ok, origin: "https://evil.example" }, ADMIN, parent)).toBeNull();
  expect(focusTargetOf({ ...ok, origin: "null" }, ADMIN, parent)).toBeNull();
  expect(focusTargetOf({ ...ok, source: {} }, ADMIN, parent)).toBeNull();
  expect(
    focusTargetOf(
      { ...ok, data: { type: "morbeh:focus-section", id: '"] , body [x="' } },
      ADMIN,
      parent,
    ),
  ).toBeNull();
  expect(
    focusTargetOf({ ...ok, data: { type: "other", id: ok.data.id } }, ADMIN, parent),
  ).toBeNull();
  expect(focusTargetOf({ ...ok, data: "morbeh:focus-section" }, ADMIN, parent)).toBeNull();
});
```

`store-chrome.test.tsx` adds "the listener is mounted only in preview with an admin origin":

- no token → no listener;
- token with `ADMIN_ORIGIN` unset → no listener;
- token with it set → `SectionFocusListener` receives exactly that origin.

`sections.test.tsx`:

- unknown or unhandled types render nothing;
- a section whose data is `"error"` is omitted while the others render ("one failing section does not break the page");
- in preview every section has `data-section-id`, and a hidden one shows "قسم مخفي" with no content;
- live shows no `data-section-id` and no placeholder;
- **one dispatch per type** (Task 8 types here, Task 9's in its own file): each type in `SECTION_TYPES` other than `announcement_bar` dispatches to its component, so no type is silently dropped.

`commerce-sections.test.tsx` (ar and en, RTL):

- featured products renders `ProductCard`s in the `columnsClass(columns)` grid, with the heading in `h2` `dir="auto"`;
- `newest` with no products shows `t.home.productsEmpty` (Ruling 14);
- manual with data renders in the order given;
- featured collection shows "View all" (`t.sections.viewAll`) linking `/collections/<slug>` only when `showViewAll`;
- in preview that link keeps `?preview=` (through `withPreview`);
- collection list `all` with none shows `t.home.collectionsEmpty`;
- manual items show their image when given and omit the count when `null`;
- a heading only in Arabic shows in English too, and both empty renders no `h2`.

`page.test.tsx`:

- **"the default homepage equals today's layout":** with `DEFAULT_HOME` and data `{ products: [p1, p2], collections: [c1] }`, the page has, in order, one `sr-only` `h1` with the store name in `<bdi dir="auto">`, an `h2` "المنتجات" over two product cards in `grid-cols-1 sm:grid-cols-2`, and an `h2` "المجموعات" over one collection card;
- no "Shop" card and no Categories heading (Ruling 3);
- a preview shell passes the token to `getHomepage`, and a live shell passes `null`;
- `AvailabilityBook.load()` is called once, outside any cache.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/lib/section-focus.test.ts src/components/sections src/components/store-chrome.test.tsx src/components/collection-card.test.tsx "src/app/(store)/page.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`page.tsx`:

1. `[locale, shell, token] = await Promise.all([...])`.
2. `previewToken = token !== null && shell.mode === "preview" ? token : null`.
3. `home = await getHomepage(previewToken)`.
4. `shopId = await currentShopId()`.
5. `[data, book] = await Promise.all([loadSectionData(shopId, home.sections), AvailabilityBook.load()])`.
6. Render `<main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8">`, the existing `h1`, then `<Sections …>`.

Pass `eagerHeroId` = the id of the first `hero` in `home.sections`. Preview mode is `home.mode`. Product cards keep today's props (`priceOf`, the availability from `book`).

`StoreChrome` renders `<SectionFocusListener adminOrigin={origin} />` when `previewToken !== null && origin !== null`, where `origin = storefrontSecrets().adminOrigin`. The focus outline is `[data-section-focused="true"]{outline:2px dashed var(--primary);outline-offset:4px}` in `globals.css`, a fixed rule with no merchant value.

Dictionary (MSA / en):

- `sections.hiddenPlaceholder` "قسم مخفي" / "Hidden section";
- `sections.viewAll` "عرض الكل" / "View all".

- [ ] **Step 4: Run, typecheck, lint, no-HTML grep**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint && grep -rn "dangerouslySetInnerHTML\|style={{" apps/storefront/src/components/sections`
Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/components/sections apps/storefront/src/lib/section-focus.ts \
  apps/storefront/src/lib/section-focus.test.ts apps/storefront/src/components/collection-card.tsx \
  apps/storefront/src/components/collection-card.test.tsx apps/storefront/src/components/store-chrome.tsx \
  apps/storefront/src/components/store-chrome.test.tsx "apps/storefront/src/app/(store)/page.tsx" \
  "apps/storefront/src/app/(store)/page.test.tsx" apps/storefront/src/app/globals.css \
  apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): render the homepage from sections

The hard-coded homepage becomes a section renderer with product and collection sections,
preview frames with hidden placeholders, and an origin-checked focus listener for the editor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Storefront — content sections and the site-wide announcement bar

Model tier: **standard**.

**Files:**

- Create: `apps/storefront/src/components/sections/hero.tsx`, `image-with-text.tsx`, `rich-text-section.tsx`, `testimonials.tsx`, `features.tsx`, `whatsapp-cta.tsx`, `announcement-bar.tsx`, `content-sections.test.tsx`
- Modify: `apps/storefront/src/components/sections/section-styles.ts`, `sections.tsx`, `sections.test.tsx`
- Modify: `apps/storefront/src/components/store-chrome.tsx`, `store-chrome.test.tsx`, `locked-frame.tsx` test only (`apps/storefront/src/app/(store)/layout.test.tsx`)
- Modify: `apps/storefront/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes:
  - Task 8's `SectionFrame`, `SectionHeading`, `SectionButton`, `Sections`;
  - `<RichText text>`;
  - Task 1's `whatsAppHref`;
  - Task 7's `StorefrontShell.header.announcement`;
  - `next/image`'s `getImageProps`.
- Produces:
  - `section-styles.ts` adds four lookups:
    - `OVERLAY_CLASSES: Readonly<Record<0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80, string>>`, with `after:opacity-0` … `after:opacity-80` on an `after:bg-foreground after:absolute after:inset-0` pseudo-element;
    - `HERO_HEIGHTS`: `small` `"h-60 md:h-80"`, `medium` `"h-80 md:h-[30rem]"`, `large` `"h-[28rem] md:h-[40rem]"`;
    - `ANNOUNCEMENT_STYLES`: `accent` `"bg-accent text-accent-foreground"`, `primary` `"bg-primary text-primary-foreground"`, `dark` `"bg-foreground text-background"`;
    - `ALIGN_CLASSES`: `start` `"items-start text-start"`, `center` `"items-center text-center"`.
  - `<HeroSection section locale previewToken eager t>`, `<ImageWithTextSection>`, `<RichTextSection>`, `<TestimonialsSection>`, `<FeaturesSection>`, `<WhatsAppCtaSection>`, `<AnnouncementBar section locale previewToken t preview>`.
  - `FEATURE_ICON_COMPONENTS: Readonly<Record<FeatureIcon, LucideIcon>>`: `cod` `BanknoteIcon`, `shipping` `TruckIcon`, `returns` `RotateCcwIcon`, `support` `HeadsetIcon`, `secure` `ShieldCheckIcon`, `quality` `BadgeCheckIcon`, `gift` `GiftIcon`. They are decorative (`aria-hidden`).
  - Storefront dictionary `sections` gains `rating` ("التقييم {rating} من 5" / "Rated {rating} out of 5"), `announcement` ("إعلان" / "Announcement") and `opensInNewTab` ("يفتح في نافذة جديدة" / "Opens in a new tab").

- [ ] **Step 1: Write the failing tests**: `content-sections.test.tsx` (both locales, `dir` checked)

```ts
describe("content sections (spec 3.6)", () => {
  it("hero: <picture> with the mobile image under 768 px; the first hero is eager and fetchpriority high, others lazy", () => {
    const { container } = render(<HeroSection section={hero({ mobileImage: MOBILE })} locale="ar" previewToken={null} eager t={ar} />);
    expect(container.querySelector('picture source[media="(max-width: 767px)"]')).toHaveAttribute("srcset", expect.stringContaining(MOBILE.url));
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).not.toHaveAttribute("loading", "lazy");
    render(<HeroSection section={hero()} locale="ar" previewToken={null} eager={false} t={ar} />);
    expect(screen.getAllByRole("img").at(-1)).toHaveAttribute("loading", "lazy");
  });

  it("hero: overlay, height and alignment are fixed classes, never a style attribute (Ruling 16)", () => {
    const { container } = render(<HeroSection section={hero({ overlay: 40, height: "large", contentAlign: "start" })} locale="en" previewToken={null} eager={false} t={en} />);
    expect(container.innerHTML).toContain("after:opacity-40");
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("hero without an image shows its text on the muted panel; texts are dir=auto", () => { … });

  it("image with text: image at the inline start or end; the body through <RichText>, never HTML", () => {
    const { container } = render(<ImageWithTextSection section={iwt({ body: { en: "<img src=x onerror=alert(1)> **bold**" } })} locale="en" previewToken={null} t={en} />);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("rich text: align start or center; a button only when it has a label and a link", () => { … });

  it("testimonials: quotes stack on mobile, rating 0 shows no stars, rating 4 says so to screen readers", () => {
    render(<TestimonialsSection section={testimonials([{ quote: { ar: "رائع" }, author: "نور", rating: 4 }, { quote: { en: "Nice" }, author: "", rating: 0 }])} locale="ar" t={ar} />);
    expect(screen.getByText("التقييم 4 من 5")).toHaveClass("sr-only");
    expect(screen.getAllByText(/التقييم/)).toHaveLength(1);
  });

  it("features: the fixed icon per key, titles and texts with dir=auto", () => { … });

  it("WhatsApp: wa.me with the message in the request locale, new tab, no opener, no referrer, no preview token", () => {
    render(<WhatsAppCtaSection section={wa({ phone: "201001234567", message: { ar: "مرحبًا", en: "Hello" } })} locale="en" t={en} />);
    const link = screen.getByRole("link", { name: /Message us on WhatsApp/ });
    expect(link).toHaveAttribute("href", "https://wa.me/201001234567?text=Hello");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("announcement bar: style class, a link through the safe link rules, isolated text", () => { … });

  it("an Arabic-only section viewed in English falls back; long Arabic words wrap at 320 px (break-words)", () => { … });
});
```

`store-chrome.test.tsx` adds:

- the announcement bar renders above the header row on every store page;
- in preview a hidden bar renders the placeholder inside `data-section-id`;
- with no announcement, nothing renders.

`layout.test.tsx` adds "a locked view never renders the announcement bar" (Ruling 25).

`sections.test.tsx` extends the dispatch case to every `SECTION_TYPES` entry except `announcement_bar`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter storefront exec vitest run src/components/sections src/components/store-chrome.test.tsx "src/app/(store)/layout.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Hero:**
  - a `relative` box with `HERO_HEIGHTS[height]`;
  - when there is an image, `<picture>`: `<source media="(max-width: 767px)" srcSet={getImageProps({ src: mobile.url, alt: "", width, height, unoptimized: true }).props.srcSet}>` when a mobile image exists, then `<img {...getImageProps({ src, alt: image.alt ?? "", width: image.width ?? 1600, height: image.height ?? 900, sizes: "100vw", unoptimized: true, ...(eager ? { priority: true } : { loading: "lazy" }) }).props} className="absolute inset-0 size-full object-cover" />`;
  - the overlay `after:` classes on the box;
  - the content block with `ALIGN_CLASSES` and logical padding;
  - the heading as `h2`, the subheading as `p`, each `dir="auto"` with `break-words`;
  - `SectionButton`.

  If `@next/next/no-img-element` fires on the `<img>` fed by `getImageProps`, disable it on that line with the reason `getImageProps art direction (spec 3.6)`.

- **Image with text:**
  - `md:grid-cols-2`, with the image first in DOM order;
  - `imagePosition: "end"` adds `md:order-last`, so it is logical and flips in RTL;
  - an `aspect-[4/3]` box with `next/image` `fill`, `unoptimized`, `loading="lazy"` and `sizes="(min-width: 768px) 50vw, 100vw"`;
  - the body through `<RichText text={pickText(body, locale) ?? ""}>`.
- **Testimonials:** `grid gap-4 md:grid-cols-2 lg:grid-cols-3`. Rating stars are `"★".repeat(rating)` with `aria-hidden`, plus an `sr-only` span with the `rating` copy. The author is in `<bdi dir="auto">`.
- **Features:** `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
- **WhatsApp:** `whatsAppHref(phone, pickText(message, locale))`. A null href renders nothing. The link carries `target="_blank" rel="noopener noreferrer nofollow"` and an `sr-only` `opensInNewTab`.
- **Announcement:**
  - `<div role="region" aria-label={t.sections.announcement}>` with `ANNOUNCEMENT_STYLES[style]`;
  - the text `<bdi dir="auto">`, wrapped in a safe link when the section has one (`MenuLink`'s rules);
  - inside `SectionFrame` in preview.
- **StoreChrome:** `{shell.header.announcement === null ? null : <AnnouncementBar …/>}`, rendered after the preview banner and before the header row, outside the sticky blurred wrapper. `LockedFrame` is unchanged.

Dictionary rows as in Interfaces.

- [ ] **Step 4: Run, typecheck, lint, greps**

Run: `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint && grep -rn "dangerouslySetInnerHTML\|style={{" apps/storefront/src/components/sections apps/storefront/src/components/store-chrome.tsx`
Expected: PASS, and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/components/sections apps/storefront/src/components/store-chrome.tsx \
  apps/storefront/src/components/store-chrome.test.tsx "apps/storefront/src/app/(store)/layout.test.tsx" \
  apps/storefront/src/messages/en.ts apps/storefront/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(storefront): add content sections and the announcement bar

Image banner with art-directed mobile image, image with text, rich text, testimonials, store
highlights and the WhatsApp button, plus a site-wide announcement bar; styling only from fixed
class maps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: admin-web — editor data: the library route, API clients, actions and pure section helpers

Model tier: **standard**.

**Files:**

- Modify: `apps/admin/src/http/media-library-routes.ts`, `media-library-routes.test.ts` (items gain `image`)
- Modify: `apps/admin-web/src/lib/api/media.ts`, `media.test.ts` (`fetchLibraryImages`); `apps/admin-web/src/lib/api/online-store.ts`, `online-store.test.ts` (`targets`)
- Modify: `apps/admin-web/src/app/online-store/themes/actions.ts`, `actions.test.ts`
- Create: `apps/admin-web/src/lib/online-store/section-tree.ts`, `section-tree.test.ts`
- Create: `apps/admin-web/src/lib/online-store/section-problems.ts`, `section-problems.test.ts`
- Create: `apps/admin-web/src/lib/online-store/theme-field-errors.ts`, `theme-field-errors.test.ts` (moved from `customize-editor.tsx`, extended); Modify: `apps/admin-web/src/components/online-store/customize-editor.tsx` (imports it)
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes:
  - Tasks 2–3's `Section`, `KnownSection`, `SectionType`, `newSection`, `sectionDefinition`, `HOMEPAGE_SECTIONS_MAX`, `sectionRefsOf`, `isKnownSection`, `ThemeDocument`;
  - Part 1's `getAdminApi`, `mutateAdminApi`, `newIdempotencyKey`, `isVersion`, `newItemId`, `updateMediaAlt`.
- Produces:
  - apps/admin: `MediaAssetDto` gains `image: { url: string; alt: string | null; width: number | null; height: number | null } | null`, from one `admin.mediaImages.execute({ ids: pageIds, tenantId })` per page.
  - `lib/api/media.ts`:
    - `interface LibraryImageDto { readonly id: string; readonly name: string; readonly image: OnlineStoreImageDto }`;
    - `fetchLibraryImages(after: string | null): Promise<ApiResult<{ readonly items: readonly LibraryImageDto[]; readonly endCursor: string | null; readonly hasNextPage: boolean }>>`. It calls `GET /api/v1/media/assets?first=24[&after=]`, keeps `status === "active"` items with a non-null `image`, and drops `storageKey` from what it returns.
  - `lib/api/online-store.ts`:
    - `type ThemeTargetsDto = Readonly<Record<"collection" | "product" | "page", Readonly<Record<string, { readonly title: string; readonly live: boolean }>>>>`;
    - `ThemeStateDto.targets: ThemeTargetsDto | null`, with the guard accepting `null` or that shape.
  - `app/online-store/themes/actions.ts`:
    - `listLibraryImagesAction(after: string | null): Promise<{ status: "ok"; items: readonly LibraryImageDto[]; endCursor: string | null; hasNextPage: boolean } | { status: "error" }>`. `after` must be `null` or a string ≤ 200 without whitespace.
    - `updateImageAltAction(imageId: string, alt: string): Promise<{ status: "ok" } | { status: "error" }>`. `imageId` must match `IMAGE_REF_PATTERN`, `alt` must be a string ≤ 300, it is trimmed, and empty → `null`.
    - `saveThemeDraftAction` checks `document` is a plain object, `isVersion(expectedVersion)`, and the key shape. Otherwise it returns `{ status: "error" }` without a call.
  - `lib/online-store/section-tree.ts` (pure, client-safe):
    - `type SectionPlace = "announcement" | number`;
    - `findSection(doc: ThemeDocument, id: string): { readonly section: Section; readonly place: SectionPlace } | null`;
    - `type AddBlock = "ok" | "limit" | "type_limit"`;
    - `canAddSection(doc: ThemeDocument, type: SectionType): AddBlock`. The announcement is `type_limit` when the slot is full; the homepage is `limit` at 25 and `type_limit` at `maxPerPage`.
    - `addSection(doc: ThemeDocument, type: SectionType, id: string): ThemeDocument`: appends, or fills the announcement slot for `announcement_bar`; unchanged when blocked;
    - `duplicateSection(doc: ThemeDocument, id: string, newId: string): ThemeDocument`: inserts below; homepage only; unchanged when blocked;
    - `removeSection(doc: ThemeDocument, id: string): ThemeDocument`;
    - `moveSection(doc: ThemeDocument, id: string, delta: -1 | 1): ThemeDocument`: clamped;
    - `setSectionHidden(doc: ThemeDocument, id: string, hidden: boolean): ThemeDocument`;
    - `updateSectionSettings(doc: ThemeDocument, id: string, settings: Readonly<Record<string, unknown>>): ThemeDocument`: known sections only.
  - `lib/online-store/section-problems.ts`:
    - `type SectionProblem = "removed_collection" | "removed_product" | "removed_page" | "removed_image" | "unpublished_target"`;
    - `sectionProblems(section: Section, targets: ThemeTargetsDto | null, images: Readonly<Record<string, unknown>>): readonly SectionProblem[]`. It is distinct, in that order. A `null` targets gives no target problems.
  - `lib/online-store/theme-field-errors.ts`: `themeFieldErrors(t: Dictionary, fields: readonly FieldIssue[]): Record<string, string>`. This is Part 1's `fieldErrorsOf`, plus the copy below.

- [ ] **Step 1: Write the failing tests**

`section-tree.test.ts`:

```ts
const doc = (sections: Section[], announcement: Section | null = null): ThemeDocument =>
  ({ ...DEFAULT_THEME_DOCUMENT, header: { ...DEFAULT_THEME_DOCUMENT.header, announcement }, homepage: { sections } }) as ThemeDocument;

describe("section tree (spec 3.3, Ruling 22)", () => {
  it("adds at the end; the announcement bar fills the header slot once", () => {
    const one = addSection(doc([]), "hero", ID1);
    expect(one.homepage.sections.map((s) => s.id)).toEqual([ID1]);
    const bar = addSection(one, "announcement_bar", ID2);
    expect(bar.header.announcement?.id).toBe(ID2);
    expect(canAddSection(bar, "announcement_bar")).toBe("type_limit");
  });
  it("blocks the 26th section and the 4th hero", () => {
    const full = doc(Array.from({ length: 25 }, (_, i) => newSection("rich_text", uuid(i))));
    expect(canAddSection(full, "features")).toBe("limit");
    expect(addSection(full, "features", ID1)).toBe(full);
    const heroes = doc([0, 1, 2].map((i) => newSection("hero", uuid(i))));
    expect(canAddSection(heroes, "hero")).toBe("type_limit");
  });
  it("duplicates below with a new id and the same settings; moves clamp; hide toggles", () => { … });
  it("removes from either place; unsupported sections move, hide and remove like others", () => { … });
  it("updates settings of a known section only, leaving others untouched (same object identity)", () => { … });
});
```

`section-problems.test.ts`:

- a removed collection, a product missing from `targets.product`, a page link absent, an image id absent from `images`, and an unpublished target (`live: false`) each produce their problem;
- `targets: null` gives image problems only;
- `__proto__` as an id is never treated as present.

`theme-field-errors.test.ts`: each new code maps to its copy, keyed by its path:

- `homepage.sections.1.settings.collection` + `TARGET_NOT_FOUND`;
- `IMAGE_NOT_FOUND`, `TOO_MANY_SECTIONS`, `TOO_MANY_OF_TYPE`, `SECTION_NOT_ALLOWED_HERE`, `DUPLICATE_SECTION_ID`, `INVALID_PHONE`, `UNSAFE_LINK`, `TOO_FEW_ITEMS`, `TOO_MANY_ITEMS`, `DUPLICATE_VALUE`, `INVALID_LINK`;
- `INVALID_URL` under `.buttonLink.url` / `.link.url` → `onlineStoreNavigation.urlError`;
- the Part 1 codes are unchanged, and an unknown code → `formErrors.invalid`.

`actions.test.ts` (themes):

- `listLibraryImagesAction` passes `after` and maps the page;
- a 5,000-character `after`, or one with a space, returns `error` with no API call;
- `updateImageAltAction("../x", "a")` and `updateImageAltAction("m1", 7 as never)` return `error` with no call;
- `updateImageAltAction("m1", "  ")` sends `null` with a fresh key;
- `saveThemeDraftAction({ document: "x" as never, expectedVersion: 1 })` and `expectedVersion: -1` return `error` with no call.

`media-library-routes.test.ts`:

- items carry `image` for an active image asset, from one batched resolve per page;
- a non-image or archived asset has `image: null`;
- the existing fields are unchanged.

`online-store.test.ts` (admin-web api):

- `targets` is accepted as `null` or the record;
- a malformed `targets` makes the guard fail;
- `fetchLibraryImages` filters out inactive and image-less items and never returns `storageKey`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @platform/admin exec vitest run src/http/media-library-routes.test.ts && pnpm --filter admin-web exec vitest run src/lib/online-store src/lib/api/media.test.ts src/lib/api/online-store.test.ts src/app/online-store/themes/actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the route mapping (an async handler: list, then resolve the page's ids, then map), the clients, the actions (each argument checked first; `newIdempotencyKey()` for the alt PATCH), the helpers (immutable updates; `findSection` scans the announcement, then the sections) and `themeFieldErrors` (moved verbatim, then extended).

- [ ] **Step 4: Dictionaries (admin-web Arabic is Egyptian)**: new `onlineStoreSections.errors`

| Key                | en                                              | ar                                          |
| ------------------ | ----------------------------------------------- | ------------------------------------------- |
| `targetNotFound`   | This item no longer exists in your store.       | العنصر ده مبقاش موجود في متجرك.             |
| `imageNotFound`    | This image no longer exists in your store.      | الصورة دي مبقتش موجودة في متجرك.            |
| `tooManySections`  | A home page holds up to 25 sections.            | الصفحة الرئيسية تشيل لحد 25 سكشن.           |
| `tooManyOfType`    | You've added the most of this section you can.  | ضفت أكتر عدد مسموح من السكشن ده.            |
| `notAllowedHere`   | This section can't go here.                     | السكشن ده مينفعش يتحط هنا.                  |
| `duplicateSection` | Two sections share an id. Reload the page.      | فيه سكشنين بنفس المعرّف. اعمل ريلود للصفحة. |
| `invalidPhone`     | Enter a WhatsApp number of 8 to 15 digits.      | اكتب رقم واتساب من 8 لـ 15 رقم.             |
| `tooFewItems`      | Keep at least one item.                         | لازم يفضل عنصر واحد على الأقل.              |
| `tooManyItems`     | You've added the most items this section holds. | ضفت أكتر عدد عناصر السكشن ده يشيله.         |
| `duplicateValue`   | This product is already in the list.            | المنتج ده موجود في القايمة أصلًا.           |
| `invalidLink`      | Choose where this link goes.                    | اختار اللينك ده يروح فين.                   |

`UNSAFE_LINK` reuses `richText.unsafeLinkSaved`. `OUT_OF_RANGE` reuses `onlineStoreErrors.outOfRange`.

- [ ] **Step 5: Run, typecheck, lint, route contract**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint && (cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts) && pnpm --filter @platform/admin exec vitest run src/http/media-library-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/http/media-library-routes.ts apps/admin/src/http/media-library-routes.test.ts \
  apps/admin-web/src/lib/api/media.ts apps/admin-web/src/lib/api/media.test.ts \
  apps/admin-web/src/lib/api/online-store.ts apps/admin-web/src/lib/api/online-store.test.ts \
  apps/admin-web/src/app/online-store/themes/actions.ts apps/admin-web/src/app/online-store/themes/actions.test.ts \
  apps/admin-web/src/lib/online-store/section-tree.ts apps/admin-web/src/lib/online-store/section-tree.test.ts \
  apps/admin-web/src/lib/online-store/section-problems.ts apps/admin-web/src/lib/online-store/section-problems.test.ts \
  apps/admin-web/src/lib/online-store/theme-field-errors.ts apps/admin-web/src/lib/online-store/theme-field-errors.test.ts \
  apps/admin-web/src/components/online-store/customize-editor.tsx \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add section editing helpers, library reads and error copy

Pure tree operations with the spec's limits, reference problems for editor flags, the media
library page with image urls, checked server actions, and copy for every section save code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: admin-web — the generated settings form

Model tier: **standard**.

**Files:**

- Create: `apps/admin-web/src/components/online-store/sections/section-settings-form.tsx`, `section-settings-form.test.tsx`
- Create: `apps/admin-web/src/components/online-store/sections/field-control.tsx`, `number-field.tsx`, `choice-field.tsx`, `phone-field.tsx`, `items-field.tsx`, `fields.test.tsx`
- Create: `apps/admin-web/src/components/online-store/sections/image-field.tsx`, `media-library-dialog.tsx`, `media-library-dialog.test.tsx`
- Create: `apps/admin-web/src/components/online-store/sections/resource-picker.tsx`, `resource-picker.test.tsx`
- Modify: `apps/admin-web/src/components/online-store/localized-text-field.tsx`, `localized-text-field.test.tsx` (`layout`)
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`

**Interfaces:**

- Consumes:
  - `sectionDefinition`, `FieldDescriptor`, `toWhatsAppDigits`, `KnownSection`, `pickText`;
  - Part 2's `RichTextEditor`, `LinkPicker`, `LINK_SEARCH_DEBOUNCE_MS`, `searchLinkTargetsAction` (`app/online-store/navigation/actions.ts`);
  - Part 1's `ImageUploadField` (purpose `section_image`), `NativeSelect`, `Switch`, `Dialog*`, `settleAction`;
  - Task 10's `listLibraryImagesAction`, `updateImageAltAction`, `ThemeTargetsDto`, `themeFieldErrors` output (`FieldErrors`).
- Produces:
  - `LocalizedTextField` gains `layout?: "tabs" | "both"` (default `"tabs"`). In `both`, each locale has its own label ("<label> (العربي)" / "(English)", through existing copy), input, counter and error.
  - `<SectionSettingsForm t locale section images targets errors disabled onChange onImage>`, where:
    - `section: KnownSection`;
    - `errors` is keyed by the full document path;
    - `onChange(settings)`;
    - `onImage(image: OnlineStoreImageDto & { id: string })` registers uploads and picks in the editor's image map.

    It renders `sectionDefinition(type).fields` in order through `FieldControl`, with `basePath` = the section's document path + `.settings`, and the section's problems (`sectionProblems`) as alerts at the top.

  - `<FieldControl field value path …>` maps each kind to a control:

    | Kind            | Control                                           |
    | --------------- | ------------------------------------------------- |
    | `localizedText` | `LocalizedTextField layout="both"`                |
    | `richText`      | `RichTextEditor`                                  |
    | `image`         | `SectionImageField`                               |
    | `link`          | `LinkPicker` (null-able, with a "No link" option) |
    | `collection`    | `ResourcePicker` single                           |
    | `products`      | `ResourcePicker` multi, limited by `max`          |
    | `number`        | `NumberField`                                     |
    | `select`        | `ChoiceField`                                     |
    | `boolean`       | `Switch`                                          |
    | `phone`         | `PhoneField`                                      |
    | `text`          | `Input`                                           |
    | `items`         | `ItemsField`                                      |

  - `<NumberField>`: `input type="range"` plus `input type="number"` with the descriptor's `min`/`max`/`step`. An out-of-range typed value is clamped on blur.
  - `<ChoiceField>`: up to 3 options is a radio group of segmented buttons (`role="radiogroup"`); more is a `NativeSelect`.
  - `<PhoneField>`: the "+20" hint. On blur it normalises with `toWhatsAppDigits` and shows `invalidPhone` inline when it is null and the field is not empty.
  - `<ItemsField>`: one fieldset per item, numbered in the legend, with Move up, Move down and Remove. Remove is disabled at `min` with the `minItems` hint. Add is disabled at `max`. Focus is restored as in Ruling 22.
  - `<SectionImageField>`:
    - the preview thumbnail and its alt input, saved on blur through `updateImageAltAction`;
    - Upload (`ImageUploadField purpose="section_image"`);
    - "Choose from library" (`MediaLibraryDialog`);
    - Remove (sets `null`).

    A ref missing from `images` shows "This image was removed" with Remove.

  - `<MediaLibraryDialog open onOpenChange onPick t>`:
    - loads pages of 24 through `settleAction(() => listLibraryImagesAction(after), { status: "error" })`;
    - shows a grid of buttons (`aria-label` = name or alt), "Load more", the empty state, and the localised error with a retry;
    - is portalled (`@platform/ui` `Dialog`).
  - `<ResourcePicker t locale kind multiple max value targets onChange>`:
    - `kind` is `"collection" | "product"`;
    - search uses `searchLinkTargetsAction(kind, q)`, debounced by `LINK_SEARCH_DEBOUNCE_MS`, with the latest answer winning;
    - the debounce is cleared on unmount;
    - chosen items are chips (`<bdi dir="auto">` title from `targets`/the pick), each with its own remove button, with focus going to the next chip or the search box.

- [ ] **Step 1: Write the failing tests**

`fields.test.tsx`:

```ts
it("labels, counters and limits come from the definition (hero heading /80)", () => {
  render(<Harness section={newSection("hero", ID)} />);
  expect(screen.getAllByText(/\/\s*80/)).not.toHaveLength(0); // counter max from the descriptor
  expect(screen.getByLabelText(en.onlineStoreSections.fields.overlay)).toHaveAttribute("max", "80");
});
it("three options are segmented buttons; seven are a select", () => { … contentAlign radiogroup; features icon NativeSelect … });
it("item fields have ids unique per section and item, wired to aria-describedby/aria-invalid", () => {
  render(<Harness section={testimonials(2)} errors={{ "homepage.sections.0.settings.items.0.quote.ar": "x", "homepage.sections.0.settings.items.1.quote.ar": "y" }} />);
  const [a, b] = screen.getAllByLabelText(/الرأي|Quote/).filter((el) => el.getAttribute("aria-invalid") === "true");
  expect(a!.getAttribute("aria-describedby")).not.toBe(b!.getAttribute("aria-describedby"));
  expect(document.getElementById(a!.getAttribute("aria-describedby")!)).toHaveTextContent("x");
});
it("removing an item moves focus to the next item's first field, or Add when none is left", async () => {
  // three items; remove item 2 → document.activeElement is item 2's (formerly 3rd) first input
});
it("Remove is disabled at the minimum; Add at the maximum", () => { … });
it("the phone field normalises on blur with the package rule and flags a bad number", async () => {
  await user.type(phoneInput(), "010 0123 4567"); await user.tab();
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ phone: "201001234567" }));
});
it("the form shows the section's problems (removed collection)", () => { … });
```

`media-library-dialog.test.tsx`:

- "a thrown action shows the localised error and resets": the action rejects → `libraryError` is shown, the Load more / Retry button is enabled (not pending), and `unstable_rethrow` is honoured (a `redirect` error propagates);
- picking an image calls `onPick` with `{ id, url, alt, width, height }` and closes;
- the dialog content is rendered under `document.body`, not inside the sidebar (the portal).

`resource-picker.test.tsx`:

- **"debounced, and nothing after unmount":** with fake timers, typing "sal" calls the action once after 250 ms, and unmounting before 250 ms calls it never;
- a stale answer never replaces a newer one;
- the multi picker stops at `max`;
- removing a chip focuses the next chip, or the search box.

`section-settings-form.test.tsx`: each section type renders without crashing from its defaults, a parametrised test over `SECTION_TYPES`.

`localized-text-field.test.tsx`: `layout="both"` shows both inputs and both counters at once, and `tabs` is unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter admin-web exec vitest run src/components/online-store/sections src/components/online-store/localized-text-field.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the components per Interfaces.
- Field ids: `${useId()}-${path}`, with a `"-"` replacing every `.`.
- Errors: read with `errors[path]` and `errors[path + ".ar"]` / `".en"`.
- Settings: immutable updates through `onChange({ ...settings, [key]: value })`.

- [ ] **Step 4: Dictionaries (admin-web Arabic is Egyptian)**: `onlineStoreSections.fields`, `.options`, `.image`, `.items`, `.picker`

| Key                                                                                                     | en                                                                                                                                                                                                                    | ar                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields.heading`, `subheading`, `text`, `body`                                                          | Heading, Subheading, Text, Text                                                                                                                                                                                       | العنوان، العنوان الفرعي، الكلام، المحتوى                                                                                                                              |
| `fields.image`, `mobileImage`                                                                           | Image, Mobile image                                                                                                                                                                                                   | الصورة، صورة الموبايل                                                                                                                                                 |
| `fields.buttonLabel`, `buttonLink`, `link`                                                              | Button label, Button link, Link                                                                                                                                                                                       | كلام الزرار، لينك الزرار، اللينك                                                                                                                                      |
| `fields.style`, `height`, `contentAlign`, `overlay`                                                     | Style, Height, Text position, Image overlay                                                                                                                                                                           | الشكل، الارتفاع، مكان الكلام، تعتيم الصورة                                                                                                                            |
| `fields.collection`, `productCount`, `columns`, `showViewAll`                                           | Collection, Products to show, Columns, Show “View all”                                                                                                                                                                | المجموعة، عدد المنتجات، عدد الأعمدة، اظهر «عرض الكل»                                                                                                                  |
| `fields.source`, `products`, `count`, `items`                                                           | Show, Products, Products to show, Items                                                                                                                                                                               | اعرض، المنتجات، عدد المنتجات، العناصر                                                                                                                                 |
| `fields.imagePosition`, `align`                                                                         | Image position, Alignment                                                                                                                                                                                             | مكان الصورة، المحاذاة                                                                                                                                                 |
| `fields.quote`, `author`, `rating`, `icon`, `title`                                                     | Quote, Customer name, Rating, Icon, Title                                                                                                                                                                             | الرأي، اسم العميل، التقييم، الأيقونة، العنوان                                                                                                                         |
| `fields.phone`, `message`                                                                               | WhatsApp number, Prefilled message                                                                                                                                                                                    | رقم الواتساب، الرسالة الجاهزة                                                                                                                                         |
| `options.accent`, `primary`, `dark`                                                                     | Accent, Primary, Dark                                                                                                                                                                                                 | لون مميز، اللون الأساسي، غامق                                                                                                                                         |
| `options.small`, `medium`, `large`                                                                      | Small, Medium, Large                                                                                                                                                                                                  | صغير، متوسط، كبير                                                                                                                                                     |
| `options.start`, `center`, `end`                                                                        | Start, Center, End                                                                                                                                                                                                    | البداية، النص، النهاية                                                                                                                                                |
| `options.newest`, `manual`, `all`, `manualCollections`                                                  | Newest products, Pick products, All collections, Pick collections                                                                                                                                                     | أحدث المنتجات، اختار منتجات، كل المجموعات، اختار مجموعات                                                                                                              |
| `options.cod` … `gift`                                                                                  | Cash on delivery, Shipping, Returns, Support, Secure payment, Quality, Gift                                                                                                                                           | الدفع عند الاستلام، الشحن، الإرجاع، الدعم، دفع آمن، الجودة، هدية                                                                                                      |
| `options.noLink`                                                                                        | No link                                                                                                                                                                                                               | من غير لينك                                                                                                                                                           |
| `image.upload`, `library`, `remove`, `alt`, `removed`                                                   | Upload, Choose from library, Remove image, Alt text, This image was removed                                                                                                                                           | ارفع صورة، اختار من المكتبة، شيل الصورة، وصف الصورة، الصورة دي اتشالت                                                                                                 |
| `image.libraryTitle`, `libraryEmpty`, `loadMore`, `libraryError`, `retry`, `altError`                   | Media library, No images yet., Load more, Couldn't load your images., Try again, Couldn't save the alt text.                                                                                                          | مكتبة الصور، مفيش صور لسه.، اعرض أكتر، معرفناش نحمّل صورك.، جرّب تاني، معرفناش نحفظ وصف الصورة.                                                                       |
| `items.add`, `remove`, `moveUp`, `moveDown`, `legend`, `minItems`                                       | Add item, Remove item {n}, Move item {n} up, Move item {n} down, Item {n}, Keep at least one item.                                                                                                                    | ضيف عنصر، امسح العنصر {n}، طلّع العنصر {n} لفوق، نزّل العنصر {n} لتحت، العنصر {n}، لازم يفضل عنصر واحد على الأقل.                                                     |
| `picker.search`, `noResults`, `removeChip`, `max`, `pickOneProduct`, `pickOneCollection`                | Search…, No results, Remove {name}, Up to {max}., Pick at least one product., Pick at least one collection.                                                                                                           | دوّر…، مفيش نتايج، شيل {name}، لحد {max}.، اختار منتج واحد على الأقل.، اختار مجموعة واحدة على الأقل.                                                                  |
| `phone.hint`                                                                                            | Egyptian numbers can start with 0 — we add +20.                                                                                                                                                                       | الأرقام المصرية ممكن تبدأ بـ 0 — هنزوّد +20.                                                                                                                          |
| `problems.removed_collection`, `removed_product`, `removed_page`, `removed_image`, `unpublished_target` | This section has a removed collection., This section has a removed product., This section links to a removed page., This section has a removed image., Some items here aren't published, so customers won't see them. | السكشن ده فيه مجموعة اتشالت.، السكشن ده فيه منتج اتشال.، السكشن ده فيه لينك لصفحة اتشالت.، السكشن ده فيه صورة اتشالت.، فيه عناصر هنا مش منشورة، فالعملاء مش هيشوفوها. |

- [ ] **Step 5: Run, typecheck, lint, client-bundle grep**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, then the client-bundle grep (Commands).
Expected: PASS, and only the three known hits.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/components/online-store/sections \
  apps/admin-web/src/components/online-store/localized-text-field.tsx \
  apps/admin-web/src/components/online-store/localized-text-field.test.tsx \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add the generated section settings form

One control per descriptor kind, driven by the shared section definitions: localized and rich
text, images with a media library, link and resource pickers, numbers, choices, phone and items.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: admin-web — the section tree, the add dialog and the editor layout (plus the E2E scenario)

Model tier: **standard**.

**Files:**

- Create: `apps/admin-web/src/components/online-store/sections/section-tree-panel.tsx`, `section-tree-panel.test.tsx`
- Create: `apps/admin-web/src/components/online-store/sections/add-section-dialog.tsx`, `add-section-dialog.test.tsx`, `section-icons.ts`
- Create: `apps/admin-web/src/lib/online-store/preview-focus.ts`, `preview-focus.test.ts`
- Modify: `apps/admin-web/src/components/online-store/customize-panels.tsx` (`HeaderPanel`, `FooterPanel`), `customize-editor.tsx`, `customize-editor.test.tsx`
- Modify: `apps/admin-web/src/middleware.test.ts`
- Modify: `apps/admin-web/src/messages/en.ts`, `ar.ts`
- Create: `apps/e2e/tests/online-store-sections.spec.ts`; Modify: `apps/e2e/scripts/seed-e2e-identities.mjs`

**Interfaces:**

- Consumes:
  - Task 10's `section-tree.ts` operations, `canAddSection`, `sectionProblems`, `themeFieldErrors`, `ThemeTargetsDto`;
  - Task 11's `SectionSettingsForm`;
  - `SECTION_DEFINITIONS`, `sectionHeading`, `newItemId`;
  - Part 1's editor state (`update`, autosave, `frameVersion`, `preview`).
- Produces:
  - `section-icons.ts`: `SECTION_ICON_COMPONENTS: Readonly<Record<SectionIcon, LucideIcon>>`.
  - `preview-focus.ts`:
    - `previewOrigin(url: string): string | null`;
    - `postFocus(frame: Pick<HTMLIFrameElement, "contentWindow"> | null, previewUrl: string, id: string): boolean`. It calls `frame.contentWindow.postMessage({ type: "morbeh:focus-section", id }, origin)`; it does nothing (false) without a frame or origin, and never posts with `"*"`.
  - `<AddSectionDialog t locale open onOpenChange doc placement onAdd>`:
    - one button per definition of that placement, with icon, name and the dictionary's one-line description;
    - blocked types are disabled, with the `limitReached` / `typeLimit` reason in `aria-describedby`;
    - portalled.
  - `<SectionTreePanel t locale doc targets images selectedId disabled menus onSelect onUpdate>`. It renders three groups:
    - **Header:** the announcement slot (a row when set, else "Add announcement"), `HeaderPanel` (sticky and the header menu);
    - **Template: Home page:** rows, then "+ Add section";
    - **Footer:** `FooterPanel` (footer menu, policy links, showSocial, note).

    Each row has:
    - a select button with the type icon, `<bdi dir="auto">` title (`sectionHeading` ?? the type label), and a "Hidden" badge;
    - a problem dot when `sectionProblems` is non-empty;
    - an eye toggle (`aria-label` hide/show `{name}`, `aria-pressed`);
    - the ⋯ `DropdownMenu`: Move up, Move down, Duplicate, Remove.

    Alt+ArrowUp/ArrowDown on the select button moves the section. Remove asks through a `Dialog`. Unsupported sections show the type label `unsupported` and no settings form.

  - `HeaderPanel` (sticky and the header menu select) and `FooterPanel` (footer menu, showPolicyLinks, showSocial and note) replace Part 1/2's `FooterPanel` (Ruling 23).
  - `CustomizeEditor`:
    - tabs **Sections** / **Theme settings** (`Tabs` from `@platform/ui`); Theme settings holds Logo, Colours, Typography, Corners and Social;
    - `selectedId` state. Selecting opens `SectionSettingsForm`: below `xl`, in the same column with "Back to sections", which returns focus to the row; at `xl` (≥ 1280 px), in a second column (`xl:grid-cols-[20rem_22rem]`);
    - a `ref` on the iframe. `postFocus` runs on selection, and again in the iframe's `onLoad` when something is selected (Ruling 18);
    - `targets` / `images` passed down. Newly uploaded or picked images are added to `images`;
    - field errors from `themeFieldErrors`. A section with an error path shows a dot on its row.

- [ ] **Step 1: Write the failing tests**

`section-tree-panel.test.tsx`:

```ts
it("focus after remove, move and duplicate (Review Focus 5, Ruling 22)", async () => {
  const user = userEvent.setup();
  render(<Harness sections={[rich(ID1, "A"), rich(ID2, "B"), rich(ID3, "C")]} />);
  // Alt+↓ on A: A moves below B and keeps focus
  screen.getByRole("button", { name: /^A/ }).focus();
  await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(rowTitles()).toEqual(["B", "A", "C"]);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^A/ }));
  // remove A through ⋯ → confirm: focus goes to the next row (C)
  await user.click(screen.getByRole("button", { name: en.onlineStoreSections.more.replace("{name}", "A") }));
  await user.click(screen.getByRole("menuitem", { name: en.onlineStoreSections.remove }));
  await user.click(screen.getByRole("button", { name: en.onlineStoreSections.confirmRemoveButton }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^C/ }));
  // duplicate C: the copy is selected and focused
  await user.click(screen.getByRole("button", { name: en.onlineStoreSections.more.replace("{name}", "C") }));
  await user.click(screen.getByRole("menuitem", { name: en.onlineStoreSections.duplicate }));
  expect(rowTitles()).toEqual(["B", "C", "C"]);
  expect(document.activeElement).toBe(screen.getAllByRole("button", { name: /^C/ })[1]);
});
it("removing the last row focuses + Add section", async () => { … });
it("the eye toggle hides and shows, with aria-pressed and the section's name", async () => { … });
it("the ⋯ menu is portalled out of the sidebar", async () => {
  // open it; expect(screen.getByTestId("sections-aside").contains(screen.getByRole("menu"))).toBe(false)
});
it("Move up is disabled on the first row, Move down on the last; Duplicate at 25 sections", () => { … });
it("titles are the first heading or the type name, isolated with <bdi dir=auto>", () => { … });
it("a section with a removed collection shows the problem dot; an unsupported section says so", () => { … });
it("a viewer sees the tree read-only (every control disabled)", () => { … });
```

`add-section-dialog.test.tsx`:

- the homepage placement lists nine types with name and description, and the header placement only the announcement bar;
- with 3 heroes the hero option is disabled and described by `typeLimit` ("up to 3");
- picking calls `onAdd(type)` and closes;
- the content is under `document.body`.

`preview-focus.test.ts`:

- `postFocus` posts to `https://shop.example` for `https://shop.example/?preview=t&v=3`;
- no frame or a bad URL gives `false` and no post;
- the second argument is never `"*"`.

`customize-editor.test.tsx` adds:

- **"focus posts to the preview origin, again after each reload" (Review Focus 3):** select a section → `postMessage` is called with `{ type: "morbeh:focus-section", id }` and the preview origin; fire the iframe `load` → posted again.
- **"adding a section autosaves the draft with it, and the second save carries the first save's version" (version-forward):**
  1. Add a hero; after 1 s `saveThemeDraftAction` is called with `expectedVersion: state.version`.
  2. The action answers `{ status: "ok", version: 9, draftRevision: 4 }`.
  3. Hide the hero; the next call carries `expectedVersion: 9`.
- an invalid save puts the copy on the hero's field (`TARGET_NOT_FOUND` at `homepage.sections.N.settings.collection`) and the dot on its row;
- a 409 stops autosave and shows the reload alert (Part 1, unchanged);
- Publish stays disabled for an operator, with the admin-only title;
- `beforeunload` is prevented while a section edit is unsaved;
- the Theme settings tab still shows the Part 1 panels;
- the Header and Footer groups write `header.sticky`, `header.menuHandle`, `footer.menuHandle`, `footer.showPolicyLinks`, `footer.showSocial` and `footer.note` (the Part 2 cases, moved here).

`middleware.test.ts` adds "the section editor stays operator-only": a viewer is refused `/online-store/themes/customize`, and an operator and an admin reach it. Part 3 adds no route, so `ROUTE_ROLE_REQUIREMENTS` is unchanged.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter admin-web exec vitest run src/components/online-store src/lib/online-store/preview-focus.test.ts src/middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Focus control:** use Part 2's `MenuEditor` pattern. A `pendingFocus` ref is decided together with the new tree and applied in a layout effect after the render, through a `Map` of row controls keyed `${id}:select`, plus the Add button.
- **Moves:** Alt+arrow and the menu items call `moveSection`. Alt+arrow is ignored when the row is already at that end.
- **New ids:** come from `newItemId()`.
- **Edits:** every tree edit goes through the editor's existing `update(change)`, so autosave, conflict and replay are Part 1's.
- **Second column:** pure CSS (`hidden xl:block` / `xl:hidden`). jsdom renders the single-column flow.

- [ ] **Step 4: Dictionaries (admin-web Arabic is Egyptian)**: `onlineStoreSections`

| Key                                     | en                                                                                                  | ar                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tabSections` / `tabTheme`              | Sections / Theme settings                                                                           | السكاشن / إعدادات الثيم                                                           |
| `header` / `template` / `footer`        | Header / Template: Home page / Footer                                                               | الهيدر / القالب: الصفحة الرئيسية / الفوتر                                         |
| `homePage`                              | Home page                                                                                           | الصفحة الرئيسية                                                                   |
| `addAnnouncement`                       | Add announcement                                                                                    | ضيف شريط إعلانات                                                                  |
| `addSection` / `pickerTitle`            | Add section / Add section                                                                           | ضيف سكشن / ضيف سكشن                                                               |
| `hide` / `show`                         | Hide {name} / Show {name}                                                                           | اخفي {name} / اظهر {name}                                                         |
| `hiddenBadge`                           | Hidden                                                                                              | مخفي                                                                              |
| `more`                                  | More actions for {name}                                                                             | اختيارات تانية لـ {name}                                                          |
| `moveUp` / `moveDown`                   | Move up / Move down                                                                                 | طلّع لفوق / نزّل لتحت                                                             |
| `duplicate` / `remove`                  | Duplicate / Remove                                                                                  | كرر / امسح                                                                        |
| `confirmRemove` / `confirmRemoveButton` | Remove this section? You can't undo this. / Remove                                                  | تمسح السكشن ده؟ مش هتعرف ترجّعه. / امسح                                           |
| `cancel`                                | Cancel                                                                                              | إلغاء                                                                             |
| `back`                                  | Back to sections                                                                                    | ارجع للسكاشن                                                                      |
| `unsupported` / `unsupportedBody`       | Unsupported section / A newer version of Morbeh made this section. You can move, hide or remove it. | سكشن مش مدعوم / السكشن ده اتعمل بنسخة أحدث من مربح. تقدر تحركه أو تخفيه أو تمسحه. |
| `limitReached`                          | A home page holds up to 25 sections.                                                                | الصفحة الرئيسية تشيل لحد 25 سكشن.                                                 |
| `typeLimit`                             | You can add up to {max} of this section.                                                            | تقدر تضيف لحد {max} من السكشن ده.                                                 |
| `hasProblem`                            | Needs attention                                                                                     | محتاج مراجعة                                                                      |
| `descriptions.announcement_bar`         | A short message at the top of every page.                                                           | رسالة قصيرة فوق في كل صفحة.                                                       |
| `descriptions.hero`                     | A large image with a heading and a button.                                                          | صورة كبيرة عليها عنوان وزرار.                                                     |
| `descriptions.featured_collection`      | Products from one collection.                                                                       | منتجات من مجموعة واحدة.                                                           |
| `descriptions.featured_products`        | Your newest products, or ones you pick.                                                             | أحدث منتجاتك، أو منتجات تختارها.                                                  |
| `descriptions.collection_list`          | Links to your collections.                                                                          | روابط لمجموعاتك.                                                                  |
| `descriptions.image_with_text`          | An image beside a heading and text.                                                                 | صورة جنب عنوان وكلام.                                                             |
| `descriptions.rich_text`                | A heading and text, like your store's story.                                                        | عنوان وكلام، زي حكاية متجرك.                                                      |
| `descriptions.testimonials`             | Quotes from happy customers.                                                                        | كلام عملاء مبسوطين.                                                               |
| `descriptions.features`                 | Badges like cash on delivery and easy returns.                                                      | مميزات زي الدفع عند الاستلام والإرجاع السهل.                                      |
| `descriptions.whatsapp_cta`             | A button that opens a WhatsApp chat with you.                                                       | زرار يفتح شات واتساب معاك.                                                        |
| `showSocial`                            | Show social links                                                                                   | اظهر لينكات السوشيال                                                              |

The `lib/i18n.test.ts` parity test stays green. The type names in the tree come from the package's `labels` (`ar` for an Arabic admin).

- [ ] **Step 5: Write the E2E scenario (spec 3.7; written, not run, Ruling 24)**

- **The seed:** in `apps/e2e/scripts/seed-e2e-identities.mjs`, add `"online_store:read"`, `"online_store:edit_theme"`, `"online_store:upload_image"` and `"media_library:read"` to the operator and admin extras. The admin also gets `"online_store_admin:publish_theme"` and `"online_store_admin:update_access"`.
- **The spec:** `apps/e2e/tests/online-store-sections.spec.ts`, steps in order:
  1. The operator opens the customize editor, adds an image banner (uploading a fixture PNG) and a featured collection (picking the seeded collection), sees both in the preview frame, and finds Publish disabled.
  2. The admin publishes.
  3. A fresh context sees the hero heading and the collection heading on the live homepage.
  4. The admin turns on the password lock.
  5. A fresh context lands on `/password`, unlocks, and sees the store.
  6. `/robots.txt` reads `Disallow: /` while locked.

  It uses `requireEnv("E2E_PASSWORD")` and `loginToAdminWeb`, like `operator-create-product.spec.ts`.

- [ ] **Step 6: Run, typecheck, lint, route contract, client-bundle grep, e2e static checks**

Run: `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint && (cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts) && pnpm --filter @platform/e2e typecheck && pnpm --filter @platform/e2e lint`, then the client-bundle grep.
Expected: PASS, and only the three known grep hits. Do **not** run `pnpm --filter @platform/e2e e2e`: no environment exists.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/components/online-store apps/admin-web/src/lib/online-store/preview-focus.ts \
  apps/admin-web/src/lib/online-store/preview-focus.test.ts apps/admin-web/src/middleware.test.ts \
  apps/admin-web/src/messages/en.ts apps/admin-web/src/messages/ar.ts \
  apps/e2e/tests/online-store-sections.spec.ts apps/e2e/scripts/seed-e2e-identities.mjs
git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit -F - <<'EOF'
feat(admin-web): add the homepage section editor

The customize editor gets Shopify's layout: a header, home page and footer tree with add,
reorder (buttons and Alt+arrows), hide, duplicate and remove, the generated settings form, and
focus messages to the preview; plus the written E2E scenario.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Final verification (after Task 12)

- [ ] `pnpm --filter @platform/storefront-content test && pnpm --filter @platform/catalog test && pnpm --filter @platform/online-store test`
- [ ] `pnpm --filter @platform/admin test` and `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @platform/admin lint`
- [ ] `pnpm --filter storefront test && pnpm --filter storefront typecheck && pnpm --filter storefront lint`, and `cd apps/storefront && pnpm exec vitest run src/lib/runtime-contract.test.ts`
- [ ] `pnpm --filter admin-web test && pnpm --filter admin-web typecheck && NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter admin-web lint`, and `cd apps/admin-web && pnpm exec vitest run src/lib/api/route-contract.test.ts`
- [ ] `pnpm --filter @platform/e2e typecheck && pnpm --filter @platform/e2e lint` (the suite itself is not run).
- [ ] `pnpm typecheck` at the root (turbo): every package is green.
- [ ] `node scripts/dev/check-prisma-tenant-where.mjs` prints exactly the one known finding.
- [ ] `git diff 34526820 --stat -- packages/db` prints nothing (no migration, no schema change).
- [ ] The client-bundle grep prints only the three known pre-existing hits.
- [ ] `grep -rn "dangerouslySetInnerHTML" apps/storefront/src apps/admin-web/src/components/online-store` and `grep -rn "style={{" apps/storefront/src/components/sections` print nothing.
- [ ] `grep -rn "موربيه" apps packages services` prints nothing. The invisible-character check over every file the tasks wrote prints nothing.
- [ ] `git log --oneline 34526820..HEAD` shows twelve task commits. `git status` is clean except `.superpowers/` and `.claude/`, which are never staged.
- [ ] **Owed to the browser pass** (`next build` fails here with `EPERM`). Check in ar and en:
  - the default homepage next to a screenshot of today's;
  - every section at 320/375/1280 px: long Arabic words in the hero, a wide image banner, the overlay, RTL image-with-text order;
  - the announcement bar with a sticky header;
  - the editor tree at narrow and ≥ 1280 px widths;
  - focus outlines in the preview after a save;
  - the library dialog;
  - a WhatsApp link on a phone.
- [ ] **Owner hand-off note** (in the PR description, not code):
  - **No migration, no new environment variable and no new permission string** (Ruling 1).
  - **Deploy order:** deploy the Runtime API (`apps/admin`) before the storefront. The storefront falls back to the default homepage when `/public/online-store/home` is missing, so either order is safe.
  - **Admin:** an admin tab left open across the deploy keeps autosaving: version-1 documents are upcast (Ruling 2).

## Self-review (done while writing this plan)

**1. Spec coverage (Part 3).**

- **3.1** (a typed model in the theme document, `experience`/`components` untouched): Rulings 1–2, Tasks 2–3.
- **3.2:**
  - the section model, definitions with labels, icon, `maxPerPage`, defaults, fields and validate: Task 2;
  - every descriptor kind: Task 1;
  - the ten types with their limits: Task 2;
  - 25 sections: Task 3;
  - the announcement in the header, site-wide: Tasks 3, 6, 9;
  - no newsletter: the library has none;
  - `features`: Task 2;
  - phone normalisation and `wa.me`: Tasks 1, 9;
  - the default homepage and the replaced page: Tasks 2, 3, 8.
- **3.3:**
  - add, reorder, hide, duplicate, remove and configure: Tasks 10–12;
  - one draft and one publish: unchanged Part 1 publish;
  - reference ownership on save: Task 5;
  - broken references dropped live: Task 6;
  - broken references flagged in the editor: Tasks 5, 10, 11, 12;
  - unknown types preserved, skipped and shown as unsupported: Tasks 2, 3, 6, 8, 12.
- **3.4:**
  - draft validation with paths: Tasks 3, 5;
  - `GET /public/online-store/home`: Task 6;
  - `?ids=`: Task 4;
  - the shell announcement: Task 6.
- **3.5:**
  - the editor layout: Sections/Theme tabs, the Header/Template/Footer tree, the add dialog, Egyptian copy, single column versus second column at 1280 px (Task 12);
  - one form control per descriptor kind, the image upload, library and alt, the pickers (Task 11);
  - focus messages and the origin check (Tasks 8, 12);
  - no drag-and-drop: Ruling 22.
- **3.6:**
  - the renderer and `type → component`, unknown types skipped, parallel data reads, failure isolation: Task 8 (+ Task 7);
  - catalog reads incl. `?ids=` and newest: Tasks 4, 7;
  - 60 s per-shop caching with both tags: Task 7;
  - image rendering, the first hero eager, the mobile `<picture>`, the overlay pseudo-element, logical alignment: Task 9;
  - `dir="auto"`, stacking on mobile, WhatsApp in a new tab: Task 9;
  - `data-section-id` and hidden placeholders in preview: Task 8.
- **3.7:** every listed test class is in a task's tests, and the E2E is written in Task 12 (Ruling 24).
- **Security:** tenant keys, origin checks, safe links, no style attribute, no draft without a token, through the Global Constraints and Tasks 5–9.
- **Knowingly not done** (spec non-goals): sections on other templates, drag-and-drop, scheduled publishing, newsletter.

**2. Step scan.** There is no "TBD" and no "similar to Task N". Where a test is sketched as `…` (render matrices, harness wiring), its title names the exact assertion, and the full neighbouring tests fix its shape. Algorithms the signatures leave open are spelled out:

- the phone normaliser;
- the new-reference diff;
- the v1/v2 read and write rules;
- the drop rules;
- the cache keys;
- focus placement.

**3. Type consistency.**

- `PublicSection` (Task 2) is what `resolveSection` returns (Task 6), what `readPublicSection` re-reads (Task 7) and what `Sections` renders (Tasks 8–9).
- `SectionRefs` / `SectionRef` (Task 1) are produced by `collectFieldRefs` (Task 1), `sectionRefsOf` (Task 2) and `documentRefsOf` (Task 3), and consumed by `SaveThemeDraft` (Task 5).
- `LinkTarget.slug` (Task 5) becomes `PublicCollectionRef.slug` (Task 6) and is read by `readCollectionProducts` (Task 7).
- `ThemeStateView.targets` / `ThemeTargetsView` (Task 5) is `ThemeStateDto.targets` / `ThemeTargetsDto` (Task 10), used by `sectionProblems` (Task 10) and the tree and form (Tasks 11–12).
- `FOCUS_MESSAGE_TYPE` (Task 8) equals the type `postFocus` sends (Task 12).
- `catalogTag` (Task 7) is used only there. `/api/revalidate` stays on `os:`.
- `listLibraryImagesAction` / `LibraryImageDto` (Task 10) feed `MediaLibraryDialog` (Task 11).
- `canAddSection`'s `AddBlock` (Task 10) feeds `AddSectionDialog` (Task 12).

**4. Review Focus.** Each of the five lines is pinned by named tests in its owning task (Tasks 3/5/7; 5; 8/12; 7; 11/12). The spec's own Review Focus items for Part 3 are covered too:

- cross-shop leakage: Task 7 keys, Task 6 tenant-per-call;
- preview token leakage: external section links carry no token, and `no-referrer` (Task 9);
- bilingual gaps: Tasks 8, 9;
- draft races: Task 5 and Part 1's autosave in Task 12;
- old documents: Tasks 2, 3.

**5. Proportion.** The plan carries the spec's decisions, 25 rulings, the tests as code for the security-bearing pieces, and the fixed copy: default section text and both dictionaries. Implementation bodies appear only for the phone normaliser, the new-reference algorithm, the document versioning rules and the hero markup the spec pins.
