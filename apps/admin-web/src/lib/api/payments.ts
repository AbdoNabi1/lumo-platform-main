import { getAdminApi } from "./client";

export interface PaymentIntentDto {
  readonly id: string;
  readonly orderRef: string;
  readonly status: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly authorizedAmountMinor: number | null;
  readonly capturedAmountMinor: number;
  readonly refundedAmountMinor: number;
  readonly pspReference: string | null;
  readonly capturedAt: string | null;
  readonly refundedAt: string | null;
}

function isPaymentIntentDto(value: unknown): value is PaymentIntentDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { status?: unknown }).status === "string"
  );
}

export type FetchPaymentIntentResult =
  | { readonly outcome: "ok"; readonly paymentIntent: PaymentIntentDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches a payment intent by id (resolves an order's `paymentRef` for the Order Detail screen — `paymentRef` IS the `PaymentIntent` id, see `apps/runtime`'s `hasCapturedPayment` query). */
export async function fetchPaymentIntent(
  paymentIntentId: string,
): Promise<FetchPaymentIntentResult> {
  const result = await getAdminApi(
    `/api/v1/payment-intents/${encodeURIComponent(paymentIntentId)}`,
    isPaymentIntentDto,
  );
  if (result.outcome === "ok") {
    return { outcome: "ok", paymentIntent: result.data };
  }
  if (result.outcome === "error") {
    return { outcome: "error", message: result.message };
  }
  return result;
}
