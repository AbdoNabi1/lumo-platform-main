import { describe, expect, it } from "vitest";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "./computed-attribute";
import { fromSnapshot, toSnapshot } from "./attribute-snapshot";

describe("attribute-snapshot — toSnapshot/fromSnapshot", () => {
  it("round-trips a computed attribute set through a snapshot losslessly", () => {
    const attribute = applyAttributeUpdate(
      createEmptyComputedAttribute("customer_id", "cust-1", "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: ["rule-1"],
        inputs: new Map([["profile.lifetime_value", 5000]]),
        evaluatedAt: "2026-07-21T00:00:01.000Z",
      },
    ).attribute;

    const snapshot = toSnapshot(attribute, "created", "2026-07-21T00:00:02.000Z");
    expect(snapshot.reason).toBe("created");
    expect(snapshot.capturedAt).toBe("2026-07-21T00:00:02.000Z");
    expect(snapshot.version).toBe(attribute.version);

    const rebuilt = fromSnapshot(snapshot);
    expect(rebuilt.identifierType).toBe(attribute.identifierType);
    expect(rebuilt.identifierValue).toBe(attribute.identifierValue);
    expect(rebuilt.version).toBe(attribute.version);
    expect(rebuilt.attributes.get("is_vip")).toEqual(attribute.attributes.get("is_vip"));
    // `updatedAt` on the rebuilt view reflects when the snapshot was captured, not the original
    // `evaluatedAt` — the same "rebuild recomputes, it does not assert a new fact" contract
    // `fromSnapshot` (Profile Engine) already establishes.
    expect(rebuilt.updatedAt).toBe(snapshot.capturedAt);
  });
});
