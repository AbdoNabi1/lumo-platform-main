/**
 * Consent snapshot and the fail-closed forwarding gate (doc 16 §5, ADR-0032 §4).
 *
 * Consent is **owned by `services/identity`** (`ConsentRecord`/`ConsentScope`) and is never
 * re-derived here. This module models the snapshot that rides every envelope and the decision
 * function the destination router applies before any forward. Absent, stale or unreadable consent
 * denies — there is no permissive default.
 */

/** Consent Mode v2 aligned categories (doc 16 §5). */
export type ConsentCategory =
  | "necessary"
  | "analytics_storage"
  | "ad_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "personalization";

export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  "necessary",
  "analytics_storage",
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "personalization",
];

/**
 * Granular per-category grants. Absent category ⇒ **not granted** (deny by default, doc 27 §5).
 * Carried alongside the coarse booleans below, which remain for backward compatibility.
 */
export type ConsentGrants = Partial<Record<ConsentCategory, boolean>>;

/** What a destination requires before it may receive an event. */
export type ConsentPurpose = "analytics" | "marketing" | "personalization";

/**
 * The category set each purpose requires. Marketing deliberately requires **both** `ad_storage`
 * and `ad_user_data`: sending hashed PII to a conversions API on storage consent alone is the
 * common Consent-Mode-v2 compliance failure.
 */
export const CONSENT_REQUIREMENTS: Readonly<Record<ConsentPurpose, readonly ConsentCategory[]>> = {
  analytics: ["analytics_storage"],
  marketing: ["ad_storage", "ad_user_data"],
  personalization: ["personalization"],
};

/** Why a forward was denied — recorded on the delivery attempt for audit and diagnostics. */
export interface ConsentDenial {
  readonly purpose: ConsentPurpose;
  readonly missing: readonly ConsentCategory[];
  readonly reason: "missing_categories" | "no_consent_snapshot";
}

export type ConsentDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly denial: ConsentDenial };

/**
 * Resolves the effective grant for a category, preferring the granular map and falling back to
 * the coarse booleans so envelopes captured before granular consent existed still evaluate.
 */
function grantFor(consent: ConsentSnapshot, category: ConsentCategory): boolean {
  const granular = consent.grants?.[category];
  if (granular !== undefined) return granular;

  switch (category) {
    case "necessary":
      return true;
    case "analytics_storage":
      return consent.analytics;
    case "ad_storage":
    case "ad_user_data":
    case "ad_personalization":
      return consent.marketing;
    case "personalization":
      return consent.personalization;
  }
}

/**
 * The forwarding gate. Fail-closed: a missing snapshot denies, and every required category must be
 * explicitly granted. Callers must treat `allowed: false` as terminal — never as a retryable error.
 */
export function evaluateConsent(
  consent: ConsentSnapshot | undefined,
  purpose: ConsentPurpose,
): ConsentDecision {
  if (consent === undefined) {
    return {
      allowed: false,
      denial: { purpose, missing: CONSENT_REQUIREMENTS[purpose], reason: "no_consent_snapshot" },
    };
  }

  const missing = CONSENT_REQUIREMENTS[purpose].filter((category) => !grantFor(consent, category));

  return missing.length === 0
    ? { allowed: true }
    : { allowed: false, denial: { purpose, missing, reason: "missing_categories" } };
}

/**
 * Consent as it stood **at emit time**. Snapshotting rather than resolving at delivery time is
 * deliberate: an event captured under consent stays forwardable, and one captured without it can
 * never be retroactively laundered by a later grant.
 */
export interface ConsentSnapshot {
  readonly analytics: boolean;
  readonly marketing: boolean;
  readonly personalization: boolean;
  /** Granular Consent Mode v2 grants; wins over the coarse booleans when present. */
  readonly grants?: ConsentGrants;
  /** ISO-8601 UTC instant the consent state was captured. */
  readonly capturedAt?: string;
  /** Opaque reference to the owning `ConsentRecord` in `services/identity`, for audit. */
  readonly recordRef?: string;
  /** Consent framework version, e.g. `tcf-2.2`, for regulatory traceability. */
  readonly framework?: string;
}

/** The most restrictive possible snapshot — used whenever consent cannot be read. */
export const DENY_ALL_CONSENT: ConsentSnapshot = {
  analytics: false,
  marketing: false,
  personalization: false,
  grants: {
    necessary: true,
    analytics_storage: false,
    ad_storage: false,
    ad_user_data: false,
    ad_personalization: false,
    personalization: false,
  },
};
