# Product Images Like Shopify (Plan 2C-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** صور المنتجات زي شوبيفاي.
>
> **في لوحة التحكم:**
>
> - كارت **"الوسائط"** في صفحة المنتج: **اسحب الصور وارميها** أو دوس "رفع". ممكن ترفع كذا صورة مرة واحدة.
> - **أول صورة هي الصورة الرئيسية** (كبيرة). رتّب الصور بالسحب.
> - دوس على أي صورة: تشوفها كبيرة، وتكتب **"نص بديل"** (لجوجل وللمكفوفين)، أو تمسحها.
> - كل مقاس/لون ممكن يكون له **صورة** (من شاشة تعديل المقاس).
> - الصور بتظهر كمان في **قايمة المنتجات** وفي **صفحة الطلب**.
>
> **في المتجر:**
>
> - صفحة المنتج فيها **معرض صور** (صورة كبيرة وصور صغيرة تحتها)، ولما العميل يختار لون/مقاس ليه صورة، الصورة الكبيرة بتتغير.
> - الصور بتظهر في **كروت المنتجات** و**السلة** و**صفحة الدفع**.
>
> **التخزين:** على **Supabase Storage**، اللي إنت عندك حسابه أصلاً، فمفيش حساب جديد ولا كارت. الصورة بتتصغّر في المتصفح قبل الرفع (أقصى 2048 بكسل)، فالرفع بيبقى سريع والتخزين قليل.
>
> **محتاج منك:** خطوات بسيطة في Supabase وRailway، هشرحها لك خطوة خطوة بعد ما Sonnet يخلّص.
>
> **فيه migration واحدة** (أبعاد الصورة والنص البديل).

**Goal:** The merchant uploads, orders, describes and deletes product images like in Shopify. The storefront shows them on the product page (with variant images), product cards, the cart and checkout. The admin shows thumbnails in the product list and on order lines.

**Architecture:**

