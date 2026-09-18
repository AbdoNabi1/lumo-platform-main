import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import type { AttributeValue } from "../domain/attribute-value";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryAttributeHistoryStore } from "../infrastructure/in-memory-attribute-history-store";
import { InMemoryAttributeStore } from "../infrastructure/in-memory-attribute-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type {
  GetCustomerProfile,
  GetCustomerProfileInput,
  GetCustomerProfileOutput,
} from "./get-customer-profile.use-case";
import type {
  GetJourneyState,
  GetJourneyStateInput,
  GetJourneyStateOutput,
} from "./get-journey-state.use-case";
import { EvaluateComputedAttribute } from "./evaluate-computed-attribute.use-case";
import { UpdateComputedAttributeProjection } from "./update-computed-attribute-projection.use-case";
import { EvaluateAttributeGraph } from "./evaluate-attribute-graph.use-case";
import { TENANT_A } from "../test-support/tenants";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids: IdGenerator = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-1" };

function fakeGetCustomerProfile(
  handler: (
    input: GetCustomerProfileInput,
  ) => Promise<Result<GetCustomerProfileOutput, DomainError>>,
): GetCustomerProfile {
  return { execute: handler } as GetCustomerProfile;
}

function fakeGetJourneyState(): GetJourneyState {
  const handler = async (
    _input: GetJourneyStateInput,
  ): Promise<Result<GetJourneyStateOutput, DomainError>> =>
    ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } });
  return { execute: handler } as GetJourneyState;
}

function wire(profileValue: number) {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "customer360",
  });
  const context = rootEventContext(ids);
  const attributes = new InMemoryAttributeStore();
  const history = new InMemoryAttributeHistoryStore({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();

  const getCustomerProfile = fakeGetCustomerProfile(async () =>
    ok({
      profile: {
        identifierType: identifier.type,
        identifierValue: identifier.value,
        fields: new Map([
          [
            "lifetime_value",
            {
              value: profileValue,
              source: "orders",
              updatedAt: "t0",
              confidence: "verified" as const,
              version: 1,
            },
          ],
        ]),
        version: 1,
        updatedAt: "t0",
      },
      mergedFrom: [identifier],
      completeness: null,
      confidence: null,
      freshness: null,
      sources: null,
    }),
  );
  const evaluate = new EvaluateComputedAttribute({
    getCustomerProfile,
    getJourneyState: fakeGetJourneyState(),
    attributes,
    clock,
  });
  const updateProjection = new UpdateComputedAttributeProjection({
    attributes,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  const graph = new EvaluateAttributeGraph({ evaluate, updateProjection });
  return { graph, attributes };
}

function lifetimeValueTierDefinition(): ComputedAttributeDefinition {
  const ruleSet: RuleSet<AttributeValue> = {
    id: "clv_tier",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "gold",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "gte", 1000),
        then: "gold",
      },
      { id: "bronze", priority: 2, when: Expr.literal(true), then: "bronze" },
    ],
  };
  return { id: "clv_tier", version: 1, ruleSet, dependencies: [] };
}

function isVipFromTierDefinition(): ComputedAttributeDefinition {
  const ruleSet: RuleSet<AttributeValue> = {
    id: "is_vip",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "vip-rule",
        priority: 1,
        when: Expr.where("attributes.clv_tier", "eq", "gold"),
        then: true,
      },
    ],
    fallback: false,
  };
  return { id: "is_vip", version: 1, ruleSet, dependencies: ["clv_tier"] };
}

describe("EvaluateAttributeGraph", () => {
  it("evaluates in dependency order so a dependent sees its dependency's freshly-computed value", async () => {
    const { graph, attributes } = wire(5000);

    // Deliberately out-of-order input — the use case must still evaluate clv_tier before is_vip.
    const result = await graph.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [isVipFromTierDefinition(), lifetimeValueTierDefinition()],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const byId = new Map(result.value.results.map((r) => [r.definitionId, r]));
    expect(byId.get("clv_tier")?.value).toBe("gold");
    expect(byId.get("is_vip")?.value).toBe(true);
    expect([...result.value.applied].sort()).toEqual(["clv_tier", "is_vip"]);

    const persisted = await attributes.getCurrent(identifier, TENANT_A);
    expect(persisted?.attributes.get("clv_tier")?.value).toBe("gold");
    expect(persisted?.attributes.get("is_vip")?.value).toBe(true);
  });

  it("stops and returns a clear cycle error instead of evaluating anything", async () => {
    const { graph } = wire(5000);

    const a: ComputedAttributeDefinition = {
      id: "a",
      version: 1,
      dependencies: ["b"],
      ruleSet: {
        id: "a",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r", priority: 1, when: Expr.where("attributes.b", "eq", 1), then: 1 }],
      },
    };
    const b: ComputedAttributeDefinition = {
      id: "b",
      version: 1,
      dependencies: ["a"],
      ruleSet: {
        id: "b",
        version: 1,
        mode: "first_match",
        rules: [{ id: "r", priority: 1, when: Expr.where("attributes.a", "eq", 1), then: 1 }],
      },
    };

    const result = await graph.execute({ tenantId: TENANT_A, identifier, definitions: [a, b] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toMatch(/cycle/i);
  });

  it("does not re-cascade a dependent when its own dependency's value did not actually change", async () => {
    const { graph } = wire(50); // below the gold threshold -> "bronze", stable across re-evaluations

    const first = await graph.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [lifetimeValueTierDefinition(), isVipFromTierDefinition()],
    });
    if (!first.ok) throw new Error("unreachable");
    expect([...first.value.applied].sort()).toEqual(["clv_tier", "is_vip"]); // both new, both applied

    const second = await graph.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [lifetimeValueTierDefinition(), isVipFromTierDefinition()],
    });
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toEqual([]); // identical inputs -> no-op guard rejects both
  });
});
