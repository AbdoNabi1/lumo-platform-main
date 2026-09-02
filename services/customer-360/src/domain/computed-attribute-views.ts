import type { ComputedAttribute } from "./computed-attribute";
import type { ComputedAttributeValue } from "./computed-attribute-value";

/**
 * Merges every cluster member's own computed-attribute set into one unified view — the Computed
 * Attributes analogue of `mergeProfiles` (`domain/profile-views.ts`), same "per name, highest
 * version wins, tie-broken by the later `evaluatedAt`" rule, same reason: an identity cluster (e.g.
 * a guest `visitor_id` later linked to a `customer_id`) may have had attributes evaluated against
 * each identifier independently before the link was ever asserted, and the merge always prefers the
 * freshest evaluation, never the union of stale ones.
 *
 * The merged view's own `version` is the max across inputs — a computed read, never a new ledger
 * entry, so it must never invent a version number no snapshot actually has.
 */
export function mergeComputedAttributes(
  attributes: readonly ComputedAttribute[],
  mergedIdentifierType: string,
  mergedIdentifierValue: string,
  now: string,
): ComputedAttribute {
  const merged = new Map<string, ComputedAttributeValue>();
  let maxVersion = 0;
  let latestUpdatedAt = "";

  for (const attribute of attributes) {
    maxVersion = Math.max(maxVersion, attribute.version);
    if (attribute.updatedAt > latestUpdatedAt) latestUpdatedAt = attribute.updatedAt;

    for (const [id, value] of attribute.attributes) {
      const existing = merged.get(id);
      if (
        existing === undefined ||
        value.version > existing.version ||
        (value.version === existing.version && value.evaluatedAt > existing.evaluatedAt)
      ) {
        merged.set(id, value);
      }
    }
  }

  return {
    identifierType: mergedIdentifierType,
    identifierValue: mergedIdentifierValue,
    attributes: merged,
    version: maxVersion,
    updatedAt: latestUpdatedAt === "" ? now : latestUpdatedAt,
  };
}
