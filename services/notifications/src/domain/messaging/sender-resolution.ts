/**
 * Wave 2b2 (D46): who a customer's mail comes from. Only ever the store's OWN email account:
 * `"<Store name>" <merchant's address>`. There is no platform mailbox, no Reply-To mode and no
 * domain authentication here: the merchant's own provider decides whether it will send from that
 * address, and we show its answer.
 */

const FREE_MAIL_EXACT: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.ru",
]);

/** `yahoo.com`, `yahoo.co.uk`, `hotmail.fr`, `yandex.ru`, `gmx.de`, `outlook.sa` ... */
const FREE_MAIL_PREFIXES: readonly string[] = ["yahoo.", "hotmail.", "outlook.", "yandex.", "gmx."];

const EMAIL_PATTERN = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]{2,}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@").pop() ?? "";
}

export function isFreeMailDomain(domain: string): boolean {
  const lower = domain.trim().toLowerCase();
  return (
    FREE_MAIL_EXACT.has(lower) || FREE_MAIL_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/** A display name that cannot break a header: no quotes, angle brackets, backslash or control characters. */
export function safeDisplayName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 80);
}

/** The From header for a store's mail: its (safe) name at the merchant's own address. */
export function formatFrom(storeName: string, fromEmail: string): string {
  const name = safeDisplayName(storeName);
  const address = normalizeEmail(fromEmail);
  return name === "" ? `<${address}>` : `"${name}" <${address}>`;
}
