/**
 * Store currency to the country calling code its customers type national phone numbers in (P2-D7).
 *
 * Orders keep the phone exactly as typed (`01012345678`), which no ad platform can match until it is E.164. The
 * currency is the store's market, so it names the code to prepend. Mirrors `CURRENCY_CALLING_CODE` in
 * `services/leads` (EGP, SAR, AED) and adds the other Gulf currencies.
 */

export const DEFAULT_CALLING_CODE = "20";

export const CURRENCY_CALLING_CODES: Readonly<Record<string, string>> = {
  EGP: "20",
  SAR: "966",
  AED: "971",
  KWD: "965",
  QAR: "974",
  BHD: "973",
  OMR: "968",
  JOD: "962",
};

/** Digits only, no `+`. An unknown or missing currency is Egypt (the default market). */
export function callingCodeForCurrency(currency: string | null | undefined): string {
  const code =
    typeof currency === "string"
      ? CURRENCY_CALLING_CODES[currency.trim().toUpperCase()]
      : undefined;
  return code ?? DEFAULT_CALLING_CODE;
}
