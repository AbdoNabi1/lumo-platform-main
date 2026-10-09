# One-Page Checkout and Cash on Delivery (Plan 3A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):**
>
> **المشكلة:** المتجر مفعّل فيه طريقة دفع واحدة بس، وهي **Stripe** (كارت). والمتجر مش بيعرف يفتح صفحة الدفع بتاعتها، فالطلب بيتعمل وبعدين يظهر "مش قادرين نكمّل الدفع".
>
> **الدفع عند الاستلام (COD)** موجود في السيرفر من زمان، بس **مفيش شاشة تفعّله**. وكمان صفحة الدفع 6 خطوات ورا بعض، وعنوان الشحن ما فيهوش **اسم ولا رقم موبايل**، فالمندوب مش هيعرف يوصّل لمين.
>
> **الخطة دي:**
>
> - **صفحة "طرق الدفع"** في الإعدادات: مفتاح لكل طريقة (الدفع عند الاستلام، الكارت…).
> - **صفحة دفع واحدة زي شوبيفاي:**
>   - على اليمين: الإيميل، والعنوان (الاسم والموبايل والعنوان والمدينة والدولة)، وطريقة الشحن، وطريقة الدفع، وزرار واحد "إتمام الطلب".
>   - على الشمال: ملخص الطلب (المنتجات والإجمالي).
> - **العنوان فيه الاسم ورقم الموبايل**، والرقم البريدي بقى اختياري. الاسم والرقم بيوصلوا للطلب ويظهروا في صفحة الطلب عندك.
> - **في صفحة الطلب** زرار "تم استلام الفلوس" لطلبات الدفع عند الاستلام.
>
> **فيه migration واحدة** (أعمدة الاسم والموبايل في عنوان الطلب). هتطبّقها من Console أول ما Sonnet يقولك، وقبل الرفع الأخير.

**Goal:**

- The merchant can turn cash on delivery on, and others off, from the admin.
- The shopper checks out on **one page**, like Shopify, with name and phone on the address.
- The merchant sees the name and phone on the order, and marks COD cash as collected.

**Architecture:**

- **Payments settings (admin-web only).**
  - The routes already exist in `apps/admin/src/http/payments-routes.ts`:
    - `GET /payments/settings` returns `{ enabledMethods, methods: { [key]: { available, configured? } } }`;
    - `PUT /payments/settings` takes `{ enabledMethods }` (min 1).
  - A new page `/settings/payments` lists every registered method with a `Switch`, and saves `enabledMethods`.
  - `cod` is registered and needs no credentials (`services/payments/src/infrastructure/built-in-provider-registrations.ts`).
- **COD collection (admin-web plus, if missing, the payment intent DTO).**
  - `POST /payment-intents/:id/cod-collection` with `{ collectedAmountMinor, currency }` already exists. It is the only action that marks a COD payment paid.
  - The order page's payment card gets a "Mark cash as received" button for a COD intent that is not yet captured.
- **Address with recipient and phone.**
  - `CheckoutAddress` (services/checkout) gains optional `name` and `phone`, and `postalCode` may be empty. It is stored in a JSON column, so checkout needs no migration.
  - The order's shipping address lives in the **table** `orders.order_shipping_addresses`, which gains `recipient_name`, `phone` and `line2`. That is the one migration.
  - Orders' `AddressSnapshot` gains the same optional fields, with an empty `postalCode` allowed. The billing address (JSON on `orders`) carries them too.
  - `OrderCreationAdapter` stops dropping `line2`, and passes `name` and `phone`.
- **One-page checkout (storefront only).**
  - `CheckoutView` becomes one form plus an order summary. The stepper, its badges and `currentStep` go.
  - The existing server actions are reused **unchanged in behavior**.
  - When the address is complete, the page saves it, quotes shipping and pre-selects the first method.
  - "Complete order" runs the rest in order: contact, shipping address, shipping method, billing, payment, tax, recalculate, complete, then open the payment.
  - A placed order that still needs payment keeps the existing "Pay now" retry panel.

**Tech Stack:** TypeScript, Prisma 6 (no upgrade), zod, vitest, Next.js 15, React 19, `@platform/ui`.

