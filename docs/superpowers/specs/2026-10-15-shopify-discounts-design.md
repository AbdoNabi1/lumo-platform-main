# Shopify-Style Discounts — Design Spec

**Status:** Design approved section by section by the product owner (2026-10-15). Waiting for the
written spec to be reviewed before an implementation plan is written.
**Author:** Claude (this session), with the product owner.
**Relationship to prior work:** Phase 2 of the Shopify parity review (kept outside the
repository, `F:New folderlumo-platform-main-main
eportsshopify-gap-review.md`, §3
"Discounts"); builds on Phase 1 (commit `efb414d`, Shopify-style navigation).

> **Owner's summary (Arabic):**
>
> | المطلوب                      | هيبقى عندنا                                                                         |
> | ---------------------------- | ----------------------------------------------------------------------------------- |
> | صفحة خصومات واحدة زي شوبيفاي | قائمة بتبويبات (الكل/نشط/مجدول/منتهي) + زر "إنشاء خصم" بيفتح 4 أنواع                |
> | 4 أنواع                      | خصم على منتجات · خصم على الطلب · اشتري X وخد Y · شحن مجاني                          |
> | كود أو تلقائي                | كل خصم يا إما كود العميل يكتبه، يا إما تلقائي                                       |
> | نفس حقول شوبيفاي             | القيمة، ينطبق على، الحد الأدنى، العملاء، الحدود، الدمج، التواريخ + ملخّص على اليمين |
> | الخصم يشتغل فعلاً            | خانة كود في صفحة الدفع، التلقائي بيتطبّق لوحده، والاستخدام بيتسجّل مع الطلب         |
>
> الشغل على 3 أجزاء بالترتيب: (1) المحرّك والدفع، (2) صفحة الأدمن، (3) خانة الكود في المتجر.

---

## Problem

The merchant cannot run a discount the way Shopify merchants do, and no discount reaches a
customer today:

1. **Admin.** Discounts are split across two developer screens. "Promotions" asks for "target
   references (comma-separated)", "minimum subtotal, minor units" and a numeric priority;
   "Discounts" creates a coupon by typing a promotion's internal id.
2. **Checkout.** The storefront has no discount-code field. Checkout's `ValidatePromotion` takes a
   promotion _id_ (`promotionRef`) through an admin-only route; a code like `SALE10` is never
   looked up. Automatic promotions are never evaluated on their own.
3. **Engine bugs** (`services/promotions/src/domain`):
   - `Promotion.evaluate()` computes the reward on `cart.subtotalAmountMinor` even when the scope is
     `product`/`category`, so "10% off shoes" discounts the whole cart.
   - `buy_x_get_y` validates `buyQuantity`/`getQuantity` but `discountAmountMinor()` never uses them.
   - `free_shipping` always returns 0 and nothing discounts shipping.
   - A promotion authorised by a coupon is also "active", so `EvaluatePromotions` would apply it to
     every cart without the code.
4. **Usage.** Nothing records a promotion's or coupon's usage when an order is placed, so usage
   limits never trigger.

## Goal and success criteria

The merchant creates discounts exactly as in Shopify's admin, and they work for customers.

Done means: the merchant creates the code `SALE10` (10% off the order, minimum 200 EGP) in the
admin → a customer types `SALE10` at checkout → the discount line appears and the total drops →
the order is placed with the discount recorded and shown on the admin order page → the
discount's "Used" count is 1.

## Decisions made with the product owner

1. **End-to-end scope**, built as three sub-projects in order: (1) engine and checkout, (2) admin
   discounts page, (3) storefront code field. Each one has its own plan and commits and is
   testable on its own.
2. **Approach A**: keep `services/promotions` and `services/coupons` as the engine and extend them.
   A _discount_ is a `Promotion`; a _discount code_ is a `Coupon` linked to it. The admin talks to
   one "Discounts" facade and never sees the split. (A new `services/discounts` context replacing
   both was rejected as bigger and riskier.)
3. **Shopify's four types, both methods**, with the fields listed below. Customer **segments** are
   out of scope (no segment screen exists).
4. **Promotions leaves the merchant's view**: removed from the sidebar, its screens kept under
   Platform tools (`ADMIN_PLATFORM_TOOLS`).

## The discount model

### What the merchant configures (Shopify's form, in Shopify's order)

