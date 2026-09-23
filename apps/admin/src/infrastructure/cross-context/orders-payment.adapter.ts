import type { PaymentController } from "@platform/payments";
import type { PaymentPort } from "@platform/orders";

/** The payment method the shopper selected for an order, or `undefined` if none can be established. */
export type SelectedProviderLookup = (
  orderId: string,
  tenantId: string,
) => Promise<string | undefined>;

interface CreateIntentBody {
  readonly paymentIntentId: string;
}

interface CaptureBody {
  readonly paymentIntentId: string;
  readonly status: string;
}

/**
 * Real `PaymentPort` over Payments' own `createIntentLifecycle` -> `captureLifecycle` chain (Phase
 * 3 Task 12, C-3) — Orders' `RequestPaymentCapture` calls this instead of the offline
 * `InMemoryPaymentAdapter` stub (`services/orders/src/infrastructure/in-memory-port-adapters.ts`),
 * which fabricated a `payment-{orderId}-{n}` ref without ever touching Payments' real intent
 * lifecycle.
 *
 * The 2-step chain (`services/payments/src/application/payment-lifecycle.use-cases.ts`):
 *   1. `createIntentLifecycle({orderRef: orderId, amountMinor, currency})` — mints a fresh payment
 *      intent and creates the PSP-side intent. Maps directly from this port's params, no
 *      transformation needed.
 *   2. `captureLifecycle({paymentIntentId})` — using the id from step 1, requests capture from the
 *      PSP and transitions the intent to `captured`.
 * `PaymentCaptureResult.paymentRef` is the `paymentIntentId`, not a PSP reference or a freshly
 * minted id of this adapter's own — this matches the existing convention
 * `services/orders/src/interfaces/payment-captured.consumer.ts` already establishes asynchronously
 * (it treats `event.aggregateId`, "the payment intent id", as the `paymentRef` it passes into
 * `MarkOrderPaid`); this adapter establishes the same convention synchronously.
 *
 * Failure handling: `PaymentPort.requestCapture`'s contract (`Promise<PaymentCaptureResult>`) has
 * no `{valid:false}` error channel — same shape as `InventoryPort.requestReservation`
 * (`orders-inventory.adapter.ts`). A non-2xx `ControllerResponse` from either step, or a
 * `captureLifecycle` result whose `status` never reached `"captured"` (e.g. left at
 * `capture_requested` because the PSP call failed — see `CapturePaymentLifecycle`'s own doc),
 * throws a clear `Error` naming the order/payment intent and what actually happened rather than
 * fabricating a `paymentRef` for a capture that didn't succeed.
 *
 * Idempotency — deliberately NOT guarded here, unlike `OrdersInventoryAdapter`: this port's own
 * real caller, `RequestPaymentCapture` (`services/orders/src/application/order-lifecycle.use-
 * cases.ts`), already has its own `precheck()` step that short-circuits BEFORE ever calling
 * `paymentPort.requestCapture()` if `order.paymentRef` is already recorded — "a retry of a call
 * that already succeeded — no second PSP capture request" (see that class's own doc comment). The
 * ONE residual risk that precheck doesn't close is a genuinely CONCURRENT double-call (two racing
 * callers both reading "no paymentRef yet" before either commits) — `RequestPaymentCapture`'s doc
 * explicitly documents this as pre-existing, "NOT a regression," and "not fixed by this phase":
 * `settle()` already tolerates it gracefully (first commit wins, the loser's re-read finds a
 * `paymentRef` already present and no-ops). Adding a lookup-before-call guard in THIS adapter would
 * solve a problem the real caller already solves one layer up, and would not even close the
 * concurrent case (a guard read here races exactly the same way `precheck()`'s does) — so this
 * adapter is a straightforward, unguarded two-step chain.
 */
export class OrdersPaymentAdapter implements PaymentPort {
  private readonly payments: Pick<PaymentController, "createIntentLifecycle" | "captureLifecycle">;
  private readonly selectedProvider: SelectedProviderLookup;

  /**
   * ADR-0014 (WP-10, T10.3): stateless per tenant — `PaymentPort.requestCapture` carries `tenantId` per call.
   *
   * WP-13: `selectedProvider` answers "which payment method did the SHOPPER choose for this order?"
   * (from the order's checkout session). `PaymentPort` carries no method and is not widened; this
   * adapter therefore refuses to open an intent for an order whose method it cannot establish,
   * rather than choosing one.
   */
  constructor(
    payments: Pick<PaymentController, "createIntentLifecycle" | "captureLifecycle">,
    selectedProvider: SelectedProviderLookup,
  ) {
    this.payments = payments;
    this.selectedProvider = selectedProvider;
  }

  async requestCapture(
    orderId: string,
    amountMinor: number,
    currency: string,
    tenantId: string,
  ): Promise<{ readonly paymentRef: string }> {
    const provider = await this.selectedProvider(orderId, tenantId);
    if (provider === undefined) {
      throw new Error(
        `OrdersPaymentAdapter: order "${orderId}" has no payment method selected by the shopper — ` +
          "refusing to choose one",
      );
    }
    const createResponse = await this.payments.createIntentLifecycle({
      tenantId,
      orderRef: orderId,
      provider,
      amountMinor,
      currency,
    });
    if (createResponse.status !== 201) {
      throw new Error(
        `OrdersPaymentAdapter: createIntentLifecycle failed for order "${orderId}" ` +
          `(status ${createResponse.status}): ${JSON.stringify(createResponse.body)}`,
      );
    }
    const { paymentIntentId } = createResponse.body as CreateIntentBody;

    const captureResponse = await this.payments.captureLifecycle({ tenantId, paymentIntentId });
    if (captureResponse.status !== 200) {
      throw new Error(
        `OrdersPaymentAdapter: captureLifecycle failed for order "${orderId}" ` +
          `payment intent "${paymentIntentId}" (status ${captureResponse.status}): ` +
          `${JSON.stringify(captureResponse.body)}`,
      );
    }
    const { status } = captureResponse.body as CaptureBody;
    if (status !== "captured") {
      throw new Error(
        `OrdersPaymentAdapter: capture for order "${orderId}" payment intent "${paymentIntentId}" ` +
          `did not reach "captured" (reached "${status}")`,
      );
    }

    return { paymentRef: paymentIntentId };
  }
}
