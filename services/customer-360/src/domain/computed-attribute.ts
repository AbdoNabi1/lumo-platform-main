import type { AttributeValue } from "./attribute-value";
import {
  createComputedAttributeValue,
  type ComputedAttributeValue,
} from "./computed-attribute-value";
import { INITIAL_ATTRIBUTE_VERSION, type AttributeVersion } from "./attribute-version";

/**
 * The materialized set of computed attributes for one identifier — a projection, not a source of
 * truth, exactly mirroring `CustomerProfile`'s own contract one level up: `CustomerProfile` holds
 * facts *asserted by other contexts*; `ComputedAttribute` holds facts *derived from* those (plus
 * other computed attributes) by a rule set this engine owns and evaluates, but still never asserts
 * as if it were a source system.
 *
 * `identifierType`/`identifierValue` are plain strings for the same reason `CustomerProfile`'s are
 * (see its own module doc) — `domain/` never references `@platform/tracking`'s `IdentifierType` or
 * this package's own `IdentifierRef` port type directly.
 */
export interface ComputedAttribute {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly attributes: ReadonlyMap<string, ComputedAttributeValue>;
  /** Bumped on every applied attribute change — distinct from (and always >= the max of) each
   * attribute's own `version`, same relationship `CustomerProfile.version` has to its fields'. */
  readonly version: AttributeVersion;
  readonly updatedAt: string;
}

export function createEmptyComputedAttribute(
  identifierType: string,
  identifierValue: string,
  now: string,
): ComputedAttribute {
  return {
    identifierType,
    identifierValue,
    attributes: new Map(),
    version: INITIAL_ATTRIBUTE_VERSION,
    updatedAt: now,
  };
}

export interface AttributeUpdateInput {
  readonly value: AttributeValue;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly matchedRuleIds: readonly string[];
  readonly inputs: ReadonlyMap<string, AttributeValue>;
  readonly evaluatedAt: string;
}

export interface AttributeUpdateResult {
  readonly attribute: ComputedAttribute;
  /**
   * `false` when the freshly evaluated value is identical to what is already on file for this
   * attribute (same `value` and the same `definitionVersion` that produced it) — a normal, expected
   * outcome of re-evaluating a deterministic rule set against unchanged inputs, never an error.
   *
   * This is not merely cosmetic: it is the mechanism incremental evaluation depends on
   * (`RecalculateComputedAttributes`) — an attribute's dependents are only worth recomputing when
   * the attribute's own value actually moved, and `applied` is exactly that signal, propagated one
   * hop at a time. Without it, "recompute only dependents" would degrade into "recompute the whole
   * transitive closure on every evaluation", the very blowup incremental evaluation exists to avoid.
   */
  readonly applied: boolean;
}

/**
 * Applies one attribute's freshly evaluated value, append-only: never mutates `attribute`, always
 * returns a new value.
 *
 * **No-op guard**: if the attribute already holds the same `value` produced by the same
 * `definitionVersion`, the update is rejected (`applied: false`, `attribute` returned unchanged).
 * Unlike `applyFieldUpdate`'s freshness guard (which compares *timestamps* to reject stale,
 * out-of-order deliveries), this compares *values* to reject no-op re-evaluations — a different
 * problem with the same "don't record a change that isn't one" shape: computed attributes are
 * recomputed deterministically and idempotently, often far more often than a fact actually changes
 * (every dependency recalculation re-evaluates every dependent, whether or not its inputs moved), so
 * without this guard the append-only history would fill with identical snapshots and — far more
 * importantly — every recompute would look like a change worth cascading to dependents, which is
 * exactly the "recompute everyone" behavior the brief's Incremental Evaluation requirement forbids.
 *
 * A value produced by a *newer* `definitionVersion` is always applied, even if the resulting value
 * happens to be unchanged — the rule set itself changed, which is a fact worth recording even when
 * its output coincides with the previous one.
 */
export function applyAttributeUpdate(
  attribute: ComputedAttribute,
  name: string,
  update: AttributeUpdateInput,
): AttributeUpdateResult {
  const existing = attribute.attributes.get(name);
  if (
    existing !== undefined &&
    existing.definitionVersion === update.definitionVersion &&
    existing.value === update.value
  ) {
    return { attribute, applied: false };
  }

  const nextAttributeVersion = existing === undefined ? 1 : existing.version + 1;
  const nextValue = createComputedAttributeValue(
    update.value,
    update.definitionId,
    update.definitionVersion,
    update.matchedRuleIds,
    update.inputs,
    update.evaluatedAt,
    nextAttributeVersion,
  );

  const attributes = new Map(attribute.attributes);
  attributes.set(name, nextValue);

  return {
    applied: true,
    attribute: {
      identifierType: attribute.identifierType,
      identifierValue: attribute.identifierValue,
      attributes,
      version: attribute.version + 1,
      updatedAt:
        update.evaluatedAt > attribute.updatedAt ? update.evaluatedAt : attribute.updatedAt,
    },
  };
}