**Spec:**

- Owner screenshot, 2026-10-09: "Your order was placed, but this payment method can't be completed online…".
- Owner request: "ضيف الكاش كطريقة دفع وخلي مرحلة التشيك اوت خطوة واحدة زي شوبيفاي".
- Live check: `GET /api/v1/public/payment-methods` returns `{"methods":["stripe"]}`.
- Live finding: the production shipping quote is `InMemoryShippingCalculationAdapter`, which always returns standard 5.00 and express 15.00. It is recorded as a gap, **not** fixed here.

## Global Constraints

Same as Plans 2B-1 to 2B-3. Every task implicitly includes these.

### Git and branch

- Branch `morbeh/w0-w17-w12`. No force-push. No `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit lines at most 100 characters, lowercase subject.
- End every commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

### Database

- **Never connect to any database.** Never run `prisma migrate` against anything. The owner applies the migration from Railway.
- **Never set `TENANT_MODE=multi`** in any env file, example, manifest or CI config.
- No guard exemptions; rename instead. No new `TENANT_DEFAULT_ID` reads. **Do not upgrade Prisma.**
- **Push order:**
  - Task 1 (the SQL file only) is pushed alone.
  - Everything after it is committed locally and pushed only **after the owner confirms** the migration was applied (Task 8).

### Security

- **Plans 2A, 2C-1, 2B-1 and 2B-3 security assertions stay green and unchanged.**
- Name and phone are shown only to the session's owner (the public DTO is already owner-only) and to staff on the order page. Never log them.
- The storefront still never sends a price, rate, amount or `customerRef`.

### App rules

- Runtime API calls only from server code. One idempotency key per write. `toFormState` for every non-`ok` outcome (admin-web).
- Both message files get every key, in admin-web **and** storefront. Logical RTL classes only (`ms-`/`me-`/`ps-`/`pe-`/`start`/`end`).
- No `autoFocus`; use a one-shot focus ref. No async function without `await`.

### Commands

- Per-package `pnpm.cmd --filter <pkg> run test|typecheck|lint`. Never run a full typecheck and a full test suite at the same time.
- No new lint warnings.

| Directory           | Package filter       |
| ------------------- | -------------------- |
| `services/checkout` | `@platform/checkout` |
| `services/orders`   | `@platform/orders`   |
| `services/payments` | `@platform/payments` |
| `apps/admin`        | `@platform/admin`    |
| `apps/storefront`   | `storefront`         |
| `apps/admin-web`    | `admin-web`          |
| `packages/db`       | `@platform/db`       |

If a package name differs, use the one in its `package.json` and say so in the report.

---

### Task 1: Migration (pushed alone)

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261011000000_order_recipient/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts`, only if it lists migrations or columns explicitly.

- [ ] **Step 1: Write the SQL**

```sql
-- Plan 3A — who receives the order, and how to reach them. Written by hand, NOT applied by the
-- agent; the owner deploys it from Railway's Console
-- (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release whose
-- Prisma schema reads these columns. Nullable: orders placed before this plan have none.
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "recipient_name" TEXT;
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "phone" TEXT;
ALTER TABLE "orders"."order_shipping_addresses" ADD COLUMN "line2" TEXT;
```

- **Do not touch `orders.prisma` in this task.** The schema change ships in Task 2, after the owner applies the SQL.
- If the consistency test pairs every migration with schema columns and therefore fails without the schema change, **do not weaken it**. Instead, move the `orders.prisma` change into this commit too. That is safe only because the columns are nullable and nothing reads them yet. In that case, **STOP and ask before pushing**, explaining why.

- [ ] **Step 2: Run** `pnpm.cmd --filter @platform/db run test`. Expected: PASS.

- [ ] **Step 3: Commit and push ALONE, then tell the owner**

```bash
git add packages/db/prisma/schema/migrations/20261011000000_order_recipient/migration.sql
git commit -m "feat(db): add the order recipient migration (applied before the code that reads it)"
git push origin morbeh/w0-w17-w12
```

