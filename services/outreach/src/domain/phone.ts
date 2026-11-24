/**
 * Phone normalisation to E.164. Pure; no I/O.
 *
 * Reimplements the Egyptian rules of `packages/carrier-bosta/src/phone.ts` (national format) as E.164 and adds SA/AE.
 */

export type DefaultCountry = "EG" | "SA" | "AE";

const COUNTRY_CODE: Record<DefaultCountry, string> = { EG: "20", SA: "966", AE: "971" };

const MOBILE_PATTERN: Record<string, RegExp> = {
  "20": /^\+201[0125]\d{8}$/,
  "966": /^\+9665\d{8}$/,
  "971": /^\+9715\d{8}$/,
};

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= ARABIC_INDIC_ZERO && cp <= ARABIC_INDIC_ZERO + 9)
      out += String(cp - ARABIC_INDIC_ZERO);
    else if (cp >= EXTENDED_ARABIC_INDIC_ZERO && cp <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(cp - EXTENDED_ARABIC_INDIC_ZERO);
    } else out += ch;
  }
  return out;
}

/** Returns the E.164 number (`+` and 8-15 digits) or `null` when the input is not a usable mobile number. */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: DefaultCountry = "EG",
): string | null {
  if (raw === null || raw === undefined) return null;
  // Strip whitespace, separators and the invisible LRM/RLM/embedding marks chat apps add when copying numbers.
  const cleaned = toAsciiDigits(raw).replace(/[\s\-().\u200e\u200f\u202a-\u202e]/g, "");
  if (cleaned === "") return null;
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits: string;
  if (cleaned.startsWith("+")) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith("00")) {
    digits = cleaned.slice(2);
  } else {
    const cc = COUNTRY_CODE[defaultCountry];
    if (cleaned.startsWith("0")) digits = cc + cleaned.slice(1);
    else if (cleaned.startsWith(cc)) digits = cleaned;
    else digits = cc + cleaned;
  }

  if (digits === "" || digits.startsWith("0")) return null;
  const e164 = `+${digits}`;
  for (const [cc, pattern] of Object.entries(MOBILE_PATTERN)) {
    if (digits.startsWith(cc)) return pattern.test(e164) ? e164 : null;
  }
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}
