import type { SendStatus } from "@/lib/api/outreach";
import type { Dictionary } from "@/messages/en";

/**
 * Pure helpers for Settings → WhatsApp, shared by the server actions and the client components (no server-only
 * imports).
 */

const NOT_CODES: ReadonlySet<string> = new Set(["generic", "stale"]);

/**
 * True when the copy has a dedicated sentence for this feature rejection code. Provider codes (`META_131056`,
 * `HTTP_500`) and anything unknown are NOT on the list, so they fall to the generic sentence.
 */
export function isKnownWhatsAppCode(code: unknown, t: Dictionary): code is string {
  return (
    typeof code === "string" &&
    !NOT_CODES.has(code) &&
    Object.hasOwn(t.whatsappSettings.errors, code)
  );
}

/** The localised sentence for an allowlisted code; generic copy for everything else. Never provider text. */
export function whatsappErrorMessage(code: unknown, t: Dictionary): string {
  const errors: Readonly<Record<string, string>> = t.whatsappSettings.errors;
  return isKnownWhatsAppCode(code, t)
    ? (errors[code] ?? t.whatsappSettings.errors.generic)
    : t.whatsappSettings.errors.generic;
}

/** The badge label and variant for Meta's quality rating; unknown or null reads as "not rated yet". */
export function qualityBadge(
  rating: string | null,
  t: Dictionary,
): { readonly label: string; readonly variant: "success" | "warning" | "destructive" | "neutral" } {
  switch (rating) {
    case "GREEN":
      return { label: t.whatsappSettings.qualityHigh, variant: "success" };
    case "YELLOW":
      return { label: t.whatsappSettings.qualityMedium, variant: "warning" };
    case "RED":
      return { label: t.whatsappSettings.qualityLow, variant: "destructive" };
    default:
      return { label: t.whatsappSettings.qualityUnrated, variant: "neutral" };
  }
}

/**
 * The number of customers a messaging tier allows per 24 hours: `TIER_250` → 250, `TIER_1K` → 1000. `"unlimited"` for
 * `TIER_UNLIMITED`; `null` for anything else (the screen then shows "—", never the raw tier).
 */
export function tierLimit(tier: string | null): number | "unlimited" | null {
  if (tier === null) return null;
  if (tier === "TIER_UNLIMITED") return "unlimited";
  const match = /^TIER_(\d{1,3})(K?)$/.exec(tier);
  if (match === null) return null;
  const count = Number(match[1]) * (match[2] === "K" ? 1000 : 1);
  return count > 0 ? count : null;
}

/** The business messaging limit as one sentence in the admin's language. */
export function limitSentence(tier: string | null, t: Dictionary, locale: string): string {
  const limit = tierLimit(tier);
  if (limit === null) return t.whatsappSettings.limitUnknown;
  if (limit === "unlimited") return t.whatsappSettings.limitUnlimited;
  return t.whatsappSettings.limitSentence.replace(
    "{count}",
    new Intl.NumberFormat(locale).format(limit),
  );
}

export type TestSendOutcome = "accepted" | "suppressed" | "unknown" | "failed";

/**
 * What a test send's API status means to the merchant. Only a status the provider acknowledged is "accepted": an HTTP
 * 200 alone never is (a `pending` row has not reached WhatsApp, so it reads as unconfirmed).
 */
export function testSendOutcome(status: SendStatus): TestSendOutcome {
  switch (status) {
    case "accepted":
    case "sent":
    case "delivered":
    case "read":
      return "accepted";
    case "suppressed":
      return "suppressed";
    case "failed":
      return "failed";
    case "pending":
    case "unknown":
      return "unknown";
  }
}

/** Phone numbers are validated authoritatively on the server; this only catches obvious typos. */
export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;

/** A decimal Meta asset id, as the connect route accepts it. */
export const META_ID_PATTERN = /^\d{1,64}$/;

/**
 * A fresh idempotency key for one test-send submission, made in the browser (it has to outlive a retry, so the server
 * action cannot make it). 36 characters of `[0-9a-f-]`.
 */
export function newClientKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
