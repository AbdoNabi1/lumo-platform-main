# @platform/payments

## Purpose

The **Payments** bounded context (Phase 1 Commerce Core): a payment intent per order, its captures
(charges) and refunds, against a single PSP. References the order only by bare id; never stores raw
card data — only an opaque `PspToken`. No cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `PaymentIntent` (aggregate; `requires_payment` → `captured` → `refunded`, or
  `→ failed`; raises `payment.captured`/`payment.failed`/`payment.refunded`), `Charge` + `Refund`
  (entities); value objects `PspToken`, `PaymentStatus`; `PaymentIntentRepository` port. Uses the
  shared-kernel `Money` (`@platform/domain`) — refunds are bounded by the captured amount via
  `Money` arithmetic. Pure.
- **application/** — `CreatePaymentIntent`, `CapturePayment`, `FailPayment`, `RefundPayment`
  (`@platform/application` `UseCase`). VO validation returns `Result`; aggregate invariants throw
  `DomainError` caught into the `Result`.
- **infrastructure/** — in-memory repository (writes the outbox on save), `InMemoryUnitOfWork`,
  `PaymentEventTranslator` (→ `payments.payment_intent.{captured,failed,refunded}.v1`).
- **interfaces/** — `PaymentController` (createIntent/capture/fail/refund) + `present()` (no HTTP).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Cross-context integration

The checkout saga creates + captures the intent; `payment.captured` drives Orders to paid, while
`payment.failed` triggers saga compensation (release the Inventory reservation). Payments imports no
other context — it references the order by bare id and publishes events.

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Replace the in-memory repository with Postgres + a PSP adapter (Stripe) behind a port (outbox inside
the DB transaction); add webhooks/idempotency keys, partial-capture, and multi-PSP routing. All
deferred (need infrastructure).
