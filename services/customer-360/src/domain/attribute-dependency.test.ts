import { describe, expect, it } from "vitest";
import { dependentsOf, topologicalOrder, type AttributeDependency } from "./attribute-dependency";

describe("attribute-dependency — topologicalOrder", () => {
  it("orders independent attributes in their own declaration order (no edges)", () => {
    const result = topologicalOrder(["c", "a", "b"], []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.order).toEqual(["c", "a", "b"]);
  });

  it("orders a simple chain: a depends on b depends on c", () => {
    const edges: AttributeDependency[] = [
      { attribute: "a", dependsOn: "b" },
      { attribute: "b", dependsOn: "c" },
    ];
    const result = topologicalOrder(["a", "b", "c"], edges);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.order.indexOf("c")).toBeLessThan(result.order.indexOf("b"));
    expect(result.order.indexOf("b")).toBeLessThan(result.order.indexOf("a"));
  });

  it("orders a diamond: d depends on b and c, both depend on a", () => {
    const edges: AttributeDependency[] = [
      { attribute: "b", dependsOn: "a" },
      { attribute: "c", dependsOn: "a" },
      { attribute: "d", dependsOn: "b" },
      { attribute: "d", dependsOn: "c" },
    ];
    const result = topologicalOrder(["a", "b", "c", "d"], edges);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const index = (name: string) => result.order.indexOf(name);
    expect(index("a")).toBeLessThan(index("b"));
    expect(index("a")).toBeLessThan(index("c"));
    expect(index("b")).toBeLessThan(index("d"));
    expect(index("c")).toBeLessThan(index("d"));
  });

  it("detects a direct two-node cycle and names both nodes in the returned cycle", () => {
    const edges: AttributeDependency[] = [
      { attribute: "a", dependsOn: "b" },
      { attribute: "b", dependsOn: "a" },
    ];
    const result = topologicalOrder(["a", "b"], edges);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("cycle");
    expect(result.error.cycle).toEqual(expect.arrayContaining(["a", "b"]));
    // First and last entries of the cycle path are the same node, closing the loop.
    expect(result.error.cycle[0]).toBe(result.error.cycle[result.error.cycle.length - 1]);
  });

  it("detects a longer cycle (a -> b -> c -> a) even with unrelated acyclic nodes present", () => {
    const edges: AttributeDependency[] = [
      { attribute: "a", dependsOn: "b" },
      { attribute: "b", dependsOn: "c" },
      { attribute: "c", dependsOn: "a" },
      { attribute: "d", dependsOn: "b" }, // acyclic node hanging off the cyclic component
    ];
    const result = topologicalOrder(["a", "b", "c", "d"], edges);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(new Set(result.error.cycle)).toEqual(new Set(["a", "b", "c"]));
  });

  it("a self-dependency is its own cycle", () => {
    const result = topologicalOrder(["a"], [{ attribute: "a", dependsOn: "a" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.cycle).toEqual(["a", "a"]);
  });

  it("is deterministic: the same input always yields the same order", () => {
    const edges: AttributeDependency[] = [
      { attribute: "clv_tier", dependsOn: "lifetime_value" },
      { attribute: "is_vip", dependsOn: "clv_tier" },
      { attribute: "is_vip", dependsOn: "loyalty_tier" },
    ];
    const names = ["is_vip", "clv_tier", "lifetime_value", "loyalty_tier"];
    const first = topologicalOrder(names, edges);
    const second = topologicalOrder(names, edges);
    expect(first).toEqual(second);
  });
});

describe("attribute-dependency — dependentsOf", () => {
  const edges: AttributeDependency[] = [
    { attribute: "b", dependsOn: "a" },
    { attribute: "c", dependsOn: "b" },
    { attribute: "d", dependsOn: "c" },
    { attribute: "unrelated", dependsOn: "z" },
  ];

  it("includes the changed attribute itself and every transitive dependent", () => {
    const closure = dependentsOf(["a"], edges);
    expect(closure).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("never includes an attribute with no path from any changed attribute", () => {
    const closure = dependentsOf(["a"], edges);
    expect(closure.has("unrelated")).toBe(false);
    expect(closure.has("z")).toBe(false);
  });

  it("a leaf attribute's closure is just itself when nothing depends on it", () => {
    const closure = dependentsOf(["d"], edges);
    expect(closure).toEqual(new Set(["d"]));
  });

  it("unions closures across multiple seeds", () => {
    const closure = dependentsOf(["a", "z"], edges);
    expect(closure).toEqual(new Set(["a", "b", "c", "d", "z", "unrelated"]));
  });

  it("a filtered full topological order restricted to the closure is itself a valid sub-order", () => {
    const names = ["a", "b", "c", "d", "unrelated", "z"];
    const ordered = topologicalOrder(names, edges);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) throw new Error("unreachable");

    const closure = dependentsOf(["a"], edges);
    const scoped = ordered.order.filter((name) => closure.has(name));
    expect(new Set(scoped)).toEqual(closure);
    expect(scoped.indexOf("a")).toBeLessThan(scoped.indexOf("b"));
    expect(scoped.indexOf("b")).toBeLessThan(scoped.indexOf("c"));
    expect(scoped.indexOf("c")).toBeLessThan(scoped.indexOf("d"));
  });
});
