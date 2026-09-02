# C-06 — The purchase saga can never complete: no activity implementations, no signal sender, no consumer

| Field                      | Value                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | Critical                                                                                                                                             |
| **Area**                   | Orchestration / Commerce correctness                                                                                                                 |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                   |
| **Blocker verdict**        | **Intentional, honestly-documented deferral — and still a true blocker**, because the checkout→payment→order path has no alternative implementation. |
| **Public contract change** | **No** for the guardrail. The activities implementation is new code against an existing interface.                                                   |

---

## 1. Location

| File                                                   | Lines     | What is there                                                                  |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------ |
| `packages/temporal/src/saga/purchase-saga.ts`          | 32–58     | `PurchaseSagaActivities` — the interface, **implemented nowhere**              |
| `packages/temporal/src/saga/purchase-saga.ts`          | 60        | `export type CaptureWait = () => Promise<"captured" \| "failed" \| "timeout">` |
| `packages/temporal/src/saga/purchase-saga.ts`          | 99–100    | `const capture = await awaitCapture();` — the blocking point                   |
| `packages/temporal/src/workflows/purchase.workflow.ts` | 16–19     | `defineSignal` for `paymentCaptured` / `paymentFailed` / `manualResolve`       |
| `packages/temporal/src/workflows/purchase.workflow.ts` | 61–69     | `setHandler(...)` — **receivers** are correctly registered                     |
| `packages/temporal/src/runtime.ts`                     | 20, 33    | `createPurchaseWorker`, `startPurchase` — **zero callers**                     |
| `apps/runtime/src/worker.ts`                           | 11–16, 24 | Registers one Kafka consumer; no Temporal worker                               |
| `apps/runtime/src/config.ts`                           | 29        | `TEMPORAL_ADDRESS` — validated, never read                                     |

---

## 2. Current implementation

### 2a. The core and the adapter are both written, and both correct

The deterministic core implements the full ADR-0012 compensation table:

```ts
// packages/temporal/src/saga/purchase-saga.ts:99-108
// 4. Await capture TRUTH via signal (webhook → outbox event → signal; never a return value).
const capture = await awaitCapture();
if (capture !== "captured") {
  const reason = capture === "failed" ? "payment_failed" : "payment_timeout";
  await activities.cancelPaymentIntent(input, paymentIntentRef); // no-op if never captured
  await activities.releaseReservation(input, reservationRef);
  await activities.failCheckout(input, reason);
  return { status: "failed", reason };
}
```

The Temporal adapter registers all three signal handlers with correct dedup semantics:

```ts
// packages/temporal/src/workflows/purchase.workflow.ts:61-69
setHandler(paymentCapturedSignal, () => {
  captureOutcome ??= "captured"; // signal dedup: first outcome wins (replayed duplicates no-op)
});
setHandler(paymentFailedSignal, () => {
  captureOutcome ??= "failed";
});
setHandler(manualResolveSignal, (resolution) => {
  captureOutcome ??= resolution;
});
```

and bridges it to `CaptureWait` with a 15-minute bounded wait (lines 84–87).

### 2b. Three things are missing

**(i) No implementation of `PurchaseSagaActivities` exists.**

```
$ git grep -n "PurchaseSagaActivities" -- '*.ts'   # excluding tests
packages/temporal/src/index.ts:5            (type re-export)
packages/temporal/src/runtime.ts:3,22       (type import, parameter)
packages/temporal/src/saga/purchase-saga.ts:32,67   (declaration, parameter)
packages/temporal/src/workflows/purchase.workflow.ts:11,34,44,48  (type params)
```

Every hit is a **type reference**. There is no `class …Activities implements PurchaseSagaActivities` and no object literal satisfying it. `proxyActivities<PurchaseSagaActivities>()` is a compile-time cast over a Temporal proxy — it does not supply implementations.

**(ii) No sender ever signals a workflow.**

```
$ git grep -n "\.signal(" -- '*.ts'
(no matches)
```

Receivers exist; senders do not. Nothing converts `payments.payment_intent.captured` into `paymentCapturedSignal`.

**(iii) `@platform/temporal` has zero consumers.**

```
$ git grep -ln "@platform/temporal" -- '*.ts' '*.json'
packages/temporal/package.json
```

No app or service declares it as a dependency. `apps/runtime/package.json` lists 29 workspace dependencies; `@platform/temporal` is not among them. `createPurchaseWorker` and `startPurchase` are exported from the barrel and called by nobody.

`apps/runtime/src/worker.ts:11-16` documents the omission honestly:

> _"The Temporal worker joins this process when its activities become composable — blocked honestly on: a price-quote use case (read side, G-8), the ADR-0013 reservation-commit implementation, and payments carrying the checkout-session ref for the signal bridge (ADR-0012 follow-up, G-40). Registering a worker whose activities cannot exist would be a fake adapter, which this codebase does not do."_

---

## 3. Why it is incorrect

To be precise about what is and is not wrong: **the saga design is not wrong.** The core is deterministic, the compensation ordering is correct (refund before release before fail before page-a-human), signal dedup handles replay, retry policies are differentiated between bounded pre-payment steps and the convergent post-payment tail, and `purchase-saga.test.ts` exercises it without a Temporal server. This is good work.

What is wrong is that **the platform has no other implementation of the checkout→payment→order transaction**, and this one cannot run. Specifically:

1. `TEMPORAL_ADDRESS` is validated in `apps/runtime/src/config.ts:29` with a default of `localhost:7233`, implying an operator can configure it. Nothing reads it. An operator would reasonably conclude the saga is live.
2. The four stated blockers (G-8 price-quote read side, ADR-0013 reservation commit, G-40 checkout-session ref, G-18 api-clients) are themselves all open in `docs/KNOWN_GAPS.md`. The dependency chain is real, but it is four deep and none of it has started.
3. Because there is no working saga, whatever _does_ place orders in production bypasses it — and per C-05 that path fabricates payment success.

