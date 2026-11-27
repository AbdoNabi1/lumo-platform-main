/**
 * The identifier of a carrier a merchant can connect (`bosta`, …). Open: which keys exist is decided
 * by the registrations composed at boot (`CarrierRegistry`), never by a list in this file.
 *
 * Short, lower-case, url-, column- and JSON-key-safe. A key starts with a letter, so `__proto__`,
 * `constructor`-style names with a leading underscore and digits-first values are never well formed.
 */
export const CARRIER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/**
 * Whether `value` is SHAPED like a carrier key. Says nothing about whether a carrier by that name is
 * registered: that is the registry's question, at the boundary.
 */
export function isWellFormedCarrierKey(value: string): boolean {
  return typeof value === "string" && CARRIER_KEY_PATTERN.test(value);
}
