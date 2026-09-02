import { describe, expect, it } from "vitest";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "./computed-attribute";
import { mergeComputedAttributes } from "./computed-attribute-views";

describe("computed-attribute-views — mergeComputedAttributes", () => {
  it("merges attributes from every cluster member, per-attribute highest version wins", () => {
    const memberA = applyAttributeUpdate(
      createEmptyComputedAttribute("visitor_id", "v1", "t0"),
      "is_vip",
      {
        value: false,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:01.000Z",
      },
    ).attribute;

    const memberB = applyAttributeUpdate(
      createEmptyComputedAttribute("customer_id", "cust-1", "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: ["rule-1"],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:02.000Z",
      },
    ).attribute;

    const merged = mergeComputedAttributes(
      [memberA, memberB],
      "customer_id",
      "cust-1",
      "2026-07-21T00:00:03.000Z",
    );
    // memberB's own attribute was applied second (its own local version is 1, tying memberA's own
    // local version of 1) — tie-broken by the later `evaluatedAt`, so memberB's `true` wins.
    expect(merged.attributes.get("is_vip")?.value).toBe(true);
  });

  it("prefers the strictly higher per-attribute version regardless of evaluatedAt", () => {
    let member = createEmptyComputedAttribute("visitor_id", "v1", "t0");
    member = applyAttributeUpdate(member, "tier", {
      value: "bronze",
      definitionId: "tier",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "2026-07-21T00:00:01.000Z",
    }).attribute;
    member = applyAttributeUpdate(member, "tier", {
      value: "gold",
      definitionId: "tier",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "2026-07-21T00:00:02.000Z",
    }).attribute; // tier is now version 2, value "gold"

    const stale = applyAttributeUpdate(
      createEmptyComputedAttribute("customer_id", "cust-1", "t0"),
      "tier",
      {
        value: "platinum",
        definitionId: "tier",
        definitionVersion: 1,
        matchedRuleIds: [],
        // A much later evaluatedAt but still only local version 1 — must lose to the higher version.
        evaluatedAt: "2026-07-25T00:00:00.000Z",
        inputs: new Map(),
      },
    ).attribute;

    const merged = mergeComputedAttributes(
      [member, stale],
      "customer_id",
      "cust-1",
      "2026-07-26T00:00:00.000Z",
    );
    expect(merged.attributes.get("tier")?.value).toBe("gold");
  });

  it("is idempotent under duplication: merging [x, x] equals merging [x]", () => {
    const member = applyAttributeUpdate(
      createEmptyComputedAttribute("visitor_id", "v1", "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "2026-07-21T00:00:01.000Z",
      },
    ).attribute;

    const once = mergeComputedAttributes([member], "customer_id", "cust-1", "now");
    const twice = mergeComputedAttributes([member, member], "customer_id", "cust-1", "now");
    expect(twice.attributes.get("is_vip")).toEqual(once.attributes.get("is_vip"));
    expect(twice.version).toBe(once.version);
  });

  it("the merged view's version is the max across inputs, never invented", () => {
    const a = applyAttributeUpdate(createEmptyComputedAttribute("visitor_id", "v1", "t0"), "x", {
      value: 1,
      definitionId: "x",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).attribute;
    let b = applyAttributeUpdate(createEmptyComputedAttribute("customer_id", "c1", "t0"), "y", {
      value: 1,
      definitionId: "y",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t1",
    }).attribute;
    b = applyAttributeUpdate(b, "z", {
      value: 1,
      definitionId: "z",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t2",
    }).attribute; // b.version === 2

    const merged = mergeComputedAttributes([a, b], "customer_id", "c1", "now");
    expect(merged.version).toBe(2);
  });
});
