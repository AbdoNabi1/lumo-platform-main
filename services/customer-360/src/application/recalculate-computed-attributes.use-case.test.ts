import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeValue } from "../domain/attribute-value";
import { InMemoryAttributeDefinitionRegistry } from "../infrastructure/in-memory-attribute-definition-registry";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import type {
  EvaluateAttributeGraph,
  EvaluateAttributeGraphInput,
  EvaluateAttributeGraphOutput,
} from "./evaluate-attribute-graph.use-case";
import { RecalculateComputedAttributes } from "./recalculate-computed-attributes.use-case";

const identifier = { type: "customer_id" as const, value: "cust-1" };

function trivialRuleSet(id: string): RuleSet<AttributeValue> {
  return {
    id,
    version: 1,
    mode: "first_match",
    rules: [{ id: `${id}-rule`, priority: 1, when: Expr.literal(true), then: true }],
  };
}

function def(id: string, dependencies: readonly string[] = []): ComputedAttributeDefinition {
  return { id, version: 1, ruleSet: trivialRuleSet(id), dependencies };
}

function fakeEvaluateGraph(): {
  graph: EvaluateAttributeGraph;
  calls: EvaluateAttributeGraphInput[];
} {
  const calls: EvaluateAttributeGraphInput[] = [];
  const handler = async (
    input: EvaluateAttributeGraphInput,
  ): Promise<Result<EvaluateAttributeGraphOutput, DomainError>> => {
    calls.push(input);
    return ok({ results: [], applied: input.definitions.map((d) => d.id) });
  };
  return { graph: { execute: handler } as EvaluateAttributeGraph, calls };
}

describe("RecalculateComputedAttributes", () => {
  it("recomputes the full registered set when `changed` is omitted", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([
      def("a"),
      def("b", ["a"]),
      def("c", ["b"]),
    ]);
    const { graph, calls } = fakeEvaluateGraph();
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: graph,
    });

    const result = await useCase.execute({ identifier });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect([...result.value.recomputed].sort()).toEqual(["a", "b", "c"]);
    expect(calls[0]?.definitions.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("recomputes only the changed attribute's transitive dependents — a chain a<-b<-c<-d plus unrelated e", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([
      def("a"),
      def("b", ["a"]),
      def("c", ["b"]),
      def("d", ["c"]),
      def("e"), // unrelated
    ]);
    const { graph, calls } = fakeEvaluateGraph();
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: graph,
    });

    const result = await useCase.execute({ identifier, changed: ["a"] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect([...result.value.recomputed].sort()).toEqual(["a", "b", "c", "d"]);
    expect(result.value.recomputed).not.toContain("e");
    expect(calls[0]?.definitions.map((d) => d.id).sort()).toEqual(["a", "b", "c", "d"]);

    // Order matters: a must precede b, b must precede c, c must precede d.
    const order = calls[0]!.definitions.map((d) => d.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  it("a leaf attribute with nothing depending on it recomputes only itself when changed", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([
      def("a"),
      def("b", ["a"]),
      def("leaf"),
    ]);
    const { graph } = fakeEvaluateGraph();
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: graph,
    });

    const result = await useCase.execute({ identifier, changed: ["leaf"] });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.recomputed).toEqual(["leaf"]);
  });

  it("stops before evaluating anything when the registered graph has a cycle, even outside the changed scope", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([
      def("a"),
      def("cyclic1", ["cyclic2"]),
      def("cyclic2", ["cyclic1"]),
    ]);
    const { graph, calls } = fakeEvaluateGraph();
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: graph,
    });

    const result = await useCase.execute({ identifier, changed: ["a"] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/cycle/i);
    expect(calls).toHaveLength(0); // never reached evaluation
  });

  it("reports a clear validation error when a definition names an unregistered dependency", async () => {
    const registry = new InMemoryAttributeDefinitionRegistry([def("a", ["ghost"])]);
    const { graph } = fakeEvaluateGraph();
    const useCase = new RecalculateComputedAttributes({
      definitions: registry,
      evaluateGraph: graph,
    });

    const result = await useCase.execute({ identifier });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/ghost/);
  });
});