Print this for the owner, in Arabic, and **continue** (do not wait):

> لما Railway يخلّص النشر (حوالي 5 دقايق)، طبّق الـ migration من Railway → runtime-api → Console:
> `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`
> المفروض تشوف `20261011000000_order_recipient` اتطبّقت. ابعتلي الناتج.

---

### Task 2: Recipient name, phone and line 2 on the address

**Files (read each before editing):**

- Checkout:
  - `services/checkout/src/domain/value-objects/checkout-address.ts` (+ test)
  - `services/checkout/src/infrastructure/checkout-session.mapper.ts`
  - `services/checkout/src/infrastructure/prisma-checkout-session-repository.ts`, only if it maps address fields itself
- `apps/admin/src/http/public-checkout-routes.ts`: `addressBody`, `PublicAddressDto`, `toAddressDto`
- Orders:
  - `services/orders/src/domain/value-objects/address-snapshot.ts` (+ test)
  - `services/orders/src/application/create-order-from-checkout.use-case.ts`
  - `services/orders/src/application/place-order.use-case.ts`, which only needs the new optional fields passed through, if its input has them
  - `services/orders/src/infrastructure/order.mapper.ts`, and the repository that reads and writes `order_shipping_addresses`
  - the orders DTO / presenter that the admin `GET /orders/:id` returns
- `packages/db/prisma/schema/orders.prisma`: add to `OrderShippingAddress`:
  ```prisma
    recipientName String? @map("recipient_name") // Plan 3A
    phone         String? // Plan 3A
    line2         String? // Plan 3A
  ```
- `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts`: pass `line2`, `name` → `recipientName`, and `phone`. Delete the "line2 dropped" comments.
- Admin-web: `src/lib/api/orders.ts` (DTO type) and `src/components/orders/order-addresses-card.tsx` (render).
- Storefront: `src/lib/runtime-api.ts`, where `CheckoutAddressInput` gains `name?` and `phone?`.

**Rules:**

1. **`CheckoutAddress`**
   - New optional `name` and `phone`.
   - `postalCode` may be empty: drop its "required" issue, and store `""` when absent.
   - **`phone`**, when present:
     - normalize Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits to ASCII;
     - strip spaces, `-`, `(` and `)`;
     - it must match `^\+?[0-9]{7,15}$`, otherwise a `phone` issue.
   - **`name`**, when present: trimmed, 1–120 characters, otherwise a `name` issue.
   - Getters for both.
2. **`addressBody`:** `name: z.string().max(120).optional()`, `phone: z.string().max(32).optional()`, `postalCode: z.string().max(32).optional()`. The handler passes `postalCode ?? ""`.
3. **`PublicAddressDto`** gains `name: string | null` and `phone: string | null`. It stays visible only to the owner, as today.
4. **`AddressSnapshot.create(line1, city, postalCode, country, extra?)`**
   - `extra` is `{ recipientName?, phone?, line2? }`.
   - An empty `postalCode` is allowed; the other three must still be non-empty.
   - Existing call sites keep compiling **without** passing `extra`.
5. **Persistence.** The mapper writes and reads the three columns, using `null` when absent. The billing JSON carries `recipientName`, `phone` and `line2` the same way.
   - **Orders placed before this plan read back unchanged.** Add a mapper test for a row with all three columns `null`.
6. **Admin `GET /orders/:id`** exposes `shippingAddress.recipientName`, `.phone` and `.line2` (null when absent). **The public API never returns an order.**
7. **`OrderAddressesCard`**
   - Shows the name in bold first, then line1 and line2, then city, postal code and country, then the phone as `<a href="tel:…">` with `dir="ltr"`.
   - Absent fields render nothing (no empty lines).

**Tests (write first, see them fail):**

- `checkout-address.test.ts`:
  - phone `"٠١٠ ١٢٣٤ ٥٦٧٨"` is stored as `"01012345678"`;
  - `"+20 10-1234-5678"` is stored as `"+201012345678"`;
  - `"12ab"` gives a `phone` issue;
  - an empty `postalCode` is accepted;
  - a 121-character name gives a `name` issue.
