# Task T5.2 brief — Order actions

Follows the same write-screen recipe as T5.1 (see `apps/admin-web/README.md`, "Adding a write
screen" — read it if you have not just done T5.1). Condensed recipe: route → typed `lib/api/`
function via `mutateAdminApi` → `"use server"` action in `app/orders/actions.ts` (new file) →
`"use client"` form/button using `useActionState` → both dictionaries → `middleware.ts` role check.

## Routes — all in `apps/admin/src/http/admin-routes.ts`, lines ~1011-1117

| Route | Method | Permission | Idempotent | Body (zod, verbatim) |
| --- | --- | --- | --- | --- |
| `/orders` (place, backoffice) | POST | `orders:place` | yes | `placeOrderBody` (line 54): `{ customerRef: string.min(1), currency: string.length(3), items: Array<{ productId, name, unitPriceAmountMinor: number.int().positive(), quantity: number.int().positive() }>.min(1), shippingAddress: { line1, city, postalCode, country } }` |
| `/orders/:orderId/refund` | POST | `orders:refund` | yes | none (params only) |
| `/orders/from-checkout` | POST | `orders:create_from_checkout` | yes | `createOrderFromCheckoutBody` (line 324): `{ checkoutRef, customerRef, currency: length(3), items: Array<{productId, name, unitPriceAmountMinor: int().min(0), quantity: int().positive()}>.min(1), billingAddress: {line1,city,postalCode,country}, shippingAddress: {same} }` — `.strict()` |
| `/orders/:orderId/advance` | POST | `orders:advance` | yes | `{ toStatus: string.min(1) }`, rejected server-side if `toStatus` is `"paid"` or `"payment_received"` (those two only happen via `/mark-paid`) |
| `/orders/:orderId/mark-paid` | POST | `orders:mark_paid` | yes | `{ paymentRef: string.min(1) }` |
| `/orders/:orderId/request-payment-capture` | POST | `orders:request_payment_capture` | **no** | none |
| `/orders/:orderId/request-fulfillment` | POST | `orders:request_fulfillment` | **no** | none |

(`GET /orders` and `GET /orders/:orderId` are already wired — do not touch `fetchOrder`/
`fetchRecentOrders` in `lib/api/orders.ts` except to add new functions alongside them.)

## The 21-state order lifecycle — gate the "advance" UI with this table

The backend's real transition table (`services/orders/src/domain/order-event.ts`, `TRANSITIONS`) —
apps/* may never import services/*, so copy this table verbatim as a UI-only constant in
`lib/api/orders.ts` or a small `lib/order-lifecycle.ts`, with a comment noting it is a hand-kept
copy of the backend's authoritative table (link the source file in the comment) and must be
updated if that table ever changes:

```
placed: [paid, cancelled]
paid: [refunded]
refunded: []
created: [confirmed, cancelled]
confirmed: [awaiting_payment, held, cancelled]
held: [resumed, cancelled]
resumed: [awaiting_payment]
awaiting_payment: [payment_requested, cancelled]
payment_requested: [payment_received, payment_failed]
payment_failed: [payment_requested, cancelled]
payment_received: [ready_for_fulfillment]
ready_for_fulfillment: [fulfillment_requested]
fulfillment_requested: [fulfilled, partially_fulfilled]
partially_fulfilled: [fulfilled]
fulfilled: [delivered]
delivered: [return_requested, closed]
return_requested: [returned]
returned: [refund_requested, closed]
refund_requested: [closed]
cancelled: [closed]
closed: []
```

Use this to populate the "advance to…" dropdown on the order detail screen with only the current
status's allowed next states, **excluding** `paid` and `payment_received` from the offered list
even where the table allows them (those two are asserted only via `/mark-paid`, never via
`/advance` — the backend's zod refinement rejects them; do not offer them here either). If the
current status has no allowed next states (e.g. `refunded`, `closed`), render no "advance" control
at all, not a disabled one with nothing in it.

`refund` should only be offered from a status where it makes sense (the legacy `paid` status, or
after `returned`/`refund_requested` in the full lifecycle per the table above) — gate its button
the same way, using the same table.

## Where to add the UI

- **Order detail** (`apps/admin-web/src/app/orders/[orderId]/page.tsx`): add an actions area (e.g.
  near `OrderStatusBadge`, or its own card) with: the gated "advance" dropdown + submit, "Mark
  paid" (paymentRef text input), "Refund" button (gated per above), "Request payment capture"
  button, "Request fulfillment" button. `request-payment-capture` and `request-fulfillment` are
  **not** idempotent — still mint an `Idempotency-Key` in the action per this app's own rule (one
  per submit), the backend's `idempotent: false` only means it does not dedupe by that header, it
  does not mean the client should skip minting one; follow `mutateAdminApi`'s existing contract
  as-is (check `lib/api/client.ts`'s `mutateAdminApi` signature — if it always sends an
  `Idempotency-Key` header regardless of the route's `idempotent` flag, do nothing special; if it
  conditionally omits the header for non-idempotent routes, follow whatever `mutateAdminApi`
  already does, do not change its behavior for this task).
- **Orders list** (`apps/admin-web/src/app/orders/page.tsx`): add a "New order" button linking to
  a new `apps/admin-web/src/app/orders/new/page.tsx` with the backoffice place-order form (mirror
  `apps/products/new/page.tsx` + `product-create-form.tsx`'s structure for a multi-line-item form —
  `parseVariants` in `app/products/actions.ts` is the reference pattern for a repeated-field-group
  form array; reuse the same technique for order line items).
- **Create from checkout**: this is a recovery path for a checkout session whose saga did not
  auto-create its order — there is no checkout-session admin screen in this codebase to launch it
  from contextually. Add it as its own small screen, `apps/admin-web/src/app/orders/from-checkout/
  page.tsx`, linked from the Orders list page (e.g. a secondary "Create from checkout session"
  link next to "New order"). Same line-item-array form technique, plus the two address blocks.

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*` and `services/*` never import from `apps/*` — and per the rule above, this task
   must NOT import from `services/orders` either; copy the transition table as data, not an import.
2. Domain aggregates never go on the wire — every DTO stays hand-typed to primitive fields.
3. Never fabricate data in the UI — explicit unavailable/empty/error states only.
4. Every user-facing string goes in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands — this working copy is not a git repository.
6. Do not ask questions. If genuinely blocked, append to `docs/plans/BLOCKERS.md`, skip that piece,
   continue.
7. Mark this task's checkbox (`- [ ] **T5.2 Order actions.**` → `- [x] **T5.2 Order actions.**`)
   in `docs/plans/PHASE-5-6-backlog.md` when done.
8. One `Idempotency-Key` per user-initiated submit, minted once in the action.
9. Never call the runtime API from browser JS.
10. Never send a client-supplied price/amount without it being a value the operator actually typed
    into the form — these are manual backoffice order-creation forms, so unit prices ARE
    operator-entered here (unlike the storefront, which never trusts client prices) — that is
    correct for this specific screen, not a violation of the pricing rule.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

Repo root: `D:\lumo-platform-main-main\lumo-platform-main-main`. Use `--filter admin-web` directly
(root-level turbo is broken on this Windows host per `docs/plans/BLOCKERS.md`).

## Report

Write your full report to `docs/plans/.progress/task-T5.2-report.md`. Return to the controller
only: status (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), files changed, a one-line test
summary (pass count), and any concerns.
