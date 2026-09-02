import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import type { AttributeDependency } from "../domain/attribute-dependency";
import type { AttributeValue } from "../domain/attribute-value";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";

/**
 * Test-only synthetic graph generator for Phase 6.4.1 hardening — shared by the dependency-graph and
 * incremental-recompute stress tests (`domain/attribute-dependency.stress.test.ts`,
 * `application/recalculate-computed-attributes.stress.test.ts`) and the benchmark suite
 * (`domain/attribute-dependency.bench.ts`, `application/computed-attributes.bench.ts`), so graph
 * generation logic exists exactly once rather than being re-derived per file (Task 10's own
 * zero-duplication goal applied to this sprint's own new code).
 */

function nodeName(i: number): string {
  return `attr_${i}`;
}

export interface SyntheticGraph {
  readonly names: readonly string[];
  readonly edges: readonly AttributeDependency[];
}

/**
 * Deterministic PRNG (mulberry32) — no new dependency pulled in for one seeded-random generator; the
 * point is reproducibility across runs, not statistical quality.
 */
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

/**
 * A single linear chain: `attr_1` depends on `attr_0`, `attr_2` depends on `attr_1`, etc. — the
 * worst case for incremental-recompute closure size, since changing `attr_0` transitively affects
 * every other node in the graph.
 */
export function generateChain(size: number): SyntheticGraph {
  const names = Array.from({ length: size }, (_, i) => nodeName(i));
  const edges: AttributeDependency[] = [];
  for (let i = 1; i < size; i++) {
    edges.push({ attribute: nodeName(i), dependsOn: nodeName(i - 1) });
  }
  return { names, edges };
}

/**
 * A layered DAG: node `i` (i > 0) depends on 1-3 earlier nodes, chosen via a seeded PRNG so the same
 * `size`/`seed` always yields the same graph. More representative of a real attribute registry than
 * one long chain — most nodes have a handful of unrelated ancestors, not a single deep spine.
 */
export function generateLayeredDag(size: number, seed = 42): SyntheticGraph {
  const rng = mulberry32(seed);
  const names = Array.from({ length: size }, (_, i) => nodeName(i));
  const edges: AttributeDependency[] = [];
  for (let i = 1; i < size; i++) {
    const fanIn = 1 + Math.floor(rng() * Math.min(3, i));
    const chosen = new Set<number>();
    while (chosen.size < fanIn) {
      chosen.add(Math.floor(rng() * i));
    }
    for (const dep of chosen) {
      edges.push({ attribute: nodeName(i), dependsOn: nodeName(dep) });
    }
  }
  return { names, edges };
}

/**
 * Always-matches rule set — sufficient wherever what's under test is which nodes a graph/recompute
 * operation *includes*, not what value a rule produces (`RecalculateComputedAttributes`'s scoping
 * decision is purely topological — see `application/recalculate-computed-attributes.use-case.ts:99-103`
 * — so a trivial rule set exercises the real code path being audited without needing profile/journey
 * fixtures per node).
 */
function trivialRuleSet(id: string): RuleSet<AttributeValue> {
  return {
    id,
    version: 1,
    mode: "first_match",
    rules: [{ id: `${id}-rule`, priority: 1, when: Expr.literal(true), then: true }],
  };
}

/**
 * Builds `ComputedAttributeDefinition`s from a `SyntheticGraph`'s edges, grouping dependencies per
 * attribute — the shape `AttributeDefinitionRegistry`/`RecalculateComputedAttributes`/
 * `EvaluateAttributeGraph` consume.
 */
export function toDefinitions(graph: SyntheticGraph): ComputedAttributeDefinition[] {
  const dependenciesByAttribute = new Map<string, string[]>();
  for (const name of graph.names) dependenciesByAttribute.set(name, []);
  for (const edge of graph.edges) {
    dependenciesByAttribute.get(edge.attribute)!.push(edge.dependsOn);
  }
  return graph.names.map((id) => ({
    id,
    version: 1,
    ruleSet: trivialRuleSet(id),
    dependencies: dependenciesByAttribute.get(id) ?? [],
  }));
}
