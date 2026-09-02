import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";
import { InMemoryAttributeDefinitionRegistry } from "./in-memory-attribute-definition-registry";

function ruleSet(id: string): RuleSet<AttributeValue> {
  return {
    id,
    version: 1,
    mode: "first_match",
    rules: [{ id: `${id}-rule`, priority: 1, when: Expr.literal(true), then: true }],
  };
}

describe("InMemoryAttributeDefinitionRegistry", () => {
  it("is empty by default", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry();
    expect(await registry.list()).toEqual([]);
    expect(await registry.getById("is_vip")).toBeNull();
  });

  it("lists and looks up seeded definitions", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([
      { id: "is_vip", version: 1, ruleSet: ruleSet("is_vip"), dependencies: [] },
      { id: "tier", version: 1, ruleSet: ruleSet("tier"), dependencies: ["is_vip"] },
    ]);

    const all = await registry.list();
    expect(all.map((d) => d.id).sort()).toEqual(["is_vip", "tier"]);

    const tier = await registry.getById("tier");
    expect(tier?.dependencies).toEqual(["is_vip"]);
  });
});