| Field                         | Applies to                             | Values                                                                                                                            |
| ----------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Type                          | all                                    | `amount_off_products` · `amount_off_order` · `buy_x_get_y` · `free_shipping` (chosen when creating, cannot be changed afterwards) |
| Method                        | all                                    | `code` (with the code; "Generate random code") · `automatic` (with a title)                                                       |
| Value                         | amount off products / order            | percentage (0–100, up to 2 decimals) or fixed amount (store currency)                                                             |
| Applies to                    | amount off products                    | specific categories, or specific products (at least one)                                                                          |
| Apply once per order          | amount off products, fixed amount only | off: the amount comes off each matching item; on: once per order                                                                  |
| Customer buys                 | buy X get Y                            | minimum quantity of items, or minimum purchase amount; from specific products or categories                                       |
| Customer gets                 | buy X get Y                            | quantity; from specific products or categories; at a percentage off or free; optional maximum uses per order                      |
| Countries                     | free shipping                          | all countries, or a list of countries                                                                                             |
| Exclude shipping rates over   | free shipping                          | optional amount                                                                                                                   |
| Minimum purchase requirements | all except buy X get Y                 | none · minimum purchase amount · minimum quantity of items                                                                        |
| Customer eligibility          | all                                    | all customers · specific customers (picked from Customers)                                                                        |
| Maximum discount uses         | code only                              | limit total uses (number) · limit to one use per customer                                                                         |
| Combinations                  | all                                    | can combine with product discounts / order discounts / shipping discounts                                                         |
| Active dates                  | all                                    | start date and time (required); end date and time (optional)                                                                      |

### Discount class (Shopify's combination classes)

| Type                             | Class      |
| -------------------------------- | ---------- |
| amount off products, buy X get Y | `product`  |
| amount off order                 | `order`    |
| free shipping                    | `shipping` |

### Status shown to the merchant

| Shown     | When                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Active    | promotion `active` and start ≤ now < end (or no end)                                                                              |
| Scheduled | promotion `active`/`scheduled` and start > now                                                                                    |
| Expired   | end ≤ now, or promotion `expired`/`depleted`, or **deactivated** (`paused`) — as in Shopify, where deactivating ends the discount |

`Deactivate` pauses the promotion (and disables its coupon); `Activate` resumes both. `Delete`
archives the promotion (every status may move to `archived` except `archived` itself) and
disables its coupon; archived discounts never appear in the admin list.

### Storage (extensions to existing tables)

**`promotions.promotions`**, three new columns, all with defaults so existing rows stay valid:

| Column           | Type                                        | Default / backfill                                                                                      |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `method`         | text, `code` or `automatic`                 | backfill `code` for promotions referenced by any coupon, else `automatic`                               |
| `discount_class` | text, `product`/`order`/`shipping`          | backfill from reward and scope: free shipping → `shipping`; scope `cart` → `order`; otherwise `product` |
| `combines_with`  | jsonb `{product, order, shipping}` booleans | backfill all `true` where `stackable = true`, else all `false`                                          |

`stackable` and `priority` stay in the table, are no longer edited from the admin, and are ignored
by the new calculation. They are not removed in this project.

**`reward` jsonb** (no schema change) gains the shape each type needs:

- amount off: `{ type: "percentage" | "fixed_amount", value, appliesOncePerOrder? }`
- free shipping: `{ type: "free_shipping", countries?: string[] /* ISO 3166-1; absent = all */, maxShippingRateMinor?: number }`
- buy X get Y: `{ type: "buy_x_get_y", buys: { kind: "quantity" | "amount", value }, gets: { quantity, scope: "product" | "category", targetRefs, effect: { kind: "percentage", value } | { kind: "free" } }, maxUsesPerOrder? }`.
  The buys targets use the existing condition `scope` + `targetRefs`.

The existing condition (`scope`, `targetRefs`, `minimumQuantity`, `minimumSubtotalAmountMinor`) keeps
holding "applies to" and the minimum purchase requirement. `ruleType` keeps its two values
(`automatic` = amount off / free shipping, `buy_x_get_y`); `method` — not `ruleType` — now decides
code vs automatic.

**`coupons.coupons`**: no new columns. "Limit to one use per customer" is `multiUse = false` per
customer, checked against the redemption ledger (see Usage). The ledger entries gain an optional
`email` (jsonb, no migration) so guests can be matched. `Coupon` gains `changeCode(code)` so the
merchant can edit a discount's code; uniqueness per tenant is kept by the existing unique index.

All amounts are minor units in the store currency (single-currency store, Settings → General).

## Applying discounts at checkout

### Customer-facing behaviour

- The customer enters a code at checkout; it is checked immediately and either appears as a
  discount line or shows one of these messages: `not_found`, `expired`, `not_started`,
  `minimum_not_met`, `not_eligible`, `usage_limit_reached`, `already_used`, `cannot_combine`,
  `too_many_codes`, `too_many_attempts`. An unknown code and a deleted code answer the same
  `not_found`.
