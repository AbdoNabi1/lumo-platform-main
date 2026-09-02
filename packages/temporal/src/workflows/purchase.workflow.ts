import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import {
  runPurchaseSaga,
  type PurchaseOutcome,
  type PurchaseSagaActivities,
  type PurchaseSagaInput,
} from "../saga/purchase-saga";

/** Webhook-consumer → saga signals (ADR-0012 §1: capture truth arrives as a signal, never a return). */
export const paymentCapturedSignal = defineSignal("paymentCaptured");
export const paymentFailedSignal = defineSignal("paymentFailed");
/** Operator override for stuck sagas — the sender audits (ADR-0012 §3). */
export const manualResolveSignal = defineSignal<["captured" | "failed"]>("manualResolve");
/** Reconciliation window into saga state (read-only). */
export const reconcileQuery = defineQuery<string>("reconcile");

const CAPTURE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Thin Temporal adapter over the deterministic core (ADR-0012 §2). Determinism is inherited:
 * the core has no clock/ids/I-O; time here is Temporal's replayed timer; ids are minted by
 * activities. Workflow id = `purchase:<tenant>:<checkoutSession>` (duplicate starts rejected).
 * Versioning via `patched()` when the flow changes; ContinueAsNew is the escape hatch for
 * signal floods (not expected on a short-lived purchase).
 */
export async function purchaseWorkflow(input: PurchaseSagaInput): Promise<PurchaseOutcome> {
  // Bounded retries for pre-payment steps (ADR-0012: 1s ×2 → 1m cap, 5 attempts).
  const bounded = proxyActivities<PurchaseSagaActivities>({
    startToCloseTimeout: "30 seconds",
    retry: {
      initialInterval: "1 second",
      backoffCoefficient: 2,
      maximumInterval: "1 minute",
      maximumAttempts: 5,
    },
  });
  // Convergent tail: order+payment are truth — retry until convergence (capped interval).
  const convergent = proxyActivities<PurchaseSagaActivities>({
    startToCloseTimeout: "30 seconds",
    retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumInterval: "5 minutes" },
  });
  const activities: PurchaseSagaActivities = {
    ...bounded,
    commitReservation: convergent.commitReservation,
    completeCheckout: convergent.completeCheckout,
    sendConfirmation: convergent.sendConfirmation,
    refundPayment: convergent.refundPayment,
    releaseReservation: convergent.releaseReservation,
    failCheckout: convergent.failCheckout,
    alertOperator: convergent.alertOperator,
  };

  let captureOutcome: "captured" | "failed" | null = null;
  let phase = "started";
  setHandler(paymentCapturedSignal, () => {
    captureOutcome ??= "captured"; // signal dedup: first outcome wins (replayed duplicates no-op)
  });
  setHandler(paymentFailedSignal, () => {
    captureOutcome ??= "failed";
  });
  setHandler(manualResolveSignal, (resolution) => {
    captureOutcome ??= resolution;
  });
  setHandler(reconcileQuery, () => phase);

  const outcome = await runPurchaseSaga(
    {
      ...activities,
      priceQuote: async (i) => ((phase = "pricing"), activities.priceQuote(i)),
      reserveStock: async (i, q) => ((phase = "reserving"), activities.reserveStock(i, q)),
      createPaymentIntent: async (i, q) => (
        (phase = "awaiting_payment"),
        activities.createPaymentIntent(i, q)
      ),
      placeOrder: async (i, q, p) => ((phase = "placing_order"), activities.placeOrder(i, q, p)),
    },
    input,
    async () => {
      const signalled = await condition(() => captureOutcome !== null, CAPTURE_TIMEOUT_MS);
      return signalled && captureOutcome !== null ? captureOutcome : "timeout";
    },
  ).then((result) => ((phase = result.status), result));
  return outcome;
}
