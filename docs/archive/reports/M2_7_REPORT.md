# M2-7 Remediation Report — Payment Verification Consumer Path

| Field        | Value                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Finding**  | M2-7 — Consumer-path payment verification omitted                                                       |
| **Baseline** | `main` @ `9f36a69` (post M2-2)                                                                          |
| **Commit**   | one commit, 2 files                                                                                     |
| **Verdict**  | Fixed — the consumer path now routes through the same verification adapter the admin path already uses. |

---

## 1. Investigation

### 1a. Consumer entrypoints / event handlers

The worker process (`apps/runtime/src/worker.ts`) registers three consumer runtimes via
`ConsumerSupervisor`: `buildPaymentCapturedRuntime` (payments → orders, the one relevant to
this finding), `buildTrackingIngestRuntime` (config-gated), and `wireSecurityProvisioning`
(config-gated). Only the first is in scope for payment verification.

`buildPaymentCapturedRuntime` (`apps/runtime/src/composition.ts`) wires a
`KafkaConsumerRuntime<PaymentCapturedPayload>` whose handler is
`PaymentCapturedConsumer` (`services/orders/src/interfaces/payment-captured.consumer.ts`).
`PaymentCapturedConsumer.handle()` calls `MarkOrderPaid.execute()` — the ONE authoritative
"payment completed" path, shared with the admin backoffice mark-paid action
(`services/orders/src/application/mark-order-paid.use-case.ts`).

### 1b. Payment lifecycle / verification invocation

`MarkOrderPaid` has always supported an optional `paymentVerification?: PaymentVerificationPort`
dependency (Sprint A1 Task 5): when supplied, it gates the caller-asserted `paymentRef` against
Payments' own `payment_intents` table before completing the order; when omitted, verification is
silently skipped (`mark-order-paid.use-case.ts:60-72`).

Two production call sites construct `MarkOrderPaid`:

- **Admin HTTP path** (`apps/runtime/src/api.ts:158-161`) — **wired**: passes
  `new PrismaPaymentVerificationAdapter(runtime.prisma, runtime.config.TENANT_DEFAULT_ID)`.
- **Kafka consumer path** (`apps/runtime/src/composition.ts`, `buildPaymentCapturedRuntime`) —
  **not wired**: constructed `MarkOrderPaid` with `orders`/`unitOfWork`/`idGenerator`/`clock`
  only, omitting `paymentVerification` entirely.

`PrismaPaymentVerificationAdapter` (defined in the same `composition.ts`, already used by the
admin path) is a read-only, tenant-scoped `prisma.paymentIntent.findFirst` lookup keyed on
`id` + `orderRef` + `tenantId` + `status: "captured"` — the same schema/table
`PrismaPaymentIntentRepository` writes to. It never imports `@platform/payments` (Orders/Payments
stay code-decoupled, matching every other cross-context port in this codebase).

**Root cause confirmed:** every asynchronous payment transition on this consumer topic
(`payments.payment_intent.captured.v1`) reached `Order.completePayment` with the verification gate
unconditionally skipped, while the synchronous admin path enforced it. An existing investigation
(`docs/investigations/H-08-payment-verification-optional.md`) and the standing
`MEDIUM_REMEDIATION_PLAN.md` §3 had already documented this exact asymmetry; this sprint closes it.

### 1c. Retry / DLQ / outbox / webhook / licensing / finance interaction (checked, unaffected)

- **Retry & DLQ:** `KafkaConsumerRuntime` retries the _same_ `MarkOrderPaid` instance on
  redelivery and DLQs on exhaustion (`packages/kafka/src/consumer-runtime.ts`). Wiring
  verification into the single shared instance means every retry attempt is now verified too —
  no separate wiring needed.
- **Outbox:** `buildPaymentCapturedRuntime` already constructs its own tx-scoped
  `OutboxWriter`/`PrismaOutboxStore` for Orders' own published events; untouched by this change.
- **Webhook interaction:** the PSP webhook ingress (`apps/admin/src/http/payments-webhook-routes.ts`)
  calls `paymentProvider.verifyWebhook()` before `RecordWebhook` — a distinct, already-closed
  control (C2-2/C2-6) gating webhook _authenticity_, separate from `PaymentVerificationPort`
  gating a caller-asserted `paymentRef` at order-completion time. Out of scope for M2-7, unaffected.
