import { describe, expect, it } from "vitest";
import {
  applyAttributeUpdate,
  createEmptyComputedAttribute,
  type ComputedAttribute,
} from "./computed-attribute";
import { dependentsOf, topologicalOrder, type AttributeDependency } from "./attribute-dependency";

/**
 * Property-style tests, same hand-rolled seeded-PRNG shape `customer-profile.property.test.ts`
 * already establishes for this package (no property-testing library is a workspace dependency).
 */

const IDENTIFIER = { type: "customer_id" as const, value: "cust-prop" };
const ATTRIBUTE_IDS = ["is_vip", "tier", "churn_risk", "clv_band", "engagement"] as const;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUpdateSequence(rng: () => number, count: number) {
  let cursorMs = Date.parse("2026-07-21T00:00:00.000Z");
  const updates: {
    attribute: string;
    evaluatedAt: string;
    value: boolean;
    definitionVersion: number;
  }[] = [];
  for (let i = 0; i < count; i += 1) {
    cursorMs += Math.floor(rng() * 5000); // strictly non-decreasing wall clock
    updates.push({
      attribute: ATTRIBUTE_IDS[Math.floor(rng() * ATTRIBUTE_IDS.length)] as string,
      evaluatedAt: new Date(cursorMs).toISOString(),
      value: rng() < 0.5,
      definitionVersion: 1,
    });
  }
  return updates;
}

describe("ComputedAttribute domain — property tests", () => {
  it("attribute.version never decreases across any sequence of applied updates (50 random trials)", () => {
    for (let trial = 0; trial < 50; trial += 1) {
      const rng = mulberry32(trial + 1);
      let attribute: ComputedAttribute = createEmptyComputedAttribute(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      let previousVersion = 0;

      for (const update of randomUpdateSequence(rng, 30)) {
        const result = applyAttributeUpdate(attribute, update.attribute, {
          value: update.value,
          definitionId: update.attribute,
          definitionVersion: update.definitionVersion,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: update.evaluatedAt,
        });
        expect(result.attribute.version).toBeGreaterThanOrEqual(previousVersion);
        previousVersion = result.attribute.version;
        attribute = result.attribute;
      }
    }
  });

  it("applyAttributeUpdate never mutates its input attribute set, applied or not (40 random trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 1000);
      let attribute: ComputedAttribute = createEmptyComputedAttribute(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );

      for (const update of randomUpdateSequence(rng, 20)) {
        const beforeCount = attribute.attributes.size;
        const beforeVersion = attribute.version;
        const result = applyAttributeUpdate(attribute, update.attribute, {
          value: update.value,
          definitionId: update.attribute,
          definitionVersion: update.definitionVersion,
          matchedRuleIds: [],
          inputs: new Map(),
          evaluatedAt: update.evaluatedAt,
        });
        expect(attribute.attributes.size, `trial ${trial} mutated the input attribute count`).toBe(
          beforeCount,
        );
        expect(attribute.version, `trial ${trial} mutated the input version`).toBe(beforeVersion);
        attribute = result.attribute;
      }
    }
  });

  it("re-evaluating the exact same (value, definitionVersion) twice in a row is always a no-op (30 random trials)", () => {
    for (let trial = 0; trial < 30; trial += 1) {
      const rng = mulberry32(trial + 2000);
      const attribute: ComputedAttribute = createEmptyComputedAttribute(
        IDENTIFIER.type,
        IDENTIFIER.value,
        "2026-07-21T00:00:00.000Z",
      );
      const update = randomUpdateSequence(rng, 1)[0]!;

      const first = applyAttributeUpdate(attribute, update.attribute, {
        value: update.value,
        definitionId: update.attribute,
        definitionVersion: update.definitionVersion,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: update.evaluatedAt,
      });
      const second = applyAttributeUpdate(first.attribute, update.attribute, {
        value: update.value,
        definitionId: update.attribute,
        definitionVersion: update.definitionVersion,
        matchedRuleIds: [],
        inputs: new Map(),
        // A later timestamp, but same value/definitionVersion — still expected to be a no-op.
        evaluatedAt: new Date(Date.parse(update.evaluatedAt) + 60_000).toISOString(),
      });
      expect(second.applied).toBe(false);
      expect(second.attribute).toBe(first.attribute);
    }
  });

  it("topologicalOrder over a random acyclic forest always fully orders every node (40 random trials)", () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rng = mulberry32(trial + 3000);
      const nodeCount = 5 + Math.floor(rng() * 10);
      const names = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
      // Every edge points strictly from a higher-indexed node to a lower-indexed one — acyclic by
      // construction, regardless of which random subset of edges is chosen.
      const edges: AttributeDependency[] = [];
      for (let i = 1; i < nodeCount; i += 1) {
        if (rng() < 0.6) {
          const target = Math.floor(rng() * i);
          edges.push({ attribute: names[i]!, dependsOn: names[target]! });
        }
      }

      const result = topologicalOrder(names, edges);
      expect(result.ok, `trial ${trial} unexpectedly found a cycle in an acyclic forest`).toBe(
        true,
      );
      if (!result.ok) continue;
      expect(new Set(result.order)).toEqual(new Set(names));

      const position = new Map(result.order.map((name, index) => [name, index]));
      for (const edge of edges) {
        expect(
          position.get(edge.dependsOn)!,
          `trial ${trial}: ${edge.dependsOn} must precede ${edge.attribute}`,
        ).toBeLessThan(position.get(edge.attribute)!);
      }

      // dependentsOf's closure, filtered against this valid order, must itself preserve every edge's
      // relative ordering constraint — the property `RecalculateComputedAttributes` depends on.
      const seed = [names[0]!];
      const closure = dependentsOf(seed, edges);
      const scoped = result.order.filter((name) => closure.has(name));
      for (const edge of edges) {
        if (closure.has(edge.attribute) && closure.has(edge.dependsOn)) {
          expect(scoped.indexOf(edge.dependsOn)).toBeLessThan(scoped.indexOf(edge.attribute));
        }
      }
    }
  });
});
