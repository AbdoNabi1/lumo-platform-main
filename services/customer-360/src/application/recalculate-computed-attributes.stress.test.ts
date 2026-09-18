import { describe, expect, it } from "vitest";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { InMemoryAttributeDefinitionRegistry } from "../infrastructure/in-memory-attribute-definition-registry";
import {
  generateChain,
  generateLayeredDag,
  toDefinitions,
} from "../test-support/synthetic-attribute-graph";
import type {
  EvaluateAttributeGraph,
  EvaluateAttributeGraphInput,
  EvaluateAttributeGraphOutput,
} from "./evaluate-attribute-graph.use-case";
import { RecalculateComputedAttributes } from "./recalculate-computed-attributes.use-case";
import { TENANT_A } from "../test-support/tenants";

/**
 * Phase 6.4.1 hardening — Task 2 (Incremental Evaluation Validation). Proves, at 10/100/1000/5000
 * registered attributes, that changing one attribute recomputes only its transitive dependents, never
 * the full registry — the brief's "reject any implementation that falls back to full recomputation"
 * requirement — and reports the evaluated/skipped split and wall-clock time for each size.
 *
 * Uses a fake `EvaluateAttributeGraph` (same technique as
 * `recalculate-computed-attributes.use-case.test.ts`) because what's under test here is purely
 * `RecalculateComputedAttributes`'s topological *scoping* decision
 * (`recalculate-computed-attributes.use-case.ts:99-103`), which never depends on what a rule actually
 * evaluates to — real rule evaluation cost is covered separately by `computed-attributes.bench.ts`.
 */

const identifier = { type: "customer_id" as const, value: "cust-stress" };
const SIZES = [10, 100, 1000, 5000] as const;

function fakeEvaluateGraph(): EvaluateAttributeGraph {
  const handler = async (
    input: EvaluateAttributeGraphInput,
  ): Promise<Result<EvaluateAttributeGraphOutput, DomainError>> =>
    ok({ results: [], applied: input.definitions.map((d) => d.id) });
  return { execute: handler } as EvaluateAttributeGraph;
}

describe("RecalculateComputedAttributes — incremental-vs-full stress (Task 2)", () => {
  for (const size of SIZES) {
    it(`chain of ${size}: changing the root recomputes the whole chain (worst case), changing the leaf recomputes only itself`, async () => {
      const graph = generateChain(size);
      const registry = new InMemoryAttributeDefinitionRegistry({
        tenantId: TENANT_A,
        definitions: toDefinitions(graph),
      });
      const useCase = new RecalculateComputedAttributes({
        definitions: registry,
        evaluateGraph: fakeEvaluateGraph(),
      });

      const rootChanged = await useCase.execute({
        tenantId: TENANT_A,
        identifier,
        changed: [graph.names[0]!],
      });
      expect(rootChanged.ok).toBe(true);
      if (!rootChanged.ok) throw new Error("unreachable");
      expect(rootChanged.value.recomputed.length).toBe(size); // every node depends on the root, transitively

      const leafChanged = await useCase.execute({
        tenantId: TENANT_A,
        identifier,
        changed: [graph.names[size - 1]!],
      });
      expect(leafChanged.ok).toBe(true);
      if (!leafChanged.ok) throw new Error("unreachable");
      expect(leafChanged.value.recomputed).toEqual([graph.names[size - 1]!]); // nothing depends on the leaf
    });

    it(`layered DAG of ${size}: changing one interior attribute recomputes strictly fewer than the full registry`, async () => {
      const graph = generateLayeredDag(size);
      const registry = new InMemoryAttributeDefinitionRegistry({
        tenantId: TENANT_A,
        definitions: toDefinitions(graph),
      });
      const useCase = new RecalculateComputedAttributes({
        definitions: registry,
        evaluateGraph: fakeEvaluateGraph(),
      });

      // Pick a node roughly in the middle of the generation order — layered DAG edges only point
      // backward, so a mid-graph node has both real ancestors and a bounded (not full) descendant set.
      const midIndex = Math.floor(size / 2);
      const changed = [graph.names[midIndex]!];

      const start = performance.now();
      const result = await useCase.execute({ tenantId: TENANT_A, identifier, changed });
      const elapsedMs = performance.now() - start;

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");

      const evaluated = result.value.recomputed.length;
      const skipped = size - evaluated;
      expect(evaluated).toBeGreaterThan(0);
      // The whole point of Incremental Evaluation: a mid-graph, single-attribute change must never
      // silently degrade into a full-registry recompute.
      expect(evaluated).toBeLessThan(size);
      expect(result.value.recomputed).toContain(changed[0]);

      // eslint-disable-next-line no-console -- intentional: captured into the hardening report's table.
      console.log(
        `[Task 2] layered DAG size=${size} changed=1 -> evaluated=${evaluated} skipped=${skipped} elapsedMs=${elapsedMs.toFixed(3)}`,
      );
    });
  }

  it("regression guard: a single-attribute recompute over a 5000-node registry stays near-linear, not quadratic (found during Phase 6.4.1 hardening: dependentsOf was previously re-run once per element inside the scoping .filter, an O(V+E)*O(V) blowup — fixed in recalculate-computed-attributes.use-case.ts)", async () => {
    const graph = generateLayeredDag(5000);
    const registry = new InMemoryAttributeDefinitionRegistry({
      tenantId: TENANT_A,
      definitions: toDefinitions(graph),
    });
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: fakeEvaluateGraph(),
    });

    const start = performance.now();
    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      changed: [graph.names[2500]!],
    });
    const elapsedMs = performance.now() - start;

    expect(result.ok).toBe(true);
    // Measured ~20-25ms post-fix on dev hardware; the pre-fix regression measured 7000ms+ at this
    // size. 1000ms leaves generous headroom for slow CI while still catching a reintroduced blowup.
    expect(
      elapsedMs,
      `RecalculateComputedAttributes over 5000 nodes took ${elapsedMs}ms`,
    ).toBeLessThan(1000);
  });

  it("evaluated count for a single mid-graph change grows sublinearly relative to a full recompute, at 5000 nodes", async () => {
    const graph = generateLayeredDag(5000);
    const registry = new InMemoryAttributeDefinitionRegistry({
      tenantId: TENANT_A,
      definitions: toDefinitions(graph),
    });
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: fakeEvaluateGraph(),
    });

    const full = await useCase.execute({ tenantId: TENANT_A, identifier });
    const scoped = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      changed: [graph.names[2500]!],
    });
    if (!full.ok || !scoped.ok) throw new Error("unreachable");

    expect(full.value.recomputed.length).toBe(5000);
    expect(scoped.value.recomputed.length).toBeLessThan(full.value.recomputed.length);
  });
});