- **Licensing interaction:** grepped `services/licensing` for `PaymentVerificationPort`/
  `paymentVerification` — zero matches. Licensing's payment integration (M2-3) is a synchronous
  `PaymentsPort` call for billing, not a consumer of `payments.payment_intent.captured`; no
  bypass exists there to route.
- **Finance interaction:** `services/finance/src/interfaces/finance-consumers.ts` declares a
  `PaymentsCapturedConsumer` for the same topic, but it has zero callers anywhere in
  `apps/runtime` (confirmed by repo-wide search) — it is unwired, dead code, unrelated to payment
  _verification_ and out of this finding's scope. Not modified.
- **A known, separate, larger finding — explicitly not touched:** the webhook-driven and
  Sprint-4.8-lifecycle capture paths (`RecordWebhook`/`PaymentIntent.markCaptured`) emit
  `PaymentTransitioned` → `payments.intent.captured`, a _different_ event type from the legacy
  `PaymentIntent.capture()` → `PaymentCaptured` → `payments.payment_intent.captured` that
  `PaymentCapturedConsumer` actually subscribes to. This is a pre-existing, already-tracked event-contract
  finding (`docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md:377`, "PAY-12") requiring an event
  contract change — explicitly forbidden by this sprint's rules ("DO NOT change event contracts").
  Left untouched.

---

## 2. Runtime Evidence

