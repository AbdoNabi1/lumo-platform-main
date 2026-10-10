# Orders Like Shopify (Plan 3B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** صفحة الطلب وقايمة الطلبات دلوقتي **أدوات مطوّرين** مش شاشة تاجر.
>
> **المشاكل:**
>
> - **رقم الطلب** طويل (`#ORD-01a12259-…`).
> - **طريقة الدفع مش ظاهرة:** الطلب مش مربوط بالدفعة، فبيقول "No payment has been requested". وعشان كده كمان زرار "تم استلام الفلوس" مش بيظهر، والطلب عمره ما بيبقى "مدفوع".
> - **القايمة** بتقول "Customer 149F27" بدل اسم العميل.
> - **المقاس** مش ظاهر جنب المنتج، فبيبان كأن المنتج متكرر.
> - **الدولة** مكتوبة "EG".
> - **فوق** فيه أدوات زي "Advance to…" و"Payment reference".
>
> **الخطة دي بتخليها زي شوبيفاي:**
>
> - **رقم طلب** زي `#1001` و`#1002`. الطلبات القديمة كمان بتاخد أرقام بالترتيب.
> - **حالتين منفصلتين** لكل طلب، زي شوبيفاي:
>   - حالة الدفع: **"في انتظار الدفع"** أو **"مدفوع"** أو **"مسترد"**.
>   - حالة التجهيز: **"لم يتم التجهيز"** أو **"قيد التجهيز"** أو **"تم التجهيز"**.
>     وده بيخلّي طلب الكاش يتشحن قبل ما يتدفع.
> - **صفحة الطلب:**
>   - فوق: الرقم والحالتين والتاريخ، وزرار "إجراءات أخرى" (إلغاء الطلب…).
>   - كارت **"لم يتم التجهيز (3)"** فيه المنتجات بالمقاس والـ SKU وطريقة الشحن، وزرار **"تجهيز المنتجات"**.
>   - كارت **الدفع** فيه المجموع والشحن والضريبة والإجمالي، و"المدفوع" و"المتبقي على العميل"، وطريقة الدفع (الدفع عند الاستلام)، وزرار **"تحديد كمدفوع"**.
>   - على الجنب: العميل (الاسم والإيميل والموبايل)، وعنوان الشحن مع زرار **نسخ** ولينك **الخريطة**، وعنوان الفواتير.
>   - **الأدوات المتقدمة** تتخبّى تحت "متقدم".
> - **قايمة الطلبات:** الرقم، والتاريخ ("النهارده الساعة 8:27")، واسم العميل، والإجمالي، وحالة الدفع، وحالة التجهيز، وعدد المنتجات، وطريقة الشحن.
>
> **فيه migration واحدة** (عدّاد أرقام الطلبات، وترقيم الطلبات القديمة). هتطبّقها لما Sonnet يقولك.

**Goal:**

- The admin order page and orders list look and behave like Shopify's.
- A checkout payment is linked to its order, so COD can be marked paid.
- Orders get short sequential numbers.

**Architecture:**

- **Sequential numbers.** A new table `orders.order_number_counters (tenant_id PK, last_number INT)` under FORCE RLS.
  - An `OrderNumberAllocator` port in `services/orders`:
    - the Prisma adapter runs one atomic `INSERT … ON CONFLICT (tenant_id) DO UPDATE SET last_number = last_number + 1 RETURNING last_number`, inside the order-creation transaction;
    - the in-memory adapter counts for tests.
  - Numbers start at **1001** and are stored as `"1001"`; the UI shows `#1001`.
  - The migration renumbers existing orders per tenant by `created_at` (1001, 1002, …) and seeds the counter.
