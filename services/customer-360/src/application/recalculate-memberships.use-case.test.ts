import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { InMemorySegmentDefinitionRegistry } from "../infrastructure/in-memory-segment-definition-registry";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { SegmentDefinition } from "../ports/segment-definition";
import type {
  EvaluateAllSegments,
  EvaluateAllSegmentsInput,
  EvaluateAllSegmentsOutput,
} from "./evaluate-all-segments.use-case";
import { RecalculateMemberships } from "./recalculate-memberships.use-case";
import { TENANT_A } from "../test-support/tenants";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-1" };

function ruleSetOn(path: string): RuleSet<boolean> {
  return {
    id: path,
    version: 1,
    mode: "first_match",
    rules: [{ id: "r1", priority: 1, when: Expr.where(path, "eq", true), then: true }],
    fallback: false,
  };
}

function def(id: string, path: string): SegmentDefinition {
  return { id, name: id, version: 1, ruleSet: ruleSetOn(path), createdAt: "t0", updatedAt: "t0" };
}

function registry(definitions: readonly SegmentDefinition[]) {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  return new InMemorySegmentDefinitionRegistry(
    { outbox, context: rootEventContext(ids) },
    { tenantId: TENANT_A, definitions: definitions },
  );
}

function fakeEvaluateAll(): {
  evaluateAll: EvaluateAllSegments;
  calls: EvaluateAllSegmentsInput[];
} {
  const calls: EvaluateAllSegmentsInput[] = [];
  const handler = async (
    input: EvaluateAllSegmentsInput,
  ): Promise<Result<EvaluateAllSegmentsOutput, DomainError>> => {
    calls.push(input);
    return ok({ results: [], applied: input.definitions.map((d) => d.id) });
  };
  return { evaluateAll: { execute: handler } as EvaluateAllSegments, calls };
}

describe("RecalculateMemberships", () => {
  it("recomputes the full registered set when `changed` is omitted", async () => {
    const defs = registry([def("a", "profile.a"), def("b", "attributes.b"), def("c", "journey.c")]);
    const { evaluateAll, calls } = fakeEvaluateAll();
    const useCase = new RecalculateMemberships({ definitions: defs, evaluateAll });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect([...result.value.recomputed].sort()).toEqual(["a", "b", "c"]);
    expect(calls[0]?.definitions.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("recomputes only segments whose fact path actually changed", async () => {
    const defs = registry([
      def("high_value", "profile.ltv"),
      def("has_orders", "profile.order_count"),
      def("vip_tier", "attributes.vip_tier"),
    ]);
    const { evaluateAll, calls } = fakeEvaluateAll();
    const useCase = new RecalculateMemberships({ definitions: defs, evaluateAll });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      changed: ["profile.ltv"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.recomputed).toEqual(["high_value"]);
    expect(result.value.recomputed).not.toContain("has_orders");
    expect(result.value.recomputed).not.toContain("vip_tier");
    expect(calls[0]?.definitions.map((d) => d.id)).toEqual(["high_value"]);
  });

  it("unifies profile/attribute/journey changes through the same mechanism", async () => {
    const defs = registry([
      def("a", "profile.ltv"),
      def("b", "attributes.vip_tier"),
      def("c", "journey.sessionCount"),
      def("unrelated", "profile.email"),
    ]);
    const { evaluateAll } = fakeEvaluateAll();
    const useCase = new RecalculateMemberships({ definitions: defs, evaluateAll });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      changed: ["profile.ltv", "attributes.vip_tier", "journey.sessionCount"],
    });
    if (!result.ok) throw new Error("unreachable");
    expect([...result.value.recomputed].sort()).toEqual(["a", "b", "c"]);
    expect(result.value.recomputed).not.toContain("unrelated");
  });

  it("a segment depending on multiple facts recomputes when any one of them changes", async () => {
    const multi: SegmentDefinition = {
      id: "multi",
      name: "multi",
      version: 1,
      ruleSet: {
        id: "multi",
        version: 1,
        mode: "first_match",
        rules: [
          {
            id: "r1",
            priority: 1,
            when: Expr.and(
              Expr.where("profile.ltv", "gte", 1),
              Expr.where("attributes.tier", "eq", "gold"),
            ),
            then: true,
          },
        ],
        fallback: false,
      },
      createdAt: "t0",
      updatedAt: "t0",
    };
    const defs = registry([multi]);
    const { evaluateAll } = fakeEvaluateAll();
    const useCase = new RecalculateMemberships({ definitions: defs, evaluateAll });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      changed: ["attributes.tier"],
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.recomputed).toEqual(["multi"]);
  });
});
