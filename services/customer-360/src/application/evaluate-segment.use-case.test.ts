import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import type { SegmentDefinition } from "../ports/segment-definition";
import type {
  GetComputedAttributes,
  GetComputedAttributesInput,
  GetComputedAttributesOutput,
} from "./get-computed-attributes.use-case";
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
import { EvaluateSegment } from "./evaluate-segment.use-case";
import { TENANT_A } from "../test-support/tenants";

const clock: Clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const identifier = { type: "customer_id" as const, value: "cust-1" };

function fakeGetCustomerProfile(
  handler: (
    input: GetCustomerProfileInput,
  ) => Promise<Result<GetCustomerProfileOutput, DomainError>>,
): GetCustomerProfile {
  return { execute: handler } as GetCustomerProfile;
}

function fakeGetJourneyState(
  handler: (
    input: GetJourneyStateInput,
  ) => Promise<Result<GetJourneyStateOutput, DomainError>> = async () =>
    ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } }),
): GetJourneyState {
  return { execute: handler } as GetJourneyState;
}

function fakeGetComputedAttributes(
  handler: (
    input: GetComputedAttributesInput,
  ) => Promise<Result<GetComputedAttributesOutput, DomainError>> = async () =>
    ok({ attribute: null, mergedFrom: [] }),
): GetComputedAttributes {
  return { execute: handler } as GetComputedAttributes;
}

function highValueDefinition(): SegmentDefinition {
  const ruleSet: RuleSet<boolean> = {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "high-value-rule",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "gte", 1000),
        then: true,
      },
    ],
    fallback: false,
  };
  return {
    id: "high_value",
    name: "High value",
    version: 1,
    ruleSet,
    createdAt: "t0",
    updatedAt: "t0",
  };
}

describe("EvaluateSegment", () => {
  it("evaluates a rule against profile facts and reports which rule matched", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "lifetime_value",
      {
        value: 5000,
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;

    const useCase = new EvaluateSegment({
      getCustomerProfile: fakeGetCustomerProfile(async () =>
        ok({
          profile,
          mergedFrom: [identifier],
          completeness: null,
          confidence: null,
          freshness: null,
          sources: null,
        }),
      ),
      getJourneyState: fakeGetJourneyState(),
      getComputedAttributes: fakeGetComputedAttributes(),
      clock,
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      definition: highValueDefinition(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.isMember).toBe(true);
    expect(result.value.result.matchedRuleIds).toEqual(["high-value-rule"]);
    expect(result.value.result.degraded).toBe(false);
    expect(result.value.result.inputs.get("profile.lifetime_value")).toBe(5000);
    expect(result.value.result.source).toBe("segment:high_value");
  });

  it("is not a member (fallback) when no rule matches", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(identifier.type, identifier.value, "t0"),
      "lifetime_value",
      {
        value: 10,
        source: "orders",
        confidence: "verified",
        occurredAt: "t0",
      },
    ).profile;

    const useCase = new EvaluateSegment({
      getCustomerProfile: fakeGetCustomerProfile(async () =>
        ok({
          profile,
          mergedFrom: [identifier],
          completeness: null,
          confidence: null,
          freshness: null,
          sources: null,
        }),
      ),
      getJourneyState: fakeGetJourneyState(),
      getComputedAttributes: fakeGetComputedAttributes(),
      clock,
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      definition: highValueDefinition(),
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.isMember).toBe(false);
    expect(result.value.result.usedFallback).toBe(true);
  });

  it("reads the full cluster-merged computed-attribute set, namespaced under attributes.<id>", async () => {
    const attribute = applyAttributeUpdate(
      createEmptyComputedAttribute(identifier.type, identifier.value, "t0"),
      "clv_tier",
      {
        value: "gold",
        definitionId: "clv_tier",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;

    const ruleSet: RuleSet<boolean> = {
      id: "gold_tier",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "gold-rule",
          priority: 1,
          when: Expr.where("attributes.clv_tier", "eq", "gold"),
          then: true,
        },
      ],
      fallback: false,
    };
    const definition: SegmentDefinition = {
      id: "gold_tier",
      name: "Gold tier",
      version: 1,
      ruleSet,
      createdAt: "t0",
      updatedAt: "t0",
    };

    const useCase = new EvaluateSegment({
      getCustomerProfile: fakeGetCustomerProfile(async () =>
        ok({
          profile: null,
          mergedFrom: [],
          completeness: null,
          confidence: null,
          freshness: null,
          sources: null,
        }),
      ),
      getJourneyState: fakeGetJourneyState(),
      getComputedAttributes: fakeGetComputedAttributes(async () =>
        ok({ attribute, mergedFrom: [identifier] }),
      ),
      clock,
    });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier, definition });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.isMember).toBe(true);
    expect(result.value.result.inputs.get("attributes.clv_tier")).toBe("gold");
  });

  it("only consults journey state when the identifier is itself a visitor_id", async () => {
    let journeyCalled = false;
    const useCase = new EvaluateSegment({
      getCustomerProfile: fakeGetCustomerProfile(async () =>
        ok({
          profile: null,
          mergedFrom: [],
          completeness: null,
          confidence: null,
          freshness: null,
          sources: null,
        }),
      ),
      getJourneyState: fakeGetJourneyState(async () => {
        journeyCalled = true;
        return ok({ state: { visitorId: "v1", sessionCount: 3, identified: true } });
      }),
      getComputedAttributes: fakeGetComputedAttributes(),
      clock,
    });

    await useCase.execute({ tenantId: TENANT_A, identifier, definition: highValueDefinition() }); // customer_id, not visitor_id
    expect(journeyCalled).toBe(false);

    await useCase.execute({
      tenantId: TENANT_A,
      identifier: { type: "visitor_id", value: "v1" },
      definition: highValueDefinition(),
    });
    expect(journeyCalled).toBe(true);
  });
});
