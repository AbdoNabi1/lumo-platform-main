import type { CodIntentFacts, ShippableOrder } from "./ports";

export const OPEN_COD_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "requires_payment",
  "created",
  "processing",
  "authorized",
  "capture_requested",
]);
export function decideCodAmount(
  order: Pick<ShippableOrder, "paymentStatus" | "totalMinor" | "paymentRef" | "currency">,
  intent: CodIntentFacts | null,
):
  | { readonly ok: true; readonly codAmountMinor: number }
  | {
      readonly ok: false;
      readonly code: "ORDER_NOT_PAID" | "COD_AMOUNT_MISMATCH" | "ORDER_NOT_SHIPPABLE";
    } {
  if (order.paymentStatus === "refunded" || order.paymentStatus === "voided")
    return { ok: false, code: "ORDER_NOT_SHIPPABLE" };
  if (order.paymentStatus === "paid") return { ok: true, codAmountMinor: 0 };
  if (
    !order.paymentRef ||
    intent === null ||
    intent.provider !== "cod" ||
    !OPEN_COD_INTENT_STATUSES.has(intent.status)
  )
    return { ok: false, code: "ORDER_NOT_PAID" };
  if (intent.amountMinor !== order.totalMinor || intent.currency !== order.currency)
    return { ok: false, code: "COD_AMOUNT_MISMATCH" };
  return { ok: true, codAmountMinor: intent.amountMinor };
}
