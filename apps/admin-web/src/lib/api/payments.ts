import { getAdminApi, mutateAdminApi, type MutationResult } from "./client";

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

/** One registered payment method, as `GET /payments/settings` reports it (never any credential). */
export interface PaymentMethodInfo {
  readonly available: boolean;
  /** Present only for a method that needs merchant credentials. */
  readonly configured?: boolean;
}

/** `GET /payments/settings`: the methods the shopper is offered, and every method this platform registers. */
export interface PaymentSettingsDto {
  readonly enabledMethods: readonly string[];
  readonly methods: Readonly<Record<string, PaymentMethodInfo>>;
}

function isPaymentSettingsDto(value: unknown): value is PaymentSettingsDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { enabledMethods?: unknown; methods?: unknown };
  return (
    Array.isArray(candidate.enabledMethods) &&
    candidate.enabledMethods.every((method) => typeof method === "string") &&
    typeof candidate.methods === "object" &&
    candidate.methods !== null
  );
}

export type FetchPaymentSettingsResult =
  | { readonly outcome: "ok"; readonly settings: PaymentSettingsDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/** Fetches which payment methods the merchant offers and which the platform registers. */
export async function fetchPaymentSettings(): Promise<FetchPaymentSettingsResult> {
  const result = await getAdminApi("/api/v1/payments/settings", isPaymentSettingsDto);
  if (result.outcome === "ok") {
    return { outcome: "ok", settings: result.data };
  }
  return result;
}

function isUnknown(_value: unknown): _value is unknown {
  return true;
}

/** Replaces the set of methods the shopper is offered (at least one). Nothing else in the settings changes. */
export function updateEnabledPaymentMethods(
  methods: readonly string[],
  idempotencyKey: string,
): Promise<MutationResult<unknown>> {
  return mutateAdminApi(
    "/api/v1/payments/settings",
    { method: "PUT", body: { enabledMethods: methods }, idempotencyKey },
    isUnknown,
  );
}