- **Payment ↔ order link.** Today `CheckoutPaymentInitiationAdapter` opens the intent but never tells Orders, so `order.paymentRef` stays null and `PaymentCapturedConsumer` refuses an order still at `created` (G-121).
  - New Orders use case `RecordCheckoutPayment({ orderId, paymentRef })`. It walks a `created` order through `confirmed → awaiting_payment → payment_requested(paymentRef)`, which is the existing transition table, unchanged.
  - It is idempotent: the same `paymentRef` already recorded → ok, no new events.
  - Any other state → `BusinessRuleError`, logged by the caller and **not** failing the shopper's payment.
  - The adapter calls it right after a 201 from `createIntentLifecycle`.
  - Then COD's `cod-collection` → `payment.captured` → `completePayment` → `payment_received`. **This closes G-121.**
- **Shopify statuses, derived — never stored.**
  - `paymentStatus`, from the order's history:
    - `paid`: the history has `paid` or `payment_received`;
    - `refunded`: `refunded` or `refund_requested`;
    - `voided`: `cancelled` before any payment;
    - `pending`: otherwise.
  - `fulfillmentStatus`, from the **Fulfillment** context's fulfillment order for this order:
    - `unfulfilled`: none;
    - `in_progress`: opened but not shipped;
    - `fulfilled`: shipped;
    - `delivered`: delivered.

    Map Fulfillment's real status values; read them first.

  - Both are computed server-side by pure functions and returned by `GET /orders` and `GET /orders/:id`. Fulfillment is independent of payment, as in Shopify, so a COD order can be fulfilled while payment is pending.
- **Order DTO additions:**
  - **list:** `customerName` (shipping `recipientName`, else null), `itemCount` (sum of quantities), `shippingMethod`, `paymentStatus` and `fulfillmentStatus`;
  - **detail:** the same, plus items' `variantTitle` and `sku`, and `paymentProvider` (from the intent, when linked).
  - `shippingMethod` is snapshotted into the order's `totals` JSON at creation (no migration); older orders have null.
- **Admin-web UI:**
  - a new order page layout;
  - a new orders table;
  - the old controls move into a collapsed **Advanced** section.

**Tech Stack:** TypeScript, Prisma 6 (no upgrade), zod, vitest, Next.js 15, React 19, `@platform/ui`.

**Spec:**

- Owner screenshots, 2026-10-09: the order page (Created, "No payment has been requested", an Actions card with Advance/Payment reference/Mark paid) and the list ("Customer 149F27", `#ORD-<uuid>`).
- Owner request: "مش موجود طريقة الدفع جوه الاوردر. عدل كل التفاصيل خليها زي شوبيفاي".
- Gap G-121.

## Global Constraints

Same as Plan 3A. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Before every commit, check `git diff --cached --stat`. Run prettier only on files you changed.

### Database

- **Never connect to any database.** The owner applies the migration from Railway.
- **Never set `TENANT_MODE=multi`.** No guard exemptions. No new `TENANT_DEFAULT_ID` reads. **Do not upgrade Prisma.**
- **Push order:**
  - Task 1 (the SQL only) is pushed alone.
  - Everything else is committed locally and pushed only after the owner confirms the migration (Task 8).

### Security

- **Security assertions from Plans 2A, 2C-1, 2B-1, 2B-3 and 3A stay green and unchanged.**
- Name, phone and email are staff-only. **The public API never returns an order.**

### App rules

- Runtime API calls only from server code. One idempotency key per write. `toFormState` for every non-`ok` outcome.
- Both message files get every key. Logical RTL classes only.
- No `autoFocus`. No async function without `await`.
- Dates and money go through the existing `formatDateTime` / `formatCurrency` helpers, or `Intl` with the page locale.
- Country names come from `new Intl.DisplayNames([locale], { type: "region" })`, falling back to the raw value.

### Commands

- Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings.
- Packages: `@platform/orders`, `@platform/fulfillment`, `@platform/payments`, `@platform/checkout`, `@platform/admin`, `admin-web` and `@platform/db`. Use the real names from `package.json`.

---

### Task 1: Migration (pushed alone)

**File:** `packages/db/prisma/schema/migrations/20261012000000_order_numbers/migration.sql`

