# Task T5.2 report — Order actions

Status: **DONE**

## Summary

Wired all 7 order-lifecycle write routes (`apps/admin/src/http/admin-routes.ts` lines ~1011-1117)
into `apps/admin-web`'s Orders screens, following the exact write-screen recipe from
`apps/admin-web/README.md` and the reference implementations from T1.3/T1.4/T5.1
(`lib/api/products.ts`, `app/products/actions.ts`, `product-create-form.tsx`,
`product-lifecycle-actions.tsx`). Did not touch anything under `apps/admin-web/src/app/products`,
`src/components/products`, or `src/lib/api/products.ts` (T5.1's scope). Only edited files under
`apps/admin-web/`.

## Routes wired

| Route | Method | `lib/api/orders.ts` fn | Server action | UI |
| --- | --- | --- | --- | --- |
| `/orders` | POST | `placeOrder` | `placeOrderAction` | `/orders/new` (`OrderCreateForm`) |
| `/orders/:orderId/refund` | POST | `refundOrder` | `refundOrderAction` | Order detail, `OrderLifecycleActions` refund button (gated) |
| `/orders/from-checkout` | POST | `createOrderFromCheckout` | `createOrderFromCheckoutAction` | `/orders/from-checkout` (`OrderFromCheckoutForm`) |
| `/orders/:orderId/advance` | POST | `advanceOrder` | `advanceOrderAction` | Order detail, "advance to…" dropdown (gated) |
| `/orders/:orderId/mark-paid` | POST | `markOrderPaid` | `markOrderPaidAction` | Order detail, paymentRef input + submit |
| `/orders/:orderId/request-payment-capture` | POST | `requestPaymentCapture` | `requestPaymentCaptureAction` | Order detail, button |
| `/orders/:orderId/request-fulfillment` | POST | `requestFulfillment` | `requestFulfillmentAction` | Order detail, button |

`GET /orders` / `GET /orders/:orderId` (already wired) were untouched except adding new exports
alongside `fetchRecentOrders`/`fetchOrder`/`fetchOrdersPage`/`fetchOrder` in the same file.

## Lifecycle table

Copied the backend's 21-state `TRANSITIONS` table verbatim into a new file,
`apps/admin-web/src/lib/order-lifecycle.ts`, with a comment noting it's a hand-kept copy of
`services/orders/src/domain/order-event.ts`'s `TRANSITIONS` (never imported — `apps/*` never
imports `services/*`). Two helpers built on top:

- `advanceableStatusesFrom(status)` — the transition table's targets from `status`, minus
  `paid`/`payment_received` (asserted only via `mark-paid`, rejected by the backend's
  `advanceOrderBody` zod refinement if sent to `/advance`). Returns `[]` for a terminal status
  (`refunded`, `closed`) or one whose only targets are payment-completion statuses (`placed` →
  only `cancelled` is offered, not `paid`).
- `canRefundFrom(status)` — `true` only for `paid`, `returned`, `refund_requested` (curated
  allowlist per the brief, since refund isn't a modeled transition target in the table).

The order-detail "advance to…" dropdown is rendered only when `advanceableStatusesFrom` is
non-empty (no disabled/empty control otherwise); the "Refund" button is rendered only when
`canRefundFrom` is true. "Mark paid", "Request payment capture", and "Request fulfillment" are
always offered (the brief only specified explicit gating for advance/refund) — an invalid
transition surfaces as a normal `toFormState` error, same discipline `ProductLifecycleActions`
already uses for products.

## Files changed

New:
- `apps/admin-web/src/lib/order-lifecycle.ts` + `order-lifecycle.test.ts`
- `apps/admin-web/src/app/orders/actions.ts` (7 actions: `placeOrderAction`,
  `createOrderFromCheckoutAction`, `refundOrderAction`, `advanceOrderAction`,
  `markOrderPaidAction`, `requestPaymentCaptureAction`, `requestFulfillmentAction`)
- `apps/admin-web/src/app/orders/new/page.tsx`
- `apps/admin-web/src/app/orders/from-checkout/page.tsx`
- `apps/admin-web/src/components/orders/order-line-items-field.tsx` — the repeated-field-array
  line-item rows, reusing `app/products/actions.ts`'s `parseVariants` technique (shared by both
  create forms since `placeOrderBody`/`createOrderFromCheckoutBody` declare identical per-item
  fields)
- `apps/admin-web/src/components/orders/order-address-fields.tsx` — one address block, shared by
  both forms (shipping-only for place-order, billing+shipping for from-checkout)
