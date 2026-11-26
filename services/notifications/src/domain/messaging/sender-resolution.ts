/**
 * Wave 2b (D38): who a customer's mail comes from. Shopify's model, honestly:
 *
 * - The store's Sender email defaults to its contact email.
 * - Only when that address's domain is VERIFIED for the store is it used as the From address.
 * - Otherwise the mail comes from the store's name at the PLATFORM's own sending address, and the
 *   Sender email becomes Reply-To, so replies still reach the merchant.
 * - A free-mail domain (gmail.com ...) can never be verified (its DMARC rejects third-party senders),
 *   so it is always the Reply-To mode. An unverified merchant address is NEVER put in From.
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

/** The address inside `Name <address>`, or the bare value. */
export function mailboxAddress(mailbox: string): string {
  const match = /<([^<>]+)>\s*$/.exec(mailbox);
  return (match?.[1] ?? mailbox).trim();
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

export type SenderMode = "own_domain" | "reply_to" | "platform_only";

export interface ResolveSenderInput {
  readonly storeName: string;
  /** The merchant's chosen Sender email (null = not set). */
  readonly senderEmail: string | null;
  /** The store contact email, used when no Sender email is set. */
  readonly contactEmail?: string | null;
  /** Domains the store has verified at the email provider (lower case). */
  readonly verifiedDomains: readonly string[];
  /** The platform's sending mailbox, e.g. `Morbeh <onboarding@resend.dev>`. */
  readonly platformFrom: string;
}

export interface ResolvedSender {
  readonly from: string;
  readonly replyTo?: string;
  readonly mode: SenderMode;
  /** The merchant address in effect (the Sender email, else the contact email), or null. */
  readonly effectiveEmail: string | null;
}

export function resolveSender(input: ResolveSenderInput): ResolvedSender {
  const name = safeDisplayName(input.storeName);
  const platformAddress = mailboxAddress(input.platformFrom);
  const display = name === "" ? "" : `"${name}" `;
  const platformFrom = `${display}<${platformAddress}>`.trim();

  const candidate = [input.senderEmail, input.contactEmail ?? null].find(
    (value): value is string => value !== null && value !== undefined && isValidEmail(value),
  );
  if (candidate === undefined) {
    return { from: platformFrom, mode: "platform_only", effectiveEmail: null };
  }
  const email = normalizeEmail(candidate);
  const domain = emailDomain(email);
  const verified =
    !isFreeMailDomain(domain) && input.verifiedDomains.some((d) => d.toLowerCase() === domain);
  if (verified) {
    return { from: `${display}<${email}>`.trim(), mode: "own_domain", effectiveEmail: email };
  }
  return { from: platformFrom, replyTo: email, mode: "reply_to", effectiveEmail: email };
}