- `address-snapshot.test.ts`: an empty postal code is accepted; the extras round-trip.
- Order mapper: writes the three columns; a legacy row with nulls reads back.
- `public-checkout-routes` test: `POST …/shipping-address` with name and phone, then `GET` returns them; without them, `null`.
- An admin e2e (in the existing guest checkout e2e file): complete a checkout whose shipping address has name, phone and line2, then the admin order read shows all three.
- `order-addresses-card` test: renders the name, a `tel:` link, and no empty line for a missing line2.

Run the tests for checkout, orders, admin, admin-web, storefront and db. Commit (do **not** push):

```bash
git commit -m "feat(orders): carry the recipient's name, phone and second address line to the order"
```

---

### Task 3: Payment methods page in the admin

**Files:**

- `apps/admin-web/src/lib/api/payments.ts`: add `fetchPaymentSettings()` (GET) and `updateEnabledPaymentMethods(methods, idempotencyKey)` (PUT `{ enabledMethods }`). Use the same transport helpers this file already uses.
- Create: `apps/admin-web/src/app/settings/payments/page.tsx`, `actions.ts` and `actions.test.ts`.
- Create: `apps/admin-web/src/components/settings/payment-methods-form.tsx` (+ test).
- Modify: `apps/admin-web/src/app/settings/page.tsx`. Add a "Payments" card linking to `/settings/payments`, with the line "Choose how customers pay you".
- Modify: `src/messages/en.ts` and `ar.ts`.

**Page:**

- **Title** "Payments" / "الدفع". **Subtitle** "Choose which payment methods customers see at checkout." / "اختار طرق الدفع اللي تظهر للعميل وقت الدفع."
- **One row per key in `methods`**, in this order: `cod` first, then `paymob`, then `stripe`, then any other key alphabetically. Each row has:
  - a `Switch` (`name="method"`, `value=<key>`);
  - the label and a one-line description.
- **Labels and descriptions:**

