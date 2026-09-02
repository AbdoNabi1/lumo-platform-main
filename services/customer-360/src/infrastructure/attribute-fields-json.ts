import type { Prisma } from "@platform/db";
import type { ComputedAttributeValue } from "../domain/computed-attribute-value";

/**
 * `ReadonlyMap<string, ComputedAttributeValue>` ↔ plain-object JSON, shared by both Prisma adapters
 * — exactly `profile-fields-json.ts`'s helper, mirrored for the Computed Attributes ledger/cache. A
 * `Map`'s entries (including each value's own nested `inputs: ReadonlyMap`) round-trip losslessly
 * through `Object.fromEntries` because every key involved is always a plain string.
 */
function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function attributeValueToJson(value: ComputedAttributeValue): unknown {
  return { ...value, inputs: Object.fromEntries(value.inputs) };
}

function attributeValueFromJson(json: unknown): ComputedAttributeValue {
  const raw = json as Omit<ComputedAttributeValue, "inputs"> & { inputs: Record<string, unknown> };
  return {
    ...raw,
    inputs: new Map(Object.entries(raw.inputs)) as ComputedAttributeValue["inputs"],
  };
}

export function attributesToJson(
  attributes: ReadonlyMap<string, ComputedAttributeValue>,
): Prisma.InputJsonValue {
  const plain: Record<string, unknown> = {};
  for (const [id, value] of attributes) plain[id] = attributeValueToJson(value);
  return asInputJson(plain);
}

export function jsonToAttributes(json: unknown): Map<string, ComputedAttributeValue> {
  if (json === null || typeof json !== "object") return new Map();
  const entries = Object.entries(json as Record<string, unknown>).map(
    ([id, value]) => [id, attributeValueFromJson(value)] as const,
  );
  return new Map(entries);
}
