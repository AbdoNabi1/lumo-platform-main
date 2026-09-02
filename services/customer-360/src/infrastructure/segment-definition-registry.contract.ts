import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ConcurrencyError } from "@platform/utils";
import {
  INITIAL_SEGMENT_DEFINITION_VERSION,
  type SegmentDefinition,
} from "../ports/segment-definition";
import type { SegmentDefinitionRegistry } from "../ports/segment-definition-registry";

function ruleSet(): RuleSet<boolean> {
  return {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [{ id: "high-value-rule", priority: 1, when: Expr.literal(true), then: true }],
    fallback: false,
  };
}

function definition(overrides: Partial<SegmentDefinition> = {}): SegmentDefinition {
  return {
    id: "high_value",
    name: "High value",
    version: 1,
    ruleSet: ruleSet(),
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Repository parity contract for `SegmentDefinitionRegistry` — a genuinely new contract relative to
 * Phase 6.4 (`AttributeDefinitionRegistry` is read-only and has none), because this registry has a
 * real `save`/`delete` CAS lifecycle (`SEGMENTATION_MODEL.md` §2/§3). Call once per adapter with a
 * fresh registry factory.
 */
export function runSegmentDefinitionRegistryContractTests(
  adapterName: string,
  makeRegistry: () => SegmentDefinitionRegistry,
): void {
  describe(`SegmentDefinitionRegistry contract — ${adapterName}`, () => {
    it("list/getById are empty for a fresh registry", async () => {
      const registry = makeRegistry();
      expect(await registry.list()).toEqual([]);
      expect(await registry.getById("high_value")).toBeNull();
    });

    it("save with expectedVersion=INITIAL creates a new definition", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);

      const loaded = await registry.getById("high_value");
      expect(loaded?.name).toBe("High value");
      expect(loaded?.version).toBe(1);
    });

    it("save with a matching expectedVersion updates an existing definition", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);

      await registry.save(definition({ name: "High value (updated)", version: 2 }), 1);
      const loaded = await registry.getById("high_value");
      expect(loaded?.name).toBe("High value (updated)");
      expect(loaded?.version).toBe(2);
    });

    it("save with a stale expectedVersion rejects with ConcurrencyError and never applies the write", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);

      await expect(
        registry.save(definition({ name: "Stale write", version: 2 }), 5),
      ).rejects.toBeInstanceOf(ConcurrencyError);

      const loaded = await registry.getById("high_value");
      expect(loaded?.name).toBe("High value");
      expect(loaded?.version).toBe(1);
    });

    it("save with expectedVersion omitted unconditionally upserts", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);
      await registry.save(definition({ name: "Forced overwrite", version: 9 }));

      const loaded = await registry.getById("high_value");
      expect(loaded?.name).toBe("Forced overwrite");
      expect(loaded?.version).toBe(9);
    });

    it("delete with a matching expectedVersion removes the definition", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);

      await registry.delete("high_value", 1);
      expect(await registry.getById("high_value")).toBeNull();
      expect(await registry.list()).toEqual([]);
    });

    it("delete with a stale expectedVersion rejects with ConcurrencyError and never deletes", async () => {
      const registry = makeRegistry();
      await registry.save(definition(), INITIAL_SEGMENT_DEFINITION_VERSION);

      await expect(registry.delete("high_value", 5)).rejects.toBeInstanceOf(ConcurrencyError);
      expect(await registry.getById("high_value")).not.toBeNull();
    });

    it("delete of a non-existent id rejects with ConcurrencyError", async () => {
      const registry = makeRegistry();
      await expect(registry.delete("does_not_exist", 1)).rejects.toBeInstanceOf(ConcurrencyError);
    });

    it("list reports every saved definition exactly once", async () => {
      const registry = makeRegistry();
      await registry.save(definition({ id: "high_value" }), INITIAL_SEGMENT_DEFINITION_VERSION);
      await registry.save(
        definition({ id: "churn_risk", name: "Churn risk" }),
        INITIAL_SEGMENT_DEFINITION_VERSION,
      );
      // Re-saving the first must not duplicate it in the listing.
      await registry.save(definition({ id: "high_value", name: "High value v2", version: 2 }), 1);

      const all = await registry.list();
      expect(all.map((d) => d.id).sort()).toEqual(["churn_risk", "high_value"]);
    });
  });
}
