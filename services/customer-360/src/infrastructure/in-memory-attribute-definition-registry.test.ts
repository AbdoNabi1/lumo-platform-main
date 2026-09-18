import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import type { AttributeValue } from "../domain/attribute-value";
import { InMemoryAttributeDefinitionRegistry } from "./in-memory-attribute-definition-registry";
import { TENANT_A, TENANT_B } from "../test-support/tenants";

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
    expect(await registry.list(TENANT_A)).toEqual([]);
    expect(await registry.getById("is_vip", TENANT_A)).toBeNull();
  });

  it("lists and looks up seeded definitions", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry({
      tenantId: TENANT_A,
      definitions: [
        { id: "is_vip", version: 1, ruleSet: ruleSet("is_vip"), dependencies: [] },
        { id: "tier", version: 1, ruleSet: ruleSet("tier"), dependencies: ["is_vip"] },
      ],
    });

    const all = await registry.list(TENANT_A);
    expect(all.map((d) => d.id).sort()).toEqual(["is_vip", "tier"]);

    const tier = await registry.getById("tier", TENANT_A);
    expect(tier?.dependencies).toEqual(["is_vip"]);
  });

  it("isolates tenants — definitions seeded for one tenant are invisible to another (ADR-0014)", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry({
      tenantId: TENANT_A,
      definitions: [{ id: "is_vip", version: 1, ruleSet: ruleSet("is_vip"), dependencies: [] }],
    });

    expect(await registry.list(TENANT_B)).toEqual([]);
    expect(await registry.getById("is_vip", TENANT_B)).toBeNull();
    expect(await registry.getById("is_vip", TENANT_A)).not.toBeNull();
  });
});
