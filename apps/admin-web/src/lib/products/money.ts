/** Currencies offered in the price fields until a store currency setting exists (G-99). */
export const SUPPORTED_CURRENCIES = ["EGP", "USD", "SAR", "AED", "KWD", "QAR", "EUR"] as const;

/** Minor-unit exponent of an ISO-4217 currency (EGP 2, JPY 0, KWD 3), from the runtime's Intl data. */
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

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(text: string): string {
  let out = "";
  for (const char of text) {
    const index = ARABIC_INDIC.indexOf(char);
    if (index >= 0) out += String(index);
    else if (char === "٫") out += ".";
    else if (char === "٬" || char === "," || char === " ") continue;
    else out += char;
  }
  return out;
}

/**
 * A typed amount ("150", "150.5", "1,250.75", "١٥٠٫٥") to minor units, by string arithmetic —
 * never `Number(text) * 100`, which turns 0.29 into 28.999…. `null` when the text is not a
 * non-negative amount with at most the currency's number of decimals.
 */
export function toMinorUnits(text: string, currency: string): number | null {
  const normalized = normalizeDigits(text.trim());
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (match === null) return null;
  const exponent = currencyExponent(currency);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units to the plain text an input shows ("150.50"); no grouping, always `exponent` decimals. */
export function fromMinorUnits(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
