# H-08 — `paymentVerification` is optional and unwired on the event-driven path; the consumer's atomic idempotency is also off

| Field                      | Value                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | High                                                                                                                                       |
| **Area**                   | Payments / Orders / Event system                                                                                                           |
| **Baseline**               | `main` @ `756bce3`                                                                                                                         |
| **Blocker verdict**        | **True blocker.** The optionality was a deliberate backward-compatibility choice; leaving the production consumer path unwired is not.     |
| **Public contract change** | **Yes, if made required** — a `MarkOrderPaidDeps` field would change from optional to required. A no-contract-change alternative is given. |

---

## 1. Location

| File                                                            | Lines        | What is there                                                        |
| --------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| `services/orders/src/application/mark-order-paid.use-case.ts`   | 35           | `readonly paymentVerification?: PaymentVerificationPort;` — optional |
| `services/orders/src/application/mark-order-paid.use-case.ts`   | 60–72        | The verification block, skipped when unwired                         |
| `apps/runtime/src/api.ts`                                       | 43–46        | Admin HTTP path — **wired**                                          |
| `apps/runtime/src/composition.ts`                               | 196–201      | Consumer path — **not wired**                                        |
| `apps/runtime/src/composition.ts`                               | 203–217      | `KafkaConsumerRuntime` — no `unitOfWork`, no `metrics`               |
| `apps/runtime/src/composition.ts`                               | 155–171      | `PrismaPaymentVerificationAdapter` — the real adapter                |
| `packages/kafka/src/consumer-runtime.ts`                        | 38–43, 58–63 | The opt-in atomic path and why it matters                            |
| `services/orders/src/infrastructure/in-memory-port-adapters.ts` | 51           | `InMemoryPaymentVerificationAdapter` — the always-true default       |

---

## 2. Current implementation

### 2a. Verification is optional and self-disabling

```ts
// services/orders/src/application/mark-order-paid.use-case.ts:28-35
/**
 * Gates a caller-asserted `paymentRef` against Payments before it can complete an order
 * (Sprint A1 Task 5 — closes the remaining "no bare non-empty-string check" gap). Optional: when
 * unwired, behavior is unchanged from before this field existed …
 */
readonly paymentVerification?: PaymentVerificationPort;
```

```ts
// services/orders/src/application/mark-order-paid.use-case.ts:60-72
if (this.deps.paymentVerification !== undefined) {
  const verified = await this.deps.paymentVerification.hasCapturedPayment(
    input.orderId,
    input.paymentRef,
  );
  if (!verified) {
    return err(
      new ValidationError("No captured payment found for this reference on this order", [
        { field: "paymentRef", message: "could not be verified against Payments" },
      ]),
    );
  }
}
```

The entire control is inside an `!== undefined` guard. Omitting the dependency silently disables it.

### 2b. Only one of the two production paths wires it

**Admin HTTP — wired:**

```ts
// apps/runtime/src/api.ts:43-46
paymentVerification: new PrismaPaymentVerificationAdapter(
  runtime.prisma,
  runtime.config.TENANT_DEFAULT_ID,
),
```

**Kafka consumer — not wired:**

```ts
// apps/runtime/src/composition.ts:196-201
const markOrderPaid = new MarkOrderPaid({
  orders,
  unitOfWork: new PrismaUnitOfWork(core.prisma),
  idGenerator: core.idGenerator,
  clock: core.clock,
});
```

`api.ts:24-27` states this is deliberate:

> _"The event-driven `PaymentCapturedConsumer` path (in `worker.ts`) is untouched — it builds its own separate `MarkOrderPaid` instance and was already trustworthy by construction."_

### 2c. The same call site also omits two other safety options

```ts
// apps/runtime/src/composition.ts:203-217
return new KafkaConsumerRuntime({
  kafka: core.kafka,
  handler: new PaymentCapturedConsumer({ markOrderPaid, logger: core.logger }),
  consumerGroup,
  serializer: core.serializer,
  processedEvents: new PrismaProcessedEventStore(core.prisma, consumerGroup),
  deadLetters: new DeadLetterPublisher({ ... }),
  retryPublisher: producer,
  clock: core.clock,
  logger: core.logger,
  // no `unitOfWork` → the atomic idempotency path is disabled
  // no `metrics`    → messaging metrics are noop (H-04)
});
```

