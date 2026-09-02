import { describe, expect, it } from "vitest";
import { dependentsOf, topologicalOrder, type AttributeDependency } from "./attribute-dependency";
import {
  generateChain,
  generateLayeredDag,
  type SyntheticGraph,
} from "../test-support/synthetic-attribute-graph";

/**
 * Phase 6.4.1 hardening — Task 1 (Dependency Graph Validation) and part of Task 7 (Large DAG
 * correctness at scale; timing/memory numbers live in `attribute-dependency.bench.ts` instead, this
 * file only guards against gross regressions).
 *
 * Ground truth this suite is written against (see `docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md`
 * for the full audit): `topologicalOrder` and `dependentsOf` are rebuilt from scratch on every call —
 * there is no cached graph, no memoized topological order, nothing to invalidate — by deliberate
 * design (`docs/platform/COMPUTED_ATTRIBUTES_MODEL.md:106-114`). This suite does not pretend
 * otherwise; it proves the two properties that actually matter given that design: **correctness**
 * (every dependency edge respected, no node dropped or duplicated) and **determinism** (identical
 * input always yields an identical result — Phase 6.4's explicit brief requirement) hold at scale,
 * for both a worst-case single chain and a more realistic multi-parent layered DAG.
 */

const SIZES = [100, 1000, 5000, 10000] as const;

function assertValidTopologicalOrder(graph: SyntheticGraph, order: readonly string[]): void {
  expect(new Set(order)).toEqual(new Set(graph.names));
  expect(order.length).toBe(graph.names.length);

  const position = new Map(order.map((name, index) => [name, index]));
  for (const edge of graph.edges) {
    expect(
      position.get(edge.dependsOn)!,
      `${edge.dependsOn} must be ordered before its dependent ${edge.attribute}`,
    ).toBeLessThan(position.get(edge.attribute)!);
  }
}

/** Independent ground truth for `dependentsOf`, deliberately not reusing its BFS — a plain forward
 * closure over the edge list, used only to cross-check the real implementation's output. */
function bruteForceDependents(
  seed: readonly string[],
  edges: readonly AttributeDependency[],
): Set<string> {
  const closure = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (closure.has(edge.dependsOn) && !closure.has(edge.attribute)) {
        closure.add(edge.attribute);
        grew = true;
      }
    }
  }
  return closure;
}

describe("attribute-dependency — large-graph correctness (Task 1)", () => {
  for (const size of SIZES) {
    it(`orders a ${size}-node chain correctly and deterministically`, () => {
      const graph = generateChain(size);
      const first = topologicalOrder(graph.names, graph.edges);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      assertValidTopologicalOrder(graph, first.order);

      const second = topologicalOrder(graph.names, graph.edges);
      expect(second).toEqual(first);
    });

    it(`orders a ${size}-node layered DAG correctly and deterministically`, () => {
      const graph = generateLayeredDag(size);
      const first = topologicalOrder(graph.names, graph.edges);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      assertValidTopologicalOrder(graph, first.order);

      const second = topologicalOrder(graph.names, graph.edges);
      expect(second).toEqual(first);
    });
  }

  it("a chain's root affects every downstream node — dependentsOf(root) is the whole chain", () => {
    const graph = generateChain(5000);
    const closure = dependentsOf([graph.names[0]!], graph.edges);
    expect(closure).toEqual(new Set(graph.names));
  });

  for (const size of SIZES) {
    it(`dependentsOf matches an independent brute-force closure on a ${size}-node layered DAG`, () => {
      const graph = generateLayeredDag(size);
      const seed = [graph.names[0]!];
      const closure = dependentsOf(seed, graph.edges);
      expect(closure).toEqual(bruteForceDependents(seed, graph.edges));
    });
  }

  it("a scoped topological order (full order filtered to a dependentsOf closure) still respects every edge, at 10000 nodes", () => {
    const graph = generateLayeredDag(10000);
    const full = topologicalOrder(graph.names, graph.edges);
    expect(full.ok).toBe(true);
    if (!full.ok) throw new Error("unreachable");

    const closure = dependentsOf([graph.names[0]!], graph.edges);
    const scoped = full.order.filter((name) => closure.has(name));
    const position = new Map(scoped.map((name, index) => [name, index]));
    for (const edge of graph.edges) {
      if (closure.has(edge.attribute) && closure.has(edge.dependsOn)) {
        expect(position.get(edge.dependsOn)!).toBeLessThan(position.get(edge.attribute)!);
      }
    }
  });

  it("regression guard: a 10000-node chain's topologicalOrder does not exhibit worse-than-linear blowup (rebuild-per-call is the documented design, not a bug — this only catches an accidental quadratic regression)", () => {
    const graph = generateChain(10000);
    const start = performance.now();
    const result = topologicalOrder(graph.names, graph.edges);
    const elapsedMs = performance.now() - start;
    expect(result.ok).toBe(true);
    // Generous bound: Kahn's algorithm is O(V+E); 10000 nodes should complete in low tens of ms even
    // on slow CI, not seconds. Real numbers are captured in attribute-dependency.bench.ts.
    expect(elapsedMs, `topologicalOrder over 10000 nodes took ${elapsedMs}ms`).toBeLessThan(500);
  });
});
