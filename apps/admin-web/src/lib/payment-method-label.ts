import type { Dictionary } from "@/messages/en";

/**
 * How the customer pays, named for a person: "Cash on delivery", "Card (Stripe)", … A method this
 * build has no name for shows as it was recorded; no payment linked yet is a dash.
 */
export function paymentMethodLabel(provider: string | null, t: Dictionary): string {
  if (provider === null) return t.orderPage.noPaymentMethod;
  return (t.orderPage.paymentMethodName as Record<string, string>)[provider] ?? provider;
}
