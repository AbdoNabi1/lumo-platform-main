# @platform/orders

## Purpose

The **Orders** bounded context (Phase 1 Commerce Core): placed orders, their line items, an
append-only event history, totals, and refunds. Owns its data; references the customer and payment
only by bare id and copies product/price/address as **immutable snapshots** at purchase time — no
live Catalog/Pricing reference, no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `Order` (aggregate; status **derived** from an append-only `OrderEvent` history:
  `placed` → `paid` → `refunded`; raises `order.placed`/`order.paid`/`order.refunded`), `OrderItem`
  - `OrderEvent` (entities); value objects `OrderNumber`, `ProductSnapshot`, `AddressSnapshot`;
    `RefundPolicy` (domain service — only paid orders are refundable); `OrderRepository` port. Uses the
    shared-kernel `Money` (`@platform/domain`). Pure.
- **application/** — `PlaceOrder`, `MarkOrderPaid`, `RefundOrder` (`@platform/application` `UseCase`).
  VO validation returns `Result`; aggregate invariants throw `DomainError` caught into the `Result`.
- **infrastructure/** — in-memory repository (writes the outbox on save), `InMemoryUnitOfWork`,
  `OrderEventTranslator` (→ `orders.order.{placed,paid,refunded}.v1`).
- **interfaces/** — `OrderController` (place/markPaid/refund) + `present()` (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Cross-context integration

`PlaceOrder` takes caller-supplied line **snapshots** (productId, name, unit price) + a shipping
address — sourced from Cart/Checkout at purchase time, never a live reference. `order.paid` is
consumed (later) by Inventory (decrement reserved) and Notifications; `MarkOrderPaid` is driven by
the checkout saga on `payment.captured`. No context is imported.

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace the in-memory repository with partitioned Postgres (outbox inside the DB transaction); add
returns/shipment aggregates and partial/time-windowed refunds (extend `RefundPolicy`); the checkout
saga calls `PlaceOrder` then `MarkOrderPaid`. All deferred (need infrastructure).

## Sprint A1 addendum — Payment Truth Foundation

`Order.completePayment(paymentRef, eventId, occurredAt)` is now the ONE authoritative
"payment completed" entry point, used by both the admin backoffice mark-paid action
(`POST /orders/:orderId/mark-paid`) and `PaymentCapturedConsumer`. It delegates to `markPaid` for the
legacy lifecycle (`placed` → `paid`) and to the generic `transition` for the checkout/saga lifecycle
(→ `payment_received`), so both lifecycles reach a paid state through one call, one error contract.
`apps/admin`'s generic `POST /orders/:orderId/transitions`-equivalent (`/orders/:orderId/advance`)
now rejects asserting `paid`/`payment_received` directly (422) — payment completion is no longer
caller-asserted outside the dedicated route. `MarkOrderPaidDeps` gained an optional `shadow` field
(`PaymentTruthShadowPort`, `services/orders/src/application/payment-truth-shadow.ts`) — inert by
default (`NoopPaymentTruthShadow`, unwired), reserved for a future saga-cutover sprint to compare
against the runtime purchase saga's own direct order-advance call. The sections above describing only
the legacy `placed → paid → refunded` lifecycle predate Sprint 4.7's checkout-driven lifecycle
entirely and are left as-is per sprint-isolation discipline.
