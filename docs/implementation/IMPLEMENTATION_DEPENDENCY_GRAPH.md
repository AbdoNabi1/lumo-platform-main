# Lumo Platform — Phase A Implementation Dependency Graph

**Status:** Validation only. No code was changed to produce this document.
**Inputs:** `ARCHITECTURE_REMEDIATION_PLAN.md` (findings → remediation items) and `ARCHITECTURE_EXECUTION_MATRIX.md` (corrected scope, per-item impact analysis, revised ordering). This document takes the execution matrix's corrected 30-sub-item Phase A scope and makes the dependency structure between every pair of items explicit and checkable, then computes the critical path.
**Purpose:** confirm the graph is internally consistent — no cycles, no sub-item scheduled before a hard predecessor, every shared-resource conflict identified — before `PRODUCTION_CUTOVER_PLAN.md` is treated as actionable.

---

## 0. Item Catalog

The execution matrix split several original remediation items into ordered sub-items once their real scope was understood. This is the full, corrected Phase A worklist — 30 items — used as the unit of scheduling throughout this document.

| ID      | Item                                                                                                                | Context(s)                                                         | Effort                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| A6a     | Opt-in atomic consumer idempotency capability                                                                       | Platform (`packages/kafka`, `packages/messaging`)                  | M                                                 |
| A5a     | Postgres-backed webhook idempotency — Payments                                                                      | Payments                                                           | S                                                 |
| A5b     | Postgres-backed webhook idempotency — Fulfillment                                                                   | Fulfillment                                                        | S                                                 |
| A5c     | Postgres-backed webhook idempotency — Shipping                                                                      | Shipping                                                           | S                                                 |
| A5d     | Postgres-backed webhook idempotency — Returns                                                                       | Returns                                                            | S                                                 |
| A5e     | Postgres-backed webhook idempotency — Notifications                                                                 | Notifications                                                      | S                                                 |
| A6b-i   | Finance: `onRefundIssued` consumer (only Phase-A-achievable sub-item of A6b)                                        | Finance, Payments (translator field fix)                           | M                                                 |
| A1-i    | Fix id-correlation; add `findByCheckoutRef`-style Order lookup                                                      | Orders                                                             | S                                                 |
| A1-ii   | Consumer drives `AdvanceOrder(payment_received)` in shadow mode                                                     | Orders, `apps/runtime`                                             | M                                                 |
| A1-iii  | Restrict `/orders/:orderId/transitions` from caller-asserted payment transitions                                    | Orders, `apps/admin`                                               | S                                                 |
| A1-iv   | Gate/remove dead-code admin `markOrderPaid` action                                                                  | Orders, `apps/admin`                                               | S                                                 |
| A1-v    | Tighten `pspToken` check in synchronous-capture fallback                                                            | Payments, `apps/runtime`                                           | S                                                 |
| A1-vi   | Cutover: remove saga's direct `payment_received` call                                                               | `apps/runtime`                                                     | S (but gated by a calendar-time soak, not effort) |
| A2      | Wire Temporal `paymentCapturedSignal`                                                                               | `packages/temporal`, `apps/runtime`                                | M                                                 |
| A3      | Saga activity idempotency + partial-failure compensation                                                            | `apps/runtime`, Inventory, Payments, Checkout                      | L                                                 |
| A9a     | Build `RealInventoryRestockPort`; add idempotency key to `requestRestock`                                           | Returns, `apps/admin`, Inventory                                   | M                                                 |
| A9b     | `AcceptItems` restock compensation logic                                                                            | Returns                                                            | M                                                 |
| A8      | Fulfillment→Shipping idempotency key + migration + admin-route reconciliation                                       | Shipping, Fulfillment, `apps/admin`                                | M                                                 |
| A10     | Catalog variant-edit upsert fix (sku-swap-safe)                                                                     | Catalog                                                            | S                                                 |
| A4a     | Fail-loud interim PSP guard                                                                                         | Payments                                                           | S                                                 |
| A4b     | Real PSP adapter + signature-verified public route + tenant resolution + error handling + `WEBHOOK_TRANSITIONS` fix | Payments, `packages/http`                                          | XL                                                |
| A4c     | Rewire saga's real checkout path onto the PSP-calling lifecycle                                                     | `apps/runtime`, Payments                                           | M                                                 |
| A7a-i   | Expose `queue`/`send` on `WiredNotifications`' activities surface                                                   | Notifications                                                      | S                                                 |
| A7a-ii  | Auto-progression worker + missing event consumers (verified-real subset only)                                       | Notifications, `apps/runtime`                                      | L                                                 |
| A7b-i   | Fix Notifications' provider-selection branching; add `notifications?` override to `FulfillmentWiringDeps`           | Notifications, Fulfillment, Returns, Payments (composition wiring) | M                                                 |
| A7b-ii  | Real email provider adapter                                                                                         | Notifications                                                      | L                                                 |
| A7b-iii | Real SMS provider adapter                                                                                           | Notifications                                                      | L                                                 |
| A7b-iv  | Real push provider adapter                                                                                          | Notifications                                                      | L                                                 |
| A7b-v   | Real webhook (generic signed) provider adapter                                                                      | Notifications                                                      | L                                                 |
| A6c     | Returns event gains item-level data; Finance computes restock cost via its own COGS engine                          | Returns, Finance                                                   | M                                                 |
| A6d     | Legacy `orders.order.paid` consumer + net/tax-split decision                                                        | Finance, Orders (conditionally)                                    | M                                                 |

---

## 1. Per-Item Dependency Record

For each item: required predecessors (hard technical blocker — cannot function or is unsafe without it), optional predecessors (recommended ordering, not a hard block), parallelizable work (safe to develop and merge concurrently), blocking work (what downstream items this item gates), and the seven shared-resource categories.

### A6a — Opt-in atomic consumer idempotency

