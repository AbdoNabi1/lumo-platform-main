# Sprint 1.4 — Commerce Core: Checkout + Orders + Payments (+ Step 0 kernel promotion) — Implementation Report

> **Date:** 2026-06-30 · **Status:** ✅ COMPLETE (all gates green) · **Phase 1 — Commerce Core.**
> Not committed/pushed (per instructions).

## 1. Summary

Two logically separate pieces of work:

- **Step 0 — Rule-of-Three promotion (refactor):** `Money` and `ProductRef` were promoted into the
  shared kernel `@platform/domain` and **all** consumers migrated; the six context-local copies were
  deleted. Independent, behaviour-preserving, fully gated **before** any feature work (DECISIONS
  D-030; per the Architecture Debt Policy + D-029).
- **Sprint 1.4 feature work — three bounded contexts:** `@platform/orders`, `@platform/payments`,
  `@platform/checkout`, each an independent Clean-Architecture slice on the kernel/messaging with
  in-memory persistence + transactional outbox, framework-agnostic controllers, and no cross-context
  imports (DECISIONS D-031).

## 2. Step 0 — kernel promotion (separated refactor)

- **Canonical `Money`** (`packages/domain/src/shared/value-objects/money.ts`): `create(amountMinor,
currency: string)` requiring a **non-negative integer** + ISO-4217 code; `zero`; `plus`/`minus`/
  `times`; `isGreaterThan`/`isZero` — all currency-checked, throwing `BusinessRuleError` on a
  mismatch or negative result. Reconciles the three prior shapes (Catalog getters-only; Pricing's
  `Currency`-VO form; Cart's `string` + arithmetic) → **string** currency + the superset of
  arithmetic Orders/Payments need. Pricing keeps its local `Currency` VO and passes `.code` in.
- **Canonical `ProductRef`**: unchanged (`Guard.againstEmpty`).
- **Migration:** deleted catalog/pricing/cart `money.ts` + pricing/inventory/cart `product-ref.ts`
  (6 files); migrated every import; rewrote Pricing's `Money(Currency)` call sites to
  `Money(string)`; moved the `Money`/`ProductRef` unit tests into the kernel. `Currency` (Pricing)
  and `Quantity` (Inventory/Cart) stayed context-local — not at rule of three.
- **No duplicates remain** (`arch` + a tree scan confirm `Money`/`ProductRef` exist only in the
  kernel). **Only behavioural change:** `Money` now rejects negatives — no test/call relied on them.

## 3. Implemented contexts (feature work)

- **`@platform/orders`** — `Order` aggregate (status **derived** from an append-only `OrderEvent`
  history: `placed`→`paid`→`refunded`), `OrderItem`/`OrderEvent` entities, VOs `OrderNumber`/
  `ProductSnapshot`/`AddressSnapshot`, `RefundPolicy` domain service (paid-only); use-cases
  `PlaceOrder`/`MarkOrderPaid`/`RefundOrder`; events `order.{placed,paid,refunded}`.
- **`@platform/payments`** — `PaymentIntent` aggregate (`requires_payment`→`captured`→`refunded` |
  `→failed`), `Charge`/`Refund` entities, VOs `PspToken`/`PaymentStatus`; refunds bounded by the
  captured amount via `Money` arithmetic; use-cases `CreatePaymentIntent`/`CapturePayment`/
  `FailPayment`/`RefundPayment`; events `payment.{captured,failed,refunded}`.
- **`@platform/checkout`** — `CheckoutSession` aggregate (`CheckoutState` VO; `started`→`completed`|
  `failed`); use-cases `StartCheckout`/`CompleteCheckout`/`FailCheckout`; events
  `checkout.{completed,failed}`. **Saga orchestration deferred** (needs Temporal + gRPC clients).

Each context also has the standard infra (in-memory repo writing the outbox on save,
`InMemoryUnitOfWork`, an `IntegrationEventTranslator`), `present()` + a framework-agnostic
controller, a `composition.ts`, an `index.ts`, and an end-to-end test.

## 4. Files created

- **Step 0 (kernel, 4):** `packages/domain/src/shared/value-objects/{money,product-ref,index,value-objects.test}.ts`.
- **`services/orders` (28):** config 4 (`package.json`/`tsconfig.json`/`vitest.config.ts`/`README.md`);
  `src/{index,composition,orders.e2e.test}.ts`;
  `domain/value-objects/{order-number,product-snapshot,address-snapshot,value-objects.test}.ts`;
  `domain/{order,order-item,order-event,order-repository,refund-policy,order.test}.ts`;
  `domain/events/{order-placed,order-paid,order-refunded}.event.ts`;
  `application/{place-order,mark-order-paid,refund-order}.use-case.ts`;
  `infrastructure/{in-memory-unit-of-work,order-event-translator,in-memory-order-repository}.ts`;
  `interfaces/{presenter,order.controller}.ts`.
- **`services/payments` (27):** config 4; `src/{index,composition,payments.e2e.test}.ts`;
  `domain/value-objects/{psp-token,payment-status,value-objects.test}.ts`;
  `domain/{payment-intent,charge,refund,payment-intent-repository,payment-intent.test}.ts`;
  `domain/events/{payment-captured,payment-failed,payment-refunded}.event.ts`;
  `application/{create-payment-intent,capture-payment,fail-payment,refund-payment}.use-case.ts`;
  `infrastructure/{in-memory-unit-of-work,payment-event-translator,in-memory-payment-intent-repository}.ts`;
  `interfaces/{presenter,payment.controller}.ts`.
- **`services/checkout` (22):** config 4; `src/{index,composition,checkout.e2e.test}.ts`;
  `domain/value-objects/{checkout-state,value-objects.test}.ts`;
  `domain/{checkout-session,checkout-session-repository,checkout-session.test}.ts`;
  `domain/events/{checkout-completed,checkout-failed}.event.ts`;
  `application/{start-checkout,complete-checkout,fail-checkout}.use-case.ts`;
  `infrastructure/{in-memory-unit-of-work,checkout-event-translator,in-memory-checkout-session-repository}.ts`;
  `interfaces/{presenter,checkout.controller}.ts`.
- `docs/implementation/SPRINT_1_4_REPORT.md`.

## 5. Files modified / deleted

- **Deleted (6):** `services/{catalog,pricing,cart}/src/domain/value-objects/money.ts`,
  `services/{pricing,inventory,cart}/src/domain/value-objects/product-ref.ts`.
- **Modified (Step 0 migration):** `packages/domain/src/shared/index.ts`; catalog `variant.ts` +
  `create-product.use-case.ts` + `product.test.ts` + `value-objects.test.ts`; pricing `price.ts` +
  `create-price.use-case.ts` + `change-price.use-case.ts` + `price.test.ts` + `value-objects.test.ts`;
  inventory `inventory-item.ts` + `inventory-item.test.ts` + the 4 use-cases; cart `cart.ts` +
  `cart-item.ts` + `cart.test.ts` + 4 use-cases + `value-objects.test.ts`.
- **Docs:** `PROJECT_STATE.md`, `AI_CONTEXT.md`, `DECISIONS.md` (append D-030, D-031),
  `docs/development/WORKSPACE_GUIDE.md`; `pnpm-lock.yaml` (3 new workspace packages).

## 6. Validation results

| Gate                             | Result                              |
| -------------------------------- | ----------------------------------- |
| `pnpm install --frozen-lockfile` | ✅ PASS                             |
| `pnpm lint`                      | ✅ PASS (32 packages)               |
| `pnpm typecheck`                 | ✅ PASS (32 packages)               |
| `pnpm test` (serialized)         | ✅ PASS (32 task)                   |
| `pnpm build`                     | ✅ PASS                             |
| `pnpm arch`                      | ✅ PASS — 351 modules, 0 violations |

Step 0 was independently green on all five gates before any feature work began. One test fix during
the build (Cart e2e asserted a domain event name vs the integration type) was already resolved in
Sprint 1.3; no new fixes were needed here.

## 7. Test counts

- New feature tests: **`@platform/orders` 12**, **`@platform/payments` 13**, **`@platform/checkout`
  10** (= 35). Kernel `@platform/domain` **33** (incl. the promoted `Money`/`ProductRef` suite).
  All migrated contexts (catalog/pricing/inventory/cart) remain green.

## 8. Architecture notes

- **No cross-context imports** (`arch` enforced): Orders/Payments/Checkout reference cart, order,
  customer, and payment by **bare id**; Orders copies product/price/address as **snapshots**.
- **Outbox per context**; events published via the in-memory relay in tests
  (`orders.order.*`, `payments.payment_intent.*`, `checkout.checkout_session.*`).
- **Derived order status** from an append-only `OrderEvent` log (insert-only; status never mutated)
  honours the 0.5 design's append-only aggregate intent.
- **Domain service** `RefundPolicy` demonstrates the kernel `DomainService` seam.
- VO factories → `Result`; aggregate invariants throw `DomainError` caught into `Result`;
  framework-agnostic controllers + `present()` — consistent with D-026/D-027/D-028.

## 9. Trade-offs

- In-memory persistence (no ACID/durability) — the outbox-on-save pattern swaps to Postgres without
  touching domain/application.
- `present()` + `InMemoryUnitOfWork` duplicated per context (interface/infra independence).
- Step 0 touched four previously-committed contexts (imports + Pricing call sites) — required to
  complete the promotion; behaviour preserved.

## 10. Technical debt

- The **purchase-saga orchestration** is not implemented: Checkout exposes the session lifecycle but
  does not yet _drive_ Pricing → Inventory → Payments → Orders with compensation. Needs a workflow
  engine (Temporal) + sync gRPC clients.
- Cross-context reactions (`order.paid` → Inventory decrement; `payment.failed` → release stock) are
  modelled as events but have **no live consumer** yet (broker deferred).
- `present()`/`InMemoryUnitOfWork` duplication across the eight Phase-1 contexts (intentional).

## 11. Deferred work

Temporal purchase saga + gRPC sync clients; Prisma persistence + partitioned `orders` schema + a PSP
adapter (Stripe) behind a port; Redpanda/Debezium broker wiring + live event consumers; HTTP
transport; returns/shipment aggregates + partial/time-windowed refunds; Identity context (Sprint
1.5) as the order's customer/address source.

## 12. Git (not committed)

Working tree contains the Step 0 refactor + the three new contexts + doc updates (and the still-
uncommitted Sprint 1.3 Cart). **Two recommended commits, separated per the Architecture Debt Policy:**

```
refactor(domain): promote Money and ProductRef to the shared kernel (Sprint 1.4 Step 0)

feat(checkout,orders,payments): phase 1 checkout + orders + payments contexts (Sprint 1.4)
```

**Ready for Sprint 1.5?** Yes — Orders/Payments/Checkout are green and the kernel is consolidated.
Next per the roadmap is **Sprint 1.5 — Identity/Customers** (the last Phase-1 context).

**Sprint 1.4 is complete. Stopping — not beginning Sprint 1.5.**
