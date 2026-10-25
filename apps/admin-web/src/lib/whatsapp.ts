/**
 * Order operations Part 3 — sharing a recovery link through the merchant's own WhatsApp with a
 * `wa.me` deep link (spec §3.7, no WhatsApp Business API). Pure; safe in client components.
 */

/** Calling codes for the shop's markets (spec §3.7). */
export const WHATSAPP_CALLING_CODES: Readonly<Record<string, string>> = {
  EG: "20",
  SA: "966",
  AE: "971",
  KW: "965",
  QA: "974",
  BH: "973",
  OM: "968",
  JO: "962",
};

/** E.164 allows at most 15 digits; fewer than 8 is not a reachable mobile in these markets. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/** Arabic-Indic (U+0660–0669) and Persian (U+06F0–06F9) digits to ASCII. */
function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The digits `wa.me` wants (country code + national number, no `+`). A number written
 * internationally (`+20…`, `0020…`) is used as written; a national one (`010…`, `10…`) gets the
 * shipping country's calling code, its national leading `0` dropped. Null when it cannot be made
 * usable — the caller then opens WhatsApp's chat picker instead of a wrong chat.
 */
export function toWhatsAppDigits(phone: string | null, country: string | null): string | null {
  if (phone === null) return null;
  const raw = asciiDigits(phone).trim();
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    const code = country === null ? undefined : WHATSAPP_CALLING_CODES[country.toUpperCase()];
    if (code === undefined) return null;
    if (digits.startsWith("0")) digits = `${code}${digits.slice(1)}`;
    else if (!digits.startsWith(code)) digits = `${code}${digits}`;
  }
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS ? digits : null;
}

export function whatsAppUrl(digits: string | null, text: string): string {
  const query = `text=${encodeURIComponent(text)}`;
  return digits === null ? `https://wa.me/?${query}` : `https://wa.me/${digits}?${query}`;
}

/** `{name}`-style placeholders; a function replacer, so `$&` in a value stays literal. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