---

## 4. Production impact

**There is no working purchase transaction.**

- If a Temporal worker were registered today, every workflow would fail at the first activity: `priceQuote` has no implementation.
- Even with activities implemented, every workflow would block at `await awaitCapture()` for the full `CAPTURE_TIMEOUT_MS` (15 minutes, `purchase.workflow.ts:23`), then compensate and fail with `payment_timeout` — because no sender exists (2b-ii) and, per C-05, no webhook can arrive to trigger one.
- The compensation path would then run `cancelPaymentIntent` → `releaseReservation` → `failCheckout` on **every** purchase. Customers would experience a 15-minute hang followed by a failed checkout.
- Operationally: `manualResolveSignal` and `reconcileQuery` — the operator escape hatches ADR-0012 §3 mandates — are unreachable, because nothing can address a workflow that was never started. This matches SAGA-9 in the repository's own remediation plan.

---

## 5. Smallest additive fix

There is no small fix that makes the saga work. There **is** a small fix that stops it from being silently absent.

### Step 1 — fail closed on unconfigured orchestration (~10 lines, do this first)

`apps/runtime/src/config.ts` currently accepts `TEMPORAL_ADDRESS` and ignores it. Add a `superRefine` clause in the existing block (lines 143–160 already contain three such clauses):

```ts
// Purchase orchestration is not composable yet (G-40, ADR-0012 follow-up). Refuse to imply it is.
if (cfg.APP_ENV !== "local" && cfg.PURCHASE_SAGA_ENABLED) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["PURCHASE_SAGA_ENABLED"],
    message:
      "PURCHASE_SAGA_ENABLED is not supported: PurchaseSagaActivities has no implementation and " +
      "no signal sender exists (G-40). Enabling it would block every checkout for 15 minutes.",
  });
}
```

This is additive, changes nothing today, and makes the gap impossible to misread.

### Step 2 — the real work, in dependency order

The four blockers `worker.ts:11-16` names, each already tracked:

1. **G-8** — a price-quote read use case → enables `priceQuote`.
2. **ADR-0013** — the reservation-commit ledger → enables `reserveStock` / `commitReservation` / `releaseReservation`.
3. **G-40** — Payments carrying the checkout-session ref → enables the signal bridge.
4. **The signal sender itself** — a Kafka consumer on `payments.payment_intent.captured.v1` that resolves the workflow id via `purchaseWorkflowId(input)` (already written, `runtime.ts:7`) and calls `handle.signal(paymentCapturedSignal)`. This is ~40 lines and follows `buildPaymentCapturedRuntime`'s existing shape exactly.

Then register the worker in `apps/runtime/src/worker.ts` alongside the existing `ConsumerSupervisor`, and add `@platform/temporal` to `apps/runtime/package.json`.

**Do not implement Step 2 before C-05.** Without a real PSP and a verified webhook, the signal bridge would relay fabricated capture events, which is worse than no saga at all.

---

## 6. Public contract impact

**None.**

- Step 1 adds one config field and one validation clause. No existing signature changes.
- Step 2 implements the existing `PurchaseSagaActivities` interface — it does not modify it. `PurchaseSagaInput`, `QuoteResult`, `PurchaseOutcome`, and `CaptureWait` are unchanged. The signal and query names (`paymentCaptured`, `paymentFailed`, `manualResolve`, `reconcile`) are already defined and are not altered.
- Adding `@platform/temporal` to `apps/runtime`'s dependencies is additive.

---

## 7. Blocker or intentional deferral?

**An intentional, unusually honest deferral — that is nonetheless a true blocker.**

The deferral is explicit and well-reasoned. `apps/runtime/src/worker.ts:11-16` names all four prerequisites and states the principle: _"Registering a worker whose activities cannot exist would be a fake adapter, which this codebase does not do."_ I agree with that judgement — a registered worker with stub activities would be strictly worse.

`docs/KNOWN_GAPS.md` tracks it as **G-40** (_"Payments carries checkout-session ref → signal bridge → Temporal worker registration"_, impact **"saga not activatable"**, P1, status `designed`) and **G-8** (P1, `designed`). `docs/implementation/ARCHITECTURE_REMEDIATION_PLAN.md` records it as **SAGA-2** (CRIT, CONFIRMED → item A2). I re-verified SAGA-2 independently at this HEAD: `git grep "\.signal("` still returns nothing.

But a deferral is only safe while nothing depends on it. The checkout→payment→order transaction is the core of a commerce platform, and there is no second implementation. **Verdict: true blocker.** The deferral is correct engineering; deploying on top of it is not.

---

## 8. How this was verified

- `git grep -n "\.signal(" -- '*.ts'` → **no matches**.
- `git grep -n "PurchaseSagaActivities" -- '*.ts'` (tests excluded) → 9 hits, all type references; no implementation.
- `git grep -ln "@platform/temporal" -- '*.ts' '*.json'` → **1 hit: its own `package.json`**.
- `apps/runtime/package.json` dependency list read in full — `@platform/temporal` absent.
- `packages/temporal/src/workflows/purchase.workflow.ts` read in full (91 lines).
- `packages/temporal/src/saga/purchase-saga.ts` read (core flow, lines 60–115).
- `packages/temporal/src/runtime.ts` exports enumerated; all four have zero external callers.
- `git grep -n "TEMPORAL_ADDRESS"` → `config.ts:29` only.
- No code was modified.
