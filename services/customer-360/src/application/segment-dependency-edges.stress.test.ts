import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { dependentsOf, type AttributeDependency } from "../domain/attribute-dependency";
import type { SegmentDefinition } from "../ports/segment-definition";
import { collectReferencedPaths, toSegmentDependencyEdges } from "./evaluate-all-segments.use-case";

/**
 * Stress test for the fact→segment edge-construction step (`collectReferencedPaths`/
 * `toSegmentDependencyEdges`) at scale — **not** a re-stress-test of `dependentsOf`/`topologicalOrder`
 * themselves, which are reused verbatim from Phase 6.4 and already proven at 5000/10000-node scale in
 * `domain/attribute-dependency.stress.test.ts` against the identical, unmodified functions
 * (`SEGMENTATION_MODEL.md` §5 — no second dependency-graph implementation exists here to re-test).
 * What's new and worth proving at scale is the translation from N segment definitions' rule sets into
 * the edge list those reused functions consume: every definition's referenced paths are collected
 * correctly, and the resulting fact→segment closure computed via `dependentsOf` matches an
 * independent, brute-force cross-check.
 */

const SIZES = [10, 100, 1000, 5000] as const;

function ruleSetOn(paths: readonly string[]): RuleSet<boolean> {
  return {
    id: "def",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "r1",
        priority: 1,
        when: Expr.and(...paths.map((path) => Expr.exists(path))),
        then: true,
      },
    ],
    fallback: false,
  };
}

/** Builds `size` definitions, each depending on exactly one fact path drawn from a small shared pool
 * (so several segments legitimately share a dependency, the realistic case `RecalculateMemberships`
 * must narrow correctly). */
function generateSegments(size: number): {
  definitions: SegmentDefinition[];
  factPaths: readonly string[];
} {
  const factPaths = Array.from(
    { length: Math.max(1, Math.floor(size / 20)) },
    (_, i) => `profile.field_${i}`,
  );
  const definitions = Array.from({ length: size }, (_, i) => {
    const path = factPaths[i % factPaths.length]!;
    return {
      id: `segment_${i}`,
      name: `segment_${i}`,
      version: 1,
      ruleSet: ruleSetOn([path]),
      createdAt: "t0",
      updatedAt: "t0",
    };
  });
  return { definitions, factPaths };
}

/** Independent ground truth, deliberately not reusing `dependentsOf`'s own BFS — a plain forward
 * closure over the edge list, mirrors `attribute-dependency.stress.test.ts`'s own
 * `bruteForceDependents` helper. */
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

describe("segment fact→segment edge construction — large-registry correctness", () => {
  for (const size of SIZES) {
    it(`builds correct edges for ${size} definitions and matches a brute-force dependents closure`, () => {
      const { definitions, factPaths } = generateSegments(size);
      const start = performance.now();
      const edges = toSegmentDependencyEdges(definitions);
      const elapsedMs = performance.now() - start;

      expect(edges.length).toBe(size); // one edge per definition (each references exactly one path)

      const changedPath = factPaths[0]!;
      const closure = dependentsOf([changedPath], edges);
      const expected = bruteForceDependents([changedPath], edges);
      expect(closure).toEqual(expected);

      // Every segment in the closure genuinely depends on the changed path; nothing outside it does.
      const affectedSegments = definitions.filter((d) => closure.has(d.id)).map((d) => d.id);
      const trulyDependent = edges
        .filter((e) => e.dependsOn === changedPath)
        .map((e) => e.attribute);
      expect(new Set(affectedSegments)).toEqual(new Set(trulyDependent));

      // Soft perf regression guard, same convention `attribute-dependency.stress.test.ts` uses.
      expect(
        elapsedMs,
        `edge construction for ${size} definitions took ${elapsedMs}ms`,
      ).toBeLessThan(500);
    });
  }

  it("collectReferencedPaths scales linearly with rule count and never drops a referenced path", () => {
    const paths = Array.from({ length: 2000 }, (_, i) => `attributes.attr_${i}`);
    const ruleSet: RuleSet<boolean> = {
      id: "big",
      version: 1,
      mode: "all_matches",
      rules: paths.map((path, i) => ({
        id: `r${i}`,
        priority: i,
        when: Expr.exists(path),
        then: true,
      })),
    };

    const start = performance.now();
    const collected = collectReferencedPaths(ruleSet);
    const elapsedMs = performance.now() - start;

    expect(collected.size).toBe(paths.length);
    for (const path of paths) expect(collected.has(path)).toBe(true);
    expect(elapsedMs).toBeLessThan(500);
  });
});