- **Required predecessors:** none (first item in the graph).
- **Optional predecessors:** none.
- **Parallelizable with:** A1 cluster, A9a/A9b, A8, A10, A4a (all independent of this item).
- **Blocks:** A5a–e (hard — reuses this item's tx-threading pattern), A6b-i (soft — should be built atomic from day one using this pattern, but not unsafe to defer).
- **Shared files:** `packages/kafka/src/consumer-runtime.ts`, `packages/messaging/src/consumer/event-consumer.ts`, `EventHandler` interface definition.
- **Shared aggregates:** none (platform/infra layer, not domain).
- **Shared ports:** `EventHandler` (touched by all 17 existing consumer registrations — none of their _code_ changes, only the interface gains an opt-in capability).
- **Shared repositories:** `ProcessedEventStore` (interface unaffected — `tx?` param already exists on `PrismaProcessedEventStore.recordIfNew`).
- **Shared event contracts:** none directly (delivery semantics change for all 17 topics, payload shapes untouched).
- **Shared DB tables:** `platform.inbox_processed_events` (read/write, shared by all consumers — but no schema change, existing `tx?` support is reused).
- **Shared workflows:** none.

### A5a/A5b/A5c/A5d/A5e — Postgres-backed idempotency stores (Payments/Fulfillment/Shipping/Returns/Notifications)

- **Required predecessors:** **A6a** (all five — must reuse its tx-threading pattern; shipping any of these before A6a lands introduces the new silent-data-loss failure mode identified in the execution matrix).
- **Optional predecessors:** none between the five sub-items themselves.
- **Parallelizable with:** each other (A5a↔A5b↔A5c↔A5d↔A5e — five independent contexts, five independent engineers can do these simultaneously), A1 cluster, A9a/A9b, A8, A10, A4a/A4b (composition-file contention noted below).
- **Blocks:** nothing downstream directly.
- **Shared files:** A5a shares `services/payments/src/composition.ts` with **A4a and A4b** (three items editing the same file — see §3 contention matrix). A5b shares `services/fulfillment/src/composition.ts` with **A7b-i** (adding the `notifications?` field). A5c is isolated (no other Phase A item touches `services/shipping/src/composition.ts`). A5d shares `services/returns/src/composition.ts` with **A9a** (wiring `ReturnsWiringDeps`' new override field) and **A7b-i**. A5e shares `services/notifications/src/composition.ts` with **A7a-i, A7a-ii, A7b-i, A7b-ii..v** (Notifications' composition file is the single most contended file in the whole graph — six items touch it).
- **Shared aggregates:** none (infra-layer stores, not domain aggregates).
- **Shared ports:** each store's own `Processed*Store` port — not shared across contexts (five distinct ports, mechanically similar, not the same interface).
- **Shared repositories:** none shared across the five (each is its own new Prisma-backed class).
- **Shared event contracts:** none.
- **Shared DB tables:** none shared across the five — each targets its own already-existing table (`ProcessedWebhook`, `ProcessedCarrierWebhook` ×2, `ReturnsProcessedCallback`, Notifications' provider-callback table).
- **Shared workflows:** none.

### A6b-i — Finance `onRefundIssued` consumer

- **Required predecessors:** none technically (can be built non-atomic and retrofitted).
- **Optional predecessors:** **A6a** (recommended — build atomic from day one rather than retrofit later).
- **Parallelizable with:** everything else except direct file overlap (none found).
- **Blocks:** nothing.
- **Shared files:** `services/finance/src/events/consumers.ts` (also touched conceptually by A6c/A6d, but those add _different_ consumer functions in the same file — low actual conflict, coordinate merge order to avoid one large diff).
- **Shared aggregates:** `Journal` (Finance's own aggregate — also touched by A6c, A6d; append-only, low conflict risk since each posts independently).
- **Shared ports:** none new.
- **Shared repositories:** `FinanceJournalRepository` (shared with A6c, A6d, and the already-existing `PostOrderPaidJournal` — all append-only writers, no update-path conflict).
- **Shared event contracts:** Finance's own translator fix to accept `refundRef` — internal to Finance's consumer, does not change Payments' published event.
- **Shared DB tables:** `FinanceJournal`/`FinanceJournalLine` (shared with A6c, A6d — append-only, safe to write concurrently from independently-deployed consumers).
- **Shared workflows:** none.

### A1-i — Fix id-correlation; add Order lookup method

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** everything outside the A1 cluster; within the cluster, must land before A1-ii.
- **Blocks:** **A1-ii** (hard — the lookup method is a direct input to the consumer fix).
- **Shared files:** `services/orders/src/domain/order-repository.ts` (interface), `prisma-order-repository.ts`, `in-memory-order-repository.ts`, existing test doubles (`payment-captured.consumer.test.ts`).
- **Shared aggregates:** `Order` (shared with A1-ii, A1-iii, A1-iv, A6d — see the aggregate-contention note in §3).
- **Shared ports:** `OrderRepository`.
- **Shared repositories:** `OrderRepository` (both implementations).
- **Shared event contracts:** none directly (read-path change only).
- **Shared DB tables:** `Order` (adds a queryable lookup path on the existing `checkoutRef` column — no schema migration, an index may be warranted for the new lookup's performance, evaluate at implementation time).
- **Shared workflows:** none.

### A1-ii — Consumer drives `AdvanceOrder(payment_received)` in shadow mode

- **Required predecessors:** **A1-i**.
- **Optional predecessors:** none.
- **Parallelizable with:** A3 (soft-coordinate on `checkoutSessionId` semantics — see below), A9a/A9b, A8, A10, A4 cluster, A6 cluster, A7 cluster.
- **Blocks:** **A1-vi** (hard — cutover cannot happen until this item's shadow period shows zero divergence, a calendar-time gate, not just a code-merge gate), **A2** (hard — the signal must fire from this consumer once it reliably reaches the transition point).
- **Shared files:** `services/orders/src/interfaces/payment-captured.consumer.ts`, `services/orders/src/application/order-lifecycle.use-cases.ts` (`AdvanceOrder` — **shared with A1-iii**, both editing the same use case, coordinate merge order or land A1-ii first since A1-iii's restriction should apply to the already-corrected transition logic).
- **Shared aggregates:** `Order`.
- **Shared ports:** none new.
- **Shared repositories:** `OrderRepository` (read via A1-i's new method).
- **Shared event contracts:** `payments.payment_intent.captured` (consumed), `orders.order.payment_received` (produced — **this is the critical shared contract**: during the shadow period, this event has two live producers, the saga's existing direct call and this new consumer-driven path, both targeting the same downstream consumers in Finance and Fulfillment — the shadow design must ensure only one of the two actually _emits_ during the soak period, with the other only _logging_ its would-be outcome, or Finance/Fulfillment will double-process).
- **Shared DB tables:** `Order`, `OrderEvent`.
- **Shared workflows:** `purchase-saga.ts`'s `placeOrder` step, indirectly (the saga's own success signal must stay coupled to this consumer's real outcome — see execution matrix A1 finding on saga/order decoupling).

### A1-iii — Restrict `/orders/:orderId/transitions`

- **Required predecessors:** none technically, but **strongly recommended to land after A1-ii** (restricting the route before the consumer-driven replacement path is proven removes a currently-working caller-supplied fallback with nothing yet verified to replace it for edge cases the shadow period hasn't covered).
- **Optional predecessors:** A1-ii.
- **Parallelizable with:** most of the graph; direct file overlap only with A1-ii (see above).
- **Blocks:** nothing downstream.
- **Shared files:** `apps/admin/src/http/admin-routes.ts` (or wherever the route lives), `order-lifecycle.use-cases.ts` (shared with A1-ii).
- **Shared aggregates:** `Order`.
- **Shared ports:** none new.
- **Shared repositories:** none new.
- **Shared event contracts:** `orders.order.payment_received` (this route is the second producer path the execution matrix identified — restricting it closes the second caller-asserted-truth hole).
- **Shared DB tables:** none new.
- **Shared workflows:** none.

### A1-iv — Gate/remove dead-code admin `markOrderPaid`

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** everything (fully independent — confirmed dead code, zero live callers).
- **Blocks:** nothing.
- **Shared files:** `apps/admin/src/interfaces/orders.admin-controller.ts`, `services/orders/src/application/mark-order-paid.use-case.ts`.
- **Shared aggregates:** `Order` (but via `MarkOrderPaid`, a different method (`markPaid()`) than A1-ii/A1-iii touch (`transition()`) — low real conflict).
- **Shared ports/repositories/events/tables/workflows:** none shared with other Phase A items.

### A1-v — Tighten `pspToken` check

- **Required predecessors:** none.
- **Optional predecessors:** none, though pairs naturally with **A4b** (both harden the same synchronous-capture path — sequencing them close together avoids two separate reviews of the same code path, but neither blocks the other).
- **Parallelizable with:** everything.
- **Blocks:** nothing.
- **Shared files:** `apps/runtime/src/purchase/purchase-saga-routes.ts`, `services/payments/src/application/capture-payment.use-case.ts` — **`purchase-saga-routes.ts` is also touched by A2** (different sections, low conflict).
- **Shared aggregates:** `PaymentIntent` (light touch — input validation only, no transition-table change).
- **Shared ports/repositories:** none new.
- **Shared event contracts:** none.
- **Shared DB tables:** none.
- **Shared workflows:** none directly, though this is the fallback path A2/A4c are working to make less load-bearing over time.

### A1-vi — Cutover: remove saga's direct call

- **Required predecessors:** **A1-ii, verified** (zero divergence across a real traffic sample during the shadow period — this is the single hardest gate in the entire graph, bound by calendar time, not developer effort).
- **Optional predecessors:** A1-iii, A1-iv, A1-v (clean to have landed first, not required).
- **Parallelizable with:** A9a/A9b, A8, A10, most of A4/A6/A7 clusters.
- **Blocks:** **A3's final merge** (recommended, not hard — see A3's record), **A4c** (recommended — avoid two concurrent rewrites of `purchase-saga-activities.ts`'s payment-related sections).
- **Shared files:** `apps/runtime/src/purchase-saga-activities.ts` — **the most contended file in the entire graph**, also edited by A1-v (adjacent), A3 (dedup keys), A4c (PSP-lifecycle rewiring). All four should be sequenced or carefully coordinated at the file level, not necessarily strictly ordered, but never merged blind to each other's diffs.
- **Shared aggregates:** `Order` (indirectly, by removing a call site).
- **Shared ports/repositories:** none new.
- **Shared event contracts:** `orders.order.payment_received` (single producer restored, ending the dual-producer shadow period).
- **Shared DB tables:** none new.
- **Shared workflows:** `purchase-saga.ts`.

### A2 — Wire Temporal signal

- **Required predecessors:** **A1-ii verified** (the signal must fire from a consumer that reliably reaches the transition point — starving this dependency makes A2's own code correct but functionally inert).
- **Optional predecessors:** A1-vi (cleaner to have the single-producer state established first, to avoid ambiguity about which of two `payment_received` producers is "the" signal source during the transition — not a hard requirement since the signal call and the event-production call are logically separable).
- **Parallelizable with:** A3 (different files — `packages/temporal/src/runtime.ts` and `apps/runtime/src/composition.ts` vs. `apps/runtime/src/purchase-saga-activities.ts`'s dedup logic), A9/A8/A10, A6/A7 clusters.
- **Blocks:** nothing downstream (A4c does not require A2 — the synchronous fallback path A4c touches is architecturally separate from the durable Temporal path A2 completes).
- **Shared files:** `packages/temporal/src/runtime.ts`, `apps/runtime/src/composition.ts` (**heavily shared** — also touched by A5a-e's composition wiring in other contexts, A6b-i, A7a-ii, A7b-i, and generally every item that registers a new consumer or worker module; see §3 for the full contention list on this file).
- **Shared aggregates:** none directly (signal-level, not aggregate-level).
- **Shared ports:** none new.
- **Shared repositories:** none new.
- **Shared event contracts:** `paymentCapturedSignal` (Temporal signal, not a Kafka event — distinct contract type, worth noting explicitly since it's easy to conflate with the Kafka event of the same conceptual meaning).
- **Shared DB tables:** none (Temporal's own event history is outside `packages/db`).
- **Shared workflows:** `purchase.workflow.ts` — **shared with A3** (both touch the workflow's activity-retry/timeout configuration and its awaited-signal state; A3 doesn't change the signal itself, but changes what the activities the workflow calls actually do — low direct conflict, same file family).

### A3 — Saga activity idempotency

- **Required predecessors:** none technically (the dedup-key mechanism can be built independently), but **the specific value used as the dedup key (`checkoutSessionId`) must have the same canonical meaning A1's consumer resolves against** — this is a design-agreement dependency, not a code dependency: land the _decision_ about what `checkoutSessionId` means for correlation before finalizing A3's key derivation, even if the code itself merges in either order.
- **Optional predecessors:** A1-i (establishes the canonical correlation semantics this item should match).
- **Parallelizable with:** A2 (different files, see above), A9/A8/A10, A6/A7 clusters. Development can proceed fully in parallel with the A1 cluster; only the _design decision_ on key semantics needs early agreement.
- **Blocks:** nothing downstream directly, though **A4c should not merge until A3 has landed and stabilized** (both touch `purchase-saga-activities.ts`'s core activity logic — sequencing avoids two large concurrent rewrites of the same hot file).
- **Shared files:** `apps/runtime/src/purchase-saga-activities.ts` (contended, see A1-vi's record), `services/inventory/src/application/reserve-stock.use-case.ts` + `commit-reservation.use-case.ts` + `release-reservation.use-case.ts`, `services/payments/src/application/create-payment-intent.use-case.ts`, `services/checkout/src/domain/checkout-session.ts`.
- **Shared aggregates:** `Reservation`/`InventoryItem` (Inventory), `PaymentIntent` (Payments — **shared with A4a/A4b's PSP work, but different concern: A3 adds a dedup key to intent _creation_, A4 changes what happens once an intent is _captured_ — low direct conflict, same aggregate family**), `CheckoutSession`.
- **Shared ports:** none new.
- **Shared repositories:** `InventoryItemRepository`, `PaymentIntentRepository` (new lookup methods needed on both, mirroring A1-i's `findByCheckoutRef` pattern).
- **Shared event contracts:** none.
- **Shared DB tables:** `Reservation` (new unique constraint — **migration**), `PaymentIntent` (new unique constraint — **migration**, coordinate with A4b if A4b also touches `PaymentIntent`'s schema, confirm no overlapping migration on the same table in the same release).
- **Shared workflows:** `purchase.workflow.ts`, `purchase-saga.ts` (shared with A2, see above).

### A9a — Build `RealInventoryRestockPort`

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** the entire rest of the graph — this cluster has no dependency on payment-truth, PSP, or notifications work.
- **Blocks:** **A9b** (hard — A9b's retry logic is meaningless against a stub, per the execution matrix's explicit finding).
- **Shared files:** `apps/admin/src/infrastructure/cross-context-ports.ts` (**shared with A8** — both add a new `Real*Port` class to this file; different classes, low actual conflict, but coordinate to avoid a large simultaneous diff), `services/returns/src/composition.ts` (**shared with A5d, A7b-i**), `services/returns/src/application/ports.ts` (`InventoryPort.requestRestock` signature change).
- **Shared aggregates:** `InventoryItem` (whichever use case ends up backing the port — `AdjustInventory` recommended per the execution matrix's idempotency analysis).
- **Shared ports:** `InventoryPort` (Returns' side), whichever Inventory use case backs it.
- **Shared repositories:** `InventoryItemRepository` if a new idempotency-key-aware lookup is added.
- **Shared event contracts:** none.
- **Shared DB tables:** none, unless `ReceiveStock` itself gains an idempotency key (design decision noted in the execution matrix — recommend backing via `AdjustInventory` instead, which needs no schema change, to avoid this).
- **Shared workflows:** none.

### A9b — `AcceptItems` restock compensation

- **Required predecessors:** **A9a**.
- **Optional predecessors:** none.
- **Parallelizable with:** everything outside its own cluster.
- **Blocks:** nothing.
- **Shared files:** `services/returns/src/application/return-lifecycle.use-cases.ts` (**shared with A6c** — both touch Returns' return-lifecycle application layer, though A6c's event-payload change is in a different file, `return-transitioned.event.ts` — low conflict, same bounded context).
- **Shared aggregates:** `ReturnRequest`.
- **Shared ports:** `InventoryPort` (consumes A9a's new adapter).
- **Shared repositories:** none new.
- **Shared event contracts:** none directly (internal retry/compensation logic).
- **Shared DB tables:** possibly a new durable-retry/outbox entry, reusing Returns' existing `OutboxWriter`/`OutboxRelay` plumbing (no new table required per the execution matrix).
- **Shared workflows:** none.

### A8 — Fulfillment→Shipping idempotency key + migration

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** the entire rest of the graph.
- **Blocks:** nothing downstream.
- **Shared files:** `services/shipping/src/application/create-shipment.use-case.ts`, `apps/admin/src/infrastructure/cross-context-ports.ts` (**shared with A9a**, different port class), `apps/admin/src/http/shipping-routes.ts`.
- **Shared aggregates:** `Shipment`.
- **Shared ports:** `ShippingProviderPort` (Fulfillment's side, consumer of the fix).
- **Shared repositories:** `ShipmentRepository`.
- **Shared event contracts:** none (no shape change).
- **Shared DB tables:** `Shipment` (**migration** — new unique constraint on `(tenantId, fulfillmentRef, idempotencyKey)` or equivalent).
- **Shared workflows:** none (confirmed the saga does not call `CreateShipment` directly).

### A10 — Catalog variant-edit fix

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** literally everything — zero shared files, aggregates, ports, repositories, event contracts, tables, or workflows with any other Phase A item. The single most isolated item in the entire graph.
- **Blocks:** nothing.
- **Shared resources:** none.

### A4a — Fail-loud interim PSP guard

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** most of the graph.
- **Blocks:** **A4b** (soft — recommended as a safety net during A4b's rollout, not a hard code dependency; A4b can technically ship without A4a but loses the fail-loud protection during its own rollout window).
- **Shared files:** `services/payments/src/composition.ts` (**shared with A5a and A4b** — three items touching the same file; recommend landing A4a first since it's the smallest, then A5a, then A4b, to keep each diff reviewable — see §3).
- **Shared aggregates:** none (composition-root guard, not domain logic).
- **Shared ports/repositories/events/tables/workflows:** none.

### A4b — Real PSP adapter

- **Required predecessors:** none hard, but **A4a strongly recommended first** (see above).
- **Optional predecessors:** A5a (cleaner if Payments' idempotency store is already Postgres-backed before the real adapter starts receiving real webhook traffic, though not a hard requirement — the in-memory store's known gap is orthogonal to whether the PSP itself is real).
- **Parallelizable with:** A1 cluster, A9/A8/A10, A6 cluster, A7 cluster (all independent).
- **Blocks:** **A4c** (hard — cannot rewire the saga onto a PSP-calling lifecycle that doesn't exist yet).
- **Shared files:** `services/payments/src/composition.ts` (shared with A4a, A5a — see above), new PSP adapter package (isolated), a new public webhook route (isolated, new file), `services/payments/src/application/record-webhook.use-case.ts`, `services/payments/src/application/payment-lifecycle.use-cases.ts`, `packages/http/src/tenant-resolution.ts` (**new resolver strategy — check this doesn't conflict with any other item touching tenant resolution; none found in this Phase A scope**).
- **Shared aggregates:** `PaymentIntent` (via `payment-lifecycle.use-cases.ts` — **shared with A3's dedup-key work and A1-v's token-check tightening**, all touching Payments' intent-handling code; different methods within the same aggregate family, coordinate merge order rather than treating as a hard block).
- **Shared ports:** `PaymentProvider`.
- **Shared repositories:** `PaymentIntentRepository`.
- **Shared event contracts:** none in shape; reliability semantics change (first time this path can fail).
- **Shared DB tables:** none new for A4b itself (webhook idempotency table is A5a's concern).
- **Shared workflows:** none directly (the saga's _current_ capture path is untouched by A4b — that's exactly A4c's job).

### A4c — Rewire saga onto PSP-calling lifecycle

- **Required predecessors:** **A4b** (hard — needs the real adapter to exist), **recommended after A1-vi and A3 have landed and stabilized** (both touch the same file, `purchase-saga-activities.ts`, and this item is the most invasive of the four concurrent editors of that file).
- **Optional predecessors:** A1-vi, A3.
- **Parallelizable with:** A9/A8/A10, A6/A7 clusters.
- **Blocks:** nothing downstream in this Phase A scope.
- **Shared files:** `apps/runtime/src/purchase-saga-activities.ts` (see the file-contention note under A1-vi — this is the fourth and most structurally invasive editor of this file).
- **Shared aggregates:** `PaymentIntent`.
- **Shared ports:** `PaymentProvider` (now actually invoked from the saga for the first time).
- **Shared repositories:** none new.
- **Shared event contracts:** none new (uses the existing capture event path, now genuinely PSP-verified).
- **Shared DB tables:** none new.
- **Shared workflows:** `purchase-saga.ts` (the capture step's actual behavior changes — must be re-verified against the deterministic core's compensation table).

### A7a-i — Expose `queue`/`send` on `WiredNotifications`

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** most of the graph.
- **Blocks:** **A7a-ii** (hard — the worker cannot be built against a composition surface that doesn't expose these methods yet).
- **Shared files:** `services/notifications/src/composition.ts` (contended — see A5e's record).
- **Shared aggregates:** `Notification`.
- **Shared ports/repositories:** none new.
- **Shared event contracts:** none.
- **Shared DB tables:** none.
- **Shared workflows:** none.

### A7a-ii — Auto-progression worker + missing consumers

- **Required predecessors:** **A7a-i**.
- **Optional predecessors:** **A6a** (recommended — new consumers should be built atomic from day one, same rationale as A6b-i).
- **Parallelizable with:** A1/A2/A3, A9/A8/A10, A4 cluster, A6 cluster.
- **Blocks:** nothing downstream in this Phase A scope.
- **Shared files:** `apps/runtime/src/composition.ts` (contended, see A2's record), new worker module and new consumer classes (isolated, new files) in `apps/runtime/src/notifications/`.
- **Shared aggregates:** `Notification`.
- **Shared ports:** none new.
- **Shared repositories:** `NotificationRepository`.
- **Shared event contracts:** consumes several already-real event types (order fulfilled/shipped, tracking, return-lifecycle) — no new producer-side contracts, purely additive consumers. **Two catalog-documented event types (`inventory.stock.low`, `identity.user.invited`) are explicitly excluded from this item's scope since no producer exists.**
- **Shared DB tables:** shares `platform.inbox_processed_events` if built atomic via A6a.
- **Shared workflows:** touches the purchase saga's `sendConfirmation` call site (in scope per the execution matrix — the saga's own notifications get the same auto-progression fix).

### A7b-i — Fix Notifications' provider-selection branching; add `notifications?` override to Fulfillment

- **Required predecessors:** none.
- **Optional predecessors:** none.
- **Parallelizable with:** most of the graph.
- **Blocks:** **A7b-ii through A7b-v** (hard — the composition branching must exist before real channel adapters can be selected in production).
- **Shared files:** `services/notifications/src/composition.ts` (contended — see A5e), `services/fulfillment/src/composition.ts` (**shared with A5b**), `services/returns/src/composition.ts` (**shared with A5d, A9a**), `services/payments/src/composition.ts` (**shared with A4a, A4b, A5a — the single most contended file across the whole graph now has four editors**).
- **Shared aggregates:** none (composition-layer only).
- **Shared ports:** `NotificationPort` (three new `Real*NotificationPort` wiring points, reusing Orders' already-correct pattern).
- **Shared repositories:** none new.
- **Shared event contracts:** none.
- **Shared DB tables:** none.
- **Shared workflows:** the saga's `sendConfirmation` call (indirectly — starts producing real external side effects once channels are live).

### A7b-ii / A7b-iii / A7b-iv / A7b-v — Real email/SMS/push/webhook adapters

- **Required predecessors:** **A7b-i** (all four).
- **Optional predecessors:** none between the four channels themselves.
- **Parallelizable with:** each other (four independent engineers can build four channels simultaneously), and with the entire rest of the graph.
- **Blocks:** nothing downstream in this Phase A scope, though full "production readiness" per the remediation plan's own readiness bar implicitly wants at least email live.
- **Shared files:** `services/notifications/src/composition.ts` (all four land a wiring change here — coordinate merge order among the four, not a hard sequential block, but avoid four simultaneous large diffs to the same file).
- **Shared aggregates:** none.
- **Shared ports:** each channel's own provider port (four distinct interfaces, not shared with each other).
- **Shared repositories/events/tables:** none.
- **Shared workflows:** the saga's `sendConfirmation` (same note as A7b-i).

### A6c — Returns event item-level data + Finance COGS-based cost computation

- **Required predecessors:** none hard (Finance's `HistoricalCostResolver`/`CogsCalculator` already exist and are independent of this Phase A scope).
- **Optional predecessors:** **A6b-i** (establishes the Finance-side consumer-wrapper pattern this item follows).
- **Parallelizable with:** the entire rest of the graph.
- **Blocks:** nothing.
- **Shared files:** `services/returns/src/domain/events/return-transitioned.event.ts`, `services/finance/src/events/consumers.ts` (shared with A6b-i, A6d — see A6b-i's record).
- **Shared aggregates:** `ReturnRequest` (Returns), `Journal` (Finance, shared with A6b-i/A6d).
- **Shared ports:** none new.
- **Shared repositories:** `FinanceJournalRepository` (shared, append-only, low conflict).
- **Shared event contracts:** `returns.items.accepted` (payload gains new fields — additive, no other consumer exists today so no versioning conflict).
- **Shared DB tables:** `FinanceJournal`/`FinanceJournalLine` (shared, append-only).
- **Shared workflows:** none.

### A6d — Legacy `orders.order.paid` consumer

- **Required predecessors:** none hard.
- **Optional predecessors:** **A6b-i** (same pattern-establishment rationale as A6c). **A1 cluster** (soft — if the net/tax-split decision results in adding fields to `Order.markPaid()`'s event, coordinate with A1's Order-aggregate changes to avoid two concurrent modifications to `order.ts`'s event-emission logic, though A1 touches `transition()` and this would touch `markPaid()`, different methods, low actual conflict).
- **Parallelizable with:** the entire rest of the graph.
- **Blocks:** nothing.
- **Shared files:** `services/finance/src/events/consumers.ts` (shared with A6b-i, A6c), possibly `services/orders/src/domain/order.ts`/`order-paid.event.ts` if the payload gains fields (shared, lightly, with A1-i/A1-iv which also touch Orders' domain layer but different methods).
- **Shared aggregates:** `Journal` (Finance), `Order` (Orders, only if the payload-gap decision requires a field addition).
- **Shared ports:** none new.
- **Shared repositories:** `FinanceJournalRepository` (shared, append-only).
- **Shared event contracts:** `orders.order.paid` (payload may gain net/tax-split fields, pending the stakeholder decision the execution matrix flagged as required before implementation).
- **Shared DB tables:** `FinanceJournal`/`FinanceJournalLine` (shared, append-only).
- **Shared workflows:** none.

---

## 2. Dependency Graph (text form)

```
A6a ──┬──→ A5a ──┐
      ├──→ A5b ──┤
      ├──→ A5c ──┼── (independent, parallel; each also touches a
      ├──→ A5d ──┤    contended composition.ts — see §3)
      ├──→ A5e ──┘
      └··→ A6b-i (optional predecessor only)
                        │
                        ├··→ A6c (optional predecessor)
                        └··→ A6d (optional predecessor)

A1-i ──→ A1-ii ──→ A1-vi (requires shadow-verified A1-ii; calendar-time gate)
           │           │
           ├──→ A2 (requires A1-ii verified)
           │           │
           └··→ A3 (design-only soft dependency on A1-i's key semantics)
                       │
A1-i ··→ A1-iii (recommended after A1-ii)
A1-iv, A1-v — fully independent within the cluster

A9a ──→ A9b

A8 — independent
A10 — fully independent of everything

A4a ··→ A4b ──→ A4c (requires A4b; recommended after A1-vi + A3 land)

A7a-i ──→ A7a-ii
A7b-i ──→ { A7b-ii, A7b-iii, A7b-iv, A7b-v }  (four parallel children)
```

No cycles exist in this graph. Every hard (`──→`) edge is a required predecessor; every soft (`··→`) edge is optional/recommended only.

---

## 3. Shared-Resource Contention Matrix

Files, tables, and aggregates touched by **three or more** Phase A items — these are the real coordination risk points, independent of the formal dependency edges above (two items can be fully independent in the dependency graph and still require careful merge coordination if they edit the same file).

| Resource                                                         | Items touching it                                                       | Coordination note                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/runtime/src/purchase-saga-activities.ts`                   | A1-ii, A1-v, A1-vi, A3, A4c                                             | **Highest-contention file in the graph.** Recommended internal land order: A1-ii → A1-v → A1-vi → A3 → A4c, even though only A1-i→A1-ii→A1-vi and A4b→A4c are hard dependency edges — the rest is pure merge-conflict avoidance on a single hot file.                                          |
| `apps/runtime/src/composition.ts`                                | A2, A5a-e (each context's registration), A6b-i, A7a-ii, A7b-i           | Large file, many independent registration blocks — low semantic conflict, but every item lands a diff here; recommend a single "composition owner" reviews all diffs to this file in a release window rather than five separate reviewers missing each other's changes.                        |
| `services/payments/src/composition.ts`                           | A4a, A4b, A5a, A7b-i                                                    | Second-highest-contention file. Recommended order: A4a (smallest) → A5a → A4b → A7b-i, matching the dependency graph's own A4a→A4b edge.                                                                                                                                                       |
| `services/notifications/src/composition.ts`                      | A5e, A7a-i, A7a-ii, A7b-i, A7b-ii, A7b-iii, A7b-iv, A7b-v               | Highest-contention file by item count (8). Dependency edges already force A7a-i→A7a-ii and A7b-i→{A7b-ii..v}; A5e is independent of the A7 items but touches the same file — land A5e first (smallest, no dependents) to keep the file's diff history clean before the larger A7 changes land. |
| `services/returns/src/composition.ts`                            | A5d, A9a, A7b-i                                                         | Land A5d first (independent, smallest), then A9a (adds the `inventory?` override field), then A7b-i (adds the `notifications?` override field) — each adds one new field, low conflict if sequenced.                                                                                           |
| `services/fulfillment/src/composition.ts`                        | A5b, A7b-i                                                              | Land A5b first (independent), then A7b-i (adds `notifications?` override).                                                                                                                                                                                                                     |
| `apps/admin/src/infrastructure/cross-context-ports.ts`           | A9a, A8                                                                 | Different port classes added to the same file — low semantic conflict, coordinate to avoid simultaneous large diffs.                                                                                                                                                                           |
| `Order` aggregate / `services/orders/src/domain/order.ts` family | A1-i, A1-ii, A1-iii, A1-iv, (A6d conditionally)                         | All touch `Order` but through different methods (`AdvanceOrder`/`transition()` vs. `markPaid()`) — genuine dependency only within A1-i→A1-ii→A1-iii; A1-iv and conditional A6d are low-conflict siblings.                                                                                      |
| `services/finance/src/events/consumers.ts`                       | A6b-i, A6c, A6d                                                         | Each adds/wires a different translator function in the same file — low conflict, sequence to avoid three simultaneous large diffs (recommend A6b-i first, it's the pattern-setter).                                                                                                            |
| `FinanceJournal`/`FinanceJournalLine` tables                     | A6b-i, A6c, A6d                                                         | Append-only writes from three independently-deployed consumers — no locking/ordering conflict at the data layer; the only coordination need is the file-level one above.                                                                                                                       |
| `platform.inbox_processed_events` table                          | A6a (mechanism), all opted-in consumers (A6b-i, A7a-ii if built atomic) | No conflict — this table is designed for concurrent multi-consumer use via its `(consumerGroup, messageId)` key.                                                                                                                                                                               |

---

## 4. Critical Path

Three independent chains dominate the graph; the overall program's critical path is the **longest of the three**, not a single linear sequence, since none of the three chains depends on either of the others to _start_ (though A4c and A3 both recommend landing after A1-vi for file-contention reasons, not because they're logically blocked).

**Chain 1 — Payment-truth (calendar-bound, not effort-bound):**
`A1-i (S) → A1-ii (M) → [shadow soak, real-traffic-duration, not a dev-effort cost] → A1-vi (S) → A2 (M)`
This chain's true bottleneck is not code — it's the shadow-verification soak period between A1-ii landing and A1-vi cutting over, which must run long enough to observe a representative sample of real purchase traffic (recommend defining this as a fixed calendar window — e.g. two full weeks including a weekend — rather than a fixed number of transactions, so low-traffic periods don't produce false confidence).

**Chain 2 — External PSP adapter (effort-bound, largest single item):**
`A4a (S) → A4b (XL) → A4c (M)`
A4b alone is rated XL and is, along with the notification channel adapters, one of the two largest single line items across the entire Phase A plan (matching the original remediation plan's own conclusion). This chain has no calendar-time gate — it's purely bound by engineering effort and external-integration lead time (PSP sandbox access, credential provisioning, compliance review if applicable — not modeled here, flag for the implementation team).

**Chain 3 — Notification channels (effort-bound, parallelizable internally):**
`A7a-i (S) → A7a-ii (L)` and, independently, `A7b-i (M) → {A7b-ii, A7b-iii, A7b-iv, A7b-v} (L each, parallel)`
If all four channels are staffed by different engineers simultaneously, this chain's duration is `A7b-i (M) + max(A7b-ii..v) (L)` — one channel's worth of L-effort, not four. If only one engineer/team owns Notifications, it's `A7b-i (M) + sum(A7b-ii..v) (4×L)` — the longest possible chain in the entire graph. **This is the single biggest lever available for shortening the overall Phase A timeline**: staffing the four channel adapters in parallel converts this from the longest chain to a comparable-length chain to A4b's.

**Overall critical path:** with adequate parallel staffing on the notification channels, **Chain 2 (A4a→A4b→A4c) and Chain 3 (A7b-i→one channel) are comparably long and jointly determine the earliest possible Phase A completion date** — not Chain 1, which is shorter in raw effort despite being the highest-risk chain architecturally. Chain 1's calendar-bound soak period should be scheduled to run _concurrently_ with Chain 2/3's development work, not sequentially before it, since nothing in Chain 2/3 depends on Chain 1 completing.

**Everything else in the graph (A9a→A9b, A8, A10, the A6 Finance cluster) is off the critical path** — all are shorter, fully parallelizable against the three chains above, and should be scheduled opportunistically by whatever engineering capacity isn't committed to Chains 1–3.

---

## 5. Per-Sprint Rollout-Mechanism Classification

| Item      | Parallel-safe?                    | Cannot merge before                    | Feature flag                                                                                                                                                      | Dark launch                                                                                                                                                                                                        | Dual-write                                                                                                                                                                                                                                                 | Data migration                                                                                                                                           | Replay                                                                                                                                                                                                | Backfill                                                                                                                                                                                                                                                        |
| --------- | --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A6a       | Yes                               | —                                      | No (opt-in by construction, no flag needed)                                                                                                                       | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A5a–e     | Yes (among selves)                | A6a                                    | Recommended (per-context toggle, safety net during first production exposure)                                                                                     | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No (tables pre-exist)                                                                                                                                    | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A6b-i     | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No — historical unposted refunds are a business decision (post retroactively or start clean), not an automatic backfill                                                                                                                                         |
| A1-i      | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No (index-only, if any)                                                                                                                                  | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A1-ii     | Yes (dev); no (merge before A1-i) | A1-i                                   | **Yes — required.** This item's entire design is flag-gated shadow mode.                                                                                          | **Yes — required.** This _is_ the dark launch: the new path runs and logs its outcome without being the system of record until A1-vi.                                                                              | **Yes — required**, in the specific sense that both the saga's existing direct call and the new consumer-driven path compute an outcome during the soak period, with only one actually emitting the downstream event (see §1's shared-event-contract note) | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A1-iii    | Yes                               | recommended after A1-ii                | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A1-iv     | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A1-v      | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A1-vi     | No                                | A1-ii verified (shadow soak complete)  | **Yes** — cutover flag, instant-revert capability to the old direct-call path if post-cutover monitoring shows divergence                                         | No (this is the cutover itself, not a dark launch)                                                                                                                                                                 | No (ends the dual-write period)                                                                                                                                                                                                                            | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A2        | Yes                               | A1-ii verified                         | Recommended (toggle to disable signal-sending independent of the rest of the saga)                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A3        | Yes                               | — (soft-coordinate key semantics only) | Recommended (per-activity toggle for the new dedup-key logic, allowing instant rollback of just the idempotency change without touching the rest of the saga)     | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | **Yes** — new unique constraints on `Reservation` and `PaymentIntent`                                                                                    | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A9a       | Yes                               | —                                      | Recommended (safety net — swap back to the stub instantly if the real adapter misbehaves)                                                                         | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | Only if `ReceiveStock` gains an idempotency key (avoid by backing via `AdjustInventory` instead, per the execution matrix's recommendation)              | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A9b       | No                                | A9a                                    | No (depends on A9a's flag if any)                                                                                                                                 | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A8        | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | **Yes** — new unique constraint on `Shipment`                                                                                                            | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A10       | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | Optional — a one-time data-audit query to check whether any production variant edits have already silently failed under the old bug, and if so, whether those specific rows need a manual correction pass (not an automated backfill, a targeted investigation) |
| A4a       | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A4b       | Yes (dev); recommend after A4a    | A4a (soft)                             | **Yes — required.** Composition-level provider swap must be instantly revertible given the financial-transaction-critical nature of this item.                    | **Yes — recommended.** Route real traffic through the new adapter for a limited tenant/traffic slice before full cutover, if the PSP integration supports sandbox/test-mode traffic shadowing.                     | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A4c       | No                                | A4b; recommended after A1-vi, A3       | **Yes — required**, same rationale as A4b — this is the item that makes the saga's real money-movement path depend on a live external service for the first time. | **Yes — recommended**, same shadow-comparison logic as A1-ii is applicable here (compare the new PSP-verified capture outcome against what the trusted-token path would have produced, before fully cutting over). | Possible, mirroring A1-ii's pattern, if a comparably cautious rollout is desired given this is also a financial-truth path.                                                                                                                                | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A7a-i     | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A7a-ii    | Yes                               | A7a-i                                  | Recommended (worker on/off toggle, independent of manual admin queue/send)                                                                                        | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A7b-i     | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A7b-ii..v | Yes (among selves)                | A7b-i                                  | Recommended (per-channel toggle — critical, since these are four independent external integrations each capable of failing independently)                         | **Yes — recommended per channel**, sandbox/test-mode traffic before full cutover, same rationale as A4b.                                                                                                           | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | No                                                                                                                                                                                                    | No                                                                                                                                                                                                                                                              |
| A6c       | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | No                                                                                                                                                       | Possible — if historical accepted-returns should be retroactively journaled, a one-time replay of past `returns.items.accepted` events through the new consumer is a business decision, not a default | No                                                                                                                                                                                                                                                              |
| A6d       | Yes                               | —                                      | No                                                                                                                                                                | No                                                                                                                                                                                                                 | No                                                                                                                                                                                                                                                         | Possible, only if the net/tax-split decision adds fields to `Order.markPaid()`'s event (additive schema change on the event payload, not a DB migration) | Possible — same historical-backfill decision as A6c, for legacy-path paid orders that predate this fix                                                                                                | No                                                                                                                                                                                                                                                              |

---

## 6. Internal Consistency Check

- **No cycles found** in the dependency graph (§2).
- **Every hard predecessor edge has a corresponding entry in both directions** (e.g. A1-i lists A1-ii as "blocks"; A1-ii lists A1-i as "required predecessor") — cross-checked across all 30 items.
- **Every shared-resource conflict flagged in §1's per-item records is also captured in §3's contention matrix** — no orphaned conflicts.
- **The critical path in §4 is consistent with the per-item required-predecessor chains in §1** — no chain in §4 skips a hard dependency edge established in §1.
- **Every "requires feature flag / dark launch / dual-write" classification in §5 traces back to a specific finding in `ARCHITECTURE_EXECUTION_MATRIX.md`'s corrected scope** (A1-ii/A1-vi's shadow requirement, A4b/A4c's financial-critical-path requirement, A3/A8's new-migration requirement) — none are introduced here without a documented reason upstream.

This graph is internally consistent. `PRODUCTION_CUTOVER_PLAN.md` may proceed on this basis.
