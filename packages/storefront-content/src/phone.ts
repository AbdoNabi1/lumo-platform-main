/** A WhatsApp number as wa.me takes it: country code first, 8 to 15 digits, never a leading 0. */
export const WHATSAPP_DIGITS_MIN = 8;
export const WHATSAPP_DIGITS_MAX = 15;
/** Egypt: there is no shop-country setting to read (Ruling 10). */
export const DEFAULT_CALLING_CODE = "20";

const WHATSAPP_DIGITS = new RegExp(
  `^[1-9][0-9]{${WHATSAPP_DIGITS_MIN - 1},${WHATSAPP_DIGITS_MAX - 1}}$`,
);

export function isWhatsAppDigits(value: unknown): value is string {
  return typeof value === "string" && WHATSAPP_DIGITS.test(value);
}

// Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic / Persian (U+06F0-06F9) digits.
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

function toAsciiDigits(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}

const CALLING_CODE = /^[1-9][0-9]{0,2}$/;
// An Egyptian mobile without its leading 0: 1[0125] plus 8 digits.
const EGYPT_MOBILE = /^1[0125][0-9]{8}$/;
const EGYPT_CODE = "20";

/**
 * Normalises what a merchant typed into WhatsApp digits, or null; never guesses a country.
 * - `+` or `00` marks an international number; a single trunk 0 after the calling code is dropped.
 * - A leading `0` (national format) is completed with `callingCode`.
 * - Bare digits: 11 or more are taken as already country-coded; with the default code a bare
 *   Egyptian mobile (10 digits) gets `20`; any other shorter bare number is refused, because wa.me
 *   would read it as another country's code.
 * - Letters are refused, not stripped. `callingCode` is programmer input: a bad one throws.
 */
export function toWhatsAppDigits(
  raw: unknown,
  callingCode: string = DEFAULT_CALLING_CODE,
): string | null {
  if (!CALLING_CODE.test(callingCode))
    throw new Error("callingCode must be 1-3 digits, no leading 0");
  if (typeof raw !== "string") return null;
  const trimmed = toAsciiDigits(raw).trim();
  if (/\p{L}/u.test(trimmed)) return null;
  const international = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^0-9]/g, "");
  let countryCoded = international;
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    countryCoded = true;
  } else if (!international && digits.startsWith("0")) {
    digits = `${callingCode}${digits.slice(1)}`;
  } else if (!international) {
    if (digits.length >= WHATSAPP_DIGITS_MIN + 3) countryCoded = true;
    else if (callingCode === EGYPT_CODE && EGYPT_MOBILE.test(digits))
      digits = `${callingCode}${digits}`;
    else return null;
  }
  if (countryCoded && digits.startsWith(`${callingCode}0`)) {
    digits = `${callingCode}${digits.slice(callingCode.length + 1)}`;
  }
  return isWhatsAppDigits(digits) ? digits : null;
}

/** `https://wa.me/<digits>`, with `?text=` only for a non-empty message; null for bad digits. */
export function whatsAppHref(digits: string, message: string | null): string | null {
  if (!isWhatsAppDigits(digits)) return null;
  const base = `https://wa.me/${digits}`;
  return message !== null && message.length > 0
    ? `${base}?text=${encodeURIComponent(message)}`
    : base;
}
