/**
 * Morbeh event ids (lead-site plan B, Task 3).
 *
 * Pure and synchronous: safe in a browser bundle and testable without crypto. A browser event gets
 * `mb_<uuid>`; a business event derives its id from the business reference, so every emitter of the
 * same occurrence produces the same id and the ad platforms can collapse the copies.
 */

export type BusinessEventKind = "lead" | "order" | "delivery" | "cancel";

export const EVENT_ID_PREFIX = {
  browser: "mb_",
  lead: "lead_",
  order: "ord_",
  delivery: "dlv_",
  cancel: "cnl_",
} as const;

const BUSINESS_REF = /^[A-Za-z0-9-]{1,64}$/;
const PLACEHOLDER_REF = /^(?:undefined|null|na)$/i;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEGACY_HASHED_ID = /^[0-9a-f]{64}$/;

const BUSINESS_PREFIXES: readonly string[] = [
  EVENT_ID_PREFIX.lead,
  EVENT_ID_PREFIX.order,
  EVENT_ID_PREFIX.delivery,
  EVENT_ID_PREFIX.cancel,
];

/** A usable business reference: 1-64 of [A-Za-z0-9-] and not a template/placeholder word. */
export function isBusinessRef(ref: string): boolean {
  return typeof ref === "string" && BUSINESS_REF.test(ref) && !PLACEHOLDER_REF.test(ref);
}

/** `mb_` + the lowercased UUID. Throws RangeError when the generator does not return a UUID. */
export function newBrowserEventId(randomUuid: () => string): string {
  const uuid = String(randomUuid()).toLowerCase();
  if (!CANONICAL_UUID.test(uuid)) {
    throw new RangeError("newBrowserEventId: the generator did not return a UUID");
  }
  return `${EVENT_ID_PREFIX.browser}${uuid}`;
}

/** Prefix + trimmed reference. Throws RangeError unless the reference passes isBusinessRef. */
export function businessEventId(kind: BusinessEventKind, ref: string): string {
  const trimmed = typeof ref === "string" ? ref.trim() : "";
  if (!isBusinessRef(trimmed)) {
    throw new RangeError(`businessEventId: "${trimmed}" is not a valid business reference`);
  }
  return `${EVENT_ID_PREFIX[kind]}${trimmed}`;
}

/** True for `mb_` + a canonical lowercase UUID, or a business prefix + a valid business reference. */
export function isMorbehEventId(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.startsWith(EVENT_ID_PREFIX.browser)) {
    return CANONICAL_UUID.test(value.slice(EVENT_ID_PREFIX.browser.length));
  }
  const prefix = BUSINESS_PREFIXES.find((p) => value.startsWith(p));
  return prefix !== undefined && isBusinessRef(value.slice(prefix.length));
}

/**
 * Classifies a client-supplied dedup id. `undefined` is absent; a Morbeh id or a 64-hex legacy
 * hashed id is valid; anything else (null, "", "undefined", numbers, objects, malformed strings) is
 * invalid. Never throws.
 */
export function checkProvidedDedupId(value: unknown): "absent" | "valid" | "invalid" {
  if (value === undefined) return "absent";
  if (typeof value !== "string") return "invalid";
  return isMorbehEventId(value) || LEGACY_HASHED_ID.test(value) ? "valid" : "invalid";
}