`KafkaConsumerRuntime` documents what omitting `unitOfWork` costs:

> _"The residual concurrent-duplicate window is closed for real when the handler records the marker inside its own transaction (`PrismaProcessedEventStore` accepts the tx)."_ (`consumer-runtime.ts:58-63`)

Without it, the runtime takes the weaker branch — `handle()` then `recordIfNew()` as two separate operations (lines 148–154).

---

## 3. Why it is incorrect

**On the "trustworthy by construction" claim.** The reasoning is that a `payments.payment_intent.captured` event is emitted by Payments itself, so its `paymentRef` is not caller-asserted. That is sound _in isolation_. It stops being sound in context:

1. **Per C-05, the event is not evidence of payment.** `InMemoryPaymentProvider.capture()` is a no-op and `createIntent` fabricates the id. The `captured` event is emitted by the platform about its own fabricated state. "Trustworthy by construction" holds only if the construction includes a real PSP — which it does not.
2. **An optional security control is a control that will eventually be omitted.** It already has been, on one of the two production paths. The next `MarkOrderPaid` call site — a replay tool, a reconciliation job, an admin script — will default to unverified unless its author knows to pass the field.
3. **The verification is a cheap, tenant-scoped, indexed lookup** (`prisma.paymentIntent.findFirst` on `id`+`orderRef`+`tenantId`+`status`). There is no performance argument for skipping it on the consumer path.
4. **Defence in depth is the whole point of the A1 sprint.** Sprint A1 Task 5 exists to close _"the remaining 'no bare non-empty-string check' gap"_. Closing it on one of two paths leaves the gap.

**On the omitted `unitOfWork`.** The consumer does the harder thing (Prisma-backed inbox, DLQ rows, retry topics) and then declines the option that closes the last correctness window — while the code it calls constructs a `PrismaUnitOfWork` two lines earlier (line 198) that could simply be passed through.

---

## 4. Production impact

**(a) The consumer path completes orders without verification.** `payments.payment_intent.captured` → `PaymentCapturedConsumer` → `MarkOrderPaid` (unverified) → `Order.completePayment` → order marked paid. Any event on that topic — a replayed message, a manually-produced message, a message from a compromised producer, or (today) a message describing a payment that never occurred — marks an order paid.

**(b) Circular verification on the admin path.** Even where verification _is_ wired, `PrismaPaymentVerificationAdapter` (`composition.ts:164-170`) queries the platform's own `payment_intents` table for `status: "captured"` — a row written by the same fabricated capture flow. Until C-05 lands, the control validates the platform against itself. This is not a defect in the adapter; it is correct as designed. It means H-08 and C-05 must be fixed together for either to mean anything.

**(c) Concurrent redelivery can double-effect.** With `unitOfWork` omitted, two consumer instances (`replicas: 2`, `21-deployment-worker.yaml:12`) processing the same redelivered message can both pass the `has()` pre-check, both call `handle()`, and both attempt `recordIfNew()`. `Order.completePayment` is likely idempotent at the domain level (status transitions guard it), but the order-history append and the outbox write are not obviously so. The class provides the fix and it is not switched on.

**(d) No visibility.** Per H-04, `messaging_messages_*_total` is noop, so neither duplicate-processing nor verification-failure rates are observable.

---

## 5. Smallest additive fix

### Step 1 — wire the consumer path (3 lines, do this first)

```ts
// apps/runtime/src/composition.ts:196-201
const markOrderPaid = new MarkOrderPaid({
  orders,
  unitOfWork: new PrismaUnitOfWork(core.prisma),
  idGenerator: core.idGenerator,
  clock: core.clock,
  paymentVerification: new PrismaPaymentVerificationAdapter(
    // ← already defined, same file
    core.prisma,
    core.config.TENANT_DEFAULT_ID,
  ),
});
```

`PrismaPaymentVerificationAdapter` is defined at line 155 of the same file. No new import, no new class, **no contract change** — the field is already optional and simply being supplied.

### Step 2 — enable atomic idempotency (2 lines)