- `apps/admin-web/src/components/orders/order-create-form.tsx` + `.test.tsx`
- `apps/admin-web/src/components/orders/order-from-checkout-form.tsx` + `.test.tsx`
- `apps/admin-web/src/components/orders/order-lifecycle-actions.tsx` + `.test.tsx` — the
  order-detail actions bar (advance dropdown, mark-paid form, refund/request-capture/
  request-fulfillment buttons)

Modified:
- `apps/admin-web/src/lib/api/orders.ts` — added `OrderLineItemInput`/`OrderAddressInput`/
  `PlaceOrderInput`/`CreateOrderFromCheckoutInput` types and the 7 write functions
  (`placeOrder`, `createOrderFromCheckout`, `refundOrder`, `advanceOrder`, `markOrderPaid`,
  `requestPaymentCapture`, `requestFulfillment`), alongside the untouched `fetchRecentOrders`/
  `fetchOrdersPage`/`fetchOrder`
- `apps/admin-web/src/lib/api/orders.test.ts` — added a "T5.2 write functions" test block
- `apps/admin-web/src/app/orders/page.tsx` — added "New order" / "Create from checkout session"
  buttons in the header
- `apps/admin-web/src/app/orders/[orderId]/page.tsx` — renders `OrderLifecycleActions` in its own
  `Card` below the header, above the two-column grid
- `apps/admin-web/src/middleware.ts` — added `["/orders/new", "operator"]` and
  `["/orders/from-checkout", "operator"]` to `ROUTE_ROLE_REQUIREMENTS` (longest-prefix match wins
  over the existing `["/orders", "viewer"]` entry; order detail's write forms stay under the
  `viewer`-readable `/orders` prefix, same pattern T5.1 used for `/products/new` vs `/products`
  — the backend's own permission check is the real gate for the detail-page actions, same as
  product lifecycle actions)
- `apps/admin-web/src/messages/en.ts` / `messages/ar.ts` — added `ordersPage.newOrder`/
  `createFromCheckout`, and new `orderLineItemForm`, `orderAddressForm`, `orderCreate`,
  `orderFromCheckout`, `orderLifecycle` sections (both files verified key-for-key identical;
  `ar.ts`'s `Dictionary` type import would fail to compile otherwise, and typecheck passed)
- `docs/plans/PHASE-5-6-backlog.md` — ticked `T5.2` to `[x]`

## Idempotency-Key handling

`mutateAdminApi` (`lib/api/client.ts`) always sends the `Idempotency-Key` header whenever a key is
passed to it, regardless of the route's own `idempotent` flag — confirmed by reading its
implementation (no branching on a route flag it doesn't even receive). Per the brief: "if it
always sends an `Idempotency-Key` header regardless of the route's `idempotent` flag, do nothing
special." `requestPaymentCaptureAction`/`requestFulfillmentAction` (both `idempotent: false` on
the backend) still call `newIdempotencyKey()` exactly once per submit, same as every other action
— the backend simply won't dedupe replays by that header for these two routes, which is documented
in `lib/api/orders.ts`'s doc comments on those two functions.

## Manual pricing note

`OrderLineItemInput.unitPriceAmountMinor` is operator-typed in the create/from-checkout forms —
this is correct here per the brief's global constraint #10 (manual backoffice order-creation forms
are the one place client-supplied prices are intentional, unlike the storefront), and is called
out in `lib/api/orders.ts`'s doc comment above the write-route section.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no errors
pnpm --filter admin-web lint        # 0 errors, 1 pre-existing unrelated warning (next.config.ts, not touched by this task)
pnpm --filter admin-web test        # 38 test files passed, 335 tests passed
```

No entries added to `docs/plans/BLOCKERS.md` — nothing was blocked in this task.

## Concerns / follow-ups

- Server-side per-field validation errors from the backend's 422 envelope key nested fields by
  zod dot-path (`shippingAddress.line1`, confirmed by reading `packages/http/src/server.ts`'s
  `issue.path.join(".")`). `OrderAddressFields` renders per-field errors keyed exactly that way,
  but this wasn't verified against a live backend response — only unit-tested against the
  client-side parse-failure path (whole-block `shippingAddress`/`billingAddress` keys), matching
  what T5.1's own tests did for `variants`.
- Per the brief, "Mark paid", "Request payment capture", and "Request fulfillment" are rendered
  unconditionally on the order-detail actions bar (no client-side status gating) since the brief
  only specified explicit gating rules for "advance" and "refund" — an operator can attempt these
  from any status and get a normal form error back if the backend rejects the transition. Flagging
  this explicitly in case a future task wants tighter client-side gating for these three.
