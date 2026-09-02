# ADR-0012: Purchase saga & payment-provider architecture

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** Staff architecture (Sprint 2.8 Phase A; closes gap G-11)
- **Affected documents:** 05, 20, 22, 26; ADR-0003/0005/0013

## Context

The purchase flow spans five contexts with money and stock at stake. The rules already frozen:
payment truth is event-derived, never caller-asserted (doc 22); every context write is
tx+outbox atomic (ADR-0003); consumers are idempotent (ADR-0005); reservations become a ledger
(ADR-0013). What was missing: the orchestration boundaries, compensation semantics, and the PSP
seam.

## Decision

### 1. Orchestration: Temporal workflow per checkout session

`PurchaseWorkflow` (workflow id = `purchase:<tenantId>:<checkoutSessionId>` — natural
idempotency: duplicate starts are rejected by Temporal). Steps, each an **activity** calling a
context's application layer (gRPC/in-process — never repositories):

`price quote (Pricing) → reserve stock (Inventory, TTL per ADR-0013) → create payment intent
(Payments) → await capture confirmation → place order (Orders) → commit reservation (Inventory)
→ complete checkout (Checkout) → confirmation (Notifications seam)`.

**Capture confirmation is NOT an activity result**: the PSP confirms via webhook →
`payments.payment_intent.captured` (outbox) → a consumer **signals** the workflow
(`paymentCaptured` / `paymentFailed` signals). The workflow waits on signal-or-timeout. This
keeps the doc-22 rule intact inside the saga: even the orchestrator learns about money from the
event, not from a return value.

### 2. Determinism contract

Workflows contain ONLY orchestration: no clock (`workflow.now()` via injected deterministic
time), no id generation (ids minted by activities/starter and passed in), no I/O, no random.
All effects in activities; every activity independently retryable and idempotent (keyed by
`workflowId + step`, riding the contexts' own idempotency). Versioning via Temporal `patched()`;
long-lived workflows use ContinueAsNew after signal-count thresholds (purchase saga is short —
CAN is the escape hatch, not the norm).

### 3. Compensation (strict reverse order, each compensation itself retryable + idempotent)

| Failure                                                   | Compensation                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reservation unavailable/timeout                           | fail checkout (nothing to unwind)                                                                                                                |
| Payment intent creation fails / PSP unavailable           | release reservation → fail checkout                                                                                                              |
| Capture failed / cancelled / signal timeout (default 15m) | cancel intent (no-op if never captured) → release reservation → fail checkout                                                                    |
| Order placement fails after capture                       | **refund payment** → release reservation → fail checkout → operator alert (money moved — always audited)                                         |
| Reservation commit fails after order placed               | retry forever with backoff (order + payment are truth; commit is convergent) — never auto-unwind a paid order; DLQ + operator page on exhaustion |
| Duplicate/replayed events                                 | consumer inbox (ADR-0005) + signals are idempotent (signal dedup by messageId in workflow state)                                                 |

Retry policies: activities use bounded exponential backoff (initial 1s, ×2, max 1m, max 5
attempts) except the post-payment convergent steps (unbounded, capped 5m interval). Timeouts:
`startToClose` per activity (10s default; PSP calls 30s); heartbeat on long activities. Circuit
breaking: PSP activities wrap provider calls with a breaker (open after 5 consecutive failures,
half-open probe 30s) — breaker state lives in the activity worker, NOT the workflow
(determinism). Manual reconciliation: a `reconcile` query exposes saga state; a
`manualResolve` signal lets operators complete/fail a stuck saga; every manual action is
audited (ADR-0009).

### 4. PSP provider port (contracts; NO SDKs)

`PaymentProvider`: `createIntent`, `capture`, `cancel`, `refund` — all idempotent by
`idempotencyKey` parameter; `verifyWebhook(payload, signature, secret)` for the webhook
receiver. Adapters per provider (Stripe/Adyen/Checkout.com/PayPal/Amazon Pay) live in future
`@platform/psp-<provider>` packages via raw REST (same no-SDK convention as D-048). Provider
choice per tenant is composition/config; multi-PSP routing is a future policy on top of the
port. Raw card data NEVER transits the platform (tokens only, G-27).

### 5. Workers

One saga worker process: Temporal worker (workflow + activities) + the payments-captured signal
consumer, composed with the `ConsumerSupervisor` (D-046); task queue `purchase-saga`;
worker-level concurrency caps are the backpressure valve.

## Alternatives rejected

- **Pure choreography** (event chains, no orchestrator) — compensation ordering and visibility
  degrade exactly when money is at stake; Temporal gives replayable history + operator tooling.
- **Synchronous capture in-activity** — violates the event-derived payment-truth rule and makes
  webhooks a second, conflicting source.
- **Auto-refund on commit failure** — unwinding a PAID order automatically is how platforms
  refund customers who got their goods; convergent retry + human page is Shopify's shape.
