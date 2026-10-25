# Daily Order Operations — Design Spec (Project 3)

**Status:** Decided on the owner's behalf (2026-10-18). The owner delegated every decision ("نفذ وخد
القرارات مكاني ما يخدم مصلحة المنصة"); each one is marked **Decision:** with its reason and all of
them are listed at the end for the owner to check. Ready for implementation plans, one per part.
**Author:** Claude (this session).
**Branch:** `morbeh/order-operations` (from `main`, after the Shopify-style discounts work).
**Relationship to prior work:** Shopify parity programme (navigation, discounts phases 1–3); builds
on Plan 3A (order recipient), 3B (order numbers, derived payment/fulfillment status), 3C (province,
shipping and taxes), 3D (Home "Orders to fulfill"), and the public checkout (Phase 2).

> **ملخص للمالك:**
>
> المشروع ده بيخلّي شغل الطلبات اليومي زي شوبيفاي بالظبط، على 4 أجزاء كل واحد بيتسلّم لوحده:
> (1) قائمة الطلبات بتبويبات (الكل/غير منفذة/غير مدفوعة/مفتوحة/مؤرشفة) + تحديد كذا طلب وأرشفة وطباعة
> قسائم وتصدير CSV جاهز لشركة الشحن (الاسم والتليفون والمحافظة ومبلغ التحصيل).
> (2) ملاحظة على الطلب، وعلامات (Tags) تفلتر بيها، وتعليقات الفريق في سجل الطلب.
> (3) صفحة "عمليات الدفع المتروكة": مين ساب الدفع في النص، ولينك استرجاع تنسخه أو تبعته واتساب.
> (4) "المسودات": تعمل طلب بنفسك للزبون اللي كلمك واتساب، وتبعتله لينك يدفع، أو تعلّمه مدفوع / دفع عند الاستلام.

---

## Why

A merchant's day is mostly orders, and today the admin covers only the single order. Concretely:

1. **The list cannot be worked.** `apps/admin-web/src/app/orders/page.tsx` has search and a raw
   21-value lifecycle status dropdown (`orders-toolbar.tsx`), no tabs, no selection, no bulk action,
   no export. Egyptian merchants hand their courier (Bosta, J&T, Aramex, a local agent) a sheet of
   the day's orders every day; today they copy each order by hand.
2. **Nothing can be written on an order.** No note, no tags, no staff comment. Teams that sell over
   WhatsApp/Instagram keep this in chat threads instead.
3. **Lost sales are invisible.** A shopper who typed their email/phone and address and then left is
   recorded in `checkout.checkout_sessions` but no screen shows it, and there is no way to send them
   back to their checkout.
4. **Phone/WhatsApp orders have no proper path.** "Create order" opens `orders/new`, a developer form
   that asks for a `customerRef`, a `productId` and a price in minor units, and calls the legacy
   `POST /orders` (`Order.place()`, no totals, no shipping, no stock, client-supplied prices).

## What already exists (and is reused)