- Automatic discounts apply by themselves when the cart qualifies and show by their title.
- Up to **5 codes** per checkout, combined when their combination settings allow.
- Any change to items, address or shipping method re-runs the calculation. A code that stops
  qualifying stays listed as "not applicable" with its reason and gives nothing.
- After **10 rejected codes** on one checkout session, further attempts answer `too_many_attempts`
  for 15 minutes (guards against guessing codes).

### The calculation — a pure domain service in `services/promotions`

`DiscountCalculator.calculate(input)`, no I/O:

- **Input:** cart lines `{lineRef, productRef, categoryRefs, quantity, unitPriceMinor}`; shipping
  `{countryCode, rateMinor} | null`; customer `{customerRef?, email?}`; candidate discounts (the
  promotions behind the entered codes, plus active automatic promotions), each with its coupon
  state where there is one; the customer's prior redemptions of those coupons; `now`.
- **Step 1 — eligibility per candidate:** dates, status, customer eligibility, coupon limits and
  one-per-customer, minimum purchase requirement (as Shopify: for amount off products, on the
  matching items only; otherwise on the whole cart),
  matching items present, free-shipping country and rate cap. Failures produce the reasons above.
- **Step 2 — amount per eligible candidate**, on the price remaining after earlier discounts in the
  application order below:
  - amount off products: on the matching lines only; percentage `floor` per line; fixed amount per
    matching unit (capped at the line), or once per order spread across matching lines.
  - amount off order: on the subtotal after product discounts; fixed amount capped at that subtotal.
  - buy X get Y: count qualifying "buys" units (or amount); each use grants `gets.quantity` units from
    the "gets" targets, never counting the same unit as both bought and got; uses capped by
    `maxUsesPerOrder`; the discounted units are the cheapest qualifying ones; the "gets" items must
    already be in the cart (nothing is added automatically).
  - free shipping: the selected rate's full amount.
- **Step 3 — choose the combination:** among the eligible candidates, every subset in which each
  pair is compatible (A allows B's class and B allows A's class) is a candidate set; the set with
  the largest total saving wins; ties go to the set containing more entered codes, then to the
  earlier-created discounts. (At most 5 codes plus the automatic discounts — a small number — so
  subsets are enumerated exhaustively.) Entered codes outside the winning set get `cannot_combine`.
- **Application order:** product discounts → order discounts → shipping discounts. Two combined
  product discounts on the same line apply one after the other, each on the price the previous one
  left.
- **Output:** applied discounts `[{promotionId, couponId?, code?, title, class, amountMinor}]`,
  `orderDiscountMinor` (product + order), `shippingDiscountMinor`, per-line allocation
  `[{lineRef, amountMinor}]` (order discounts allocated in proportion to line totals, remainders
  to the largest lines), and per-code status `[{code, applicable, reason?}]`.

`Promotion.evaluate()` and `EvaluatePromotions` stay for compatibility but delegate to the
calculator; the old whole-cart subtotal bug is fixed there too.

### Checkout session and routes

- `CheckoutSession` stores `discountCodes: string[]` (entered, normalised as `CouponCode` does) and
  a discount snapshot `{ applied, orderDiscountMinor, shippingDiscountMinor, codeStatuses,
lineAllocations }`, plus a rejected-attempts counter with its window start. `discountMinor`
  keeps meaning the order discount, so totals and tax (`discounts: {orderMinor, shippingMinor}`)
  use the snapshot directly; grand total subtracts the shipping discount from shipping.
- `PromotionValidationPort` is widened to evaluate codes + cart + shipping + customer and return the
  calculator's output; `PromotionValidationAdapter` (apps/admin cross-context) resolves codes via
  `CouponRepository.findByCode`, loads promotions, and calls the calculator.
- New public routes (guest-owned session, same ownership check as the other public checkout
  routes): `POST /public/checkouts/:checkoutSessionId/discount-codes` `{code}` and
  `DELETE /public/checkouts/:checkoutSessionId/discount-codes/:code`. Both answer the session DTO,
  which gains the discount snapshot (titles, codes and amounts only — never promotion internals).
- Every existing recalculation (items, address, shipping selection) re-runs the discounts.

### Placing the order and recording usage

- `CompleteCheckout` re-runs the calculation right before creating the order. If the total
  discount differs from the snapshot the customer saw, completion fails with `discounts_changed`
  (409) and the session holds the new snapshot so the page can show it.
- The order's `totals` snapshot gains `discounts: [{title, code?, class, amountMinor}]` and
  `shippingDiscountMinor`. The admin order page shows each code next to the discount line
  ("Discount (SALE10)").