| Key         | Label (en / ar)                                   | Description (en / ar)                                                            |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cod`       | Cash on delivery (COD) / الدفع عند الاستلام       | Customers pay in cash when the order arrives. / العميل يدفع كاش لما الطلب يوصله. |
| `stripe`    | Credit or debit card (Stripe) / كارت (Stripe)     | Customers pay by card on a secure page. / العميل يدفع بالكارت في صفحة آمنة.      |
| `paymob`    | Paymob (cards and wallets) / Paymob (كروت ومحافظ) | Cards and mobile wallets through Paymob. / الكروت والمحافظ عن طريق Paymob.       |
| unknown key | the key itself                                    | none                                                                             |

- **A row is disabled**, with the reason under it, when:
  - `available === false`: "Not available on this platform yet." / "مش متاحة على المنصة لسه.";
  - or `configured === false`: "Needs setup before it can be turned on." / "محتاجة إعداد قبل ما تتفعّل.".

  A disabled row that is currently enabled stays checked and is still submitted, so saving never silently drops it.

- **Save button.** It is off until a switch changes, using the same rule as the product page.
- **Validation:** at least one method must stay on. The client shows "Keep at least one payment method on." / "لازم طريقة دفع واحدة على الأقل تفضل شغالة.", and the server action refuses too, without calling the API.
- **On success:** the "Saved" message and a fresh read.

**Action:** `savePaymentMethodsAction(prev, formData)`. It reads `formData.getAll("method")` and drops keys not present in `fetchPaymentSettings().methods`. It needs one non-empty set, sends one idempotency key, and maps errors through `toFormState`.

**Tests:**

- The form: renders `cod` first; Save is off until a switch changes; the last switch cannot be turned off; a disabled row shows its reason.
- The action: sends `enabledMethods`; refuses an empty set without a call; drops unknown keys; maps a 422 to a form error.

Commit: `feat(admin-web): turn payment methods on and off, cash on delivery included`.

---

### Task 4: "Cash received" on the order page

**Files:**

- `services/payments`: the payment intent DTO returned by `GET /payment-intents/:id`.
  - **Read it first.** If it already has `provider`, skip to admin-web.
  - If not, add `provider: string` to the presenter and its test. It must stay credential-free (`merchant-credentials-never-leak.test.ts` stays green).
- `apps/admin-web/src/lib/api/payments.ts`: `PaymentIntentDto.provider`, and `confirmCodCollection(intentId, amountMinor, currency, idempotencyKey)`.
- `apps/admin-web/src/app/orders/actions.ts`: `confirmCodCollectionAction`.
- `apps/admin-web/src/components/orders/order-payment-card.tsx`, plus a small client form component.
- messages en/ar.

**Rules:**

- **When the button shows:** only when `provider === "cod"` and the intent is not already captured (`capturedAmountMinor < amountMinor`, and status is not a captured, paid or refunded state).
  - **Label:** "Mark cash as received" / "تم استلام الفلوس".
  - **It asks first:** "Confirm you received {amount} in cash?" / "متأكد إنك استلمت {amount} كاش؟".
- **The action** sends `collectedAmountMinor = intent.amountMinor` and `currency = intent.currency`, read **on the server** from `fetchPaymentIntent`, never from the form. It sends one idempotency key, then `revalidatePath` of the order page.
- **The payment card** shows the method: "Cash on delivery" / "الدفع عند الاستلام" for `cod`, or the Task 3 label for the others.
- **Verify with a test, and report:** after collection, does the order itself show as paid? Payments reports outcomes to Orders (`PaymentsOrdersAdapter`). If the order does **not** become paid, do not build a workaround. Record it as a gap and say so in the report.

**Tests:** the button shows for cod-uncaptured only; the action reads the amount server-side; the confirm can be declined; a 409 maps to a form error.

Commit: `feat(admin-web): mark a cash-on-delivery payment as received from the order page`.

---

### Task 5: One-page checkout (storefront)

**Files:**

- Rewrite: `apps/storefront/src/components/checkout-view.tsx` and `checkout-view.test.tsx`.
- Modify: `apps/storefront/src/app/checkout/page.tsx` (layout width), `src/messages/en.ts` and `ar.ts`.
- `app/checkout/actions.ts` is **unchanged**, except that the address input now carries `name` and `phone`.

**Layout:** like Shopify's checkout.

- **Page:** `max-w-5xl`. Two columns at `lg`: `grid-cols-[minmax(0,1fr)_380px]`.
  - The form is on the start side.
  - The summary is on the end side, `sticky top-6`.
- **Below `lg`:** the summary sits **above** the form as a `<details>`. Its summary line reads "Show order summary" / "عرض ملخص الطلب", with the total at the end.

**Form sections**, each an `<h2>` and one `<form>` for the whole page:

1. **Contact.**
   - Email (`type="email"`, `autoComplete="email"`, required).
   - For a signed-in customer, show their email as text, "Signed in as {email}", with no field. Their email is applied once, as today.
2. **Delivery.**
   - Country/region: a `<select>`, default `EG`.
   - Full name (required, `autoComplete="name"`).
   - Address (required, `address-line1`).
   - Apartment, suite, etc. (optional, `address-line2`).
   - City (required, `address-level2`).
   - Postal code, labeled "(optional)" (`postal-code`).
   - Phone (required, `type="tel"`, `autoComplete="tel"`, `dir="ltr"`). Hint: "In case we need to contact you about your order." / "عشان نقدر نكلّمك بخصوص الطلب."
3. **Shipping method.**
   - **Before the address is complete**, show a muted box: "Enter your shipping address to view available shipping methods." / "اكتب عنوان الشحن عشان تظهر طرق الشحن."
   - **When it is complete**, show radio cards with a label and price.
     - **Labels:** `standard` → "Standard shipping" / "شحن عادي"; `express` → "Express shipping" / "شحن سريع"; an unknown key as-is.
4. **Payment.**
   - **Lead:** "All transactions are secure and encrypted." / "كل المعاملات آمنة ومشفّرة."
   - **Radio cards** in API order, the first pre-selected. Each card has its label and, when selected, a description:
     - `cod`: "Pay in cash when your order arrives." / "ادفع كاش لما الطلب يوصلك.";
     - `stripe` and `paymob`: "You'll be sent to a secure page to pay." / "هتتحوّل لصفحة آمنة للدفع.".
   - **Labels** reuse `t.checkout.paymentMethod`.
   - **Lists that are `null` or `[]`** keep today's fail-closed alerts, and the submit button is disabled.
5. **Billing address.**
   - Two radio cards: "Same as shipping address" (default) / "نفس عنوان الشحن", and "Use a different billing address" / "عنوان فواتير مختلف".
   - The second reveals the address fields, with phone optional.
6. **Submit**, full width and large.
   - **Label:** "Complete order" / "إتمام الطلب" when the chosen method is offline (`cod`), otherwise "Pay now" / "ادفع الآن".
   - **While working:** "Processing…" / "جاري التنفيذ…".

**Summary:**

- **One row per item:**
  - the title, then `variantTitle` muted underneath;
  - a quantity badge;
  - the line total, which is `unitPriceAmountMinor × quantity` formatted. That is display only, the server totals stay authoritative.
- **Then:**
  - **Subtotal.**
  - **Shipping:** "Enter shipping address" / "اكتب العنوان" until a method is selected, then the amount.
  - **Taxes:** shown only once `session.totals` exists.
  - **Total:** large and bold, with the currency code in a muted prefix, like Shopify.

  Before the shipping method is selected, the total line shows the subtotal.

**Behavior:**

- **Address complete:**
  - `line1`, `city`, `country`, `name` and `phone` are non-empty, and the phone passes the same rule as Task 2.
  - Watch them with a 600 ms debounce **after blur**. When complete and different from the last saved address:
    1. `setShippingAddress`;
    2. `requestShippingQuote`, and store the quotes;
    3. if no method is selected, or the selected one is not in the new list, `selectShipping(first)`;
    4. `recalculate`.
  - Run one at a time; drop the result of a call superseded by a newer address.
- **Choosing a method:** `selectShipping`, then `recalculate`.
- **Submit (`onSubmit`, `preventDefault`):**
  - **Order:**
    1. `setContactEmail`, if not already this email;
    2. the shipping address, if not already saved, then quote and select as above;
    3. `setBillingAddress` (the shipping address when "same");
    4. `selectPayment(method, method)`;
    5. `requestTax`;
    6. `recalculate`;
    7. `completeCheckout`;
    8. `openPayment()`, kept as today.
  - **Stop at the first failure.** Show the error banner at the top with `role="alert"`, scroll it into view, and keep every typed value.
  - `out-of-stock` keeps its cart link.
- **A placed order** (`session.orderRef !== null`) renders only today's "Pay now" retry panel. Nothing is ever completed twice.
- **Remove** the stepper badges, `currentStep`, `Step`, `toStepKey` and `stepLabelKey`, and every message key that only they used. Delete the keys from both message files.
- **Pre-fill** every field from `session.shippingAddress`, `billingAddress` and `contactEmail` when present, so a reload loses nothing the server has.

**Country list** (value, en, ar):

- **Values:** `EG`, `SA`, `AE`, `KW`, `QA`, `BH`, `OM`, `JO`, `LB`, `IQ`, `MA`, `TN`, `DZ`, `LY`, `SD`, `US`, `GB`, `DE`, `FR`, `CA`.
- **Names:** in each locale (for example `EG`: "Egypt" / "مصر").
- **Check first:** before using ISO codes, read the tax adapter that `requestTax` reaches (Finance), and see whether its rules key on codes or names.
  - If they key on codes, use codes.
  - If they key on names, or anything else, **STOP and report** what they key on.
  - Existing sessions with a free-text country pre-select nothing and require a choice.

**Tests (rewrite `checkout-view.test.tsx`).** List every removed or replaced test in the report.

- It renders all sections on one page, with no stepper.
- Shipping methods appear only after a complete address. The first is pre-selected, and `selectShipping` is called once.
- Submit calls the actions in the order above. Stop on the first failure (for example, `setBillingAddress` fails, so neither `selectPayment` nor `completeCheckout` is called) and show the right banner.
- The label is "Complete order" when cod is chosen and "Pay now" when stripe is chosen.
- An `OUT_OF_STOCK` failure shows the message with the cart link.
- A placed order shows only "Pay now".
- A signed-in customer sees "Signed in as" with no email field.
- The phone is required: an invalid phone blocks submit, with a field message, and calls nothing.
- Every new key exists in `ar`. Run the storefront i18n test.

Commit: `feat(storefront): one-page checkout like shopify, with recipient name and phone`.

---

### Task 6: Confirmation for cash on delivery

**Files:** `apps/storefront/src/app/checkout/confirmation/page.tsx` (+ test, if one exists), and messages.

- When the session's selected payment method is `cod`, add under the body: "You'll pay {total} in cash when your order arrives." / "هتدفع {total} كاش لما الطلب يوصلك.". Use `totals.grandTotalMinor` and the currency.
  - **Read the DTO first:** the field is `selectedPaymentMethod`, or whatever `public-checkout-routes.ts` names it.
  - **If the DTO does not carry it,** skip this task and say so. Do not add it.
- Show "Continue shopping" / "متابعة التسوق" as a button to `/`.

Commit: `feat(storefront): tell a cash-on-delivery shopper what they will pay on arrival`.

---

### Task 7: Docs and gaps

**Files:** `docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md` (next free G-numbers).

**Open:**

- **High:** "Card payments (Stripe) cannot complete from the storefront. The intent has no hosted page URL, so the shopper sees 'can't be completed online'. Stripe Checkout (hosted) or Elements is needed. Until then, merchants should turn Stripe off in Settings → Payments."
- **High:** "Shipping rates are a fixed stub in production (`InMemoryShippingCalculationAdapter`: standard 5.00, express 15.00, whatever the address). Merchants cannot set zones or rates."
- **Low:** "The checkout country list is fixed (20 countries); there is no governorate field."
- **Only if Task 4 found it:** "Confirming COD collection does not mark the order paid."

**Close:** none, unless an existing gap says "COD cannot be enabled from the admin", or "the address has no phone".

Commit, including this plan file (`docs/superpowers/plans/2026-10-09-one-page-checkout.md`): `docs(checkout): record plan 3a, open the card and shipping-rate gaps`.

---

### Task 8: Gates, then STOP before pushing

- [ ] **Step 1: Gates, sequentially**
  1. Run each package suite with `pnpm.cmd --filter <pkg> run test`: checkout, orders, payments, admin, storefront, admin-web, db.
  2. `pnpm.cmd -r --no-bail run typecheck`
  3. `pnpm.cmd -r --no-bail run lint`
  4. `pnpm.cmd arch`

  All must exit 0, with no new warnings. `tenant-mode-guard` and `prisma-tenant-where.guard` must pass.

- [ ] **Step 2: STOP.** Give the owner the Arabic report, and ask them, in Arabic, to confirm that `20261011000000_order_recipient` was applied. **Push only after they confirm:**

```bash
git push origin morbeh/w0-w17-w12
```

If they report a migration error, do not push; report the error text.

## Done criteria

- Settings → Payments turns COD on, and the storefront offers it.
- The storefront checkout is one page with a summary. One button places the order. COD lands on the confirmation page with the amount to pay on arrival.
- The order page shows the recipient's name and phone, plus "Mark cash as received" for COD.
- Every gate is green, with no new warnings. The security assertions are unchanged. The migration was pushed first, and the code only after the owner confirmed.

## Arabic report (for the owner)

Give it in plain Egyptian Arabic:

- the commits and test counts;
- **how to try it yourself:**
  1. Settings → Payments: turn on "الدفع عند الاستلام", turn off "كارت (Stripe)", and Save.
  2. In the store: add a product to the cart and checkout. You get one page; fill the name, phone and address; the shipping methods appear; choose "الدفع عند الاستلام"; press "إتمام الطلب".
  3. The confirmation says how much to pay in cash.
  4. In the admin: the order shows the name and phone. Press "تم استلام الفلوس".
- what Task 4 found about the order becoming paid;
- every decision not in this plan.
