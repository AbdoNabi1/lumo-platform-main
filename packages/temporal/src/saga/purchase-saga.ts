/**
 * The purchase saga's DETERMINISTIC core (ADR-0012). Pure orchestration: no clock, no id
 * generation, no I/O — every effect goes through the injected activities port and every
 * non-deterministic input (capture outcome, time) arrives as a parameter or awaited signal.
 * The Temporal workflow (`workflows/purchase.workflow.ts`) is a thin adapter over this core,
 * which is why compensation/replay semantics are fully unit-testable without a Temporal server.
 */

export interface PurchaseSagaInput {
  readonly tenantId: string;
  readonly checkoutSessionId: string;
  readonly cartRef: string;
  readonly customerRef: string;
}

export interface QuoteResult {
  readonly currency: string;
  readonly totalAmountMinor: number;
  readonly lines: readonly {
    productRef: string;
    name: string;
    unitPriceAmountMinor: number;
    quantity: number;
  }[];
}

/**
 * Activities port — each implementation calls a context's APPLICATION layer (never
 * repositories), is independently retryable, and is idempotent keyed by `sagaId + step`
 * (ADR-0012 §2). Retry/timeout policies attach in the workflow adapter, not here.
 */
export interface PurchaseSagaActivities {
  priceQuote(input: PurchaseSagaInput): Promise<QuoteResult>;
  reserveStock(input: PurchaseSagaInput, quote: QuoteResult): Promise<{ reservationRef: string }>;
  createPaymentIntent(
    input: PurchaseSagaInput,
    quote: QuoteResult,
  ): Promise<{ paymentIntentRef: string }>;
  placeOrder(
    input: PurchaseSagaInput,
    quote: QuoteResult,
    paymentIntentRef: string,
  ): Promise<{ orderRef: string }>;
  commitReservation(
    input: PurchaseSagaInput,
    reservationRef: string,
    orderRef: string,
  ): Promise<void>;
  releaseReservation(input: PurchaseSagaInput, reservationRef: string): Promise<void>;
  cancelPaymentIntent(input: PurchaseSagaInput, paymentIntentRef: string): Promise<void>;
  refundPayment(input: PurchaseSagaInput, paymentIntentRef: string): Promise<void>;
  /**
   * **STALE — contradicted by C-2's new model, kept only because `runPurchaseSaga` below still
   * sequences it.** This signature encodes the pre-Task-16 contract, in which the CALLER created
   * the order (step 5, `placeOrder`) and then handed the resulting `orderRef` to Checkout to
   * record. As of C-2 the direction is inverted: `CompleteCheckout`
   * (`services/checkout/src/application/complete-checkout.use-case.ts`) is what *creates* the
   * order, via `OrderCreationPort`, and returns the `orderRef` — so completion no longer takes one
   * and no longer follows order placement, it precedes and causes it.
   *
   * Not corrected here because nothing implements `PurchaseSagaActivities` anywhere in this
   * repository (no Temporal activity worker is wired — see `worker.ts`'s header), so reshaping the
   * saga to match would be speculative design against zero call sites; the whole ordering of steps
   * 5-6 would have to be rethought, which is a real design decision, not a rename. Whoever wires
   * the first real activity implementation must reconcile this interface with C-2's model first.
   */
  completeCheckout(input: PurchaseSagaInput, orderRef: string): Promise<void>;
  failCheckout(input: PurchaseSagaInput, reason: string): Promise<void>;
  sendConfirmation(input: PurchaseSagaInput, orderRef: string): Promise<void>;
  /** Money moved but the saga could not converge — a human must look (ADR-0012 §3). */
  alertOperator(input: PurchaseSagaInput, detail: string): Promise<void>;
}

/** Injected by the adapter: resolves when the capture webhook's event signals the saga. */
export type CaptureWait = () => Promise<"captured" | "failed" | "timeout">;

export type PurchaseOutcome =
  | { readonly status: "completed"; readonly orderRef: string }
  | { readonly status: "failed"; readonly reason: string };

export async function runPurchaseSaga(
  activities: PurchaseSagaActivities,
  input: PurchaseSagaInput,
  awaitCapture: CaptureWait,
): Promise<PurchaseOutcome> {
  // 1. Quote — nothing to compensate on failure (activity retries exhausted ⇒ fail checkout).
  let quote: QuoteResult;
  try {
    quote = await activities.priceQuote(input);
  } catch {
    await activities.failCheckout(input, "pricing_unavailable");
    return { status: "failed", reason: "pricing_unavailable" };
  }

  // 2. Reserve — insufficient stock / unavailability fails the checkout, nothing to unwind.
  let reservationRef: string;
  try {
    reservationRef = (await activities.reserveStock(input, quote)).reservationRef;
  } catch {
    await activities.failCheckout(input, "inventory_unavailable");
    return { status: "failed", reason: "inventory_unavailable" };
  }

  // 3. Payment intent — on failure: release reservation, fail (ADR-0012 compensation table).
  let paymentIntentRef: string;
  try {
    paymentIntentRef = (await activities.createPaymentIntent(input, quote)).paymentIntentRef;
  } catch {
    await activities.releaseReservation(input, reservationRef);
    await activities.failCheckout(input, "payment_provider_unavailable");
    return { status: "failed", reason: "payment_provider_unavailable" };
  }

  // 4. Await capture TRUTH via signal (webhook → outbox event → signal; never a return value).
  const capture = await awaitCapture();
  if (capture !== "captured") {
    const reason = capture === "failed" ? "payment_failed" : "payment_timeout";
    await activities.cancelPaymentIntent(input, paymentIntentRef); // no-op if never captured
    await activities.releaseReservation(input, reservationRef);
    await activities.failCheckout(input, reason);
    return { status: "failed", reason };
  }

  // 5. Place order — money HAS moved: on failure refund → release → fail → page a human.
  let orderRef: string;
  try {
    orderRef = (await activities.placeOrder(input, quote, paymentIntentRef)).orderRef;
  } catch {
    await activities.refundPayment(input, paymentIntentRef);
    await activities.releaseReservation(input, reservationRef);
    await activities.failCheckout(input, "order_placement_failed");
    await activities.alertOperator(input, "captured payment refunded: order placement failed");
    return { status: "failed", reason: "order_placement_failed" };
  }

  // 6. Convergent tail — order + payment are truth; commit/complete/confirm must converge.
  //    The adapter gives these unbounded retries (ADR-0012); the core simply sequences them.
  await activities.commitReservation(input, reservationRef, orderRef);
  await activities.completeCheckout(input, orderRef);
  await activities.sendConfirmation(input, orderRef);
  return { status: "completed", orderRef };
}
