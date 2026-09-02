# Task T5.4 brief — Fulfillment and shipping

Same write-screen recipe as T5.1-T5.3 (`apps/admin-web/README.md`). Same "no list endpoint"
situation as T5.3's returns ruling — read that ruling's reasoning; it applies here too, see below.

## Ruling already made — read before you start

Like Returns (T5.3), Fulfillment and Shipping have **no list-all** capability and **no
get-by-own-id** route. The only reads are `GET /orders/:orderId/fulfillment` (already wired,
`fetchFulfillmentByOrder` in `lib/api/fulfillment.ts`, used read-only by `OrderFulfillmentCard`)
and `GET /fulfillments/:fulfillmentOrderId/shipment` (already wired,
`fetchShipmentByFulfillment` — check the exact existing function name in `lib/api/shipping.ts`,
used read-only by `OrderShippingCard`). **Ruling:** build detail screens only, chained from the
order: `apps/admin-web/src/app/orders/[orderId]/fulfillment/page.tsx` (keyed by orderId) and
`apps/admin-web/src/app/orders/[orderId]/shipment/page.tsx` (this one needs the fulfillment order's
id first — fetch fulfillment-by-order, then shipment-by-fulfillment, chained; if there is no
fulfillment yet, there cannot be a shipment either — render that explicitly). No `/fulfillments` or
`/shipments` list screens. Add one `docs/plans/BLOCKERS.md` entry (shape at the bottom of
docs/plans/README.md) noting both gaps together (list + get-by-id, for both domains) — do not add
the backend endpoints yourself.

## Fulfillment routes — `apps/admin/src/http/fulfillment-routes.ts` (read already, verbatim below)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/fulfillments` (create) | POST | `fulfillment:create` | yes | `{ orderRef: string.min(1), items: Array<{ productRef, quantity: int().positive() }>.min(1) }` |
| `/fulfillments/:fulfillmentOrderId/transitions` | POST | `fulfillment:advance` | yes | `{ toStatus: string.min(1) }` |
| `/fulfillments/:fulfillmentOrderId/reserve` | POST | `fulfillment:reserve` | **no** | none |
| `/fulfillments/:fulfillmentOrderId/shipments` (ship) | POST | `fulfillment:ship` | yes | none |
| `/fulfillments/:fulfillmentOrderId/webhook` | POST | `fulfillment:record_webhook` | **no** | `{ carrier, eventId, kind }` (all string.min(1)) |

Fulfillment lifecycle transition table (copy verbatim as UI-only data, comment sourced from
`services/fulfillment/src/domain/value-objects/fulfillment-status.ts`, do not import `services/*`):

```
created: [reservation_requested, cancelled]
reservation_requested: [confirmed, failed]
confirmed: [picking_started, cancelled]
failed: [reservation_requested, cancelled]
picking_started: [picking_completed]
picking_completed: [packing_started]
packing_started: [packing_completed]
packing_completed: [shipment_created]
shipment_created: [tracking_assigned]
tracking_assigned: [shipment_dispatched]
shipment_dispatched: [in_transit]
in_transit: [out_for_delivery, delivery_failed]
out_for_delivery: [delivered, delivery_failed]
delivered: [returned, closed]
delivery_failed: [in_transit, returned, closed]
returned: [closed]
cancelled: [closed]
closed: []
```

## Shipping routes — `apps/admin/src/http/shipping-routes.ts` (read already, verbatim below)

| Route | Method | Permission | Idempotent | Body |
| --- | --- | --- | --- | --- |
| `/shipments` (create) | POST | `shipping:create` | yes | `{ fulfillmentRef: string.min(1), packages: Array<{ reference, itemRefs: string[].min(1), weightGrams: int().positive() }>.min(1) }` |
| `/shipments/:shipmentId/transitions` | POST | `shipping:advance` | yes | `{ toStatus: string.min(1) }` |
| `/shipments/:shipmentId/label` | POST | `shipping:create_label` | yes | none |
| `/shipments/:shipmentId/label-void` | POST | `shipping:void_label` | yes | none |
| `/shipments/:shipmentId/tracking` | POST | `shipping:update_tracking` | **no** | `{ description: string.min(1), location?: string.min(1) }` |
| `/shipments/:shipmentId/retry` | POST | `shipping:retry` | yes | none |
| `/shipments/:shipmentId/webhook` | POST | `shipping:record_webhook` | **no** | `{ carrier, eventId, kind }` (all string.min(1)) |

Shipment lifecycle transition table (same copy-as-data rule, sourced from
`services/shipping/src/domain/value-objects/shipment-status.ts`):

```
created: [label_created, voided, cancelled]
label_created: [carrier_accepted, rejected, voided, cancelled]
voided: [created, closed]
carrier_accepted: [in_transit, cancelled]
rejected: [created, cancelled]
in_transit: [out_for_delivery, exception]
out_for_delivery: [delivered, delivery_failed]
delivered: [returned, closed]
delivery_failed: [in_transit, exception, closed]
returned: [closed]
exception: [created, closed]
cancelled: [closed]
closed: []
```
Note in the comment: `rejected`/`delivery_failed`/`exception` are the 3 recoverable states the
`/retry` route targets — surface "Retry" as its own button (not folded into the generic advance
dropdown) whenever the shipment is in one of these three states.

## What to build

1. `apps/admin-web/src/lib/api/fulfillment.ts` and `lib/api/shipping.ts` (existing files) — add
   mutate functions for the 5 + 7 write routes above.
2. The two new detail pages described in the ruling, each with: read display (reuse/extend the
   existing card's rendering, or factor it into a shared component both card and page use — your
   call), the create form when nothing exists yet (fulfillment create needs the order's real line
   items — fetch via `fetchOrder`, same item-picker discipline as T5.3's return-create form; ship
   create needs the fulfillment's packages — build a simple repeated-package-row form, reference/
   itemRefs/weightGrams), and every other write action gated by its own transition table.
3. `OrderFulfillmentCard` / `OrderShippingCard` — add a "Manage" link to the corresponding new page,
   keep existing read-only rendering intact.
4. `middleware.ts` — verify `/orders` prefix covers the two new nested paths at the right role
   (match T5.2/T5.3's choice, likely `operator`).

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*`/`services/*` never import `apps/*`; this task must not import `services/fulfillment`
   or `services/shipping` either — copy both transition tables as data.
2. Domain aggregates never go on the wire.
3. Never fabricate data — the "no list screen" ruling is this rule applied to a whole screen.
4. Every user-facing string in both `messages/en.ts` and `messages/ar.ts`.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.4 Fulfillment and shipping.**` → `- [x] ...`) when done,
   and add the combined BLOCKERS.md entry — both required.
8. One `Idempotency-Key` per user-initiated submit regardless of the route's own `idempotent` flag.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.4-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
