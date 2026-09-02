import type { ComputedAttributeValue } from "./computed-attribute-value";
import type { ComputedAttribute } from "./computed-attribute";

/** Why a snapshot was captured — same "kind describes provenance" shape `ProfileSnapshotReason` /
 * `IdentityTimelineEntry` already establish, and the same three reasons `ProfileSnapshotReason`
 * itself uses (`created`/`updated`/`rebuilt`), mirroring `AttributeCreated`/`AttributeUpdated`/
 * `AttributeRebuilt`'s own three-way split exactly. Computed attributes have no merge/split concept
 * of their own — an attribute belongs to exactly one identifier; cross-identifier unification, if
 * ever needed, is `GetComputedAttributes`' read-time concern via `ResolveIdentity`, never a
 * write-time one here — same split `CustomerProfile` vs. `mergeProfiles` already makes. */
export type AttributeSnapshotReason = "created" | "updated" | "rebuilt";

/**
 * An immutable, full capture of a {@link ComputedAttribute}'s attributes at one version — the
 * durable, append-only ledger entry (`AttributeHistoryStore`). Never edited or replaced; a later
 * change is always a new snapshot with a higher `version`. Full capture (not diff-only), same
 * accepted tradeoff `ProfileSnapshot` documents: rebuild is then just "read the latest snapshot",
 * at the cost of storing the whole attribute set on every change.
 */
export interface AttributeSnapshot {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly version: number;
  readonly attributes: ReadonlyMap<string, ComputedAttributeValue>;
  readonly capturedAt: string;
  readonly reason: AttributeSnapshotReason;
}

export function toSnapshot(
  attribute: ComputedAttribute,
  reason: AttributeSnapshotReason,
  capturedAt: string,
): AttributeSnapshot {
  return {
    identifierType: attribute.identifierType,
    identifierValue: attribute.identifierValue,
    version: attribute.version,
    attributes: attribute.attributes,
    capturedAt,
    reason,
  };
}

/** Reconstructs the current attribute-set view from the latest snapshot — the whole of "rebuild":
 * each snapshot already carries the full attribute set, so recovery never needs to fold history. */
export function fromSnapshot(snapshot: AttributeSnapshot): ComputedAttribute {
  return {
    identifierType: snapshot.identifierType,
    identifierValue: snapshot.identifierValue,
    attributes: snapshot.attributes,
    version: snapshot.version,
    updatedAt: snapshot.capturedAt,
  };
}
