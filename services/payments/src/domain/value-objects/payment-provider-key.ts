/**
 * The identifier of a payment method a shopper can select and a merchant can enable. Open: which
 * keys exist is decided by the providers registered at composition time (`PaymentProviderRegistry`),
 * never by a list in this file. The key is persisted on the intent and selects the adapter.
 *
 * The shopper's explicit choice is the ONLY thing that picks one of these. Nothing in payments —
 * not the resolver, not registration order, not a capability, a fee or a success-rate preference —
 * chooses a provider on the shopper's behalf (WP-13 decision 3, "known traps").
 */
export type PaymentProviderKey = string;

const WELL_FORMED = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * Whether `value` is SHAPED like a provider key: short, lower-case, url- and column-safe. This says
 * nothing about whether a provider by that name is registered — that is the registry's question, at
 * the boundary. It is the only check a stored row can be held to, so a historical value (`stripe`)
 * always reads, whichever providers this deployment currently registers.
 */
export function isWellFormedProviderKey(value: unknown): boolean {
  return typeof value === "string" && WELL_FORMED.test(value);
}