- After the order is created, a new `DiscountUsagePort.record({orderRef, customerRef, email,
applied})` increments each promotion's usage and redeems each coupon, keyed by `orderRef`, so a
  retry never counts twice. A failure here is logged and does not fail the order (the order
  already exists); the idempotent key makes a retry safe. Known gap: two customers using the last
  available use at the same moment can both succeed — accepted, as the final re-check narrows it.

## Admin (apps/admin + apps/admin-web)

### API (apps/admin, new `discounts-routes.ts`)

| Route                                         | Purpose                                                                                                                                       | Permission         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `GET /discounts?status=&q=&after=`            | list; status = `active`/`scheduled`/`expired`/all; q matches title or code                                                                    | `promotions:read`  |
| `GET /discounts/:id`                          | one discount, the form's shape                                                                                                                | `promotions:read`  |
| `POST /discounts`                             | create (idempotent): creates the promotion, and the coupon when method = code, then activates; on a coupon failure the promotion is cancelled | `promotions:write` |
| `PUT /discounts/:id`                          | edit every field except type and method                                                                                                       | `promotions:write` |
| `POST /discounts/:id/deactivate`, `/activate` | pause/resume promotion and coupon                                                                                                             | `promotions:write` |
| `DELETE /discounts/:id`                       | archive promotion, disable coupon                                                                                                             | `promotions:write` |

A taken code answers a field error on `code` ("This code is already in use"). The DTO carries the
form fields, the derived status, `usageCount`, and a one-line summary is built in admin-web.
`Promotion` gains an update method for these fields (validation identical to create).

### Screens (apps/admin-web)

- **`/discounts` list:** title "Discounts", button **Create discount** opening a dialog with the four
  types and one-line descriptions; tabs All · Active · Scheduled · Expired; search; columns Title
  (code or title + summary line, e.g. "10% off entire order • Minimum purchase of EGP 200"), Status,
  Method, Type, Combinations, Used; empty state with the create button; cursor pagination.
- **`/discounts/new?type=…` and `/discounts/[id]`:** Shopify's two-column layout.
  - Left, in order: type card (method toggle; code field with "Generate random code", or title) →
    value / customer buys + customer gets / countries + rate cap → minimum purchase requirements →
    customer eligibility → maximum discount uses (code only) → combinations → active dates.
  - Pickers: "Browse" dialogs for products (search by name/SKU), categories, and customers (search by
    name/email), using the existing list endpoints server-side.
  - Right: **Summary** card that follows the form live (code/title, type, bullet details); on edit, a
    **Performance** card ("Used N times").
  - Save bar "Unsaved changes" with Discard / Save, as on the product page; Deactivate/Activate and
    Delete on edit; field errors shown under their inputs.
- **Removed:** Promotions child under Discounts in the sidebar (route kept under Platform tools); the
  old coupon create form and its "Promotion" id field.
- Every string in `messages/en.ts` and `messages/ar.ts`; every runtime API call stays server-side
  (README rules: one idempotency key per submit, never send a client-computed price).
- The order page's payment card shows codes on the discount line.

## Storefront (apps/storefront)

- One-page checkout's order summary: "Discount code" input + **Apply**; applied codes as chips with a
  remove (×) button; the reason message under the field when rejected; "not applicable" note on a
  code that stopped qualifying.
- Totals: one "Discount" line per applied discount (by code, or title for automatic), shipping line
  reads "Free" when the shipping discount covers it; the grand total follows the session totals.
- A `discounts_changed` answer on placing the order reloads the summary and shows a short notice.
- Arabic and English.

## Testing

- **Calculator unit tests** (services/promotions): each type; percentage and fixed; once-per-order;
  minimum amount/quantity; dates; customer eligibility; total limit and one-per-customer (by
  customer and by guest email); buy X get Y with overlapping targets, max uses, cheapest-first;
  free shipping country and rate cap; combination selection incl. ties and `cannot_combine`;
  application order; allocation and rounding.
- **Domain/use-case tests** for the promotion update method, coupon `changeCode`, the backfill
  mapping, `CheckoutSession` snapshot and attempts limit, `CompleteCheckout` re-check and usage
  recording idempotency.
- **Route tests** (apps/admin): discounts CRUD, code uniqueness, status filters; public add/remove
  code, every rejection reason, recalculation after a cart change, `discounts_changed`.
- **UI tests**: admin list tabs/columns, type dialog, each type's form, Summary card, save bar,
  pickers; storefront code field, chips, totals lines.
- **End-to-end (Playwright, apps/e2e)** when an environment is available: create `SALE10` in the
  admin → apply at checkout → place the order → the order shows the discount and the discount's
  "Used" is 1.

## Out of scope

Customer segments; gift cards; bulk/multiple codes per discount; sales channels and markets;
showing automatic discounts on the cart page (checkout only for now); POS; removing the legacy
`stackable`/`priority` columns.
