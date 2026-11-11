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

/**
 * Normalises what a merchant typed into WhatsApp digits, or null. A leading `0` (national format)
 * is completed with `callingCode`; `+` or `00` marks an international number.
 */
export function toWhatsAppDigits(
  raw: unknown,
  callingCode: string = DEFAULT_CALLING_CODE,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = toAsciiDigits(raw).trim();
  const international = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!international && digits.startsWith("00")) digits = digits.slice(2);
  else if (!international && digits.startsWith("0")) digits = `${callingCode}${digits.slice(1)}`;
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