**First:** grep the whole repo for every use of `order_number` / `orderNumber` outside `services/orders`.

- If any **other table** stores an order number as a key or a join column, **STOP and report it**, because renumbering would break that link.
- Event payloads and log lines that only carry it as text are fine; list them in the report.

```sql
-- Plan 3B — short sequential order numbers (#1001, #1002, …) per shop. Written by hand, NOT applied
-- by the agent; the owner deploys it from Railway's Console BEFORE the release that allocates numbers.
SET row_security = off;

CREATE TABLE "orders"."order_number_counters" (
  "tenant_id"   TEXT NOT NULL,
  "last_number" INTEGER NOT NULL,
  CONSTRAINT "order_number_counters_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "orders"."order_number_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_number_counters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_number_counters";
CREATE POLICY tenant_isolation ON "orders"."order_number_counters" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Existing orders: 1001, 1002, … per shop, oldest first.
UPDATE "orders"."orders" AS o
SET "order_number" = n.num::text
FROM (
  SELECT "id", 1000 + ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS num
  FROM "orders"."orders"
) AS n
WHERE o."id" = n."id";

INSERT INTO "orders"."order_number_counters" ("tenant_id", "last_number")
SELECT "tenant_id", 1000 + COUNT(*) FROM "orders"."orders" GROUP BY "tenant_id";

RESET row_security;
```

- **Check the unique index.** The `(tenant_id, order_number)` unique constraint must not trip during the UPDATE. The old values are `ORD-…` and the new ones are digits, so they cannot collide.
- **Check the grants.** Any GRANT the runtime role needs on new tables: copy exactly what `20260923000000_wp13_merchant_payments` does for its new table, if anything.
- Update `packages/db/src/schema-migration-consistency.test.ts` only if it requires it. If it forces the `orders.prisma` model into this commit, include the model (nothing reads it yet), and say so.

Run `pnpm.cmd --filter @platform/db run test`. Commit and push **alone**:

```bash
git commit -m "feat(db): add per-shop order number counters and renumber existing orders"
git push origin morbeh/w0-w17-w12
```

Print for the owner, in Arabic, and continue:

> لما Railway يخلّص النشر (حوالي 5 دقايق)، طبّق من runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261012000000_order_numbers`. ابعتلي الناتج.

---

### Task 2: Sequential order numbers

**Files:**

- `services/orders`:
  - an `OrderNumberAllocator` port (`next(tenantId, tx?)`);
  - an in-memory adapter;
  - a Prisma adapter (`$queryRaw` with the upsert above, run inside the same transaction / tenant context the repository uses for the order insert);
  - `create-order-from-checkout.use-case.ts` and `place-order.use-case.ts`: use the allocator instead of `` `ORD-${id}` ``;
  - the composition wiring.
- `packages/db/prisma/schema/orders.prisma`: the `OrderNumberCounter` model (`@@schema("orders")`, `@@map("order_number_counters")`).

**Rules:**

- **The allocation runs inside the order's transaction.** A failed order creation must not burn a number; if it does by design, say so.
- **`OrderNumber.create`** must accept digit strings. Read its validation first.
- **Tests:**
  - two orders in one tenant get `1001` then `1002`;
  - another tenant starts at `1001`;
  - the Prisma adapter test asserts the SQL shape (or, if the repo has a Postgres-backed test harness that runs in CI, use it, but never point it at a real database yourself).
- `prisma-tenant-where.guard`: the raw query must carry `tenant_id`, and pass the guard as written. **No exemption.**

Commit: `feat(orders): number orders 1001, 1002, … per shop`.

---

### Task 3: Link a checkout payment to its order (closes G-121)

**Files:**

- `services/orders`:
  - `RecordCheckoutPayment` use case (+ test), plus a controller method;
  - the `PaymentCapturedConsumer` test that pinned G-121 is updated to the new behavior, and the change is listed in the report.
- `apps/admin/src/infrastructure/cross-context/checkout-payment.adapters.ts`: after a 201, call it. On failure, log `warn` with the order id only (no PII) and still return the intent.
- `apps/admin/src/composition.ts`: pass the orders controller to the adapter (lazy cell if needed, like `lazyPaymentsController`).

**Rules:**

- **From `created`:** record `confirmed`, `awaiting_payment` and `payment_requested` (`paymentRef` = intent id) in **one** save. These are the existing transitions, unchanged.
- **Idempotent:** same `paymentRef` and already `payment_requested` or later → ok, no events.
- **Other states** (cancelled, or a different `paymentRef`) → `BusinessRuleError`.
- **The storefront retry path** (`initiatePayment` when the session already has an intent) must not call it twice with a new ref. It returns the existing intent, so the call is a no-op.

**Tests:**

- **Unit:** from `created` → `payment_requested` with the ref; the second call is a no-op; cancelled → error.
- **Admin e2e (guest checkout file):** the COD guest checkout completes and initiates. Then:
  1. the order has `paymentRef` and status `payment_requested`;
  2. `POST /payment-intents/:id/cod-collection` with the full amount;
  3. the order's `paymentStatus` is `paid`.

Commit: `fix(orders): link a checkout payment to its order so cash on delivery can be marked paid`.

---

### Task 4: Shopify statuses and richer order DTOs

**Files:**

- `services/orders`:
  - pure `derivePaymentStatus(history)`, with tests;
  - the totals snapshot gains an optional `shippingMethod` (JSON, no migration);
  - the list and detail presenters.
- `apps/admin`:
  - `OrderCreationAdapter` passes the session's selected shipping method into the order totals;
  - the `GET /orders` and `GET /orders/:id` handlers add `fulfillmentStatus` from the Fulfillment context.
    - **List:** use one batched read per page, adding a tenant-scoped `findByOrderRefs` to the fulfillment repository if none exists. **No per-order calls.**
    - **Detail:** the existing single lookup.
  - Add `paymentProvider` on the detail, via `getPaymentIntent` when `paymentRef` is set.
- `services/fulfillment`: the batched read (+ test), only if needed.

**`fulfillmentStatus` mapping.** Read Fulfillment's status values first, and put the mapping table in the report.

- no fulfillment order → `unfulfilled`;
- opened, reserved, picking or packing → `in_progress`;
- shipped / in transit → `fulfilled`;
- delivered → `delivered`;
- cancelled → `unfulfilled`.

**List DTO additions:** `customerName`, `itemCount`, `shippingMethod`, `paymentStatus` and `fulfillmentStatus`.

**Detail DTO additions:** `paymentStatus`, `fulfillmentStatus`, `paymentProvider`, `shippingMethod`, and per item `variantTitle` and `sku`. Use what the order item already stores; check `order_items.variant_title` and `sku`.

**Tests:** the derivation functions over every listed state, presenter tests, and the batched lookup.

Commit: `feat(orders): shopify payment and fulfillment statuses, customer name and item details`.

---

### Task 5: Orders list like Shopify

**Files:** `apps/admin-web/src/components/orders/orders-table.tsx` (+ test), `lib/api/orders.ts` (types) and messages.

**Columns, in this order:**

| Column                 | Content                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Order**              | `#1001`, bold, linking to the order                                                                                                                                                                                       |
| **Date**               | Relative like Shopify: "Today at 8:27 pm", "Yesterday at …", or "Oct 7 at …"; `title` holds the full date                                                                                                                 |
| **Customer**           | `customerName`, or "No customer" muted                                                                                                                                                                                    |
| **Total**              | Formatted                                                                                                                                                                                                                 |
| **Payment status**     | A badge: pending → "Payment pending" / "في انتظار الدفع" (warning); paid → "Paid" / "مدفوع" (neutral); refunded → "Refunded" / "مسترد"; voided → "Voided" / "ملغي"                                                        |
| **Fulfillment status** | A badge: unfulfilled → "Unfulfilled" / "لم يتم التجهيز" (warning); in_progress → "In progress" / "قيد التجهيز" (info); fulfilled → "Fulfilled" / "تم التجهيز" (neutral); delivered → "Delivered" / "تم التوصيل" (success) |
| **Items**              | "3 items" / "3 منتجات", pluralized for both locales                                                                                                                                                                       |
| **Delivery method**    | The localized shipping method (Plan 3A labels), or "—"                                                                                                                                                                    |

