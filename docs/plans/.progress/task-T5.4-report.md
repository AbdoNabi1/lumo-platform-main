# Task T5.4 report — Fulfillment and shipping

## Status: DONE

## What was built

Per the brief's own ruling (already resolved, not re-derived): the backend has no `GET
/fulfillments` (list) / `GET /fulfillments/:fulfillmentOrderId` (by id), and no `GET /shipments`
(list) / `GET /shipments/:shipmentId` (by id) — only `GET /orders/:orderId/fulfillment` and `GET
/fulfillments/:fulfillmentOrderId/shipment`. Built two **detail** screens only, both keyed by
`orderId`:

- `apps/admin-web/src/app/orders/[orderId]/fulfillment/page.tsx`
- `apps/admin-web/src/app/orders/[orderId]/shipment/page.tsx` (chains through the fulfillment
  order first — `fetchFulfillmentByOrder` → `fetchShipmentByFulfillment` — and renders an explicit
  "not yet fulfilled" message with no create form at all when there is no fulfillment order yet)

No `/fulfillments` or `/shipments` list screens, and no by-fulfillment-id/by-shipment-id alternate
routes, were built.

### 1. `apps/admin-web/src/lib/api/fulfillment.ts` and `lib/api/shipping.ts` (edited)

Added typed mutate functions for all 5 fulfillment write routes
(`createFulfillment`/`advanceFulfillment`/`reserveFulfillment`/`shipFulfillment`/
`recordFulfillmentWebhook`) and all 7 shipping write routes
(`createShipment`/`advanceShipment`/`createShipmentLabel`/`voidShipmentLabel`/
`updateShipmentTracking`/`retryShipment`/`recordShipmentWebhook`), next to the existing
`fetchFulfillmentByOrder`/`fetchShipmentByFulfillment`. None of the 12 routes' handlers map their
response through a DTO (only `getByOrder`/`getByFulfillment` do), so every write function follows
`returns.ts`'s established `isUnknown` pattern: type nothing off the response, `revalidatePath` the
detail screen afterward to re-fetch the real, DTO-mapped state.

### 2. `apps/admin-web/src/lib/fulfillment-lifecycle.ts` and `lib/shipping-lifecycle.ts` (new)

Hand-kept UI-only copies of the two backend transition tables (`fulfillment-status.ts`/
`shipment-status.ts`), same technique as `lib/return-lifecycle.ts`. Unlike Returns, where every
dedicated route's implied target set exactly equals its status's full transition-table entry (a
clean either/or between "dedicated action" and "generic advance dropdown"), several Fulfillment/
Shipping dedicated routes only cover *some* of their status's targets (e.g. `created`'s two targets
are `reservation_requested` and `cancelled`, but `reserve` only ever implies the former). Both
files therefore export per-action `can<X>From(status)` gates plus an
`advanceable<X>StatusesFrom(status)` helper that returns the transition table's targets **minus**
whatever a dedicated action at that status already covers — so the generic dropdown never
duplicates a control the operator already has, and multiple controls can legitimately co-render at
one status. `retry` is gated to exactly the brief's named 3 recoverable states
(`rejected`/`delivery_failed`/`exception`), per its explicit instruction. `record_webhook` for both
domains is gated only by "not terminal" — it isn't scoped to a single transition at all, it's how
the carrier/inventory side reports back over time.

### 3. The two pages + their `actions.ts`

- **Fulfillment page**: fetches the order (header + real line items for the create-fulfillment
  item picker) and the fulfillment (`fetchFulfillmentByOrder`). Three states: `ok` (summary +
  `FulfillmentLifecycleActions`), `not_found` (`FulfillmentCreateForm`), `unauthorized`/`error`
  (explicit unavailable message).
- **Shipment page**: fetches the order, then the fulfillment, then (only if the fulfillment exists)
  the shipment. Four states: order-fetch failure, no fulfillment yet (explicit message, no form),
  `ok` (summary + `ShipmentLifecycleActions`), `not_found` (`ShipmentCreateForm`).
- Both `actions.ts` files parse `FormData` defensively, mint exactly one `Idempotency-Key` per
  submit (including for the `idempotent: false` routes — `reserve`/`webhook` on both domains,
  `tracking` on shipping — matching `mutateAdminApi`'s existing always-send behavior), and project
  non-`ok` outcomes through `toFormState`.

### 4. Form/action components

- `FulfillmentCreateForm` — one row per the order's real line items (checkbox + quantity), same
  item-picker discipline as `ReturnCreateForm`: the operator never free-types a `productRef`.
- `ShipmentCreateForm` — `POST /shipments`'s `packages` body has no natural picker source (a
  shipment's packages are an operator-defined packing plan, not a 1:1 reflection of order items),
  so per the brief this is a plain repeated-package-row form (reference / comma-separated itemRefs
  / weightGrams), same array-of-rows technique `OrderLineItemsField` (T5.2) uses, read back
  positionally in `parseShipmentCreatePackages`.
- `FulfillmentLifecycleActions` / `ShipmentLifecycleActions` — render whichever of their gated
  sub-forms apply at the current status (possibly several at once, per the lifecycle-helper doc
  comments above), returning `null` entirely when none apply (only the terminal `closed` status).

### 5. `order-fulfillment-card.tsx` / `order-shipping-card.tsx` (edited)

Factored the read-only rendering into exported `FulfillmentSummary`/`ShipmentSummary` components
(same technique T5.3's `ReturnSummary` used), reused by both the card and the new page. Added a
"Manage fulfillment"/"Open a fulfillment" and "Manage shipment"/"Open a shipment" link to the new
write screens. `FulfillmentSummary` additionally renders the DTO's `packages` field, which the
original card never displayed (real data that was simply unused before this task). The cards' own
read-only bodies and `not_found`/`error`/`shippingNotYetFulfilled` states are otherwise unchanged.

### 6. `middleware.ts` — verified, no change

Same precedent T5.2/T5.3 already established and documented: `/orders` (`viewer`) covers
`/orders/[orderId]/fulfillment` and `/orders/[orderId]/shipment` by prefix, and none of the
existing more-specific entries (`/orders/new`, `/orders/from-checkout`) apply to a dynamic
`orderId` segment. The real write-authorization boundary is the backend's own per-route
`permission` check (`fulfillment:reserve`/`shipping:create_label`/etc. via `AdminGuard`) — a
`viewer`-role JWT will not carry these regardless of which page the request came from; any submit
attempt from an under-privileged session comes back `forbidden`, handled by the normal
`toFormState` error path. `middleware.test.ts` still passes unchanged (13 tests).

### 7. Both dictionaries (`messages/en.ts`, `messages/ar.ts`)

Added `fulfillmentScreen`, `fulfillmentCreateForm`, `fulfillmentLifecycle`, `shipmentScreen`,
`shipmentCreateForm`, `shipmentLifecycle` sections, plus `orderDetail.manageFulfillment`/
`openFulfillment`/`manageShipment`/`openShipment`, to both locales (key-for-key identical; `ar.ts`'s
`Dictionary` type import would fail to compile otherwise — typecheck passed).

### 8. `docs/plans/BLOCKERS.md` and `docs/plans/PHASE-5-6-backlog.md`

Added the required combined T5.4 entry to `BLOCKERS.md` (both domains' list + get-by-id gap,
together, per the brief). Ticked T5.4's checkbox in the backlog.

## Files changed

New:
- `apps/admin-web/src/lib/fulfillment-lifecycle.ts` + `.test.ts`
- `apps/admin-web/src/lib/shipping-lifecycle.ts` + `.test.ts`
- `apps/admin-web/src/lib/api/fulfillment.test.ts`
- `apps/admin-web/src/lib/api/shipping.test.ts`
- `apps/admin-web/src/app/orders/[orderId]/fulfillment/page.tsx`
- `apps/admin-web/src/app/orders/[orderId]/fulfillment/actions.ts`
- `apps/admin-web/src/app/orders/[orderId]/shipment/page.tsx`
- `apps/admin-web/src/app/orders/[orderId]/shipment/actions.ts`
- `apps/admin-web/src/components/orders/fulfillment-create-form.tsx`
- `apps/admin-web/src/components/orders/fulfillment-lifecycle-actions.tsx`
- `apps/admin-web/src/components/orders/shipment-create-form.tsx`
- `apps/admin-web/src/components/orders/shipment-lifecycle-actions.tsx`

Modified:
- `apps/admin-web/src/lib/api/fulfillment.ts` — added the 5 write functions
- `apps/admin-web/src/lib/api/shipping.ts` — added the 7 write functions
- `apps/admin-web/src/components/orders/order-fulfillment-card.tsx` — factored `FulfillmentSummary`
  out, added "Manage/Open fulfillment" link
- `apps/admin-web/src/components/orders/order-shipping-card.tsx` — factored `ShipmentSummary` out,
  added "Manage/Open shipment" link
- `apps/admin-web/src/messages/en.ts` / `messages/ar.ts`
- `docs/plans/BLOCKERS.md`
- `docs/plans/PHASE-5-6-backlog.md`
- `apps/admin-web/src/middleware.ts` — verified, not changed

No file under T5.1's, T5.2's, or T5.3's off-limits scope was touched. The three expected-overlap
files (`app/orders/[orderId]/page.tsx`, `order-fulfillment-card.tsx`, `order-shipping-card.tsx`)
were touched only as described: `page.tsx` was not touched at all (the card components' public
exports `OrderFulfillmentCard`/`OrderShippingCard` are unchanged in name/signature, only their
internals gained a factored-out summary component and a link).

## Idempotency-Key handling

Same rule as every prior task: `mutateAdminApi` always sends the `Idempotency-Key` header whenever
a key is passed, regardless of the route's own `idempotent` flag. Every write action in both
`actions.ts` files calls `newIdempotencyKey()` exactly once per submit — including
`reserveFulfillmentAction`/`recordFulfillmentWebhookAction` (fulfillment's two `idempotent: false`
routes) and `updateShipmentTrackingAction`/`recordShipmentWebhookAction` (shipping's two
`idempotent: false` routes) — documented in `lib/api/fulfillment.ts`/`shipping.ts`'s doc comments
on those functions.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main"
pnpm --filter admin-web typecheck   # clean, no errors
pnpm --filter admin-web lint        # 0 errors, 1 pre-existing unrelated warning (next.config.ts)
pnpm --filter admin-web test        # 44 files, 408 tests passed (49 new: 9 in fulfillment.test.ts,
                                     # 11 in shipping.test.ts, 12 in fulfillment-lifecycle.test.ts,
                                     # 17 in shipping-lifecycle.test.ts)
```

