import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { applyFieldUpdate, createEmptyProfile } from "../domain/customer-profile";
import { applyAttributeUpdate, createEmptyComputedAttribute } from "../domain/computed-attribute";
import type { AttributeValue } from "../domain/attribute-value";
import type { AttributeStore } from "../ports/attribute-store";
import type { ComputedAttributeDefinition } from "../ports/computed-attribute-definition";
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
  handler: (input: GetJourneyStateInput) => Promise<Result<GetJourneyStateOutput, DomainError>>,
): GetJourneyState {
  return { execute: handler } as GetJourneyState;
}

function attributeStoreWith(
  current: ReturnType<typeof createEmptyComputedAttribute> | null,
): AttributeStore {
  return {
    getCurrent: async () => current,
    saveCurrent: async () => {},
    listIdentifiers: async () => [],
  };
}

function isVipDefinition(): ComputedAttributeDefinition {
  const ruleSet: RuleSet<AttributeValue> = {
    id: "is_vip",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "vip-rule",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "gte", 1000),
        then: true,
      },
    ],
    fallback: false,
  };
  return { id: "is_vip", version: 1, ruleSet, dependencies: [] };
}

describe("EvaluateComputedAttribute", () => {
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

    const useCase = new EvaluateComputedAttribute({
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
      getJourneyState: fakeGetJourneyState(async () =>
        ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } }),
      ),
      attributes: attributeStoreWith(null),
      clock,
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      definition: isVipDefinition(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.value).toBe(true);
    expect(result.value.result.matchedRuleIds).toEqual(["vip-rule"]);
    expect(result.value.result.degraded).toBe(false);
    expect(result.value.result.inputs.get("profile.lifetime_value")).toBe(5000);
    expect(result.value.result.contributingSources.get("profile.lifetime_value")).toEqual({
      source: "orders",
      observedAt: "2026-07-21T00:00:01.000Z",
    });
    expect(result.value.result.source).toBe("computed-attribute:is_vip");
  });

  it("falls back when no rule matches", async () => {
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

    const useCase = new EvaluateComputedAttribute({
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
      getJourneyState: fakeGetJourneyState(async () =>
        ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } }),
      ),
      attributes: attributeStoreWith(null),
      clock,
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier,
      definition: isVipDefinition(),
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.value).toBe(false); // fallback
    expect(result.value.result.usedFallback).toBe(true);
    expect(result.value.result.matchedRuleIds).toEqual([]);
  });

  it("is degraded, not silently false, when a referenced fact is missing entirely", async () => {
    // Deliberately no `fallback` on this definition: with no rule matching and no fallback declared,
    // `outcomes` stays empty and `value` is legitimately `undefined` — the case that lets this test
    // isolate `degraded` from `usedFallback`/`value` being coincidentally populated by a fallback.
    const ruleSet: RuleSet<AttributeValue> = {
      id: "is_vip",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "vip-rule",
          priority: 1,
          when: Expr.where("profile.lifetime_value", "gte", 1000),
          then: true,
        },
      ],
    };
    const definition: ComputedAttributeDefinition = {
      id: "is_vip",
      version: 1,
      ruleSet,
      dependencies: [],
    };

    const useCase = new EvaluateComputedAttribute({
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
      getJourneyState: fakeGetJourneyState(async () =>
        ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } }),
      ),
      attributes: attributeStoreWith(null),
      clock,
    });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier, definition });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.degraded).toBe(true);
    expect(result.value.result.value).toBeUndefined();
  });

  it("reads dependency attribute values from the attribute store, namespaced under attributes.<id>", async () => {
    const dependency = applyAttributeUpdate(
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

    const ruleSet: RuleSet<AttributeValue> = {
      id: "is_vip",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "gold-tier-rule",
          priority: 1,
          when: Expr.where("attributes.clv_tier", "eq", "gold"),
          then: true,
        },
      ],
      fallback: false,
    };
    const definition: ComputedAttributeDefinition = {
      id: "is_vip",
      version: 1,
      ruleSet,
      dependencies: ["clv_tier"],
    };

    const useCase = new EvaluateComputedAttribute({
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
      getJourneyState: fakeGetJourneyState(async () =>
        ok({ state: { visitorId: "v1", sessionCount: 0, identified: false } }),
      ),
      attributes: attributeStoreWith(dependency),
      clock,
    });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier, definition });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.result.value).toBe(true);
    expect(result.value.result.inputs.get("attributes.clv_tier")).toBe("gold");
  });

  it("only consults journey state when the identifier is itself a visitor_id", async () => {
    let journeyCalled = false;
    const useCase = new EvaluateComputedAttribute({
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
      attributes: attributeStoreWith(null),
      clock,
    });

    await useCase.execute({ tenantId: TENANT_A, identifier, definition: isVipDefinition() }); // customer_id, not visitor_id
    expect(journeyCalled).toBe(false);

    await useCase.execute({
      tenantId: TENANT_A,
      identifier: { type: "visitor_id", value: "v1" },
      definition: isVipDefinition(),
    });
    expect(journeyCalled).toBe(true);
  });
});