```ts
const unitOfWork = new PrismaUnitOfWork(core.prisma);   // hoist the existing instance
...
return new KafkaConsumerRuntime({
  ...
  unitOfWork,           // ← enables handleAtomic when the handler supports it
  metrics: core.metrics, // ← see H-04
});
```

Verify first that `PaymentCapturedConsumer` implements `handleAtomic`; if it does not, the option is inert and the consumer should be extended to support it (that is a larger, separate change — do not fake it).

### Step 3 — close the optionality (choose one)

**Option A — make it required (preferred; small, but a contract change).** Change `readonly paymentVerification?:` to `readonly paymentVerification:` in `MarkOrderPaidDeps`. Every caller must then supply it. Blast radius, measured:

- `apps/runtime/src/composition.ts` — fixed by Step 1
- `apps/admin`'s `wireOrders(deps)` path — already threads it through (`apps/admin/src/composition.ts:140`)
- `services/orders/src/composition.ts:48` — defaults to `InMemoryPaymentVerificationAdapter` (always true); becomes an explicit default
- `services/orders/src/application/mark-order-paid.use-case.test.ts` — 3 call sites via the `wire()` helper (lines 20, 101, 114, 129)

That is a handful of files, all inside this repository.

**Option B — fail closed without a contract change (zero blast radius).** Keep the field optional but refuse the unverified path in production, mirroring `apps/runtime/src/composition.ts:111-119`:

```ts
if (this.deps.paymentVerification === undefined && this.deps.requireVerification === true) {
  return err(new ValidationError("Payment verification is required in this environment", []));
}
```

Option A is cleaner and the blast radius is small; Option B is available if a frozen-contract constraint applies.

---

## 6. Public contract impact

- **Steps 1 and 2: none.** Both supply values to fields that are already declared optional (`MarkOrderPaidDeps.paymentVerification`, `KafkaConsumerRuntimeDeps.unitOfWork`, `.metrics`). No signature changes; no route, event, or export changes.
- **Step 3 Option A: yes — a source-breaking change to `MarkOrderPaidDeps`.** `PaymentVerificationPort` itself (`services/orders/src/application/ports.ts:43`, re-exported at `services/orders/src/index.ts:28`) is unchanged; only the deps interface tightens. The change is compile-time-detected, and the four affected call sites are enumerated above.
- **Step 3 Option B: none.**
- No database, event-envelope, or HTTP contract is affected by any option.

---

## 7. Blocker or intentional deferral?

**Partly a deliberate design choice — and a true blocker as it stands.**

The optionality was intentional and its rationale is written down (`mark-order-paid.use-case.ts:28-34`): keep behaviour _"unchanged from before this field existed"_, matching _"every other in-memory default in this codebase — `InMemoryShippingAdapter.verifyReturnShipment` etc."_. As a mechanism for landing Sprint A1 Task 5 without breaking callers, that is defensible.

Not defensible is the state it left behind: **the security control is enabled on the path a human triggers and disabled on the path that runs automatically at volume.** The justification (_"already trustworthy by construction"_) rests on a PSP that does not exist (C-05).

`docs/implementation/PURCHASE_SAGA_REPORT.md` documents Task 5 as complete. It is complete for the admin action and incomplete for the consumer.

**Verdict: true blocker** — but a cheap one. Step 1 is three lines against a class defined in the same file, and it removes the asymmetry entirely.

---

## 8. How this was verified

- `services/orders/src/application/mark-order-paid.use-case.ts` read in full (100 lines).
- `apps/runtime/src/composition.ts` read in full (218 lines) — `PrismaPaymentVerificationAdapter` at 155–171; `MarkOrderPaid` construction at 196–201 confirmed to omit `paymentVerification`; `KafkaConsumerRuntime` at 203–217 confirmed to omit `unitOfWork` and `metrics`.
- `apps/runtime/src/api.ts:43-46` read — the admin path **is** wired.
- `packages/kafka/src/consumer-runtime.ts:38-43, 58-63, 140-154, 179-204` read — the atomic path and its documented rationale.
- `git grep -n "PaymentVerificationPort\|PrismaPaymentVerificationAdapter"` → all call sites enumerated (§5 Step 3 blast radius).
- `git grep -l "implements PaymentProvider"` → 1 stub, establishing the C-05 interaction.
- No code was modified.
