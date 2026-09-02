import { describe, expect, it } from "vitest";
import { CapabilityGraph } from "./capability-graph";

describe("CapabilityGraph (P1.1.1 §3)", () => {
  const graph = new CapabilityGraph([
    { key: "a", dependsOn: ["b", "c"] },
    { key: "b", dependsOn: ["d"] },
    { key: "c", dependsOn: ["d"] },
    { key: "d", dependsOn: [] },
  ]);

  it("returns direct and transitive dependencies deterministically (sorted)", () => {
    expect(graph.dependenciesOf("a")).toEqual(["b", "c"]);
    expect(graph.transitiveDependencies("a")).toEqual(["b", "c", "d"]);
    expect(graph.transitiveDependencies("d")).toEqual([]);
  });

  it("supports reverse lookup and impact analysis", () => {
    expect(graph.dependents("d")).toEqual(["b", "c"]);
    expect(graph.impactOf("d")).toEqual(["a", "b", "c"]);
  });

  it("detects circular dependencies", () => {
    expect(graph.hasCycle()).toBe(false);
    const cyclic = new CapabilityGraph([
      { key: "x", dependsOn: ["y"] },
      { key: "y", dependsOn: ["z"] },
      { key: "z", dependsOn: ["x"] },
    ]);
    expect(cyclic.hasCycle()).toBe(true);
    expect(cyclic.detectCycles().length).toBeGreaterThan(0);
  });

  it("validates compatibility against available capabilities", () => {
    const gaps = graph.validateAgainst(["a", "b", "c"]); // d missing
    expect(gaps.map((g) => g.key)).toContain("b");
    expect(graph.validateAgainst(["a", "b", "c", "d"])).toEqual([]);
  });

  it("computes a deterministic upgrade path or null when unreachable", () => {
    expect(graph.upgradePath("a", "d")).toEqual(["a", "b", "d"]);
    expect(graph.upgradePath("d", "a")).toBeNull();
  });

  it("builds from feature dependencies + compatibility requires", () => {
    const g = CapabilityGraph.fromFeatures([
      {
        key: "ai.copy",
        dependencies: [{ featureKey: "ai.tokens" }],
        requires: ["billing.metered"],
      },
      { key: "ai.tokens", dependencies: [], requires: [] },
      { key: "billing.metered", dependencies: [], requires: [] },
    ]);
    expect(g.transitiveDependencies("ai.copy")).toEqual(["ai.tokens", "billing.metered"]);
  });
});