| Area                      | What exists                                                                                                                                                                                                                                                               | Reused for                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Order status              | `OrderEventType` + transition table (`services/orders/src/domain/order-event.ts`); status derived from `order_events`; `derivePaymentStatus`, `isOpenOrder`, `CANCELLED_EVENT_TYPE`, `CLOSED_EVENT_TYPE`, `REFUNDED_EVENT_TYPES` (`order-statuses.ts`)                    | Tab predicates (part 1)                                                         |
| Fulfillment status        | `fulfillmentStatusesOf` (one batched Fulfillment read per page), `deriveFulfillmentStatus`, `listUnfulfilledOrders` (scan with `UNFULFILLED_SCAN_CAP`) in `apps/admin/src/http`                                                                                           | Unfulfilled tab, list/CSV fulfillment column                                    |
| Customer names            | `customerNamesFor` / `customerNameOf` (`order-customer-names.ts`)                                                                                                                                                                                                         | List, CSV, packing slips                                                        |
| Order routes              | `GET /orders` (+`fulfillment=unfulfilled`), `GET /orders/:id`, `/mark-paid`, `/request-payment-capture`, `/advance` (`admin-routes.ts` ~1400–1640); `POST /fulfillments`                                                                                                  | Bulk actions call the same controllers                                          |
| COD settlement            | `ConfirmCodCollection` (eligibility by provider capability, not name) behind `POST /payment-intents/:id/cod-collection` (`payments:confirm_cod_collection`, admin-only)                                                                                                   | Bulk "Mark cash as received", draft "Mark as paid"                              |
| Checkout                  | `CheckoutSession` (items/address/contact/totals/discount snapshots, `started`/`locked` = open), `StartCheckout`, `LoadItems`, `CompleteCheckout` (stock reservation, discount re-check, guest customer resolution via `contactEmail`, order numbering), `InitiatePayment` | Abandoned list (part 3), draft completion and invoice (part 4)                  |
| Public checkout ownership | `requireOwnedSession`: `sessionRef` from the HttpOnly guest cookie (`morbeh-storefront-guest-session`) is the only proof of ownership; `sessionRef` never on the wire; 404 on mismatch                                                                                    | Recovery / invoice links must never reveal or require the original `sessionRef` |
| Storefront resume         | `/checkout` reads `GUEST_SESSION_COOKIE` + `CHECKOUT_SESSION_COOKIE` (`morbeh_checkout_session`), both HttpOnly; `startCheckout` sets the latter (`apps/storefront/src/app/checkout/actions.ts`)                                                                          | The link landing page sets the same two cookies                                 |
| Server-side pricing       | `resolveMerchandise` (`merchandise-resolution.ts`): variant price from Catalog, never from the caller                                                                                                                                                                     | Recovery re-pricing, draft line pricing                                         |
| Numbering                 | `PrismaOrderNumberAllocator` on `orders.order_number_counters` (atomic upsert in the caller's tx)                                                                                                                                                                         | Draft numbers `#D1`                                                             |
| Roles                     | `ROLE_PERMISSIONS` (`packages/auth/src/role-table-access-control.ts`): operator `orders:*`, viewer `orders:read`, payments admin-only                                                                                                                                     | Permission choices below                                                        |
| Regions                   | `packages/regions` province names (en/ar)                                                                                                                                                                                                                                 | CSV and slips print province names                                              |

## Goals

- The Orders list works like Shopify's: tabs, multi-select with a bulk-action bar, export.
- Every order can carry a note, tags and staff comments, visible in Shopify's places.
- Abandoned checkouts are listed and recoverable with one link the merchant copies or shares on WhatsApp.
- A merchant can build an order for a phone/WhatsApp customer and either send a payment link or
  create the order directly (paid, or cash on delivery).
- Each of the four parts is planned, built, reviewed and deployed on its own, in order.

## Non-goals

- Automatic recovery emails / WhatsApp messages and emailing invoices (project 8, notification
  templates). This project only produces the link and a share button.
- Order editing (changing items of a placed order), bulk cancel, refunds in bulk.
- Custom line items and per-line price overrides on drafts; reserving stock for drafts.
- Saved custom list views, column picker, auto-archive setting, order "sales channel" column.
- Shopper-entered order notes at checkout; @mentions and attachments in comments.
- Asynchronous (emailed) exports above the synchronous cap.

## Anti-goals (must not happen)

- No client-supplied price, amount or rate on any public route; no merchant-browser-supplied price on
  any admin route added here (draft prices are resolved server-side from Catalog).
- No link that exposes, embeds or derives a guest `sessionRef`; no stored plaintext link token.
- No new way to mark an order paid that bypasses Payments (payment truth stays: a captured payment
  must exist for `order.paymentRef`).
- No change to the order lifecycle transition table and no annotation write that bumps the `Order`
  aggregate's `version` (a note edit must never conflict with a payment webhook).
- No skipping of stock reservation, discount re-check or guest-customer resolution when a draft becomes
  an order.

## Global constraints (apply to every part)

1. **Migrations:** hand-written, additive SQL in `packages/db/prisma/schema/migrations/<ts>_<name>/
migration.sql`, never run against a real DB by the agent (owner deploys from Railway's Console
   before the release that reads them). Every new tenant table: `tenant_id TEXT NOT NULL`, `ENABLE` +
   `FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS tenant_isolation …; CREATE POLICY
tenant_isolation … FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK
(same)` — exactly as `20261012000000_order_numbers`. Prisma models updated in the matching
   `*.prisma` file.
2. **Per-request tenant (ADR-0014):** new repositories take `tenantId` per call, reads go through
   `runReadScoped` (or the caller's `tx`), writes through the unit of work; nothing is pinned at
   construction (the only exemption stays `services/tenancy`). Each new Prisma repository gets a
   `tenant-isolation.test.ts` case like its siblings.
3. **admin-web:** runtime API only from server code (pages, server actions, route handlers); client
   components never value-import `lib/api/*` or `lib/auth/*` (type imports only); every string in
   `messages/en.ts` and `messages/ar.ts`; logical CSS (`ms-`/`pe-`/`start`/`end`, `rtl:` flips); one
   idempotency key per submit (`newIdempotencyKey()`).
4. **Public routes:** `public: true`, ownership by `sessionRef` from `x-cart-session`/body, uniform 404,
   `.strict()` bodies, DTOs never carry `sessionRef`.
5. **Shopify placement and wording:** the sidebar's Orders item gets children **Drafts** and
   **Abandoned checkouts**, in that order (Shopify's). Labels below are Shopify's English and the
   matching Arabic.

## Permissions (all parts)

| Permission                                         | Who has it today via the role table | Used by                                                                                             |
| -------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `orders:read`                                      | viewer, operator, admin             | lists, detail, drafts list/detail, abandoned list/detail, packing slips                             |
| `orders:archive`                                   | operator, admin                     | archive / unarchive (single and bulk)                                                               |
| `orders:export`                                    | operator, admin                     | export rows                                                                                         |
| `orders:edit_note`, `orders:tag`, `orders:comment` | operator, admin                     | part 2                                                                                              |
| `orders:recover_checkout`                          | operator, admin                     | issue a recovery link                                                                               |
| `orders:draft`                                     | operator, admin                     | create / update / delete drafts, issue invoice link                                                 |
| `orders:complete_draft`                            | operator, admin                     | create the order from a draft (collect on delivery)                                                 |
| `payments:confirm_cod_collection`                  | admin                               | bulk "Mark cash as received"; draft "Mark as paid" (checked in addition to `orders:complete_draft`) |

**Decision:** export is not given to viewers (`orders:export`, not `orders:read`). Reason: a bulk file
of customer phones and addresses is a bigger exposure than reading orders one screen at a time.

**Decision:** money stays admin-only: "Mark as paid" and "Mark cash as received" require
`payments:confirm_cod_collection` exactly like the existing order-page action. Reason: Plan 1B-2 kept
money admin-only; this project does not reopen that.

---

## Part 1 — Order list operations

### 1.1 Tabs (Shopify's default views)

The list gets Shopify's tabs, in Shopify's order, driven by `?view=` in the URL (absent = `all`).

| Tab (en / ar)           | `view`        | Meaning in this codebase                                                                                                                                             |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All / الكل              | `all`         | every order, archived included (archived rows show an "Archived" badge)                                                                                              |
| Unfulfilled / غير منفذة | `unfulfilled` | not archived, `isOpenOrder` (never cancelled, not closed) and Plan 3B fulfillment status `unfulfilled` — the exact definition Home's "Orders to fulfill" card counts |
| Unpaid / غير مدفوعة     | `unpaid`      | not archived, open, `derivePaymentStatus(history) === "pending"`                                                                                                     |
| Open / مفتوحة           | `open`        | not archived, open                                                                                                                                                   |
| Archived / مؤرشفة       | `archived`    | `archived_at IS NOT NULL`                                                                                                                                            |

**Decision:** "Unfulfilled" reuses the Home card's definition (only `unfulfilled`, not `in_progress`).
Reason: one definition for the card and the tab; `in_progress` here means a fulfillment is already
open, i.e. someone is working on it.

**Decision:** "Open" means not cancelled, not closed and not archived — Shopify's "open" (not
archived, not cancelled) mapped onto the event-derived lifecycle. Reason: `closed` is the lifecycle's
terminal event and is not a merchant toggle, so an order closed by the lifecycle is not open either.

The existing `status` dropdown stays, moved under a **Filter** button beside the search (Shopify keeps
fine filters there); `fulfillment=unfulfilled` stays accepted (Home's old links) and is treated as
`view=unfulfilled`. Home's card link changes to `/orders?view=unfulfilled`.

### 1.2 Archive (persistence)

`Order` has no archived flag. Shopify's archive is reversible ("Unarchive"), so it cannot be the
lifecycle's terminal `closed` event.

**Decision:** archive is a nullable timestamp column on `orders.orders`, outside the `Order`
aggregate. Reason: reversible like Shopify, filterable in the same SQL as the list, and writing it
never touches the aggregate's history or `version` (no conflict with payment/fulfillment writes).

- Migration `20261018000000_order_archive`:
  `ALTER TABLE "orders"."orders" ADD COLUMN "archived_at" TIMESTAMP(3);`
  `CREATE INDEX "orders_tenant_id_archived_at_idx" ON "orders"."orders"("tenant_id", "archived_at");`
  No backfill (NULL = not archived). Prisma: `archivedAt DateTime? @map("archived_at")`.
- `OrderMapper.toOrderRow` must NOT include `archivedAt` (so `PrismaOrderRepository.save` never
  resets it); covered by a test.
- New port in `services/orders/src/domain/order-annotations.ts`:
  `OrderAnnotationRepository { setArchived(orderIds, archivedAt: Date | null, tenantId, tx?):
Promise<readonly string[] /* ids actually changed */>; annotationsOf(orderIds, tenantId, tx?):
Promise<ReadonlyMap<string, OrderAnnotations>> }` where `OrderAnnotations = { archivedAt: Date |
null }` (part 2 widens it with `note`, `tags`). Prisma implementation does a plain
  `updateMany({ where: { tenantId, id: { in } } })` — no version check, no history row. In-memory
  implementation for tests.
- Use cases (`services/orders/src/application/order-annotations.use-cases.ts`): `ArchiveOrders`,
  `UnarchiveOrders` (input `{ tenantId, orderIds, actorRef }`; archiving an already-archived order is
  a no-op, idempotent). Part 2 adds timeline activity rows for them.

### 1.3 List query (repository)

`OrderListQuery` (`order-repository.ts`) gains, additively:

```ts
readonly archived?: boolean;          // true = only archived, false = only not archived
readonly open?: boolean;              // true = never cancelled and not closed
readonly paymentStatus?: "pending";   // derived from history
readonly ids?: readonly string[];     // export of a selection (max 50)
readonly createdFrom?: Date; readonly createdTo?: Date; // export "orders by date"
```

**Decision:** `open` and `paymentStatus` are SQL relation predicates in `PrismaOrderRepository.
fetchOrders` (`events: { none: { type: { in: [...] } } }` — Prisma emits `NOT EXISTS`), not the
status-filter scan. Reason: exact pages with no scan cap; the event types come from the existing
constants (`CANCELLED_EVENT_TYPE`, `CLOSED_EVENT_TYPE`, the paid set and `REFUNDED_EVENT_TYPES`), so
the definition stays single. Unpaid = none of `paid`, `payment_received`, `refunded`,
`refund_requested`, `cancelled`, `closed`. `InMemoryOrderRepository` mirrors them with
`isOpenOrder`/`derivePaymentStatus`; a shared test runs the same cases against both.

**Decision:** search also matches the shipping recipient's name and phone (two-step: ids from
`order_shipping_addresses` where `recipient_name`/`phone` `ILIKE %q%`, capped at 500, OR'd into the
existing order-number/customer-ref match). Reason: Egyptian merchants look orders up by phone.

`listUnfulfilledOrders` passes `archived: false` through; `view=unfulfilled` uses it unchanged.

### 1.4 API (apps/admin)

| Route                                                              | Permission         | Shape                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /orders`                                                      | `orders:read`      | adds `view` (`all`/`unfulfilled`/`unpaid`/`open`/`archived`), `first` max stays 100; items gain `archivedAt: string \| null`                                                                           |
| `POST /orders/:orderId/archive`, `POST /orders/:orderId/unarchive` | `orders:archive`   | 200 `{ orderId, archivedAt }`; idempotent                                                                                                                                                              |
| `POST /orders/bulk`                                                | per action (below) | body `{ action, orderIds: string[1..50] }` (`.strict()`; part 2 adds `tags`); 200 `{ results: [{ orderId, outcome: "ok" \| "skipped" \| "failed", reason?: string }] }`; `idempotent: true`            |
| `GET /orders/export-rows`                                          | `orders:export`    | query = list filters (`view`, `q`, `status`, `tag` from part 2) + `ids` (comma list, max 50) + `createdFrom`/`createdTo` (ISO dates) + `first` (max 250) + `after`; cursor page of `OrderExportRowDto` |
| `GET /orders/packing-slips?ids=`                                   | `orders:read`      | max 50 ids; `{ slips: PackingSlipDto[] }`                                                                                                                                                              |

Bulk actions (route checks the action's permission first; each order then runs through the SAME
controller call the single-order screen uses, each in its own transaction):

| `action`                | Permission                        | Per-order behaviour                                                                                            | `skipped` when                                                    |
| ----------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `archive` / `unarchive` | `orders:archive`                  | `ArchiveOrders` / `UnarchiveOrders`                                                                            | already in that state                                             |
| `fulfill`               | `fulfillment:create`              | opens a fulfillment for every item (`POST /fulfillments`'s use case, the order page's "Fulfill items")         | fulfillment already open, or not open                             |
| `capture_payments`      | `orders:request_payment_capture`  | `requestPaymentCapture`                                                                                        | payment not pending, or provider settles at pay time (COD/manual) |
| `mark_cod_collected`    | `payments:confirm_cod_collection` | `ConfirmCodCollection` with the amount read server-side from the intent (as `confirmCodCollectionAction` does) | not a pending COD intent of this order                            |

**Decision:** the bulk "fulfil" action opens fulfillments (Shopify wording "Fulfill items" / "تنفيذ
المنتجات") rather than an instant "Mark as fulfilled". Reason: here "fulfilled" means handed to a
carrier after the reservation → pick → pack → ship steps of `services/fulfillment`; a shortcut that
jumps them would skip stock reservation. A true one-click dispatch belongs to the courier project.

**Decision:** bulk actions are per order, not atomic, at most 50 ids, with a per-order result.
Reason: Shopify behaves the same; one bad order must not block forty-nine good ones, and the cap keeps
the request inside the HTTP timeout.

**Decision:** "Mark cash as received" is added to the bulk menu (an extra, admin-only). Reason: a
courier remits the cash of many COD orders at once; settling them one by one is the daily pain.

**Decision:** bulk cancel is not offered. Reason: cancelling triggers payment voids, stock release and
fulfillment cancellation per order (G-126 path); it stays a deliberate per-order action.

`OrderExportRowDto` (one row per order):

```ts
{ orderId, orderNumber, createdAt, customerName, email: string | null, phone: string | null,
  line1, line2: string | null, city, province: string | null /* ISO 3166-2 */, country,
  items: { title: string; variantTitle: string | null; sku: string | null; quantity: number }[],
  itemCount, subtotalMinor, shippingMinor, discountMinor, totalMinor,
  codAmountMinor /* total when payment pending and provider is cod, else 0 */, currency,
  paymentStatus, paymentProvider: string | null, fulfillmentStatus, shippingMethod: string | null,
  tags: string[] /* part 2; [] before */, note: string | null /* part 2; null before */ }
```

Email comes from one batched Identity read (like `customerNamesFor`); payment provider from a new
batched read — `GetPaymentIntentsByIds` in `services/payments` exposed as
`OrdersAdminController.paymentIntentsOf(principal, { tenantId, paymentIntentIds })` under
`orders:read` (today only the one-by-one `paymentIntentOf` exists). `PackingSlipDto` = order number,
date, ship-to (name, phone, address, province), lines (title, variant, SKU, qty), note (part 2),
`codAmountMinor` and currency.

### 1.5 admin-web

- **`/orders` (Shopify layout).** Header: title "Orders"; buttons **Export** (secondary) and
  **Create order** (primary; links to `/orders/new` until part 4 repoints it). Below: the tab strip,
  then search + **Filter** (status), then the table. `PAGE_SIZE` 20 → 50 (Shopify's page size).
  `OrdersTable` becomes a client component receiving DTOs as props (no `lib/api` import): a checkbox
  column with a header "select all on this page"; new trailing column **Tags** arrives in part 2;
  an "Archived" badge next to the order number when `archivedAt` is set.
- **Bulk bar.** When ≥1 row is selected the table header is replaced (Shopify) by "N selected" and:
  **Fulfill items**, **Capture payments**, **Print packing slips**, and a **⋯** menu with
  **Archive orders**, **Unarchive orders**, **Export selected**, **Mark cash as received** (only for
  admins — `getCurrentUser()` role passed in as a boolean prop). Part 2 adds **Add tags** / **Remove
  tags** to the menu. Each action is a server action in `app/orders/actions.ts` calling
  `POST /orders/bulk`; the result shows a toast "N orders updated · M skipped" and a details popover
  listing skipped/failed order numbers with the reason; the page revalidates.
  Arabic: تنفيذ المنتجات · تحصيل المدفوعات · طباعة قسائم التعبئة · أرشفة الطلبات · إلغاء أرشفة الطلبات ·
  تصدير المحدد · تأكيد استلام النقدية.
- **Export dialog** (Shopify's): "Export orders" with radio options **Current page**, **All orders**,
  **Selected: N orders** (disabled when none), **N orders matching your search** (only when a search
  or filter is active), **Orders by date** (from/to). One format: "CSV for Excel" (UTF-8 with BOM).
  Submitting posts to a Next route handler `app/orders/export/route.ts` (server) that pages
  `GET /orders/export-rows` (250 at a time) and streams the CSV as an attachment
  `orders_export_<yyyy-mm-dd>.csv`.
- **CSV format.** Headers in the admin's locale; columns in this order: Order, Date, Customer name,
  Phone, Email, Address line 1, Address line 2, City, Province, Country, Items, Item count, Subtotal,
  Shipping, Discount, Total, COD amount, Currency, Payment status, Payment method, Fulfillment status,
  Shipping method, Tags, Notes. Items = `2 × T-shirt (L) [SKU-1]; 1 × Cap`. Province = the
  `packages/regions` name in the admin's locale. Amounts as plain decimals (`1250.00`). Dates
  `yyyy-mm-dd HH:mm` in the shop's time zone. RFC 4180 quoting, CRLF.
  **Decision:** formula-injection guard prefixes `'` to a cell starting with `=`, `@`, or with `+`/`-`
  followed by a non-digit. Reason: protects Excel users without breaking `+2010…` phones that courier
  portals must read as-is.
  **Decision:** synchronous export capped at 5,000 orders; above that the dialog says "Narrow the
  date range" (emailed exports come with project 8). Reason: keeps the request inside the timeout
  with no job infrastructure.
  **Decision:** one row per order, not Shopify's one row per line item. Reason: the merchant's main
  consumer is a courier upload, which wants one shipment per row; the Items column keeps the lines.
- **Packing slips.** `app/orders/packing-slips/page.tsx?ids=…` (server page, outside `AppShell`,
  print CSS: one slip per A4/A6 page, `break-after: page`), auto-opens the print dialog via a tiny
  client component. Shop name, order number, date, ship-to block, lines, note, **"Collect: EGP 1,250"**
  when `codAmountMinor > 0`. Also offered from the order page's **More actions → Print packing slip**.
- **Order page:** **More actions** gains **Archive** / **Unarchive**; header shows an "Archived" badge.

### 1.6 Testing (part 1)

- Repository: each view predicate on Prisma (integration) and in-memory with the same fixture
  (cancelled, closed, paid, refunded, COD pending, archived); `save()` never clears `archived_at`;
  tenant isolation of `setArchived`.
- Use cases: archive/unarchive idempotency.
- Routes: `view` mapping incl. legacy `fulfillment=unfulfilled`; bulk per action (ok / skipped /
  failed mix, permission per action, 51 ids rejected, viewer refused); export-rows filters, `ids`,
  dates, page size, COD amount rule; packing slips cap.
- admin-web: tabs set `view`; selection and bulk bar; export dialog options; CSV builder unit tests
  (BOM, quoting, guard rule incl. `+20…` kept, Arabic headers, province names); packing slip render.

---

## Part 2 — Notes, tags and timeline comments

### 2.1 Storage

**Decision:** note on the `orders` row, tags in their own table, comments and annotation activity in
one timeline table; none of them inside the `Order` aggregate. Reason: same no-version-conflict rule
as archive; a tag table gives an indexed, case-insensitive tag filter and a cheap "all tags in this
shop" list for suggestions.

Migration `20261018010000_order_notes_tags_timeline`:

```sql
ALTER TABLE "orders"."orders" ADD COLUMN "note" TEXT;

CREATE TABLE "orders"."order_tags" (
  "tenant_id" TEXT NOT NULL,
  "order_id"  UUID NOT NULL,
  "tag"       TEXT NOT NULL,          -- as typed (trimmed, inner spaces collapsed)
  "tag_key"   TEXT NOT NULL,          -- lower(tag), the identity used for dedupe and filtering
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_tags_pkey" PRIMARY KEY ("order_id", "tag_key")
);
CREATE INDEX "order_tags_tenant_id_tag_key_idx" ON "orders"."order_tags"("tenant_id", "tag_key");

CREATE TABLE "orders"."order_timeline_entries" (
  "id"          UUID NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "order_id"    UUID NOT NULL,
  "kind"        TEXT NOT NULL,        -- comment | archived | unarchived | note_changed | tags_added | tags_removed | created_from_draft
  "author_ref"  TEXT,                 -- staff principal id; null for system
  "author_name" TEXT,                 -- snapshot at write time
  "body"        TEXT,                 -- comment text (kind = comment)
  "data"        JSONB NOT NULL DEFAULT '{}', -- e.g. { "tags": ["vip"] }, { "draftNumber": "D3" }
  "created_at"  TIMESTAMP(3) NOT NULL,
  "edited_at"   TIMESTAMP(3),
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "order_timeline_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_timeline_entries_kind_check" CHECK ("kind" IN ('comment','archived','unarchived','note_changed','tags_added','tags_removed','created_from_draft'))
);
CREATE INDEX "order_timeline_entries_order_id_created_at_idx" ON "orders"."order_timeline_entries"("order_id", "created_at");
-- + ENABLE/FORCE RLS and a tenant_isolation policy on BOTH new tables (global constraint 1).
```

No FKs to `orders` (house rule: owned rows reference by bare id; the order is never deleted).

Limits (Shopify's): note ≤ 5,000 chars; tag ≤ 40 chars, ≤ 250 tags per order, no commas (a comma
splits into two tags in the input); comment ≤ 5,000 chars.

**Decision:** tags are case-insensitive (`tag_key = lower(tag)`), first spelling wins for display.
Reason: Shopify treats `VIP` and `vip` as one tag; Arabic is unaffected.

### 2.2 Domain and use cases (services/orders)

- `OrderAnnotations` widens to `{ archivedAt, note: string | null, tags: readonly string[] }`;
  `OrderAnnotationRepository` gains `setNote`, `addTags(orderIds, tags)`, `removeTags(orderIds,
tagKeys)`, `tagsInUse(tenantId, prefix?, limit=50)` (distinct tags with counts, for suggestions)
  and `annotationsOf` returns tags.
- `OrderTimelineRepository { append(entry, tenantId, tx?); listForOrder(orderId, tenantId, {first:
200}); findById; update(edit/delete) }`, value type `OrderTimelineEntry`.
- Use cases (`order-annotations.use-cases.ts`, `order-timeline.use-cases.ts`): `UpdateOrderNote`,
  `AddOrderTags`, `RemoveOrderTags` (bulk-capable: `orderIds[]`), `AddOrderComment`,
  `EditOrderComment`, `DeleteOrderComment` (soft: `deleted_at`, the entry stays as "Comment deleted"
  for the audit trail). Each annotation change appends its activity entry in the same transaction;
  `ArchiveOrders`/`UnarchiveOrders` from part 1 start appending `archived`/`unarchived`.
- **Author.** The route passes `principal.id`; a new port `StaffDirectoryPort.displayNameOf(principalId,
tenantId)` (adapter in `apps/admin/src/infrastructure/cross-context/staff-directory.adapter.ts`,
  reading Security's `principals.display_name` by `external_id`) fills `author_name`; unknown →
  `null`, shown as "Staff". Never accepted from the client.
  **Decision:** author name is snapshotted at write time. Reason: the timeline is a record; renaming a
  staff member must not rewrite history, and reads stay one query.
- **Edit/delete rule:** the author may edit or delete their own comment; an `admin` may delete any.
  Activity entries are never editable.

### 2.3 API

| Route                                       | Permission         | Shape                                                                                         |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| `PUT /orders/:orderId/note`                 | `orders:edit_note` | `{ note: string \| null }` → `{ note }`                                                       |
| `POST /orders/:orderId/tags`                | `orders:tag`       | `{ add?: string[], remove?: string[] }` → `{ tags }`                                          |
| `GET /order-tags?q=`                        | `orders:read`      | `{ tags: { tag, count }[] }` (≤ 50, prefix match on `tag_key`)                                |
| `POST /orders/:orderId/comments`            | `orders:comment`   | `{ body }` → `TimelineEntryDto`                                                               |
| `PATCH /orders/:orderId/comments/:entryId`  | `orders:comment`   | `{ body }` (author only)                                                                      |
| `DELETE /orders/:orderId/comments/:entryId` | `orders:comment`   | author or admin                                                                               |
| `POST /orders/bulk`                         | `orders:tag`       | new actions `add_tags` / `remove_tags` with `tags: string[1..20]`                             |
| `GET /orders`                               | `orders:read`      | new filter `tag` (repeatable → AND); items gain `tags`                                        |
| `GET /orders/:orderId`                      | `orders:read`      | detail gains `note`, `tags`, `archivedAt`, `timelineEntries: TimelineEntryDto[]` (latest 200) |

`TimelineEntryDto = { id, kind, authorName: string | null, body: string | null, data, createdAt,
editedAt: string | null, deleted: boolean, canEdit: boolean }` (`canEdit` decided server-side).
Export rows and packing slips fill `tags` and `note`.

Repository tag filter: `id IN (SELECT order_id FROM order_tags WHERE tenant_id = $t AND tag_key = $k)`
per tag (AND for several).

### 2.4 admin-web (Shopify placement)

- **Order page, right column** (Shopify's order): **Notes** card first (pencil → dialog with textarea,
  "No notes" when empty — ملاحظات / لا توجد ملاحظات), then the existing Customer / addresses cards,
  then **Tags** card (chips with × and an input with suggestions from `GET /order-tags`; Enter or comma
  adds; saves immediately — العلامات).
- **Timeline** (`order-timeline.tsx`): Shopify's comment composer on top — "Leave a comment..." /
  "اكتب تعليقًا..." with **Post** / **نشر** — then one list merging lifecycle `history` and
  `timelineEntries`, newest first, grouped by day. Comments show author, time and text, with "Edit" /
  "Delete" when `canEdit`; activity lines read e.g. "Ahmed archived this order", "Ahmed added tags vip,
  urgent". Composer is a client component calling a server action.
- **Orders list:** **Tags** column (first 3 chips + "+N"); **Filter** gains **Tagged with**; bulk menu
  gains **Add tags** / **Remove tags** (dialog with the same tag input) — إضافة علامات / إزالة علامات.

### 2.5 Testing (part 2)

Domain/use cases: tag normalisation and limits, case-insensitive dedupe, note length, activity rows
written in the same tx, author snapshot, edit/delete rules, `save()` of the aggregate leaves note/tags
untouched. Repositories: Prisma integration + tenant isolation for both tables. Routes: each route,
permissions, tag filter AND, bulk tags results. admin-web: notes dialog, tag input (comma split,
suggestions, RTL), merged timeline order, composer states.

---

## Part 3 — Abandoned checkouts

### 3.1 What counts as abandoned

There is no sweeper: nothing expires checkout sessions and `services/cart`'s `AbandonCart` is only an
admin action on carts (no checkout data, no contact). The useful record is the checkout session: it
has contact email, the shipping address with recipient name and phone, items and totals.

**Decision:** "abandoned" is derived at read time, no background job:
`state IN ('started','locked') AND updated_at < now() - 60 min AND items <> '[]' AND (contact_email
IS NOT NULL OR shipping_address->>'phone' IS NOT NULL) AND draft_terms = '{}'` (the last condition
from part 4; before part 4 it is omitted), **plus** every session with `recovered_order_ref IS NOT
NULL` (so recovered ones stay listed as "Recovered", as in Shopify). Reason: no job infrastructure to
build or monitor; the list is always current.

A recovered clone that itself idles can appear as its own abandoned row. Recovery marks one hop, the
session the link was issued for (same as Shopify); it does not walk back to the root checkout.

**Decision:** the idle threshold is 60 minutes (constant `ABANDONED_AFTER_MINUTES` in
`services/checkout`). Reason: WhatsApp follow-up works best the same day; a per-shop setting can come
later.

### 3.2 Storage

Migration `20261018020000_checkout_recovery_links`:

```sql
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_from_ref" TEXT;   -- on the NEW session a link created
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "recovered_order_ref" TEXT;  -- on the ORIGINAL session once recovered
CREATE INDEX "checkout_sessions_tenant_id_state_updated_at_idx"
  ON "checkout"."checkout_sessions"("tenant_id", "state", "updated_at");

CREATE TABLE "checkout"."checkout_links" (
  "id"                  UUID NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "purpose"             TEXT NOT NULL,            -- recovery | invoice
  "token_hash"          TEXT NOT NULL,            -- hex SHA-256 of the token; the token itself is never stored
  "checkout_session_id" UUID,                     -- recovery: the abandoned session
  "draft_order_ref"     TEXT,                     -- invoice (part 4)
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "revoked_at"          TIMESTAMP(3),
  "created_by"          TEXT NOT NULL,            -- staff principal id
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim_count"         INTEGER NOT NULL DEFAULT 0,
  "last_claimed_at"     TIMESTAMP(3),
  "result_checkout_ref" TEXT,                     -- recovery: the session the last claim produced
  CONSTRAINT "checkout_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_links_purpose_check" CHECK ("purpose" IN ('recovery','invoice')),
  CONSTRAINT "checkout_links_target_check" CHECK (
    ("purpose" = 'recovery' AND "checkout_session_id" IS NOT NULL) OR
    ("purpose" = 'invoice'  AND "draft_order_ref" IS NOT NULL))
);
CREATE UNIQUE INDEX "checkout_links_token_hash_key" ON "checkout"."checkout_links"("token_hash");
CREATE INDEX "checkout_links_tenant_id_checkout_session_id_idx" ON "checkout"."checkout_links"("tenant_id", "checkout_session_id");
-- + ENABLE/FORCE RLS + tenant_isolation policy.
```

The `invoice` purpose and `draft_order_ref` are created now so part 4 needs no alteration of this table.

### 3.3 The link token

- 32 bytes from `crypto.randomBytes`, base64url (43 chars). Only `sha256(token)` is stored. Lookup is
  by hash inside the request's tenant scope (RLS), so a token from shop A is unknown in shop B.
- Expiry: recovery 7 days, invoice 30 days (part 4). Revocation: `revoked_at` (part 4 revokes on draft
  delete/complete).
- **Decision:** every "Copy recovery link" mints a new token; older ones stay valid until they expire.
  Reason: only the hash is stored, so a link cannot be shown twice — and a link the merchant already
  sent must keep working.
- Storefront path: `/c/<token>`.
  **Decision:** short path `/c/…`. Reason: it is pasted into WhatsApp messages; shorter reads better
  and wraps less on phones.
- The token is a bearer secret for "resume this checkout" only: it never maps to, encodes or reveals
  the original `sessionRef`, and the claim never hands the original session to the claimer.

### 3.4 Domain and use cases (services/checkout)

- `CheckoutLink` aggregate (`domain/checkout-link.ts`): `issue(purpose, target, createdBy, now,
ttl)` → `{ link, token }`; `isUsable(now)`; `recordClaim(now, resultCheckoutRef?)`; `revoke(now)`.
  `CheckoutLinkRepository { save; findByTokenHash(hash, tenantId, tx?); latestFor(sessionId, tenantId) }`.
- `CheckoutSession` gains `recoveredFromRef?`, `recoveredOrderRef?` and
  `markRecovered(orderRef, eventId, now)` (stamps `recoveredOrderRef`, then `expire()` if still open,
  so the original browser cannot also place it). Mapper/repository persist both columns.
- `CheckoutSessionRepository.listAbandoned({ olderThan, first, after, search?, recovery?: "recovered"
| "not_recovered" }, tenantId)` — cursor by `id desc` (UUIDv7, time-ordered); `search` matches
  contact email, shipping recipient name and phone (`shipping_address->>'name'`/`'phone'` ILIKE).
- Use cases: `ListAbandonedCheckouts`, `GetAbandonedCheckout` (404 unless it matches the abandoned
  definition), `IssueRecoveryLink`, `ResolveCheckoutLink` (hash → usable link or not-found).
- `CompleteCheckout`: after the order exists, when the session has `recoveredFromRef`, load that
  session in the same tx and `markRecovered(orderRef)` (missing or already-completed original → skip).

### 3.5 Claiming a recovery link (apps/admin, public)

**Decision:** recovery clones into the opener's own session with current prices; it never transfers
the abandoned session. Reason: the original `sessionRef` stays private, prices are re-derived from
Catalog (an abandoned snapshot can be days old), and the original record stays intact for the list.

`POST /public/checkout-links/claim` (`public: true`, permission `checkout:start`, body
`{ token, sessionRef }` `.strict()`), new file `apps/admin/src/http/public-checkout-link-routes.ts`:

1. `ResolveCheckoutLink`; unusable/unknown/other tenant → the uniform 404 `{ code: "LINK_INVALID" }`.
2. Recovery: if `result_checkout_ref` names a session that is still open AND owned by this `sessionRef`,
   return it (a second tap does not clone again).
3. Otherwise: get-or-create the caller's current cart (`GetCurrentCart` / `CreateCart` with
   `sessionRef`), **clear** it (`ClearCart` — Shopify's recovery replaces the cart), then for each
   abandoned line `resolveMerchandise` and add it with the server price (unavailable lines dropped and
   counted); no line left → 409 `{ code: "ITEMS_UNAVAILABLE" }`.
4. `StartCheckout` (with `recoveredFromRef` set), load items from that cart, copy `contactEmail` and
   the shipping address (name, phone, lines, city, province, country) from the abandoned session;
   shipping/payment selection and discount codes are not copied (the shopper re-chooses; totals are
   recalculated by the normal steps).
5. `recordClaim(now, newSessionId)`; respond `{ checkoutSessionId, droppedItems: number }`.

`GET /public/checkout-links/:token/preview` (`public: true`, `checkout:read`): usable link →
`{ purpose, shopName, itemCount, items: [{ title, variantTitle, quantity, imageUrl }], totalMinor,
currency }` — no email, phone or address; otherwise the same 404. Used by the landing page and for
WhatsApp's link preview text.

Both public routes are covered by the pipeline's existing public rate limiting.

### 3.6 Admin API

| Route                                                        | Permission                | Shape                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /abandoned-checkouts?first=&after=&q=&recovery=`        | `orders:read`             | page of `AbandonedCheckoutListItemDto`                                                                                                                                                            |
| `GET /abandoned-checkouts/:checkoutSessionId`                | `orders:read`             | `AbandonedCheckoutDetailDto`                                                                                                                                                                      |
| `POST /abandoned-checkouts/:checkoutSessionId/recovery-link` | `orders:recover_checkout` | 201 `{ url: string \| null, path, expiresAt, shopName }` (admin-web composes the WhatsApp text from its dictionaries); NOT idempotent: the token must never be cached, each call mints a new link |

```ts
AbandonedCheckoutListItemDto = { id, reference /* "#" + last 8 hex of id, upper case */, createdAt,
  lastActivityAt, customerName: string | null, email: string | null, phone: string | null,
  region: string | null /* province code or city */, itemCount, totalMinor, currency,
  recoveryStatus: "not_recovered" | "recovered", recoveredOrder: { id, orderNumber } | null,
  lastLinkIssuedAt: string | null }
AbandonedCheckoutDetailDto = list fields + items (title, variantTitle, sku, qty, unit price, image),
  totals, shippingAddress, links: { issuedAt, expiresAt, claimCount }[]
```

`url` is `https://<primary verified shop hostname><path>` read through the existing tenancy domains
read (the tenancy exemption applies there); `null` when the shop has none, and admin-web then prefixes
its `STOREFRONT_URL`. **Decision:** the API builds the URL from the shop's own domain. Reason: in
multi-tenant mode one env var cannot name every shop's storefront.

### 3.7 admin-web

- **Navigation:** `orders` gets `children: [drafts (part 4), abandoned-checkouts]`; part 3 adds
  `{ id: "abandoned-checkouts", label: t.nav.abandonedCheckouts, href: "/abandoned-checkouts" }`
  ("Abandoned checkouts" / "عمليات الدفع المتروكة"); part 4 inserts Drafts before it.
- **`/abandoned-checkouts` list** (Shopify's): title "Abandoned checkouts", search ("Search by email,
  name or phone"), filter Recovery status; columns **Checkout** (reference), **Date**, **Placed by**,
  **Region**, **Recovery link** ("Not shared" / "Shared Oct 18"), **Recovery status** (badge
  "Recovered" linking the order / "Not recovered" — تم الاسترداد / لم يتم الاسترداد), **Total**.
  Empty state: "No abandoned checkouts yet" with one line on what appears here. Cursor pagination.
- **`/abandoned-checkouts/[id]` detail:** left — items card, totals card, **Recovery** card with
  **Copy recovery link** and **Share on WhatsApp** buttons and the note "Automatic recovery messages are
  coming soon"; right — Customer/contact card (email, phone with a `tel:` link), shipping address
  card; bottom — a small timeline (checkout started, last activity, each link issued and claimed,
  recovered with order link).
- **Share on WhatsApp:** server action issues the link, then the client opens
  `https://wa.me/<digits>?text=<encoded>` — `<digits>` from the session phone via a new
  `lib/whatsapp.ts` (`toWhatsAppDigits(phone, country)`: strips non-digits and a national leading
  `0`, prefixes the calling code from a table for EG 20, SA 966, AE 971, KW 965, QA 974, BH 973,
  OM 968, JO 962; no phone → `https://wa.me/?text=…` so the merchant picks the chat). Text from the
  dictionaries, e.g. ar: "أهلاً {name}، لاحظنا إنك ما كملتش طلبك من {shop}. تقدر تكمله من هنا: {url}".
  The merchant can edit the text in a small dialog before opening WhatsApp.
  **Decision:** wa.me deep link, no WhatsApp Business API. Reason: works for every merchant today with
  their own WhatsApp; API sending belongs to project 8.

### 3.8 Storefront

- `app/c/[token]/page.tsx` (server): reads the preview; shows shop header, the items summary and total,
  and one button **Continue to checkout** / **أكمل الطلب**. Invalid → a friendly "This link has expired
  or is no longer valid" panel with a link to the shop.
  **Decision:** the claim happens on the button (a server action), not on page load. Reason: WhatsApp
  and other apps fetch links to build previews; a claim on GET would clone carts for crawlers.
- Server action `claimCheckoutLink(token)` in `app/c/[token]/actions.ts`: `currentOrNewSessionRef()`
  (same helper logic as `app/cart/actions.ts`, minting the guest cookie when missing), calls the claim
  route, sets `CHECKOUT_SESSION_COOKIE` (`CHECKOUT_SESSION_COOKIE_OPTIONS`), `redirect("/checkout")`;
  with `droppedItems > 0` the checkout shows a notice "Some items are no longer available".
- `lib/runtime-api.ts`: `getCheckoutLinkPreview(token)`, `claimCheckoutLink(token, sessionRef)`.
- `generateMetadata` on the page sets `og:title` = shop name + "Complete your order" (no personal data).
- en/ar strings in the storefront dictionaries.

### 3.9 Testing (part 3)

Domain: link issue/expiry/revoke/claim, token never persisted (repository test asserts only the hash),
`markRecovered` expires the original. Repository: `listAbandoned` definition (each excluded case:
completed, failed, expired, fresh, no contact, empty items), search, recovered rows kept, tenant
isolation for links. Routes: claim flow (clone, re-price, dropped items, all dropped, second tap
reuse, other session's claim clones its own, expired/revoked/other-tenant → same 404), preview
contains no PII, admin list/detail/issue permissions. Completion marks the original recovered.
Storefront: landing page states, action sets cookies and redirects, no claim on render.
admin-web: list columns and filter, copy and WhatsApp buttons (`toWhatsAppDigits` unit tests).

---

## Part 4 — Draft orders and payment link

### 4.1 Shape and reuse

**Decision:** a draft is its own aggregate in `services/orders`, and turning it into an order runs
the checkout pipeline (cart → checkout session → `CompleteCheckout`) instead of the legacy
`POST /orders`. Reason: the pipeline already does server pricing, totals, tax, stock reservation,
discount snapshot, guest-customer resolution, order numbering and the payment intent; `POST /orders`
(`Order.place()`) has client prices and none of those. The "Send invoice" link then resumes that same
kind of session, so one path serves both outcomes.

**Decision:** `/orders/new` redirects to `/draft-orders/new` and the Orders page's **Create order**
opens a new draft (Shopify's behaviour); the legacy `OrderCreateForm` / `placeOrderAction` are removed;
the `POST /orders` API is left untouched. Reason: one way to create orders in the merchant UI, no API
break for other callers or tests.

### 4.2 Data model

Migration `20261018030000_draft_orders`:

```sql
CREATE TABLE "orders"."draft_orders" (
  "id"               UUID NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "draft_number"     TEXT NOT NULL,                 -- "D1", "D2", … per shop
  "status"           TEXT NOT NULL,                 -- open | invoice_sent | completed
  "currency"         TEXT NOT NULL,
  "customer_ref"     TEXT,                          -- existing customer, or null for a guest
  "contact_email"    TEXT,
  "contact_phone"    TEXT,
  "shipping_address" JSONB NOT NULL DEFAULT '{}',   -- recipient name/phone, lines, city, province, postal, country
  "billing_address"  JSONB NOT NULL DEFAULT '{}',   -- {} = same as shipping
  "lines"            JSONB NOT NULL DEFAULT '[]',   -- [{ productRef, variantRef, sku, title, variantTitle, quantity, unitPriceMinor }]
  "discount"         JSONB NOT NULL DEFAULT '{}',   -- { valueType: fixed|percentage, value, reason? }
  "shipping"         JSONB NOT NULL DEFAULT '{}',   -- { kind: rate|custom|free, title, amountMinor, method? }
  "note"             TEXT,
  "tags"             JSONB NOT NULL DEFAULT '[]',
  "checkout_ref"     TEXT,                          -- the session currently materialised for it
  "checkout_version" INTEGER,                       -- draft version that session was built from
  "order_ref"        TEXT,
  "invoice_sent_at"  TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "deleted_at"       TIMESTAMP(3),
  "created_by"       TEXT NOT NULL,
  "version"          INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "draft_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "draft_orders_status_check" CHECK ("status" IN ('open','invoice_sent','completed'))
);
CREATE UNIQUE INDEX "draft_orders_tenant_id_draft_number_key" ON "orders"."draft_orders"("tenant_id", "draft_number");
CREATE INDEX "draft_orders_tenant_id_status_idx" ON "orders"."draft_orders"("tenant_id", "status");
-- + ENABLE/FORCE RLS + tenant_isolation policy.

ALTER TABLE "orders"."order_number_counters" ADD COLUMN "last_draft_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "draft_terms" JSONB NOT NULL DEFAULT '{}';
```

**Decision:** draft numbers come from a new column on the existing counter row
(`INSERT … (tenant_id, last_number, last_draft_number) VALUES ($t, 1000, 1) ON CONFLICT DO UPDATE SET
last_draft_number = last_draft_number + 1`, in the draft's transaction). Reason: same atomic pattern as
order numbers with no new table; inserting `last_number = 1000` keeps a new shop's first order at #1001.

**Decision:** deleting a draft is a soft delete (`deleted_at`), only for `open`/`invoice_sent` drafts.
Reason: a sent invoice link must resolve to "no longer available", not to a missing row.

### 4.3 What a draft can contain

- Lines: catalog variants only, priced server-side with `resolveMerchandise` every time the draft is
  saved (the browser sends `{ productId, variantId, quantity }`, never a price). Max 100 lines.
  **Decision:** no custom line items and no per-line price override in this version. Reason: order
  items need a product/variant for stock reservation, fulfillment and reports; the order-level
  discount covers the usual "special price for you" case.
- Discount: one order-level custom discount, fixed amount or percentage (0–100), optional reason
  (shown as the discount title, default "Custom discount" / "خصم مخصص"); computed on the subtotal,
  capped at it.
- Shipping: chosen from the shop's rates for the draft's address (`POST /draft-orders/:id/shipping-rates`
  via the same `ShippingCalculationPort` checkout uses), or custom (title + amount), or free.
- Customer: pick an existing customer (customers list search) or a guest email and/or phone; shipping
  address with recipient name and phone; billing = shipping unless filled.
- Note and tags (copied to the order on completion).
- Totals shown on the draft: subtotal, discount, shipping, estimated tax (`TaxCalculationPort` with the
  address; "Calculated after an address is added" without one), total — computed by the API on read.

**Decision:** drafts do not reserve stock; stock is checked and reserved when the order is created
(`CompleteCheckout`). Reason: Shopify's default; reserving for open drafts would lock stock for quotes
that never convert.

### 4.4 Checkout changes: draft terms

`CheckoutSession` gains `draftTerms?: { draftOrderRef, draftNumber, discount?: { title, amountMinor },
shipping: { title, amountMinor } }` (persisted in `draft_terms`, `{}` = none) and
`applyDraftTerms(terms)` (open sessions only), plus `transferOwnership(sessionRef)` (open sessions only;
used by the invoice claim). With draft terms:

- `refreshDiscounts` does not call Promotions; it writes a snapshot with one applied entry
  `{ promotionId: "draft:<draftId>", title, discountClass: "order", amountMinor }` (or none).
  `DiscountUsageAdapter` skips `draft:` entries.
- Shipping is fixed: the session's shipping selection is set from `terms.shipping` (method `draft`)
  and `SelectShipping`/shipping-quote are refused.
- Public routes refuse to change what the merchant fixed: `items`, `shipping-quote`,
  `shipping-selection`, `discount-codes` (add/remove) answer 409 `{ code: "DRAFT_LOCKED" }`. Contact,
  addresses, tax, payment selection, complete and payment stay open to the shopper.
- `PublicCheckoutSessionDto` gains `draftInvoice: { draftNumber } | null`; the storefront hides the
  discount-code field and the shipping-method choice when it is set.

**Decision:** a draft's price is final: automatic discounts and codes are not evaluated for draft
sessions. Reason: the customer must pay exactly what the merchant quoted on WhatsApp; a code stacking
on a negotiated price is a loss the merchant did not agree to.

### 4.5 Materialisation (apps/admin)

`materializeDraftCheckout(admin, draft, tenantId)` in `apps/admin/src/http/draft-order-checkout.ts`:

1. If `draft.checkoutRef` names an open session and `draft.checkoutVersion === draft.version`, reuse it.
2. Otherwise expire that old session (if open) and build a new one: a cart with a server-minted
   `sessionRef` (32 random bytes, never returned), lines added with the draft's server-resolved
   prices; `StartCheckout` (`customerRef` = draft customer or none); load items; contact email (if
   any); shipping and billing address; `applyDraftTerms`; recalculate totals; tax.
3. Save `checkoutRef` + `checkoutVersion` on the draft.

Validation before materialising: ≥1 line, a shipping address with country/city/line1, a shipping
choice. Direct completion of a guest draft additionally needs an email.

**Decision:** a guest draft can be completed directly only with an email; a phone-only guest draft can
be sent as an invoice (the shopper types an email at checkout). Reason: Identity resolves guest
customers by email only (`OrderCreationAdapter.resolveGuestCustomerRef`); phone-only customers are an
Identity change for the customers project, flagged as a follow-up.

### 4.6 Completing a draft

`POST /draft-orders/:id/complete` body `{ payment: "paid" | "collect_on_delivery" }`:

1. Materialise (4.5). Select payment on the session server-side: `cod` for collect on delivery,
   `manual` for paid (bypassing the "offered at checkout" list — this is the merchant's own action).
2. `CompleteCheckout` with idempotency key `draft:<draftId>:<version>` (a retry never creates two
   orders); `OUT_OF_STOCK:`/validation errors come back as field errors on the draft page.
3. `InitiatePayment` (order → `payment_requested`, as for a storefront COD order).
4. `paid` only: settle through `ConfirmCodCollection` with the intent's own amount (eligibility is by
   capability, so `manual` qualifies unchanged) → Payments captures → `PaymentCapturedConsumer` marks
   the order paid through `MarkOrderPaid` (payment truth preserved).
5. Mark the draft `completed` (`orderRef`, `completedAt`), revoke its invoice links, copy note and tags
   onto the order and append a `created_from_draft` timeline entry ("Order created from draft #D3").

**Decision:** "Mark as paid" uses a new built-in payment provider `manual` ("Manual payment" / "دفع
يدوي" — bank transfer, InstaPay, wallet) registered in `built-in-provider-registrations.ts` with COD's
capabilities (`settlesAtPayTime: true, deliversWebhooks: false, requiresMerchantCredentials: false,
chargesOffSession: false`), never listed by `PaymentMethodPort.enabledMethods` nor in payment settings.
Reason: the money is recorded in Payments like every other payment, and the order page shows the
truth ("Manual payment"), not "Cash on delivery".

**Decision:** draft completion is reported back when the shopper pays through the link: after the
order exists, `CompleteCheckout` calls a new optional `DraftOrderCompletionPort.complete({
draftOrderRef, orderRef })` (adapter → `CompleteDraftFromCheckout` in services/orders; best effort,
idempotent, logged on failure like discount usage), and `GetDraftOrder` self-heals an
`invoice_sent` draft whose session is completed. Reason: the draft must never stay "Invoice sent"
after the customer paid, even if the best-effort call failed.

### 4.7 Invoice link

`POST /draft-orders/:id/invoice-link` (`orders:draft`) validates as in 4.5, materialises, issues a
`CheckoutLink` (`purpose: "invoice"`, `draftOrderRef`, 30 days), sets `status = invoice_sent` and
`invoiceSentAt`, returns `{ url, path, expiresAt, shopName }` like the recovery link (and, like it, is not idempotent: the token must never be cached).

**Decision:** the invoice link points to the draft, not to one session. Reason: editing a draft after
sending must not break the link the customer already has — the claim re-materialises from the latest
draft (4.5 step 2) when the draft changed.

Claim (same `POST /public/checkout-links/claim`), invoice branch: draft deleted → 404; draft completed
→ 409 `{ code: "ALREADY_COMPLETED" }` (landing page: "This order has already been placed");
otherwise materialise, `transferOwnership(callerSessionRef)` on the session, `recordClaim`, return
`{ checkoutSessionId }`. **Decision:** the last opener owns the invoice checkout. Reason: the link is
the bearer secret by design (customer forwards it to a family member who pays); the server-minted
`sessionRef` is never exposed, and expiry/revocation bound the risk. Preview for an invoice shows
"Invoice #D3 from <shop>" + items + total.

### 4.8 Admin API

| Route                                        | Permission                                                                            | Shape                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /draft-orders?status=&q=&first=&after=` | `orders:read`                                                                         | page of `{ id, draftNumber, createdAt, customerName, status, totalMinor, currency, orderRef, orderNumber }` |
| `POST /draft-orders`                         | `orders:draft`                                                                        | `DraftOrderInput` → 201 `DraftOrderDto`; `idempotent: true`                                                 |
| `GET /draft-orders/:id`                      | `orders:read`                                                                         | `DraftOrderDto` (lines with images, computed totals, customer, links)                                       |
| `PUT /draft-orders/:id`                      | `orders:draft`                                                                        | full `DraftOrderInput` + `version` (optimistic lock → 409 on stale); not allowed when completed             |
| `DELETE /draft-orders/:id`                   | `orders:draft`                                                                        | soft delete; not when completed                                                                             |
| `POST /draft-orders/:id/shipping-rates`      | `orders:draft`                                                                        | `{ rates: [{ method, title, amountMinor }] }` for the draft's address                                       |
| `POST /draft-orders/:id/invoice-link`        | `orders:draft`                                                                        | as 4.7                                                                                                      |
| `POST /draft-orders/:id/complete`            | `orders:complete_draft` (+ `payments:confirm_cod_collection` when `payment = "paid"`) | 200 `{ orderId, orderNumber }`                                                                              |

```ts
DraftOrderInput = { customerId?: string | null, email?: string | null, phone?: string | null,
  shippingAddress?: AddressInput | null, billingAddress?: AddressInput | null,
  lines: { productId: string; variantId?: string; quantity: number }[],
  discount?: { valueType: "fixed" | "percentage"; value: number; reason?: string } | null,
  shipping?: { kind: "rate"; method: string } | { kind: "custom"; title: string; amountMinor: number }
           | { kind: "free" } | null,
  note?: string | null, tags?: string[] }
```

Merchant-entered amounts (custom shipping, fixed discount) are accepted only on these authenticated
admin routes, bounded (≥ 0, ≤ 10,000,000 minor units; percentage 0–100), and a `rate` shipping is
re-priced server-side from the method. Use cases in services/orders: `CreateDraftOrder`,
`UpdateDraftOrder`, `DeleteDraftOrder`, `GetDraftOrder`, `ListDraftOrders`, `MarkDraftInvoiceSent`,
`CompleteDraftFromCheckout`; `DraftOrderRepository` (tenantId per call) + `DraftNumberAllocator`.

### 4.9 admin-web (Shopify's layout)

- **Navigation:** Orders children become **Drafts** (`/draft-orders`, "Drafts" / "المسودات") then
  **Abandoned checkouts**.
- **`/draft-orders` list:** title "Drafts", button **Create order**; tabs **All**, **Open**, **Invoice
  sent**, **Completed** (الكل / مفتوحة / تم إرسال الفاتورة / مكتملة); search; columns **Draft order**
  (#D3), **Date**, **Customer**, **Status**, **Total**; a completed row links its order number.
- **`/draft-orders/new` and `/draft-orders/[id]`** (title "Create order" for new, "#D3" with status
  badge otherwise; **More actions → Delete draft**):
  - Left: **Products** card — search field + **Browse** (product/variant picker dialog reusing the
    discounts pickers' product search), lines with image, title, variant, SKU, quantity stepper, price,
    line total, remove. **Payment** card — Subtotal; **Add discount** (dialog: amount/percentage +
    reason); **Add shipping or delivery** (dialog: shop rates for the address, custom, free);
    Estimated tax; **Total**; footer buttons **Send invoice** and **Collect payment ▾** with
    **Mark as paid** (admins only; others see it disabled with a tooltip) and **Collect on delivery**
    (Shopify's "Payment due later" mapped to COD — تحصيل عند الاستلام).
  - Right: **Notes** card, **Customer** card (search existing customer, or "Guest" with email and
    phone; contact info; shipping address; billing "Same as shipping address"), **Tags** card.
  - Save bar "Unsaved changes" with **Discard** / **Save** (as product and discount pages); Send
    invoice / Collect payment save first.
  - **Send invoice dialog:** link field with **Copy link**, **Share on WhatsApp** (same `lib/whatsapp.ts`,
    editable message "أهلاً {name}، دي فاتورة طلبك #{draft} من {shop} بإجمالي {total}. تقدر تدفع من هنا:
    {url}"), and a disabled "Email invoice — coming soon" line (project 8).
  - Completed draft: read-only, banner "This draft order was completed" with a link to the order.
- **Order page:** for orders created from a draft, the timeline entry links back to the draft.

### 4.10 Storefront

- `/c/[token]` (part 3) handles `purpose: "invoice"`: title "Invoice #D3", button **Pay now** /
  **ادفع الآن**; `ALREADY_COMPLETED` → "This order has already been placed".
- `checkout-view.tsx`: when `session.draftInvoice` is set, hide the discount-code field and the
  shipping-method step (show the fixed shipping line), keep contact, address and payment; the
  order summary shows the draft's discount title. The cart page is not involved.

### 4.11 Testing (part 4)

Domain: `DraftOrder` invariants (lines, limits, discount cap, status transitions, soft delete),
draft-number allocator. Checkout: `applyDraftTerms` totals, promotions skipped, `DRAFT_LOCKED` on each
locked public route, `transferOwnership` only while open, usage adapter skips `draft:` entries.
Materialisation: reuse vs rebuild on version change, old session expired, prices from Catalog.
Completion: COD path leaves payment pending; paid path ends `payment_received` through Payments with
a `manual` intent; idempotent retry creates one order; out-of-stock surfaces; permission split for
paid. Invoice: link issue, claim transfers ownership, edit after send re-materialises, completed →
409, deleted → 404, completion via link marks the draft completed (port and self-heal). admin-web:
editor layout, pickers, dialogs, save bar, role-gated Mark as paid, `/orders/new` redirect.
Storefront: invoice landing, locked checkout UI. E2E (apps/e2e, when an environment is available):
create draft → send invoice → open link in a fresh browser → pay COD → draft shows Completed and the
order exists with the custom discount.

---

## Security and multi-tenancy

- **Tenant scoping.** Every new table has `tenant_id` + forced RLS `tenant_isolation`; every new
  repository method takes `tenantId` per call and reads through `runReadScoped` or the caller's `tx`;
  link lookup by token hash runs inside the request tenant's scope, so cross-shop tokens are unknown.
- **Links.** 256-bit random tokens, SHA-256 at rest, expiring (7 / 30 days), revocable, claim counted.
  The original guest `sessionRef` is never stored in, derived into, or returned by any link flow;
  recovery clones, invoice sessions use a server-minted `sessionRef` that is replaced by the claimer's
  own cookie value. Claims happen on an explicit user action, not on GET. Preview responses carry no
  email, phone or address.
- **Prices.** Public routes accept no amounts (claim body is `{ token, sessionRef }`); recovery
  re-prices from Catalog; draft lines are priced server-side; the only merchant-entered amounts are
  custom shipping and fixed discount on authenticated admin routes, bounded and validated.
- **Money.** Marking paid always produces a captured Payments record (`manual` provider, confirmed
  collection) and is admin-only; capture and COD settlement in bulk reuse the existing guarded calls.
- **PII.** Export is operator/admin-only, capped, and formula-guarded; abandoned checkouts are behind
  `orders:read` like orders themselves.
- **Concurrency.** Annotations never touch the `Order` version; drafts use optimistic locking;
  completion is idempotent by `draft:<id>:<version>`; a merchant completion expires any open invoice
  session first, so a customer and the merchant cannot both create the order.

## Delivery order

Each part has its own implementation plan, branch commits, review and deploy (migration first, then
the release that reads it). Later parts only add to earlier ones.

| #   | Plan                                                                                           | Migration                                  | Depends on                                                  |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| 1   | Order list operations (tabs, archive, bulk fulfil/capture/cash/archive, packing slips, export) | `20261018000000_order_archive`             | —                                                           |
| 2   | Notes, tags, timeline comments (+ tag filter/column, bulk tags, tags/note in export and slips) | `20261018010000_order_notes_tags_timeline` | 1 (bulk endpoint, export rows)                              |
| 3   | Abandoned checkouts + recovery link + storefront `/c/<token>`                                  | `20261018020000_checkout_recovery_links`   | — (nav child added here)                                    |
| 4   | Drafts + invoice link + `manual` provider + `/orders/new` redirect                             | `20261018030000_draft_orders`              | 3 (links, landing page), 2 (note/tags copy, timeline entry) |

## Decisions (for the owner to check)

1. Tabs: All = everything incl. archived; Unfulfilled = Home card definition + not archived; Unpaid = open, not archived, payment pending; Open = not cancelled/closed/archived; Archived = archived flag.
2. "Unfulfilled" does not include orders whose fulfillment is already in progress — one definition with Home.
3. Archive is a reversible `archived_at` column, not the lifecycle's `closed` event.
4. Archive, note, tags and comments live outside the `Order` aggregate and never bump its version.
5. Open/Unpaid filters are SQL `NOT EXISTS` predicates on events, not capped scans.
6. Search also matches the recipient's name and phone.
7. Bulk "Fulfill items" opens fulfillments; no instant "Mark as fulfilled" shortcut (would skip reservation).
8. Bulk actions are per order, non-atomic, max 50, with per-order results.
9. Extra bulk action "Mark cash as received" (admin-only) for courier remittances.
10. No bulk cancel.
11. Page size 50; selection is per page.
12. Export: one row per order (courier format), CSV for Excel (UTF-8 BOM), five Shopify scopes, 5,000-order synchronous cap.
13. CSV formula guard that keeps `+20…` phones intact.
14. Export is operator/admin only (`orders:export`), not viewers.
15. Note on the order row; tags in `order_tags` (case-insensitive, Shopify limits); comments + activity in `order_timeline_entries`.
16. Comment author name snapshotted from Security at write time; authors edit/delete own comments, admins delete any; deletes are soft.
17. Abandoned = derived query (open, idle ≥ 60 min, items, email or phone, not a draft session) — no background job; recovered ones stay listed.
18. Idle threshold 60 minutes.
19. Recovery clones into the opener's own cart/session with current Catalog prices and replaces their cart; the abandoned session is never transferred; on completion the original is stamped recovered and expired.
20. Link tokens: 256-bit, hash-only storage, 7-day recovery / 30-day invoice expiry, new token per copy.
21. Short storefront path `/c/<token>`; claim on a button press, not on page load (link-preview bots).
22. API builds link URLs from the shop's primary domain (fallback admin-web `STOREFRONT_URL`).
23. WhatsApp sharing via `wa.me` deep links with an editable localized message; no WhatsApp API.
24. Automatic recovery messages and emailed invoices are out (project 8).
25. Drafts are a `services/orders` aggregate and become orders through the checkout pipeline, not legacy `POST /orders`.
26. `/orders/new` redirects to `/draft-orders/new`; legacy create form removed; `POST /orders` API kept.
27. Draft lines are catalog variants priced server-side; no custom line items or per-line price overrides (yet).
28. One order-level custom discount; draft prices are final (no automatic discounts or codes on draft sessions).
29. Draft shipping is fixed by the merchant (shop rate, custom, or free).
30. Drafts do not reserve stock; stock is reserved at completion.
31. Draft numbers `#D1…` from a new column on the existing counter row.
32. Draft delete is soft.
33. "Mark as paid" uses a new built-in `manual` provider settled via confirmed collection; admin-only.
34. "Collect on delivery" = Shopify's "Payment due later", creating a COD order with payment pending.
35. Phone-only guest drafts can be invoiced but not completed directly (Identity needs email) — follow-up for the customers project.
36. Invoice link points to the draft and re-materialises after edits; last opener owns the invoice checkout.
37. Draft completion through the link is reported by a best-effort port plus self-heal on read.
38. New permissions under `orders:*` (operators yes, viewers read-only); money actions require `payments:confirm_cod_collection`.
39. Sidebar: Orders → Drafts, Abandoned checkouts (Shopify order); routes `/draft-orders`, `/abandoned-checkouts`.
40. Four separate plans in the order 1 → 2 → 3 → 4.
