import type { Prisma } from "@platform/db";
import type { AttributeValue } from "../domain/attribute-value";

/**
 * `ReadonlyMap<string, AttributeValue>` ↔ plain-object JSON — the `SegmentMembership.inputs`/
 * `SegmentHistory.inputs` round-trip, simpler than `attribute-fields-json.ts`'s helper: a segment's
 * `inputs` is one flat scalar map per row, not a per-id map of nested explainability objects (there is
 * no per-segment analogue of `ComputedAttributeValue` — the explainability fields live directly on
 * `SegmentMembership` itself).
 */
function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function inputsToJson(inputs: ReadonlyMap<string, AttributeValue>): Prisma.InputJsonValue {
  return asInputJson(Object.fromEntries(inputs));
}

export function jsonToInputs(json: unknown): Map<string, AttributeValue> {
  if (json === null || typeof json !== "object") return new Map();
  return new Map(Object.entries(json as Record<string, AttributeValue>));
}

export function matchedRuleIdsToJson(matchedRuleIds: readonly string[]): Prisma.InputJsonValue {
  return asInputJson(matchedRuleIds);
}

export function jsonToMatchedRuleIds(json: unknown): readonly string[] {
  return Array.isArray(json) ? (json as readonly string[]) : [];
}
