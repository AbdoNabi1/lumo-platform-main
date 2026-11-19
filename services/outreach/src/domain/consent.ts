/**
 * Contact consent. Pure; no I/O.
 *
 * Policy note: an inbound STOP keyword revokes EVERY WhatsApp purpose (marketing and transactional). Meta treats STOP as
 * an opt-out of everything; this all-purpose revoke is Morbeh's deliberately conservative policy. An admin/API revoke of
 * one purpose never touches the other, and a grant never changes the other purpose.
 */

export type Channel = "whatsapp" | "email";
export type Purpose = "marketing" | "transactional";
export type ConsentSource = "admin" | "import" | "inbound_keyword" | "checkout" | "api";

export interface ConsentState {
  whatsappMarketing: "granted" | "revoked" | "unknown";
  /** `unknown` is the default: transactional WhatsApp is only sent after a recorded grant (Part 3 records it at checkout). */
  whatsappTransactional: "allowed" | "revoked" | "unknown";
  emailMarketing: "granted" | "revoked" | "unknown";
}

export interface ConsentChange {
  channel: Channel;
  purpose: Purpose;
  action: "grant" | "revoke";
}

export interface ConsentEvent extends ConsentChange {
  source: ConsentSource;
}

export function initialConsentState(): ConsentState {
  return {
    whatsappMarketing: "unknown",
    whatsappTransactional: "unknown",
    emailMarketing: "unknown",
  };
}

/** Returns the new state plus the list of (channel, purpose) pairs whose value actually changed. Never mutates. */
export function applyConsent(
  state: ConsentState,
  e: ConsentEvent,
): { state: ConsentState; changed: ConsentChange[] } {
  const next: ConsentState = { ...state };
  const changed: ConsentChange[] = [];
  const grant = e.action === "grant";

  const setWhatsappMarketing = (): void => {
    const value = grant ? "granted" : "revoked";
    if (next.whatsappMarketing !== value) {
      next.whatsappMarketing = value;
      changed.push({ channel: "whatsapp", purpose: "marketing", action: e.action });
    }
  };
  const setWhatsappTransactional = (): void => {
    const value = grant ? "allowed" : "revoked";
    if (next.whatsappTransactional !== value) {
      next.whatsappTransactional = value;
      changed.push({ channel: "whatsapp", purpose: "transactional", action: e.action });
    }
  };

  if (e.channel === "whatsapp") {
    if (!grant && e.source === "inbound_keyword") {
      setWhatsappMarketing();
      setWhatsappTransactional();
    } else if (e.purpose === "marketing") {
      setWhatsappMarketing();
    } else {
      setWhatsappTransactional();
    }
  } else if (e.purpose === "marketing") {
    const value = grant ? "granted" : "revoked";
    if (next.emailMarketing !== value) {
      next.emailMarketing = value;
      changed.push({ channel: "email", purpose: "marketing", action: e.action });
    }
  }
  // Transactional email carries no consent state: it is always sendable.

  return { state: next, changed };
}

export function canSend(
  state: ConsentState,
  channel: Channel,
  purpose: "marketing" | "utility" | "transactional" | "authentication",
): boolean {
  if (channel === "whatsapp") {
    return purpose === "marketing"
      ? state.whatsappMarketing === "granted"
      : state.whatsappTransactional === "allowed";
  }
  return purpose === "marketing" ? state.emailMarketing === "granted" : true;
}

export const STOP_KEYWORDS: readonly string[] = [
  "stop",
  "unsubscribe",
  "الغاء",
  "إلغاء",
  "ايقاف",
  "إيقاف",
  "توقف",
];

/** Lowercase, drop diacritics (including the hamza-below/above marks NFKD splits off alef) and tatweel. */
function normalizeKeyword(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0640/g, "");
}

const NORMALIZED_STOP_KEYWORDS: ReadonlySet<string> = new Set(STOP_KEYWORDS.map(normalizeKeyword));

/** Exact match after normalisation. A sentence containing a keyword ("please stop") is NOT a keyword. */
export function isStopKeyword(text: string): boolean {
  return NORMALIZED_STOP_KEYWORDS.has(normalizeKeyword(text));
}
