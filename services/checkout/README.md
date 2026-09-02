# @platform/checkout

## Purpose

The **Checkout** bounded context (Phase 1 Commerce Core): a `CheckoutSession` that fronts the
purchase saga for a cart and ends `completed` (order placed + paid) or `failed` (a step failed +
compensated). References the cart, customer, and order only by bare id — no cross-context import.

## Architecture (clean-architecture slice)

- **domain/** — `CheckoutSession` (aggregate; `started` → `completed` | `failed`; raises
  `checkout.completed` / `checkout.failed`); value object `CheckoutState`;
  `CheckoutSessionRepository` port. Pure (`@platform/domain` only).
- **application/** — `StartCheckout`, `CompleteCheckout`, `FailCheckout` (`@platform/application`
  `UseCase`). VO validation returns `Result`; aggregate invariants throw `DomainError` caught into
  the `Result`.
- **infrastructure/** — in-memory repository (writes the outbox on save), `InMemoryUnitOfWork`,
  `CheckoutEventTranslator` (→ `checkout.checkout_session.{completed,failed}.v1`).
- **interfaces/** — `CheckoutController` (start/complete/fail) + `present()` (no HTTP server).
- **composition.ts** — wires the slice with in-memory adapters (serializer/id/clock injected).

## Scope note — the saga orchestration is deferred

The 0.5 design has Checkout **orchestrate** the purchase saga (Pricing → Inventory → Payments →
Orders, with compensation on `payment.failed`). That orchestration needs a workflow engine (Temporal)
and synchronous read clients (gRPC) — both deferred (no Docker host). This sprint delivers the
**session aggregate + lifecycle events** the saga will drive: the orchestrator calls
`StartCheckout`, runs the steps against the other contexts, then calls `CompleteCheckout`
(with the placed order's id) or `FailCheckout`. Checkout never imports another context.

## Dependencies

`@platform/{domain, application, contracts, repository, messaging, domain-events, types, utils}`.
Dependency direction enforced by `pnpm arch`.

## Extension points

Add the Temporal workflow + gRPC clients to orchestrate the steps and compensation; persist sessions
in Postgres (outbox inside the DB transaction); add A/B and multi-step custom flows. All deferred.
