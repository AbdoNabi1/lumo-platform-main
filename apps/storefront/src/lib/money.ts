/**
 * Minor-unit exponent of an ISO-4217 currency (EGP 2, JPY 0, KWD 3), from the runtime's Intl data.
 * Plan 2B-1. A copy of admin-web's `currencyExponent`: apps do not import each other.
 */
export function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
