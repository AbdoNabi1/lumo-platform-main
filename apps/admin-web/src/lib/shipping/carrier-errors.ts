import type { Dictionary } from "@/messages/en";

/** Mirrors CARRIER_KEY_PATTERN in shipping's carrier-key value object. */
export const CARRIER_KEY = /^[a-z][a-z0-9_-]{1,31}$/;

function shippingErrors(t: Dictionary): Record<string, string> {
  return t.carrierShipping.errors;
}

/** True when the shipping copy has a dedicated message for `code`. */
export function hasShippingMessage(code: string | undefined, t: Dictionary): code is string {
  return (
    code !== undefined &&
    (code === "CARRIER_RESULT_UNKNOWN" ||
      code === "SHIPMENT_NEEDS_REVIEW" ||
      code === "CARRIER_NOT_CONFIGURED" ||
      Object.hasOwn(shippingErrors(t), code))
  );
}

/**
 * The localised sentence for a carrier failure code. The `shipping` scope (order page, orders list)
 * checks the shipping copy first; the `settings` scope (Settings → Shipping) keeps the connection
 * wording that screen already used.
 */
export function carrierErrorMessage(
  code: string | undefined,
  t: Dictionary,
  scope: "shipping" | "settings" = "shipping",
): string {
  if (scope === "shipping" && code !== undefined) {
    if (code === "CARRIER_RESULT_UNKNOWN" || code === "SHIPMENT_NEEDS_REVIEW") {
      return t.carrierShipping.needsReview;
    }
    const errors = shippingErrors(t);
    if (code === "CARRIER_NOT_CONFIGURED")
      return errors["CARRIER_NOT_ENABLED"] ?? t.formErrors.unexpected;
    if (Object.hasOwn(errors, code)) return errors[code] ?? t.formErrors.unexpected;
  }
  switch (code) {
    case "CARRIER_CREDENTIALS_REJECTED":
      return t.carrierSettings.credentialsRejected;
    case "CARRIER_UNAVAILABLE":
      return t.carrierSettings.unavailable;
    case "CARRIER_NOT_AVAILABLE":
      return t.carrierSettings.notAvailable;
    case "CARRIER_NOT_CONFIGURED":
      return t.carrierSettings.notConfigured;
    default:
      return t.formErrors.unexpected;
  }
}