**Rules:**

- **The whole row is clickable** (keyboard-accessible link in the Order cell, with a row hover).
- **On mobile:** the Order, Customer, Total and Payment status columns, the others hidden.
- **The old single "Status" column is removed.** Keep the toolbar and pagination.

Commit: `feat(admin-web): orders list with shopify columns and status badges`.

---

### Task 6: Order page like Shopify

**Files:**

- `apps/admin-web/src/app/orders/[orderId]/page.tsx`;
- the order components in `src/components/orders/` (rewrite the header, items/fulfillment, payment, customer and addresses; keep the timeline, returns and shipment cards working);
- messages and tests.

**Layout:** `max-w-6xl`, with a main column and a sidebar (`xl:grid-cols-3`, the main column spanning 2).

**Header:**

- A back arrow to `/orders`, `#1001`, the payment badge and the fulfillment badge (same styles as the list).
- **Under it:** "October 9, 2026 at 8:27 pm from Online Store" / "٩ أكتوبر ٢٠٢٦ الساعة ٨:٢٧ م من المتجر الإلكتروني".
- **On the end side:**
  - "Refund" (opens the existing refund flow, enabled only when paid);
  - "More actions ▾" (a menu with "Cancel order" behind a confirm, when the transition table allows it, and "Print packing slip" as `window.print()`).

**Main column:**