- **Storage: Supabase Storage through its S3-compatible endpoint.**
  - It uses the existing `@platform/storage` S3 client and the existing env (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`, `S3_BUCKET_MEDIA=media`), plus **one new** variable, `MEDIA_PUBLIC_BASE_URL`.
  - The bucket is **public-read**, like Shopify's CDN. Images are served at `${MEDIA_PUBLIC_BASE_URL}/${storageKey}` with `Cache-Control: public, max-age=31536000, immutable`, because keys are unique and never overwritten.
  - **No signed URLs for images:** signed URLs expire, and expired URLs break caches and pages.
- **Upload path: browser → admin-web server action → runtime → storage.** No direct browser-to-storage PUT, so there is no CORS setup and the credentials never leave the server.
  1. **In the browser:** the image is decoded and re-encoded (canvas → WebP, quality 0.85, longest side at most 2048 px; PNGs with transparency stay WebP, which keeps alpha). That **also strips EXIF/GPS**. GIFs are uploaded as-is (animation).
  2. **The server action** forwards the bytes to the runtime `POST /media/uploads` (raw body, `Content-Type: image/*`, at most 8 MB).
  3. **The runtime:**
     - checks the **magic bytes** (JPEG, PNG, WebP, GIF only; **never SVG**);
     - reads the width and height from the header (pure parsers, no native deps);
     - writes the object under the tenant-prefixed key policy (`tenant-prefixed-key-policy.ts`), as `products/<uuid>.<ext>`;
     - registers a `MediaAsset`;
     - returns `{ id, url, width, height, alt }`.
  - **When storage is not configured**, the route returns `503` with "Image storage isn't set up yet." and the admin shows it. No stub ever pretends to store.
- **Data.**
  - `media.media_assets` gains `content_type`, `byte_size`, `width`, `height` and `alt` (the migration).
  - **Product media:** the existing `Product.mediaRefs` (an ordered list; the first is featured) and its existing attach / detach / reorder routes.
  - **Variant image:** the existing `ProductVariant.mediaRef`. It must be one of the product's media, and is cleared when that media is detached.
  - **Alt text** lives on the media asset (Shopify: alt per media), at most 512 characters.
- **Reading images.** The `apps/admin` route handlers resolve `mediaRefs` to `{ id, url, alt, width, height }` with **one batched** `media_assets` read per response (a new tenant-scoped `findByIds`).
  - **Admin product detail:** `media[]`, and each variant's `imageId`.
  - **Admin product list:** `featuredImage` per row.
  - **Public product by slug:** `media[]`, and the variants' `imageId`.
  - **Public product lists:** `featuredImage`.
  - **Admin order detail:** each item's image is the variant image, else the product's featured image, resolved at read time. A product deleted since the order shows the placeholder.
  - Cart and checkout DTOs: a line `imageUrl`, resolved the same way.
  - **No N+1:** each list does one batch.

**Tech Stack:** TypeScript, Prisma 6 (no upgrade), zod, vitest, Next.js 15, React 19, `@platform/ui`, `@platform/storage`.

**Spec:**

- Owner, Plan 2B-2 onward: "زي شوبيفاي"; earlier screenshot of the "Media" card with "Asset ID / Attach".
- The agreed decision: Supabase Storage (no new account, no card).

## Global Constraints

Same as Plans 3A–3C. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. **Never touch the lint warning cap.**
- Never stage `.claude/worktrees/`.
- Never use `git stash`, `git add -A`, `git add .` or `git add -N`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Check `git diff --cached --stat` before every commit. Run prettier only on files you changed.

### Database

- **Never connect to any database.**
- **Never set `TENANT_MODE=multi`.**
- **No guard exemptions.**
- **Do not upgrade Prisma.**
- **Push order:**
  - Task 1 (the SQL only) is pushed alone.
  - The rest stays local until the owner confirms the migration (the final task).

### Secrets

- **Never print, log or commit** any S3 key, secret, endpoint with credentials, or Supabase project ref.
- Env examples get **empty** placeholders only.
- Tests use fake values.

### Security

- **Security assertions from all earlier plans stay unchanged.**
- **Uploads:**
  - staff only (`products:update`);
  - at most 8 MB;
  - magic-byte checked;
  - SVG and anything else refused.
- **Keys** are tenant-prefixed. A tenant can never attach or read another tenant's asset: the batched read is tenant-scoped, and attach checks that the asset belongs to the tenant (add that check if missing).
- **Public DTOs** expose only `url`, `alt`, `width` and `height`, never storage keys or internal ids beyond the media id.

### App rules

- Runtime API calls only from server code. One idempotency key per write. `toFormState` for every non-`ok` outcome.
- Both message files get every key. Logical RTL classes only.
- No `autoFocus`. No async function without `await`.
- **Images** render with `next/image` `unoptimized` (no remote config, no optimizer cost), with explicit `width` / `height` or a sized wrapper with `fill` plus `sizes`, so there is no layout shift.
  - Always a meaningful `alt`: the media alt, else the product title.
  - `loading="lazy"`, except the storefront's first gallery image.
- `next.config` (admin-web): `experimental.serverActions.bodySizeLimit = "10mb"`.

### Commands

- Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`, sequentially.
- No new warnings in touched files.

---

### Task 1: Migration (pushed alone)

**File:** `packages/db/prisma/schema/migrations/20261014000000_media_image_fields/migration.sql`

```sql
-- Plan 2C-3 — what an image is (type, size, dimensions) and how to describe it (alt). Written by
-- hand, NOT applied by the agent; the owner deploys it from Railway's Console BEFORE the release
-- that reads these columns. Nullable: assets registered before this plan have none.
ALTER TABLE "media"."media_assets" ADD COLUMN "content_type" TEXT;
ALTER TABLE "media"."media_assets" ADD COLUMN "byte_size" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "width" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "height" INTEGER;
ALTER TABLE "media"."media_assets" ADD COLUMN "alt" TEXT;
```

**First, read `media.prisma`.** If product media should reference `assets` (the registry with `content_type` and status) rather than `media_assets` (the library), **STOP and report which one** `Product.mediaRefs` already holds in practice (`attach-media.use-case.ts`, the seed data, and any existing rows the code would see). Put the columns on the table that product media ids point to.

Run the db tests. Commit and push alone:

```bash
git commit -m "feat(db): add image type, size, dimensions and alt to media assets"
git push origin morbeh/w0-w17-w12
```

Print for the owner, in Arabic, and continue:

> لما Railway يخلّص النشر، طبّق من runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261014000000_media_image_fields`. ابعتلي الناتج.

---

### Task 2: Upload pipeline (media + runtime)

**Files:**

- `services/media`:
  - pure `sniffImage(bytes)` → `{ type: "jpeg"|"png"|"webp"|"gif", width, height } | null`, reading the header sizes: JPEG SOF0/SOF2 markers, PNG IHDR, WebP VP8/VP8L/VP8X, GIF logical screen;
  - an `UploadProductImage` use case that:
    1. sniffs;
    2. builds the key via the tenant key policy;
    3. calls `objectStorage.put(key, bytes, contentType, cacheControl)` (extend `ObjectStoragePort` and both adapters);
    4. registers the asset with the new fields, `status` active, and `name` = the original file name (trimmed to 255);
  - the asset's `alt` with `UpdateMediaAlt`, plus repository `findByIds(ids, tenantId)`.
- `packages/storage`: a `put` with `CacheControl`, if the existing `put` lacks it.
- `apps/runtime` / `apps/admin`:
  - `POST /media/uploads` (staff, `products:update`, raw body, route-level `bodyLimit` of 8 MB, the content-type allowlist);
  - `PATCH /media/assets/:id` (`{ alt }`);
  - `MEDIA_PUBLIC_BASE_URL` in the runtime config (optional URL), plus a `publicMediaUrl(key)` helper;
  - **`503` when storage is not real or the base URL is missing.** Read how the composition decides between `StorageServiceObjectStorage` and the in-memory stub, and expose that.

**Tests:**

- **`sniffImage`:** a 1×1 fixture per format (tiny byte arrays in the test), a truncated buffer, an SVG / text buffer (→ null), and a JPEG with EXIF before SOF.
- **The use case:** the tenant-prefixed key, the stored fields, and the put called with the immutable cache header.
- **The route:**
  - 413 over 8 MB;
  - 415 for an SVG or text body;
  - 503 when unconfigured;
  - 403 without the permission;
  - success returns the public URL;
  - a cross-tenant `PATCH` alt is 404.

Commit: `feat(media): upload product images to s3-compatible storage with a public url`.

---

### Task 3: Images in product, order, cart and checkout reads

**Files:**

- **Catalog:**
  - attach checks the asset belongs to the tenant (through a `MediaLookupPort` adapter in `apps/admin`), if not already;
  - detaching media clears any variant `mediaRef` pointing at it;
  - set or clear a variant's image (`PUT /products/:id/variants/:variantId/image` `{ mediaId | null }`, or extend the existing variant update; read it first), which must be one of the product's media.
- **`apps/admin` handlers:**
  - resolve media as the Architecture describes;
  - public DTOs gain `media[]`, `featuredImage` and the variant `imageId`;
  - admin DTOs gain the same, plus order item `imageUrl`;
  - cart / checkout line `imageUrl`.
  - **Update the DTO doc comment** that says the public DTO has no media.
- **Storefront** `lib/runtime-api.ts` types, and **admin-web** `lib/api/*` types.

**Tests:**

- Batched resolution (one read per list) and order preserved.
- A missing asset is skipped, not a 500.
- Cross-tenant ids never resolve.
- Variant image validation, and the clear on detach.
- The public DTO carries no storage key.

Commit: `feat(catalog): product, variant, order and cart images in every read`.

---

### Task 4: Admin media like Shopify

**Files:** `apps/admin-web/src/components/products/editor/media-card.tsx` (rewrite) plus a test; the image helper `lib/media/prepare-image.ts` plus a test; `app/products/actions.ts` (upload, alt, delete, reorder and variant-image actions); the variant dialog; the products table; the order fulfillment card; `next.config.ts`; and messages.

**The media card** (its own forms, not the product form; changes save immediately, like Shopify):

- **Empty state:**
  - a dashed drop zone, "Upload new" / "رفع جديد" as a button;
  - the hint "Accepts images (JPG, PNG, WebP, GIF) up to 8 MB" / "صور JPG أو PNG أو WebP أو GIF لحد 8 ميجا";
  - drag and drop, and multiple files.
- **With images:**
  - a grid where the **first image is large** (2×2 at `sm` and up) and the rest are square tiles, plus a final "+" tile to add more.
  - **Tiles** have a checkbox on hover/focus for selection. A selection bar shows "{n} selected" with "Delete" (confirm).
  - **Reorder** by drag (HTML5 drag events). Keyboard alternative: each tile's menu has "Move earlier" and "Move later", and the menu holds "Make featured" too. Saves through the existing reorder route.
  - **Clicking a tile** opens a dialog with the image large, the "Alt text" field (hint: "Describe the image for people who can't see it and for search engines." / "اوصف الصورة للي مش شايفها ولمحركات البحث."), Save (off until changed), and "Delete" (confirm).
- **Uploading:**
  - each file shows a tile with a spinner until done;
  - per-file errors show on that tile ("Too large", "Unsupported file", "Upload failed — try again"), with a retry;
  - the 503 shows once as a card alert: "Image storage isn't set up yet." / "تخزين الصور لسه مش متظبط.";
  - files upload **two at a time**.
- **`prepare-image.ts`:**
  - decode via `createImageBitmap`;
  - if the longest side is over 2048, scale down;
  - draw to a canvas and `toBlob("image/webp", 0.85)`;
  - **GIF** is passed through untouched;
  - if WebP encoding is unavailable, fall back to JPEG (0.85);
  - **a file over 8 MB after preparation** is refused client-side.
  - **Tests:** mock the canvas APIs.
- **Create mode** (no product yet): uploads work. The uploaded media ids go into hidden `mediaAssetId` inputs joined to the product form (`form=`), and `createProductAction` attaches them in order after creating. **Remove the "Asset ID / Attach" field** everywhere.
- **The variant dialog:** an "Image" picker (the product's media as small tiles, plus "None"). It saves through the variant-image action.
- **The products table:** a 40px thumbnail (featured image) before the title, or a placeholder icon.
- **The order page fulfillment card:** replace the placeholder tile with the item image when present.

**Tests:**

- Drop multiple files gives tiles and calls the action twice concurrently, at most.
- Reorder by menu.
- The alt dialog Save rule.
- Delete with confirm.
- The 503 alert.
- Create mode submits the hidden ids.
- The variant picker.
- The table thumbnail.
- The order line image.

Commit: `feat(admin-web): shopify media card with uploads, ordering, alt text and variant images`.

---

### Task 5: Storefront images

**Files:**

- the product page and a new `product-gallery.tsx` (+ test);
- the product card component (+ test);
- the cart view and the checkout summary;
- messages.

**Gallery:**

- **The main image** sits in a square box (`object-contain`, muted background), with **thumbnails below**: horizontally scrollable, the selected one ringed. Clicking a thumbnail changes the main image.
- **Without JS**, the first image still shows (server-rendered).
- **When the selected variant has an `imageId`,** the main image switches to it. Wire this to the existing variant selector state.
- **The first image is `priority`.**
- **No media:** a placeholder with the product icon.

**Cards:** a square image top (featured image or placeholder), with the hover show the second image if any (Shopify Dawn behavior; CSS only).

**Cart / checkout:** a 48–64px thumbnail per line with the quantity badge over it (checkout, like Shopify).

**Tests:**

- The gallery thumbnail click, variant switching and the placeholder.
- A card with and without an image.
- Cart / checkout lines render the image `alt`.

Commit: `feat(storefront): product gallery, card, cart and checkout images`.

---

### Task 6: Docs, gaps, gates, STOP

**Close:** any gap about product images / media upload (search both registers).

**Open:**

- **Low:** "Uploaded images are not resized on the server; the admin resizes before upload. A raw API upload keeps its size and EXIF."
- **Low:** "Detached or deleted product images stay in storage (no orphan cleanup)."
- **Low:** "No image transformations or responsive variants (srcset); the storefront serves the uploaded size."
- **Low:** "Media bucket is public-read: only product images belong there."
- **Low:** "No video, 3D or external-URL media yet."

**Env docs:** add `MEDIA_PUBLIC_BASE_URL` with an empty value to the runtime env example and the Railway README variables table, next to the S3 variables. **Empty values only.**

**Gates, sequentially:**

1. the package suites (media, storage, catalog, admin, runtime, storefront, admin-web, db);
2. `-r typecheck`;
3. `-r lint`, with no new warnings in touched files;
4. `pnpm arch`.

Commit, including this plan: `docs(media): record plan 2c-3, open the image follow-up gaps`.

**STOP.** Give the Arabic report, and ask the owner to confirm `20261014000000_media_image_fields` was applied. Push after they confirm.

## Done criteria

- **The admin uploads images.** It can upload several at once by drop or button. It orders them (drag or menu), sets alt text, deletes them, and picks a variant image. Thumbnails show in the product list and on order lines.
- **The storefront shows images.** There is a gallery with variant switching, plus images on cards, the cart and checkout.
- **Storage:** images live in the public Supabase bucket under tenant-prefixed keys. They are uploaded only through the staff route, with magic-byte checks.
- **Every gate is green.** The security assertions are unchanged, and no secret is in the repo.

## Arabic report (for the owner)

Give the commits and test counts, then **these setup steps exactly** (the owner does them; never ask for or repeat any key):

1. **Supabase → Storage → New bucket:**
   - الاسم `media`؛
   - فعّل **Public bucket**؛
   - Restrict file size: `8 MB`؛
   - Allowed MIME types: `image/jpeg, image/png, image/webp, image/gif`.
2. **Supabase → Storage → Settings → S3 Connection:**
   - اتأكد إن **S3 protocol** متفعّل؛
   - انسخ **Endpoint** و**Region**؛
   - دوس **New access key**، وانسخ **Access key ID** و**Secret access key**. **ما تبعتهمش في الشات.**
3. **Railway → runtime-api → Variables**، ضيف المتغيرات دي:
   - `S3_ENDPOINT` = الـ Endpoint اللي نسخته؛
   - `S3_REGION` = الـ Region؛
   - `S3_ACCESS_KEY_ID` و`S3_SECRET_ACCESS_KEY` = المفتاحين؛
   - `S3_FORCE_PATH_STYLE` = `true`؛
   - `S3_BUCKET_MEDIA` = `media`؛
   - `MEDIA_PUBLIC_BASE_URL` = الـ Endpoint بعد ما تغيّر آخره من `/storage/v1/s3` لـ `/storage/v1/object/public/media`.
4. Railway هيعيد التشغيل لوحده.

**Then try it:**

1. Open a product, and drop 3 images.
2. Drag the third to the front, and write alt text.
3. Give size 30 its own image.
4. Open the store: the gallery, the variant switch, the card, the cart and checkout.

Also list every decision not in the plan.