No live Kafka/Postgres broker is available in this sandbox (consistent with prior sprints —
Docker Desktop's daemon does not come up here; see `[[lumo-m2-2-media-storage-remediation]]`).
Runtime verification is therefore by direct code inspection plus offline test execution, not a
live end-to-end run — no live-broker evidence is fabricated.

**Offline evidence, in place of the live 8-step checklist:**

1. **Publish/consume shape unchanged:** `buildPaymentCapturedRuntime`'s `topic`
   (`payments.payment_intent.captured.v1`) and `consumerGroup` (`orders.payment-captured`) are
   asserted unchanged by the pre-existing `composition.test.ts` test
   ("composes the production payment-captured consumer graph").
2. **Verification executes / invalid payment rejected / valid payment accepted:** proven at the
   `MarkOrderPaid` use-case level by the pre-existing `mark-order-paid.use-case.test.ts` (accepts
   when `hasCapturedPayment` resolves `true`, rejects with a `ValidationError` before touching the
   order when it resolves `false` — unchanged by this sprint) combined with 5 new tests added
   against the concrete adapter now wired into the consumer path
   (`PrismaPaymentVerificationAdapter` — accepts a matching captured row; rejects no-row,
   cross-order, cross-tenant, and not-yet-captured rows).
3. **Retry / DLQ path:** unchanged code (`KafkaConsumerRuntime`'s retry/DLQ logic was not
   touched); since it re-invokes the same `MarkOrderPaid` instance, verification now applies
   uniformly across original delivery and every redelivery.
4. **Outbox preserved:** `OutboxWriter`/`PrismaOutboxStore` construction in
   `buildPaymentCapturedRuntime` is untouched.

---

## 3. Root Cause

`buildPaymentCapturedRuntime` (`apps/runtime/src/composition.ts`) constructed `MarkOrderPaid`
without supplying the already-optional, already-defined `paymentVerification` dependency, while
the admin HTTP boot path (`apps/runtime/src/api.ts`) did supply it. The optionality itself was an
intentional, disclosed backward-compatibility mechanism for landing Sprint A1 Task 5 without
breaking existing callers — the defect is that the consumer path was never updated to supply it,
leaving one of the two production paths permanently unverified.

---

## 4. Code Changes

**`apps/runtime/src/composition.ts`** — `buildPaymentCapturedRuntime` now passes
`paymentVerification: new PrismaPaymentVerificationAdapter(core.prisma, core.config.TENANT_DEFAULT_ID)`
into the `MarkOrderPaid` constructor — the identical adapter class already used by the admin path,
already defined in this same file. No new class, no new import, no new provider, no PSP.

**`apps/runtime/src/composition.test.ts`** — 5 new tests directly exercising
`PrismaPaymentVerificationAdapter.hasCapturedPayment` against a fake Prisma double (accept:
matching id+order+tenant+status; reject: no row, wrong order, wrong tenant, wrong status).

No other files changed. `MarkOrderPaidDeps.paymentVerification` stays optional (no public contract
change) — per the standing `MEDIUM_REMEDIATION_PLAN.md` guidance, the field is not being made
required, only supplied at this one remaining call site.

---

## 5. Regression Risk

**Low.**

- The dependency being supplied was already optional and already exercised (by the admin path) —
  no new code path, no new class, no signature change.
- `PrismaPaymentVerificationAdapter.hasCapturedPayment` is a pure, read-only, indexed lookup
  (`id` + `orderRef` + `tenantId` + `status`) — no side effects, cannot itself cause a duplicate
  write or a stuck message.
- Behavioral change is intentional and narrow: a `payments.payment_intent.captured.v1` message
  whose `paymentRef` does NOT resolve to a `captured` row in `payment_intents` for that order/tenant
  will now be rejected (`ValidationError`) instead of unconditionally marking the order paid. Per
  `MarkOrderPaid`'s existing (unchanged) domain-error handling, a `ValidationError` returned from
  `execute()` surfaces to the consumer as a failed `handle()` — following the SAME retry → DLQ path
  as any other rejected message, not a crash or a silent drop.
  - **Known caveat, already disclosed in H-08/PAY-12 (not introduced by this change, not fixed by
    it either):** the webhook-driven and Sprint-4.8-lifecycle capture flows write `captured` rows
    via `PaymentTransitioned` → `payments.intent.captured` rather than the legacy
    `payments.payment_intent.captured` this consumer subscribes to — those flows' capture events
    were never reaching this consumer at all, before or after this change. `capture()` (the legacy
    method, still the one exercised by `payments.e2e.test.ts` and the saga's documented dependency)
    is unaffected and continues to write the `captured` row this adapter reads.
- All four gates verified green after the change (below); zero pre-existing test needed
  modification.

---

## 6. Verification Results

Ran from the monorepo root (`C:\Users\abdoh\Claude code\Git\lumo-platform`), post-change:

| Gate          | Command                               | Result                                                         |
| ------------- | ------------------------------------- | -------------------------------------------------------------- |
| **typecheck** | `pnpm typecheck`                      | 76/76 tasks green                                              |
| **lint**      | `pnpm lint`                           | 76/76 tasks green                                              |
| **test**      | `pnpm turbo run test --concurrency=1` | 76/76 tasks green; runtime package 30 files / 145 tests passed |
| **arch**      | `pnpm arch`                           | 0 violations, 1531 modules, 6676 dependencies (unchanged)      |

No live-infrastructure run was performed (Docker unavailable in this sandbox, consistent with
every prior Medium remediation sprint) — no such evidence is claimed above.

---

## 7. How This Was Verified

- Read `apps/runtime/src/composition.ts` in full (both before and after the edit).
- Read `apps/runtime/src/api.ts`, `apps/runtime/src/worker.ts`,
  `services/orders/src/application/{mark-order-paid.use-case.ts,ports.ts}`,
  `services/orders/src/interfaces/payment-captured.consumer.ts` and its test file.
- Read `services/payments/src/{domain/payment-intent.ts,application/{capture-payment.use-case.ts,
record-webhook.use-case.ts},infrastructure/payment-event-translator.ts}` to trace which capture
  paths emit which event types, confirming the PAY-12 divergence is pre-existing and out of scope.
- Read `docs/investigations/H-08-payment-verification-optional.md` (prior investigation, same
  finding) and `MEDIUM_REMEDIATION_PLAN.md` §3 (registered M2-7 scope) before writing any code.
- `git grep` for `PaymentVerificationPort`/`paymentVerification` across `services/licensing`
  (zero matches) and for `finance-consumers` wiring in `apps/runtime` (zero matches) to confirm
  those interactions are unaffected/out of scope.
- Ran `pnpm typecheck`, `pnpm lint`, `pnpm turbo run test --concurrency=1`, `pnpm arch` after the
  change — all green, captured above.