1. **Fulfillment card**, titled with the fulfillment badge plus the item count, e.g. "Unfulfilled (3)".
   - **Lines:** "Location: {name}" when a fulfillment order names one; "Delivery method: Standard shipping".
   - **One row per item:**
     - a 40px placeholder tile (product images come in Plan 2C-3);
     - the title, linking to `/products/{productRef}`;
     - `variantTitle` muted (e.g. "29"), and "SKU: …" muted;
     - "$19.99 × 1" and the line total at the end.
   - **Footer, when unfulfilled:** a primary "Fulfill items" / "تجهيز المنتجات" button. It runs the **existing** open-fulfillment flow (the action behind today's "Open a fulfillment" button), then navigates to the existing fulfillment page.
   - When a fulfillment exists, a "View fulfillment" link instead.
   - **Fulfillment no longer waits for payment.** If the existing open-fulfillment action requires a paid order, **STOP and report**; do not change the order lifecycle.
2. **Payment card**, titled with the payment badge.
   - **Rows:**
     - Subtotal, "{n} items", amount;
     - Shipping, method name, amount;
     - Taxes, amount;
     - **Total** in bold;
     - a divider;
     - "Paid by customer" (the captured amount, else 0);
     - when pending, **"Balance" / "المتبقي"** with the amount.
   - **Payment method line:** "Cash on delivery" / "Card (Stripe)" from `paymentProvider`, or "—".
   - **Actions:**
     - COD and pending → "Mark as paid" / "تحديد كمدفوع". This reuses the Plan 3A `confirmCodCollectionAction`, with its confirm.
     - No payment linked and pending → "Mark as paid" opens a small dialog for a payment reference. This reuses today's `mark-paid` action; read its constraints, because it only works for `placed`. **Hide it when the action cannot succeed**; never show a button that always fails.
3. **Timeline.** Keep the existing timeline, but with human labels for each event:
   - created → "Order placed" / "تم إنشاء الطلب";
   - payment_requested → "Payment of {total} pending ({method})";
   - payment_received → "Payment of {total} received";
   - and the others in the same style.

   Write the full label list in both locales.

4. **Advanced** (a collapsed `<details>`, "Advanced" / "متقدم", at the bottom of the main column): today's Actions card unchanged (Advance to…, Payment reference / Mark paid, Request payment capture, Request fulfillment), plus the returns and shipment links that exist today.

**Sidebar:**

1. **Customer card.**
   - The name (`recipientName`, or the customer's display name), linking to the customer page if one exists.
   - **"Contact information":**
     - the email, with a copy button;
     - the phone as a `tel:` link (`dir="ltr"`), with a copy button.
2. **Shipping address card.**
   - The name, line1, line2, city, postal code, the country name (`Intl.DisplayNames`) and the phone.
   - A **copy** button (copies the formatted address).
   - "View map" / "عرض الخريطة": a link to `https://www.google.com/maps/search/?api=1&query=<encoded address>`, with `target="_blank"` and `rel="noopener noreferrer"`.
3. **Billing address:** "Same as shipping address", or the address.

**Copy buttons:** `navigator.clipboard.writeText`. On success, the label shows "Copied" / "تم النسخ" for 2 s. They need an `aria-label`.

**Tests:**

- The header shows `#1001` and both badges.
- The fulfillment card lists the variant title and SKU.
- "Fulfill items" shows only when unfulfilled.
- The payment card shows Balance when pending, and "Mark as paid" for pending COD only.
- The copy buttons call the clipboard.
- The country renders as a name.
- Advanced is collapsed and still contains the old controls.

Commit: `feat(admin-web): order page like shopify`.

---

### Task 7: Docs and gaps

**Close:** G-121 (COD collection now marks the order paid), with a reference to the Task 3 e2e.

**Open:**

- **Medium:** "Orders have no staff comments, customer notes or tags (Shopify's timeline comments and Notes card)."
- **Low:** "Order items show a placeholder instead of the product image (waits for Plan 2C-3)."
- **Low:** "The checkout payment link is best-effort: if Orders refuses it, the intent exists without the order knowing (logged)."
- Any finding from Task 1's order-number grep, or Task 6's fulfillment check.

Commit, including this plan file: `docs(orders): record plan 3b, close the cod paid gap`.

---

### Task 8: Gates, then STOP before pushing

1. Run each package suite with `pnpm.cmd --filter <pkg> run test`.
2. `pnpm.cmd -r --no-bail run typecheck`
3. `pnpm.cmd -r --no-bail run lint`
4. `pnpm.cmd arch`

`tenant-mode-guard` and `prisma-tenant-where.guard` must pass.

**STOP.** Give the Arabic report, and ask the owner to confirm `20261012000000_order_numbers` was applied. Push only after they confirm:

```bash
git push origin morbeh/w0-w17-w12
```

## Done criteria

- **Order numbers:** new orders are `#1001`-style; old ones are renumbered.
- **COD:** a COD checkout links its payment. "Mark as paid" on the order page makes it **Paid**.
- **Statuses:** the list and page show Shopify's two badges.
- **Order page:** it has fulfillment and payment cards like Shopify, a customer card with copyable contact and address, and a map link. The old controls are under Advanced.
- **Gates:** all green, with no new warnings. The security assertions are unchanged.

## Arabic report (for the owner)

- The commits and test counts.
- **How to try it:**
  1. Open the orders list: numbers, names and the two statuses.
  2. Place a COD order from the store.
  3. On its page: "في انتظار الدفع" and "لم يتم التجهيز". Press "تجهيز المنتجات", then "تحديد كمدفوع". It shows "مدفوع".
  4. Copy the address, and open the map.
- The fulfillment status mapping table.
- The order-number grep findings.
- Every decision not in the plan.
- **Old test orders:** the two created during Plan 3A testing stay "Payment pending" (their payment was opened before the link existed). The owner can cancel them from "More actions".
