/**
 * Identity block — travels with **every** event whenever available (doc 16 §6.1, doc 17 §2).
 *
 * Two rules govern this module. First, raw PII never leaves our boundary (ADR-0006, doc 09 §5):
 * fields here hold either the raw value *inside* the platform or its hash on the way out, and
 * `hashStatus` says which. Second, the platform stitches identity but does not **own** it —
 * `customerId` resolves through an outbound port to `services/identity`, and the P7 CDP profile is
 * built on top of this graph, not inside it (ADR-0032 §Consequences).
 */

/** Whether the PII fields on this envelope are raw (internal) or already hashed (outbound). */
export type HashStatus = "raw" | "sha256" | "mixed";

/** How confident we are that two identifiers belong to the same person (doc 17 §4). */
export type IdentityConfidence = "deterministic" | "probabilistic";

/**
 * Identifiers that survive cookie loss, device changes, guest checkout, login/logout and account
 * merge. Every field is optional because an anonymous first touch legitimately has almost none of
 * them — but whatever exists must be carried, since match quality is the difference between a
 * conversion being attributed and being lost.
 */
export interface IdentityContext {
  // Anonymous / device-scoped
  readonly anonymousId?: string;
  readonly visitorId?: string;
  readonly browserId?: string;
  readonly clientId?: string;
  readonly deviceId?: string;
  readonly sessionId?: string;

  // Known / authenticated
  readonly customerId?: string;
  readonly externalId?: string;
  readonly crmId?: string;
  readonly loyaltyId?: string;
  readonly householdId?: string;

  // Matchable person attributes (hashed per `hashStatus` before any outbound forward)
  readonly email?: string;
  readonly phone?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly postalCode?: string;
  readonly gender?: string;
  readonly birthDate?: string;

  // State flags
  readonly authenticated?: boolean;
  readonly guest?: boolean;
  readonly hashStatus?: HashStatus;
}

/**
 * One observed link in the identity graph (doc 17 §4). Edges are append-only observations, not
 * assertions: a merge is a new edge, never an overwrite, so stitching stays auditable and
 * reversible.
 */
export interface IdentityEdge {
  readonly fromType: IdentifierType;
  readonly fromValue: string;
  readonly toType: IdentifierType;
  readonly toValue: string;
  readonly confidence: IdentityConfidence;
  /** ISO-8601 UTC instant the link was observed. */
  readonly observedAt: string;
  /** What produced the link — login, checkout, email click, server stitch. */
  readonly source: string;
}

export type IdentifierType =
  | "visitor_id"
  | "client_id"
  | "browser_id"
  | "device_id"
  | "session_id"
  | "email_hash"
  | "phone_hash"
  | "customer_id"
  | "external_id"
  | "crm_id"
  | "loyalty_id"
  | "household_id";

/**
 * The identity fields each advertising platform uses for advanced matching. Destination mappers
 * read this to maximise Event Match Quality without every adapter re-deciding what to send.
 */
export const ADVANCED_MATCHING_FIELDS: readonly (keyof IdentityContext)[] = [
  "email",
  "phone",
  "firstName",
  "lastName",
  "city",
  "state",
  "country",
  "postalCode",
  "gender",
  "birthDate",
  "externalId",
];

/** True once the visitor is resolvable to a known person rather than only a device. */
export function isKnownIdentity(identity: IdentityContext): boolean {
  return Boolean(identity.customerId ?? identity.externalId ?? identity.crmId ?? identity.email);
}

/**
 * Counts the advanced-matching fields present, which is the practical proxy for Event Match
 * Quality. Surfaced in the admin "Show Match Quality" diagnostic so a merchant can see *why* a
 * destination scores poorly rather than only *that* it does.
 */
export function matchQualitySignals(identity: IdentityContext): readonly (keyof IdentityContext)[] {
  return ADVANCED_MATCHING_FIELDS.filter((field) => {
    const value = identity[field];
    return typeof value === "string" && value.trim() !== "";
  });
}
