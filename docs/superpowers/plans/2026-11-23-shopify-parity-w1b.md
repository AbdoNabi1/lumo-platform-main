# Shopify parity — Wave 1b: Content > Files + Customers (create, edit, tags, note, marketing, export)

`OPUS: AGREED · Sol: AGREED (w1b/plan-review-3.md, round 3)`

**Branch / worktree:** `morbeh/shopify-parity-w1b` at `F:/New folder/morbeh-shopify-parity-w1b`, BASE `a8a8bf62` (Wave 1a head, PR #15; stacked — this branch will be re-based on main by a merge after #15 lands).
**Evidence:** `docs/superpowers/plans/w1b/survey-customers.md`, `docs/superpowers/plans/w1b/survey-files-users.md` (read-only surveys with file:line), Shopify audit `C:/Users/Abdo/Documents/shopify-audit/Shopify_Audit_My_Store_2.md`.

**Owner decisions (defaults taken; owner may reverse — listed in his status message):**

- D4 Wave 1b = Files + Customers. Users & permissions (invite, roles, deactivate, 2FA, login code step, activity log) and Segments move to Wave 1c (own plan), because the survey shows they need a new staff slice over Security and a login-flow change.
- D5 Files follow Shopify exactly: Shopify's Files page has NO folders, so the UI is a flat library with search, sort, grid/list. Images only (JPG/PNG/WebP/GIF ≤ 8 MB) — the upload pipeline sniffs images only; documents/video are a later item.
- D6 Customers: email stays read-only after creation in 1b (changing it touches uniqueness, verification and signup tokens — later item). Editable: name, phone, language, note, tags, email/SMS marketing.
- D7 Marketing consent: the existing `marketing` scope IS "Email marketing" (no data migration); a new scope `marketing_sms` is "SMS marketing". Default for both: not subscribed.

**Amendment precedence:** round 2 > round 1 > original task text; within a task a later block wins over an earlier one.

**Amendments (binding) — Plan review 1 preamble (applies to every task; the amendment wins)**

- _Plan review 1, finding 2 — commands._ Every command in an amendment block below is the complete command; the abbreviated `…` lines in the original task text are replaced by them.
- _Plan review 1, findings 13–14 — honest scope._ Wave 1b is not full Shopify parity. Deferred and tracked (no work in 1b): non-image files and keeping the original file (uploads are re-encoded by `prepareImage`), optional-email / phone-only customers, address editing, customer bulk actions and filters, and channel-specific consent provenance. The marketing toggles record a staff assertion, not proof that the shopper opted in; UI copy must not claim compliance.
- Review files for this wave live in `docs/superpowers/plans/w1b/` (`plan-review-N.md`).

**Implementers:** Task 1 `terra` (media backend), Task 2 `sonnet` (Files UI), Task 3 `terra` (identity: migration, domain, use cases), Task 4 `sonnet` (customers admin API — backend, even number), Task 5 `sonnet` (customers UI).

## Global Constraints (binding for every task)

- G1 Hard rules: never `git stash/checkout/reset/force-push`, never `--no-verify`; stage only the task's files; commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional type, lowercase subject, trailer `Co-Authored-By: <your model>`. Run `git commit` in the foreground with a ≥400 s tool timeout.
- G2 Exactly ONE migration in this wave, in Task 3, hand-written and additive; never run `prisma migrate`/`db push`. Tasks 1, 2, 4, 5 change no Prisma schema.
- G3 Tenant comes from `context.tenantId`, never the body. Validation only through `defineRoute` zod schemas (transport 422 `VALIDATION`); no handler-side parsing returning 400.
- G4 Write routes: `idempotent: true`, `POST` (update = `POST /x/:id`), except where a task names `PATCH`.
- G5 Permissions: existing resources only (`media_library:*`, `products:update`, `customers:*`), no role-table edit. Operator holds `customers:*` and `media_library:*`; viewer only `:read`.
- G6 Brand lock: `@platform/ui` components and semantic tokens only, Lucide icons only, no hex colours, no font/radius/button-shape changes (`AGENTS.md`, `docs/ui/BRAND_LOCK.md`).
- G7 i18n: new strings in `apps/admin-web/src/messages/en.ts` AND `ar.ts` (same keys). Logical CSS (`ms-*`, `text-start`, `border-e`), chevrons `rtl:rotate-180`. File names, customer names, emails, tags inside `<bdi dir="auto">`.
- G8 admin-web UI rules: destructive confirms use the real `Dialog` (title, `DialogDescription` warning, initial focus on Cancel, Escape closes, focus returns to the trigger, trigger stays mounted until focus is restored). Server actions call `revalidatePath` for every affected path after EVERY write that reached the API, ok or not. Dialog / non-disclosure tests query `document.body`. `expect.hasAssertions()` inside each test or in `beforeEach`.
- G9 Commands (bash, exactly as written). Prefix every pnpm command with `export pnpm_config_verify_deps_before_run=false;`. PNPM = `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs`. Before committing: `export PATH="$TMPDIR/pnpmshim:$PATH"` (shim already exists). Never skip hooks. Do NOT run `next build`.
- G10 Dependencies are installed by Opus; do not run `pnpm install`.

---

### Task 1 — Media library list filters + richer asset DTO (implementer: terra)

**Goal:** the Files page can list active files newest-first, search by name, and show type, size and date added.

**Files:** `services/media/src/domain/media-asset.ts`, `services/media/src/domain/library-repositories.ts`, `services/media/src/application/list-media-assets.use-case.ts`, `services/media/src/infrastructure/library-mappers.ts`, `services/media/src/infrastructure/prisma-library-repositories.ts`, `services/media/src/infrastructure/in-memory-library-repositories.ts`, `services/media/src/index.ts` (export the new type), `apps/admin/src/http/media-library-routes.ts`; tests next to each (`media-library-reads.use-case.test.ts`, `in-memory-library-repositories.test.ts`, a new `apps/admin/src/http/media-library-routes.test.ts`).

**Steps:**

1. `MediaAsset`: add optional prop `createdAt?: Date`. `create(...)` sets `createdAt = occurredAt`. `reconstitute(...)` gains a LAST optional parameter `createdAt?: Date`. Getter `get createdAt(): Date | undefined`. `MediaAssetMapper.toDomain` passes `row.createdAt`. No other call site changes (`MediaAsset.reconstitute` is called only in `library-mappers.ts`).
2. Port: in `library-repositories.ts` add
   ```ts
   export interface MediaAssetListQuery extends CursorPage {
     readonly search?: string; // case-insensitive "name contains"
     readonly status?: "active" | "archived";
     readonly sort?: "newest" | "oldest"; // absent = "oldest" (today's order)
   }
   ```
   and change `MediaAssetRepository.list(page: CursorPage, …)` to `list(query: MediaAssetListQuery, tenantId: string, tx?: unknown)`. Absent fields keep today's behaviour exactly (all statuses, `id ASC`).
3. Prisma `list`: `where = { tenantId, ...(status ? { status } : {}), ...(search ? { name: { contains: search, mode: "insensitive" } } : {}), ...(after ? { id: sort === "newest" ? { lt: after } : { gt: after } } : {}) }`, `orderBy: { id: sort === "newest" ? "desc" : "asc" }`, `take: limit + 1`, same `buildPaginatedPage` with `endCursor` = last id. (ids are UUIDv7, so id order = creation order.)
4. In-memory `list`: filter by tenant, status, `name.toLowerCase().includes(search.toLowerCase())`; sort by `id` string asc or desc; apply the cursor (`id > after` asc / `id < after` desc), `normalizePageSize(first)` from `@platform/repository`, `hasNextPage` = more rows remain, `endCursor` = last returned id (null when empty). Do not change the shared `paginate` helper used by folders.
5. `ListMediaAssetsInput` becomes `MediaAssetListQuery & { readonly tenantId: string }`; the use case passes the query through unchanged.
6. Route `GET /media/assets`: querystring `assetListQuery = pageQuery.extend({ search: z.string().trim().min(1).max(100).optional(), status: z.enum(["active", "archived"]).optional(), sort: z.enum(["newest", "oldest"]).optional() })`.
7. `MediaAssetDto` gains `contentType: string | null`, `byteSize: number | null`, `createdAt: string | null` (ISO) — filled in `toMediaAssetDto` for both the list and the single GET.

**Tests (input → expected):**

- In-memory + use case: three assets A (oldest, "Beach.png", active), B ("logo.webp", archived), C (newest, "beach-2.jpg", active) → `{}` returns A,B,C; `{status:"active"}` → A,C; `{search:"BEACH"}` → A,C; `{sort:"newest"}` → C,B,A; `{sort:"newest", first:1}` → C with `endCursor` = C.id, then `{sort:"newest", first:1, after:C.id}` → B; another tenant's asset never appears.
- Route (in-process `createAdminHttpApi`, `crypto.randomUUID` ids, real `RoleTableAccessControl` with admin and viewer tokens, assets created through `POST /api/v1/media/uploads` with a tiny valid PNG — reuse the bytes helper in `services/media/src/application/upload-image.test.ts` if exported, else a 1×1 PNG literal in the test): viewer `GET /api/v1/media/assets?status=active&sort=newest` → 200, newest first, each item has `contentType: "image/png"`, `byteSize` > 0, `createdAt` ISO string; `?status=deleted` → 422 `VALIDATION`; `?search=` (empty) → 422.
- Mapper/Prisma: if a `DATABASE_URL_TEST`-gated suite exists for library repositories (`prisma-library-repositories.integration.test.ts`), add one gated case for `search` + `status` + `sort:"newest"`.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/media exec vitest run` → all pass
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run media` → all pass
- `… --filter @platform/media exec tsc --noEmit --incremental false` and `… --filter @platform/admin exec tsc --noEmit --incremental false` (same prefix) → exit 0

**Do NOT:** add folder features, change upload, change the folders list, add a migration.

**Amendments (binding) — Plan review 1, Task 1 (the amendment wins over the task text above)**

_Plan review 1, finding 3 — route-test harness._ New file `apps/admin/src/http/media-library-list-routes.test.ts`. Copy the harness of `apps/admin/src/http/media-upload-routes.test.ts` (lines ~20–106): the literal `PNG` bytes, `recordingStorage()` (`persistent: true`, `exists`, `getDownloadUrl`, `put`), `publicMediaBaseUrl: BASE`, the in-memory cache, idempotency-key store, allow-all rate limiter, `InMemoryEventSerializer`, `InMemoryAuditTrail`, fixed clock. Differences: `accessControl: new RoleTableAccessControl()` and an authenticator mapping `"admin-token"` → `{ id: "staff-a", kind: "staff", roles: ["admin"] }` and `"viewer-token"` → `{ id: "staff-v", kind: "staff", roles: ["viewer"] }`; `idGenerator: { generate: () => crypto.randomUUID() }` (plain v4 UUIDs); no Prisma, no pinned tenant; each upload its own `Idempotency-Key` and `x-file-name` (`Beach.png`, `logo.png`, `beach-2.png`). Because v4 ids are random, never assume upload order: the expected order for `sort=newest` is the returned ids sorted DESCENDING as strings, and for the default the ids sorted ASCENDING. Cases: (a) viewer `GET /api/v1/media/assets?status=active&sort=newest` → 200, ids equal the sorted-desc list, every item has `contentType: "image/png"`, `byteSize: 29`, `createdAt` = `"2026-10-14T00:00:00.000Z"` (the fixed clock); (b) `?search=BEACH` → exactly the two `beach` names; (c) archive one through `POST /api/v1/media/assets/:id/archive` (admin) → `?status=active` omits it, `?status=archived` returns only it, no `status` returns all three; (d) `?first=1&sort=newest` then `&after=<endCursor>` → second-highest id; (e) tenant B (`x-tenant-id: t-2`) upload is absent from tenant A's list; (f) `?status=deleted` → 422 `VALIDATION`; `?search=` → 422; `?sort=size` → 422.
_Domain chronological oracle._ In-memory/use-case tests construct assets with fixed, monotonic UUIDv7 ids (e.g. `0190a000-0000-7000-8000-000000000001`, `…002`, `…003`) so `newest`/`oldest` assertions are deterministic.
_Gated Prisma case (unconditional deliverable)._ Add to `services/media/src/infrastructure/prisma-library-repositories.integration.test.ts` (gated on `DATABASE_URL_TEST` like its existing cases): `search` + `status` + `sort: "newest"` with `first: 1` and the `after` cursor. Report it as skipped when no test DB is available.

_Plan review 1, finding 2 — commands._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/media exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run media`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/media exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`

---

### Task 2 — Content > Files page (implementer: sonnet, UI-only)

**Goal:** Shopify's Files page at `/content/files`.

**Files:** `apps/admin-web/src/lib/api/media.ts` (+ test), `apps/admin-web/src/app/content/files/{page.tsx, actions.ts, actions.test.ts}`, `apps/admin-web/src/components/content/files/{files-toolbar.tsx, files-grid.tsx, files-table.tsx, files-upload-button.tsx, file-details-dialog.tsx, file-delete-dialog.tsx}` (+ tests), `components/navigation.ts` (+ test), `middleware.ts` (+ test), `messages/en.ts`, `messages/ar.ts`.

**API client (`lib/api/media.ts`, add):**

```ts
export interface MediaFileDto {
  id: string;
  name: string;
  status: string;
  contentType: string | null;
  byteSize: number | null;
  createdAt: string | null;
  image: { url: string; alt: string | null; width: number | null; height: number | null } | null;
}
export async function fetchMediaFilesPage(input: {
  first?: number;
  after?: string;
  search?: string;
  sort?: "newest" | "oldest";
}): Promise<ApiResult<Page<MediaFileDto>>>; // always sends status=active
export async function archiveMediaFile(
  mediaAssetId: string,
  idempotencyKey: string,
): Promise<ApiResult<{ mediaAssetId: string }>>; // POST /media/assets/:id/archive
```

Reuse unchanged: `uploadProductImage`, `updateMediaAlt`, `fetchMediaDownloadUrl`, and `prepareImage` (`lib/media/prepare-image.ts`). Follow the existing `ApiResult`/`Page` types and `sendAdmin*` helpers in `lib/api/client.ts`.

**Page:** URL state `?q=&sort=newest|oldest&view=grid|list&after=`; page size 50; "Next"/"Previous" like `app/content/page.tsx` (keep a `before` stack in the URL is NOT required: Previous = browser history link to the prior URL is not allowed; use the same cursor pattern the existing content list uses). Title "Files". Toolbar: search input "Search files" (submits `q`), sort select "Date added (newest first)" / "Date added (oldest first)", grid/list toggle, primary button "Upload files" (operator+ only; hidden for viewers, decided by the session role helper the existing pages use). Grid: square thumbnail (`image.url`, `alt`), file name, type and size under it; non-image → Lucide `FileIcon`. List: columns "File name", "Alt text", "Type", "Size", "Date added" (locale date). Empty state: "Upload and manage your files" + Upload button. Size formatting: `KB`/`MB` with one decimal.

**Upload:** `<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif">`; each file → `prepareImage` → server action `uploadFileAction(formData)` (same checks and outcome mapping as `uploadProductImageAction` in `app/products/actions.ts`, one fresh idempotency key per file); show per-file errors with the existing messages for `unavailable | too_large | unsupported | failed`; `revalidatePath("/content/files")` after every call that reached the API.

**File details dialog** (click a file): preview, name, type, size, date, "Alt text" textarea (≤512) saved through new action `updateFileAltAction(mediaAssetId, alt)` (calls `updateMediaAlt`, revalidates `/content/files`), "Copy link" (copies `image.url`), "Download" (calls `fetchMediaDownloadUrl` via an action, opens the URL), "Delete file" → delete dialog.

**Delete dialog** (G8): title "Delete file?", description "Products and pages that use this file will stop showing it. This can't be undone." Cancel focused first; confirm calls `archiveFileAction(mediaAssetId)` → `archiveMediaFile`, revalidates `/content/files`; 409 (already archived) shows "This file was already deleted."

**Navigation / middleware:** add `{ id: "content-files", label: (t) => t.nav.files, href: "/content/files", Icon: ImageIcon }` as the FIRST child of the `content` item (before Menus). Middleware: add `["/content/files", "viewer"]` BEFORE `["/content", "operator"]`. Tests: viewer may open `/content/files`; viewer still redirected from `/content/new`; navigation test asserts Content children order Files, Menus.

**Tests:** client (query string built with `status=active`, `sort`, `search`, encoding of the id in the archive path); actions (revalidate on ok AND on API error; 8 MiB guard; alt length); grid/table render (bdi on names, KB/MB formatting, non-image icon, Arabic render); viewer sees no Upload/Delete; delete dialog contract (focus Cancel, Escape, focus returns); upload with two files calls the action twice with different idempotency keys.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run files media navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`

**Amendments (binding) — Plan review 1, Task 2 (the amendment wins over the task text above)**

_Plan review 1, finding 1 — client contract (`lib/api/media.ts`)._

```ts
export interface MediaFileDto {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly contentType: string | null;
  readonly byteSize: number | null;
  readonly createdAt: string | null;
  readonly image: {
    readonly url: string;
    readonly alt: string | null;
    readonly width: number | null;
    readonly height: number | null;
  } | null;
}
export interface MediaFilesPage {
  readonly items: readonly MediaFileDto[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}
export function isMediaFilesPage(value: unknown): value is MediaFilesPage; // checks every field type
export async function fetchMediaFilesPage(input: {
  readonly first?: number;
  readonly after?: string;
  readonly search?: string;
  readonly sort?: "newest" | "oldest";
}): Promise<ApiResult<MediaFilesPage>>;
//   getAdminApi(`/api/v1/media/assets?${params}`, isMediaFilesPage); params always has status=active, first defaults to 50
export async function archiveMediaFile(
  mediaAssetId: string,
  idempotencyKey: string,
): Promise<MutationResult<{ readonly mediaAssetId: string }>>;
//   mutateAdminApi(`/api/v1/media/assets/${encodeURIComponent(mediaAssetId)}/archive`, { method: "POST", idempotencyKey }, isArchivedDto)
```

`ApiResult`, `MutationResult`, `getAdminApi`, `mutateAdminApi` come from `@/lib/api/client`. Archive outcome mapping in the action: `conflict` with `code === "BUSINESS_RULE"` → "This file was already deleted."; `conflict` with any other code (idempotency contention) → the generic conflict text `t.formErrors.conflict`; `not_found` → `t.formErrors.notFound`; `forbidden` → `t.formErrors.forbidden`; `error` → `t.formErrors.unexpected`. `uploadProductImage`, `updateMediaAlt`, `fetchMediaDownloadUrl` stay unchanged.

_Plan review 1, finding 4 — roles._ `app/content/files/page.tsx` computes `const role = highestRole((await readSession())?.roles ?? []); const canEdit = role === "operator" || role === "admin";` (imports from `@/lib/auth/session`, same as `app/settings/policies/page.tsx`) and passes `canEdit: boolean` to `FilesToolbar`, `FilesGrid`, `FilesTable` and `FileDetailsDialog`. When `canEdit` is false: no "Upload files" button, no empty-state Upload button, alt text shown read-only (no Save), no "Delete file", no "Download" (signed download needs `media_library:get_download_url`, which viewers lack); "Copy link" stays. Unknown role (`undefined`) = viewer. Tests: viewer and unknown role render none of those controls (query `document.body`, including inside the open details dialog); operator renders all of them.

_Plan review 1, finding 5 — pagination._ URL params `q`, `sort`, `view`, `after`, `stack`. Copy the algorithm of `components/content/content-pagination.tsx` into `components/content/files/files-pagination.tsx`: Next pushes the current `after` (or `""`) onto the comma-separated `stack` and sets `after=endCursor`; Previous pops the last stack entry into `after` (deletes `after` when it is `""`, deletes `stack` when empty). Both keep `q`, `sort`, `view`. Submitting a new `q` or changing `sort` deletes `after` and `stack`; toggling `view` keeps them. No backward repository pagination. Tests: three pages (Next, Next, Previous, Previous returns to page 1 with no `after`/`stack`), a deep link with `after`+`stack` renders the right Previous target, a new search and a sort change reset to page 1, a view toggle keeps the page.

_Plan review 1, finding 11 — existing navigation oracles._ In `components/navigation.test.tsx`: the assertion that Content's children are exactly `["online-store-navigation"]` (~line 170–174) becomes `["content-files", "online-store-navigation"]`; the assertion that child index 0 is Menus in both languages (~line 209–213) looks Menus up by id `online-store-navigation` instead of by index, and adds Files = `en.nav.files` / `ar.nav.files`. Keep the Online Store exclusion and current-route assertions unchanged.

_Plan review 1, finding 2 — commands._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run files media navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`

---

### Task 3 — Identity: customer profile fields, note, tags, SMS marketing, create/update use cases (implementer: terra)

**Migration** `packages/db/prisma/schema/migrations/20261124000000_customer_profile_tags/migration.sql` (header comment in the house style of `20261018010000_order_notes_tags_timeline`: hand-written, NOT applied by the agent, owner deploys before the release, additive only):

```sql
ALTER TABLE "identity"."customers" ADD COLUMN "phone" TEXT;
ALTER TABLE "identity"."customers" ADD COLUMN "language" TEXT;
ALTER TABLE "identity"."customers" ADD COLUMN "note" TEXT;
ALTER TABLE "identity"."customers" ADD CONSTRAINT "customers_language_check" CHECK ("language" IS NULL OR "language" IN ('en','ar'));
CREATE TABLE "identity"."customer_tags" (
  "tenant_id" TEXT NOT NULL, "customer_id" UUID NOT NULL, "tag" TEXT NOT NULL, "tag_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customer_id", "tag_key"));
CREATE INDEX "customer_tags_tenant_id_tag_key_idx" ON "identity"."customer_tags"("tenant_id", "tag_key");
ALTER TABLE "identity"."customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "identity"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- + ENABLE / FORCE ROW LEVEL SECURITY and the tenant_isolation policy, copied from order_tags.
```

Prisma `identity.prisma`: `Customer` gains `phone String?`, `language String?`, `note String?`, `tags CustomerTag[]`; new `model CustomerTag { tenantId @map("tenant_id"), customerId @map("customer_id") @db.Uuid, tag, tagKey @map("tag_key"), createdAt @default(now()) @map("created_at"), customer relation onDelete: Cascade; @@id([customerId, tagKey]); @@index([tenantId, tagKey]); @@map("customer_tags"); @@schema("identity") }`. The schema↔migration consistency test (`packages/db`) must stay green.

**Domain (`services/identity/src/domain`):**

- `value-objects/phone.ts`: `Phone.create(raw: string): Result<Phone, ValidationError>` — trim, remove spaces, `-`, `(`, `)`, `.`; must then match `/^\+?[0-9]{7,15}$/`, else `ValidationError("Invalid phone", [{ field: "phone", message: "must be 7 to 15 digits, optionally starting with +" }])`. `value` getter = normalized string.
- `value-objects/customer-language.ts`: `type CustomerLanguage = "en" | "ar"`, `isCustomerLanguage(v: unknown): v is CustomerLanguage`.
- `value-objects/consent-scope.ts`: add `"marketing_sms"` to `ConsentScopeValue` and `ALLOWED`.
- `customer-annotations.ts` (new): copy VERBATIM from `services/orders/src/domain/order-tags.ts` the behaviour of `normalizeTag`, `tagKeyOf`, `parseTags`, `normalizeNote`, `sortTags`, `characterCount`, with constants `MAX_TAG_LENGTH = 40`, `MAX_TAGS_PER_CUSTOMER = 250`, `MAX_NOTE_LENGTH = 5000`, type `CustomerTag { tag: string; tagKey: string }` (rename Order→Customer only). Also the port:
  ```ts
  export interface CustomerAnnotations {
    readonly note: string | null;
    readonly tags: readonly string[];
  }
  export interface CustomerAnnotationRepository {
    annotationsOf(
      customerIds: readonly string[],
      tenantId: string,
      tx?: unknown,
    ): Promise<ReadonlyMap<string, CustomerAnnotations>>; // every requested existing id present; unknown ids absent
    setNote(
      customerId: string,
      note: string | null,
      tenantId: string,
      tx?: unknown,
    ): Promise<boolean>; // false = no such (non-deleted) customer
    replaceTags(
      customerId: string,
      tags: readonly CustomerTag[],
      tenantId: string,
      tx?: unknown,
    ): Promise<readonly string[] | null>; // null = no such customer; else the stored tags, sorted
  }
  ```
  Note and tags are NOT part of the `Customer` aggregate (same reason as orders: they never bump `version`).
- `customer.ts`: props gain `phone: string | null`, `language: CustomerLanguage | null`; `reconstitute(...)` gains two LAST optional params `phone: string | null = null, language: CustomerLanguage | null = null`; getters `phone`, `language`; new method `updateProfile(changes: { name?: string; phone?: string | null; language?: CustomerLanguage | null }): void` (sets only provided keys; raises no event — documented like `upgradeFromGuest`). `register`/`registerGuest` start with `phone: null, language: null`.

**Infrastructure:** `customer.mapper.ts` writes/reads `phone`, `language` (`toCustomerRow`, `toDomain`); `prisma-customer-repository.ts` update `data` adds `phone`, `language`; in-memory customer repo keeps them. New `prisma-customer-annotation-repository.ts` (note via `customer.updateMany({ where: { id, tenantId, deletedAt: null }, data: { note } })` — no version bump; tags via delete-all + `createMany` inside the caller's tx, or `runReadScoped`/a scoped transaction when no tx is given, mirroring the orders annotation repository) and `in-memory-customer-annotation-repository.ts` (constructed with the in-memory customer repository so it can tell whether a customer exists). Wire both in `services/identity/src/composition.ts` (`IdentityRepos.customerAnnotations`) for the Prisma and in-memory branches.

**Use cases (`services/identity/src/application`), each `UseCase<Input, Output, DomainError>` returning `Result`:**

- `create-customer.use-case.ts` — `CreateCustomerInput { tenantId; name; email; phone?: string; language?: CustomerLanguage; note?: string; tags?: readonly string[]; marketingEmail?: boolean; marketingSms?: boolean }` → `{ customerId: string }`. Validate all fields FIRST (email via `Email.create`, name non-empty ≤255, phone via `Phone.create`, language, note via `normalizeNote`, tags via `parseTags` + ≤250) and return ONE `ValidationError` listing every failing field. Then in ONE `unitOfWork.run`: `findByEmail` → `ConflictError("A customer with this email already exists")`; `Customer.register`; `updateProfile({phone, language})`; for each of `marketingEmail`/`marketingSms` that is `true`, `changeConsent(scope "marketing" / "marketing_sms", true)`; `customers.save`; then `annotations.setNote` / `replaceTags` when given (same tx).
- `update-customer-profile.use-case.ts` — `UpdateCustomerProfileInput { tenantId; customerId; name?: string; phone?: string | null; language?: CustomerLanguage | null }` → `{ customerId }`. At least one key present else `ValidationError` field `body`. `null` clears. NOT_FOUND when missing. Saves through `customers.save` (version-checked).
- `set-customer-note.use-case.ts` — `{ tenantId; customerId; note: string | null }` → `{ customerId; note: string | null }` (empty/whitespace → null). NOT_FOUND when `setNote` returns false.
- `set-customer-tags.use-case.ts` — `{ tenantId; customerId; tags: readonly string[] }` → `{ customerId; tags: readonly string[] }` (replace the whole set; sorted, de-duplicated by key).
- `change-marketing-consent.use-case.ts` — `{ tenantId; customerId; email?: boolean; sms?: boolean }` → `{ customerId; email: boolean; sms: boolean }`. At least one key. In one UoW: for each provided channel whose current value (`consentFor`) differs, `changeConsent(...)`; unchanged values append nothing; save once.
- `get-customer-annotations.use-case.ts` — `{ tenantId; customerIds: readonly string[] (1..250) }` → `{ items: readonly { customerId: string; note: string | null; tags: readonly string[] }[] }` in input order, unknown ids omitted.
  Expose all six on `CustomerController` (`createCustomer` 201, others 200, via `present`) and from `services/identity/src/index.ts`. Existing `register` stays unchanged.

**Tests (input → expected):** Phone: `"010 1234-5678"` → `"01012345678"`; `"+20 (10) 1234 5678"` → `"+201012345678"`; `"12345"` → VALIDATION; `"abc1234567"` → VALIDATION. Create: full input → customer with phone/language, consent `marketing=true`, `marketing_sms` absent → `consentFor` false, note and sorted tags stored; duplicate email → CONFLICT and nothing written (annotations empty); invalid phone + empty name → ONE VALIDATION with both fields; 251 tags → VALIDATION. Update: `{phone:null}` clears; `{}` → VALIDATION; unknown id → NOT_FOUND; another tenant's id → NOT_FOUND. Note: `"  hi  "` → `"hi"`; `"   "` → null; 5001 chars → VALIDATION; does NOT change customer `version`. Tags: `["VIP", " vip ", "Cairo"]` → `["Cairo", "VIP"]`; replace removes old tags. Consent: `{email:true}` twice appends ONE record; `{sms:true}` emits `consent.changed` with scope `marketing_sms`; `ConsentScope.create("marketing_sms")` ok. Annotations: input order kept, unknown omitted, other tenant omitted. Security consent consumer accepts scope `marketing_sms` (existing consumer test file gets one case). Prisma suites: add gated (`DATABASE_URL_TEST`) cases to `prisma-customer-repository.integration.test.ts` for phone/language round-trip and annotation note/tags.

**Commands:**

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/identity exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec vitest run schema`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma validate` and `… --filter @platform/db exec prisma generate`
- `… --filter @platform/identity exec tsc --noEmit --incremental false`, `… --filter @platform/security exec vitest run consent`, `… --filter @platform/admin exec tsc --noEmit --incremental false` (same prefix) → exit 0
- Tenant-where guard: `cd "F:/New folder/morbeh-shopify-parity-w1b" && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"` → no new finding.

**Amendments (binding) — Plan review 1, Task 3 (the amendment wins over the task text above)**

_Plan review 1, finding 6 — constructors, transactions, controller._

- Adapters (exported from `services/identity/src/index.ts`): `PrismaCustomerAnnotationRepository` constructed with `{ prisma: Database }`; `InMemoryCustomerAnnotationRepository` constructed with `{ customers: Pick<CustomerRepository, "findById"> }` and holding its own `Map<string /* tenantId:customerId */, { note: string | null; tags: CustomerTag[] }>`.
- Prisma `setNote` and `replaceTags` REQUIRE the caller's tx (throw `Error("PrismaCustomerAnnotationRepository.<method> requires the unit of work's transaction client (ADR-0003).")` without it, same as `PrismaMediaAssetRepository.requireTx`); the existence check, delete, insert and read-back all use that same tx; never open a nested transaction. Only `annotationsOf` falls back to `runReadScoped` when no tx is given. Every query carries `tenantId`, and the parent check is `deletedAt: null`. A `customerId` that is not a UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) is treated as missing (false / null / absent) without querying.
- In-memory: `setNote`/`replaceTags` first call `customers.findById(customerId, tenantId)`; null → false / null.
- Use-case deps: `CreateCustomer { customers, annotations, unitOfWork, idGenerator, clock }`; `UpdateCustomerProfile { customers, unitOfWork }`; `SetCustomerNote { annotations, unitOfWork }`; `SetCustomerTags { annotations, unitOfWork }`; `ChangeMarketingConsent { customers, unitOfWork, idGenerator, clock }`; `GetCustomerAnnotations { annotations }`. Field types: `customers: CustomerRepository`, `annotations: CustomerAnnotationRepository`, `unitOfWork: TransactionalUnitOfWork<unknown>`, `idGenerator: IdGenerator`, `clock: Clock`. Each use case and its `*Input`/`*Output` type is exported from `services/identity/src/index.ts`.
- `CustomerControllerDeps` gains required `createCustomer`, `updateCustomerProfile`, `setCustomerNote`, `setCustomerTags`, `changeMarketingConsent`, `getCustomerAnnotations`. Controller methods (all `Promise<ControllerResponse>` via `present`): `createCustomer(input: CreateCustomerInput)` → 201; `updateCustomerProfile(input: UpdateCustomerProfileInput)`, `setCustomerNote(input: SetCustomerNoteInput)`, `setCustomerTags(input: SetCustomerTagsInput)`, `changeMarketingConsent(input: ChangeMarketingConsentInput)`, `customerAnnotations(input: GetCustomerAnnotationsInput)` → 200.
- Composition (`services/identity/src/composition.ts`): `IdentityRepos` gains `customerAnnotations: CustomerAnnotationRepository`. Prisma branch: `customerAnnotations: new PrismaCustomerAnnotationRepository({ prisma: deps.prisma })`. In-memory branch: bind `const customers = new InMemoryCustomerRepository({ outbox: outboxWriter, context });` first, then `customers` and `customerAnnotations: new InMemoryCustomerAnnotationRepository({ customers })` in the literal (same instance). `buildControllers` passes the six new use cases to the single `new CustomerController(...)`.
- Tests: `in-memory-customer-annotation-repository.test.ts` (tenant isolation, missing customer, replace semantics); use-case tests per file; `customer.controller.test.ts` gets one case per new method (status codes); gated `prisma-customer-repository.integration.test.ts` cases: phone/language round-trip, note/tags round-trip, soft-deleted customer → setNote false / replaceTags null, other tenant → same, `version` unchanged after note/tags, and a create whose annotation write fails (inject a failing annotations double into `CreateCustomer` against the real Prisma UoW) leaves NO customer row, consent rows or outbox row.

_Plan review 1, finding 7 — validation (application layer is the authority)._ New `services/identity/src/application/customer-input-validation.ts`:

```ts
export interface ProfileFields {
  readonly name?: string;
  readonly phone?: string | null;
  readonly language?: CustomerLanguage | null;
}
export function validateProfile(
  input: { name?: unknown; phone?: unknown; language?: unknown },
  mode: "create" | "update",
): {
  readonly value: ProfileFields;
  readonly issues: readonly { field: string; message: string }[];
};
```

Rules: `name` trimmed, required in create, optional in update; when present must be 1..255 code points after trim (issue field `name`); `null` name is an issue. `phone`: omitted = unchanged; `null` = clear (update only; create treats null as omitted); string → `Phone.create` (issue field `phone`); empty/whitespace string → clear (update) / omitted (create). `language`: omitted = unchanged; `null` = clear; else must be `"en"`/`"ar"` (issue field `language`). Create additionally validates `email` (`Email.create`, field `email`), `note` (`normalizeNote`, field `note`), `tags` (`parseTags`, field `tags`, 250 counted AFTER splitting and de-duplication). All issues are collected and returned as ONE `ValidationError("Invalid customer", issues)` BEFORE any repository call. Update with no key at all → issue `{ field: "body", message: "provide at least one field" }`. Copy `compareText` from `services/orders/src/domain/order-tags.ts` together with `sortTags` (same ordering). Code-point counting uses `characterCount` (copied).
Tests (use case): create and update with empty name, 256-code-point name, invalid phone, `language: "fr"` (all in one ValidationError where combined); update `{phone: null}` clears, `{phone: ""}` clears, omitted keeps; tags: 40 emoji accepted, `"  VIP  "` → `"VIP"`, `"a, b، c"` → three tags (Latin and Arabic commas), blanks dropped, 251 distinct after normalization → VALIDATION, 250 → ok; note of exactly 5000 code points (emoji) ok, 5001 → VALIDATION.

_Plan review 1, finding 8 — schema tests and consumer test._ Deliverables: (1) `packages/db/src/schema-migration-consistency.test.ts` gains an `identity customer profile and tags (20261124000000)` describe block, modelled on its order note/tags block (~lines 377–436): `customers.phone/language/note` are nullable TEXT; `customers_language_check` allows NULL/en/ar; `customer_tags` columns, types, `created_at` default, PK `(customer_id, tag_key)`, index `(tenant_id, tag_key)`, FK to `identity.customers(id)` ON DELETE CASCADE, ENABLE + FORCE RLS, and the full `USING`/`WITH CHECK` predicate `tenant_id = current_setting('app.tenant_id', true)`. (2) Prisma model, exactly:

```prisma
model CustomerTag {
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id") @db.Uuid
  tag        String
  tagKey     String   @map("tag_key")
  createdAt  DateTime @default(now()) @map("created_at")
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@id([customerId, tagKey])
  @@index([tenantId, tagKey])
  @@map("customer_tags")
  @@schema("identity")
}
```

(3) `services/security/src/infrastructure/consent-projection.test.ts`: deliver `marketing_sms` grant then revoke events; assert `marketing_sms` changes independently of `marketing`; assert tenant B cannot read tenant A's grant.

_Plan review 1, finding 12 — serialized tag replacement._ Prisma `replaceTags`, inside the required tx, first lock the parent row with a parameterized tagged template:

```ts
const locked = await client.$queryRaw<
  { id: string }[]
>`SELECT "id" FROM "identity"."customers" WHERE "id" = ${customerId}::uuid AND "tenant_id" = ${tenantId} AND "deleted_at" IS NULL FOR UPDATE`;
```

no row → return `null` without touching tags. Then `customerTag.deleteMany({ where: { tenantId, customerId } })`; when `tags.length > 0`, `customerTag.createMany({ data: tags.map(...) })` (skip the call for an empty set); then `customerTag.findMany({ where: { tenantId, customerId } })` → `sortTags(rows.map(r => r.tag))`. `customers.version` is never touched. Gated tests: two concurrent replacements starting from zero tags and from existing tags end with exactly one submitted set (never the union); a forced insert failure (duplicate tagKey injected through a test double of the tag list) rolls back to the previous set.

_Plan review 1, finding 2 — commands._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/identity exec vitest run`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec vitest run schema-migration-consistency`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/security exec vitest run consent-projection`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/identity exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`
- `cd "F:/New folder/morbeh-shopify-parity-w1b/packages/db" && DATABASE_URL="postgresql://u:p@localhost:5432/x" DIRECT_URL="postgresql://u:p@localhost:5432/x" node node_modules/prisma/build/index.js validate` → "The schemas at prisma\schema are valid"
- `cd "F:/New folder/morbeh-shopify-parity-w1b/packages/db" && node node_modules/prisma/build/index.js generate` → exit 0
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"` → no new finding

---

### Task 4 — Customers admin API (implementer: sonnet; backend)

**Files:** `apps/admin/src/interfaces/customers.admin-controller.ts` (+ test), new `apps/admin/src/http/customer-routes.ts` (+ `customer-routes.test.ts`), registration in `apps/admin/src/http/admin-routes.ts` (spread next to the existing customer routes; keep `GET /customers` and `GET /customers/:customerId` where they are but extend the detail DTO), `apps/admin/src/composition.ts` only if the controller deps change.

**Controller methods (each guards first):** `createCustomer` (`customers:register`), `updateCustomerProfile` (`customers:update`), `setCustomerNote` (`customers:update`), `setCustomerTags` (`customers:update`), `changeMarketingConsent` (`customers:change_consent`), `customerAnnotations` (`customers:read`), `exportCustomers` (`customers:export`; calls identity `listCustomers` then `customerAnnotations` for the page).

**Routes (all `version: 1`, tenant from context):**

- `POST /customers` body `{ name: z.string().trim().min(1).max(255), email: z.string().trim().min(3).max(320), phone?: z.string().trim().min(1).max(32), language?: z.enum(["en","ar"]), note?: z.string().max(5000), tags?: z.array(z.string().min(1).max(40)).max(250), marketingEmail?: z.boolean(), marketingSms?: z.boolean() }.strict()`, idempotent → 201 `{ customerId }`; duplicate email → 409 `CONFLICT`.
- `POST /customers/:customerId` body `{ name?, phone?: string | null, language?: "en" | "ar" | null }.strict()` with a zod `refine` requiring ≥1 key → 200 `{ customerId }`.
- `POST /customers/:customerId/note` `{ note: z.string().max(5000).nullable() }` → 200 `{ customerId, note }`.
- `POST /customers/:customerId/tags` `{ tags: z.array(z.string().min(1).max(40)).max(250) }` → 200 `{ customerId, tags }`.
- `POST /customers/:customerId/marketing-consent` `{ email?: z.boolean(), sms?: z.boolean() }` refine ≥1 → 200 `{ customerId, email, sms }`.
- `GET /customers/export-rows` query `{ first?: 1..100 (default 100), after?, search? }` → 200 `{ items: CustomerExportRowDto[], pageInfo }` where `CustomerExportRowDto = { id; name; email; phone: string | null; language: "en" | "ar" | null; emailMarketing: boolean; smsMarketing: boolean; tags: readonly string[]; note: string | null; isGuest: boolean; address: { line1; city; postalCode; country } | null }` (first address). Register it BEFORE `/customers/:customerId`.
- Extend `CustomerDetailDto` (existing `GET /customers/:customerId`) with `phone`, `language`, `isGuest`, `note`, `tags`, `marketing: { email: boolean; sms: boolean }` (note/tags from `customerAnnotations`; a failed annotations read → the route returns that error response, not partial data).

**Tests (in-process, real `RoleTableAccessControl`, admin + operator + viewer tokens, `crypto.randomUUID`, own Idempotency-Key per POST):** create → 201, then detail shows every field; duplicate email → 409; invalid phone → 422 with field `phone`; unknown key in body → 422; viewer POST → 403 on every write route; operator may write; update `{}` → 422; tags replace; consent `{sms:true}` → `{email:false, sms:true}`; note clear with `null`; export-rows first page of 2 with `endCursor`, second page, `search` filter, viewer → 403 (no `customers:export`), operator → 200; another tenant's customer id → 404 on every `:customerId` route. Re-run `admin-http.e2e` and the existing customer route tests.

**Commands:** `… --filter @platform/admin exec vitest run customer admin-http.e2e` and `… --filter @platform/admin exec tsc --noEmit --incremental false` (prefix as in Task 1).

**Amendments (binding) — Plan review 1, Task 4 (the amendment wins over the task text above)**

_Plan review 1, finding 7 — transport schemas validate structure only; the application enforces semantic limits._ Replace the Task 4 body schemas with:

- create `z.object({ name: z.string().max(1000), email: z.string().max(320), phone: z.string().max(64).optional(), language: z.enum(["en","ar"]).optional(), note: z.string().max(20000).optional(), tags: z.array(z.string().max(400)).max(1000).optional(), marketingEmail: z.boolean().optional(), marketingSms: z.boolean().optional() }).strict()`
- profile `z.object({ name: z.string().max(1000).optional(), phone: z.string().max(64).nullable().optional(), language: z.enum(["en","ar"]).nullable().optional() }).strict()` (no refine: the use case reports an empty body as field `body`)
- note `z.object({ note: z.string().max(20000).nullable() }).strict()`; tags `z.object({ tags: z.array(z.string().max(400)).max(1000) }).strict()`; consent `z.object({ email: z.boolean().optional(), sms: z.boolean().optional() }).strict()` (empty body → use case VALIDATION field `body`).
- Params: `customerIdParams` reused as is.
  HTTP tests add: 40 emoji tag → 200; `"  VIP  "` stored `"VIP"`; `["a, b، c"]` → three tags; 251 distinct tags → 422 field `tags`; name of 256 code points → 422 field `name`; `{}` profile → 422 field `body`; unknown key → 422.

_Registration._ Spread `...customerRoutes(admin)` immediately BEFORE the existing `GET /customers` definition in `apps/admin/src/http/admin-routes.ts` (~line 1692), so `GET /customers/export-rows` precedes `GET /customers/:customerId`; the existing GET definitions keep their relative order. Harness: copy `apps/admin/src/http/collections-routes.test.ts` (~lines 42–75: injected `RoleTableAccessControl`, admin/operator/viewer tokens, `crypto.randomUUID`, no pinned tenant) into `customer-routes.test.ts`.

_Plan review 1, finding 10 (Task 4 part)._ No timezone or settings read is added (see Task 5 amendment).

_Plan review 1, finding 2 — commands._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run customer admin-http.e2e`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`

**Amendments round 2 (binding) — Plan review 2, finding R7 (wins over Task 4's round-1 block)**

- The `tags` member of BOTH the create body and the tags body is `tags: z.array(z.string())` (create: `.optional()`), with no `.max()` on the array or on each string. The shared HTTP body-size limit still applies. Per-tag length (40 code points after normalization) and the 250-tag limit counted AFTER comma splitting and de-duplication are enforced only by the application (`parseTags` in Task 3), which answers 422 `VALIDATION` field `tags`.
- Added HTTP oracle (create and tags routes): `tags: [Array.from({ length: 100 }, (_, i) => `tag${String(i).padStart(3, "0")}`).join(", ")]` (one raw string of 798 UTF-16 units holding 100 distinct 6-character tags) → 201 / 200 and the stored tags are those 100, sorted. Keep the 40-emoji, padded, Latin/Arabic comma and 251-distinct cases.

---

### Task 5 — Customers UI: add, edit, tags, note, marketing, export (implementer: sonnet, UI-only)

**Files:** `apps/admin-web/src/lib/api/customers.ts` (+ test), `app/customers/new/page.tsx`, `app/customers/actions.ts` (+ test), `app/customers/export/route.ts` (+ test), `lib/customers/customers-csv.ts` (+ test), components under `components/customers/` (`customer-form.tsx`, `customer-overview-card.tsx` (edit dialog), `customer-note-card.tsx`, `customer-tags-card.tsx`, `customer-marketing-card.tsx`, `customers-export-dialog.tsx`), `app/customers/page.tsx` (header buttons "Export" and "Add customer"), `app/customers/[customerId]/page.tsx` (new cards), `middleware.ts` (+ test), `messages/en.ts`, `messages/ar.ts`.

**Behaviour (Shopify labels):**

- List header: "Export" (opens dialog: "Current search" / "All customers", button "Export customers") and primary "Add customer" (operator+ only; hidden for viewers).
- `/customers/new` "New customer": fields "Name", "Email", "Phone number", "Language" (English/العربية), checkboxes "Customer agreed to receive marketing emails." and "Customer agreed to receive SMS marketing text messages.", "Notes", "Tags" (comma-separated input that shows chips). Save → `createCustomerAction` → redirect to the new customer; field errors from 422 shown under each field; 409 → "A customer with this email already exists."
- Detail page: overview card with "Edit" (dialog: name, phone, language; email shown read-only with a note "Email can't be changed yet"); "Notes" card with edit; "Tags" card with add/remove chips (save replaces the set); "Marketing" card: "Email subscribed"/"Not subscribed" and "SMS subscribed"/"Not subscribed" with toggles → `changeMarketingConsentAction`. The existing consent card stays but shows `marketing` as "Email marketing" and `marketing_sms` as "SMS marketing".
- Every action revalidates `/customers` and `/customers/<id>` after every API-reaching call (G8).
- Export route `GET /customers/export?scope=all|search&q=` pages `GET /customers/export-rows` 100 at a time, cap 5,000 rows / 60 requests (reuse the shape of `lib/orders/orders-export.ts`), builds CSV with `csvCell`/`guardCell` from `lib/orders/orders-csv.ts` (BOM, CRLF, formula-injection guard), columns: Name, Email, Phone, Language, Email marketing, SMS marketing, Tags, Note, Address, City, Postal code, Country, Guest — headers from the dictionary; filename `customers_export_<shop-local date>.csv`; over the cap / failure → redirect `/customers?exportError=too_many|failed`.
- Middleware: `["/customers/new", "operator"]` before the customers entry; export route requires `customers:export` server-side (the API answers 403 for viewers → redirect `failed`).

**Tests:** client functions (paths, bodies, encoding); actions (revalidate on ok and error; 422 field mapping; 409 message); form (Arabic render, bdi, tag chips de-dupe case-insensitively); detail cards (viewer sees no edit controls; edit dialog focus rules); export (CSV header row Arabic + English, BOM, a `=SUM(1)` name is guarded, phone-shaped value not guarded, cap → redirect); middleware cases (viewer redirected from `/customers/new`, operator allowed).

**Commands:** `… --filter admin-web exec vitest run customers middleware navigation --maxWorkers=1 --minWorkers=1 --no-file-parallelism` and `… --filter admin-web exec tsc --noEmit --incremental false` (prefix as in Task 1).

---

**Amendments (binding) — Plan review 1, Task 5 (the amendment wins over the task text above)**

_Plan review 1, finding 9 — client exports (`lib/api/customers.ts`)._ Keep `fetchCustomersPage`/`fetchCustomer` and their outcome shapes. Extend `CustomerDetailDto` and `isCustomerDetailDto` with `phone: string | null`, `language: "en" | "ar" | null`, `isGuest: boolean`, `note: string | null`, `tags: readonly string[]`, `marketing: { email: boolean; sms: boolean }`. Add (all writes via `mutateAdminApi` with `method: "POST"` and the given `idempotencyKey`; ids through `encodeURIComponent`):

```ts
export interface CreateCustomerBody {
  name: string;
  email: string;
  phone?: string;
  language?: "en" | "ar";
  note?: string;
  tags?: readonly string[];
  marketingEmail?: boolean;
  marketingSms?: boolean;
}
export function createCustomer(
  body: CreateCustomerBody,
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string }>>; // /api/v1/customers
export function updateCustomerProfile(
  customerId: string,
  body: { name?: string; phone?: string | null; language?: "en" | "ar" | null },
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string }>>; // /api/v1/customers/:id
export function setCustomerNote(
  customerId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; note: string | null }>>; // /note
export function setCustomerTags(
  customerId: string,
  tags: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; tags: readonly string[] }>>; // /tags
export function changeMarketingConsent(
  customerId: string,
  body: { email?: boolean; sms?: boolean },
  idempotencyKey: string,
): Promise<MutationResult<{ customerId: string; email: boolean; sms: boolean }>>; // /marketing-consent
export interface CustomerExportRowDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  language: "en" | "ar" | null;
  emailMarketing: boolean;
  smsMarketing: boolean;
  tags: readonly string[];
  note: string | null;
  isGuest: boolean;
  address: { line1: string; city: string; postalCode: string; country: string } | null;
}
export interface CustomerExportPage {
  items: readonly CustomerExportRowDto[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
export function fetchCustomerExportPage(query: {
  first?: number;
  after?: string;
  search?: string;
}): Promise<ApiResult<CustomerExportPage>>; // GET /api/v1/customers/export-rows
```

Each has a type guard checking every field.

_Server actions (`app/customers/actions.ts`, `"use server"`, dictionary from the locale cookie like `app/collections/actions.ts`):_

- `createCustomerAction(prev: FormState, formData: FormData): Promise<FormState>` — fields `name`, `email`, `phone`, `language` (`""` = omitted), `note`, `tags` (raw text; sent as `[raw]` when non-blank, the server splits commas), `marketingEmail`, `marketingSms` (checkbox `"on"`). New key per submit. ok → `revalidatePath("/customers")`, `revalidatePath(`/customers/${result.data.customerId}`)`, `redirect(`/customers/${result.data.customerId}`)`. Not ok → `revalidatePath("/customers")`, then: `conflict` whose message is exactly `"A customer with this email already exists"` → `{ status: "error", message: t.customerForm.duplicateEmail, fieldErrors: { email: t.customerForm.duplicateEmail } }`; anything else → `toFormState(result, t.formErrors)`.
- `updateCustomerProfileAction(customerId: string, prev: FormState, formData: FormData)` (bound with `.bind(null, id)`), fields `name`, `phone` (`""` → `null`), `language` (`""` → `null`).
- `setCustomerNoteAction(customerId: string, prev: FormState, formData: FormData)`, field `note` (`""` → `null`).
- `setCustomerTagsAction(customerId: string, tags: readonly string[]): Promise<FormState>`.
- `changeMarketingConsentAction(customerId: string, channel: "email" | "sms", subscribed: boolean): Promise<FormState>`.
  Every action except create revalidates `/customers` and `/customers/<id>` after EVERY outcome that reached the API, then returns `toFormState(result, t.formErrors)`. Tests: `app/customers/actions.test.ts` (each action: ok and error both revalidate; 422 fields reach `fieldErrors`; duplicate-email mapping; idempotency-key contention 409 keeps the generic message), `lib/api/customers.test.ts` (paths, encoding, bodies, guards).

_Plan review 1, finding 4 — roles._ `app/customers/page.tsx` and `app/customers/[customerId]/page.tsx` compute `canEdit` exactly as in Task 2's amendment, plus `canExport = canEdit` (operator/admin hold `customers:export`). Props: `CustomersHeader { canEdit, canExport }`, `CustomerOverviewCard`, `CustomerNoteCard`, `CustomerTagsCard`, `CustomerMarketingCard` each take `canEdit: boolean`. Viewer / unknown role: no "Add customer", no "Export", no Edit, no note/tag mutation, consent toggles rendered as read-only text. Tests query `document.body`.

_Plan review 1, finding 10 — export filename._ The requirement changes: the attachment is named `customers_export.csv` (Shopify's own export name); no timezone read, no `storeSettingsOrDefaults`. Response headers `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="customers_export.csv"`, `cache-control: no-store`. Collect with a customer-specific collector in `lib/customers/customers-export.ts` (`CUSTOMER_EXPORT_PAGE_SIZE = 100`, `CUSTOMER_EXPORT_ROW_CAP = 5000`, `MAX_CUSTOMER_EXPORT_REQUESTS = 60`) modelled on `collectExportRows`; any failed page or a malformed row → redirect `/customers?exportError=failed` (303), more than 5000 rows → `?exportError=too_many`; never a partial file.

_Plan review 1, finding 11 — consent card._ Add `components/customers/customer-consent-card.tsx` and `customer-consent-card.test.tsx` to the deliverables: scope `marketing` renders `t.customerDetail.consentScopes.marketing` ("Email marketing" / "التسويق عبر البريد الإلكتروني"), `marketing_sms` renders `consentScopes.marketingSms` ("SMS marketing" / "التسويق عبر الرسائل القصيرة"), any other scope renders its raw name inside `<bdi>`. Update every existing render of the changed components with the new required props.

_Plan review 1, finding 2 — commands._

- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run customers middleware navigation --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
- `cd "F:/New folder/morbeh-shopify-parity-w1b" && export pnpm_config_verify_deps_before_run=false; node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`

## Execution order

Task 1 → Task 2 (consumes Task 1's DTO) → Task 3 → Task 4 (consumes Task 3) → Task 5 (consumes Task 4). Each task: implement → Sol review → Opus acceptance. Then whole-branch review, push, PR, merge after green CI (owner's standing go-ahead).