Not verified in a live browser — no Docker available in this environment to run `apps/runtime` +
`admin-web` together (same standing limitation `BLOCKERS.md` already records for prior phases).

## Concerns / judgment calls

1. **The dedicated-action-vs-advance-dropdown split required real interpretation, unlike Returns'
   clean 1:1 mapping.** Returns' 8 dedicated routes each imply exactly the full target set of the
   one status they apply to, so "has a dedicated action" and "needs the generic advance dropdown"
   were mutually exclusive. Fulfillment's `reserve` (`created`/`failed` → only implies
   `reservation_requested`, not the sibling `cancelled` target) and `ship` (`packing_completed` →
   fully implies its sole target `shipment_created`) don't share that property, and neither do
   Shipping's `label`/`label-void`/`retry`. I resolved this by defining, per status, which
   transition-table targets each dedicated route is understood to cover (documented in both
   `lib/*-lifecycle.ts` files' doc comments, with the reasoning spelled out — e.g. `retry`'s
   implied target is read from which of `rejected`/`exception`'s single non-`cancelled` target is
   `created`, and `delivery_failed`'s is `in_transit`), and showing the generic advance dropdown
   only for whatever residual targets remain. This is a defensible reading of the route summaries
   and the transition table, but it is an interpretation, not something the route files state
   explicitly — a reviewer with domain knowledge of what `/reserve`/`/label`/`/retry` actually set
   the resulting status to should double-check the `DEDICATED_COVERED_TARGETS` maps in both files.
2. **`record_webhook` and `update_tracking` are gated only by "not terminal," not by a specific
   status**, since neither route corresponds to one transition-table edge — both are how the
   carrier/inventory side reports back over time. This mirrors T5.2's own precedent for actions the
   brief didn't specify tighter gating for ("Mark paid"/"Request capture" rendered unconditionally).
3. **`ShipmentCreateForm`'s `itemRefs` field is a comma-separated text input**, not a picker against
   real data — per the brief's own instruction ("build a simple repeated-package-row form,
   reference/itemRefs/weightGrams"), since a shipment's packages are an operator-defined packing
   plan with no natural 1:1 source to pick from (unlike Fulfillment's/Returns' item pickers, which
   pick from the order's *existing* real line items). This is consistent with the brief's own
   instruction, not a deviation from it, but is worth flagging since it's the one write form in this
   task (and in T5.1-T5.4 collectively) that accepts free-typed reference strings rather than
   picking from fetched data.
4. Import paths like `@/app/orders/[orderId]/fulfillment/actions` (literal bracket-directory
   segments) follow the same no-prior-elsewhere-but-verified-working precedent T5.3's report already
   flagged for `@/app/orders/[orderId]/returns/actions` — confirmed via a clean `tsc --noEmit` and
   the full test suite passing.
