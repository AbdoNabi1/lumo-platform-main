import { describe, expect, it } from "vitest";
import {
  applyAttributeUpdate,
  createEmptyComputedAttribute,
  type ComputedAttribute,
} from "./computed-attribute";

const IDENTIFIER = { type: "customer_id" as const, value: "cust-1" };

function update(overrides: Partial<Parameters<typeof applyAttributeUpdate>[2]> = {}) {
  return {
    value: true,
    definitionId: "is_vip",
    definitionVersion: 1,
    matchedRuleIds: ["rule-1"],
    inputs: new Map<string, boolean | string | number | null>(),
    evaluatedAt: "2026-07-21T00:00:01.000Z",
    ...overrides,
  };
}

describe("ComputedAttribute domain — applyAttributeUpdate", () => {
  it("applies the first value ever evaluated for an attribute", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const result = applyAttributeUpdate(empty, "is_vip", update());

    expect(result.applied).toBe(true);
    expect(result.attribute.attributes.get("is_vip")?.value).toBe(true);
    expect(result.attribute.attributes.get("is_vip")?.version).toBe(1);
    expect(result.attribute.version).toBe(1);
  });

  it("is a no-op when the same value is re-evaluated by the same definition version", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const first = applyAttributeUpdate(empty, "is_vip", update()).attribute;
    const second = applyAttributeUpdate(
      first,
      "is_vip",
      update({ evaluatedAt: "2026-07-21T00:05:00.000Z" }),
    );

    expect(second.applied).toBe(false);
    expect(second.attribute).toBe(first); // returned unchanged, same reference
  });

  it("applies when the value changes", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const first = applyAttributeUpdate(empty, "is_vip", update()).attribute;
    const second = applyAttributeUpdate(first, "is_vip", update({ value: false }));

    expect(second.applied).toBe(true);
    expect(second.attribute.attributes.get("is_vip")?.value).toBe(false);
    expect(second.attribute.attributes.get("is_vip")?.version).toBe(2);
    expect(second.attribute.version).toBe(2);
  });

  it("applies when the definition version changes, even if the resulting value coincides", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const first = applyAttributeUpdate(empty, "is_vip", update()).attribute;
    const second = applyAttributeUpdate(first, "is_vip", update({ definitionVersion: 2 }));

    expect(second.applied).toBe(true);
    expect(second.attribute.attributes.get("is_vip")?.definitionVersion).toBe(2);
  });

  it("never mutates its input attribute set, applied or not", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const before: ComputedAttribute = empty;
    applyAttributeUpdate(before, "is_vip", update());
    expect(before.attributes.size).toBe(0);
    expect(before.version).toBe(0);
  });

  it("tracks each attribute independently — updating one does not disturb another", () => {
    const empty = createEmptyComputedAttribute(IDENTIFIER.type, IDENTIFIER.value, "t0");
    const withVip = applyAttributeUpdate(empty, "is_vip", update()).attribute;
    const withTier = applyAttributeUpdate(
      withVip,
      "tier",
      update({ value: "gold", definitionId: "tier" }),
    ).attribute;

    expect(withTier.attributes.get("is_vip")?.value).toBe(true);
    expect(withTier.attributes.get("tier")?.value).toBe("gold");
    expect(withTier.version).toBe(2);
  });
});
