/**
 * Shadow-mode plumbing (Sprint A1 — Payment Truth Foundation, Task 4). NOT enabled by anything today
 * — no composition root wires a non-noop implementation, and no caller depends on this having any
 * effect. It exists only so a future cutover sprint can compare the runtime purchase saga's own
 * direct order-advance call (not yet reconstructed in this repository) against what the ONE
 * authoritative path (`Order.completePayment` via `MarkOrderPaid`) independently concludes, without
 * redesigning the saga or changing runtime behavior now.
 *
 * `MarkOrderPaid` calls `observe` after a successful `completePayment` (see
 * `mark-order-paid.use-case.ts`). A future implementation can log/emit/compare;
 * `NoopPaymentTruthShadow` — the only implementation that exists today — does nothing, so wiring it
 * (or leaving it unwired, the current default) is behaviorally identical.
 */
export interface PaymentTruthShadowObservation {
  readonly orderId: string;
  readonly paymentRef: string;
  readonly resultingStatus: string;
}

export interface PaymentTruthShadowPort {
  observe(observation: PaymentTruthShadowObservation): void;
}

export class NoopPaymentTruthShadow implements PaymentTruthShadowPort {
  observe(): void {
    // Intentionally inert — see file docstring.
  }
}
