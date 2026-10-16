import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Expr } from "@platform/expression";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import type { RuleSet } from "@platform/rules";
import { ok, type Result } from "@platform/types";
import type { DomainError } from "@platform/utils";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemorySegmentHistoryStore } from "../infrastructure/in-memory-segment-history-store";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
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
import { UpdateSegmentMembershipProjection } from "./update-segment-membership-projection.use-case";
import {
  EvaluateAllSegments,
  collectReferencedPaths,
  toSegmentDependencyEdges,
} from "./evaluate-all-segments.use-case";
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
function fakeGetComputedAttributes(): GetComputedAttributes {
  const handler = async (
    _input: GetComputedAttributesInput,
  ): Promise<Result<GetComputedAttributesOutput, DomainError>> =>
    ok({ attribute: null, mergedFrom: [] });
  return { execute: handler } as GetComputedAttributes;
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
  const segments = new InMemorySegmentStore();
  const history = new InMemorySegmentHistoryStore({ outbox, context });
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
  const evaluate = new EvaluateSegment({
    getCustomerProfile,
    getJourneyState: fakeGetJourneyState(),
    getComputedAttributes: fakeGetComputedAttributes(),
    clock,
  });
  const updateProjection = new UpdateSegmentMembershipProjection({
    segments,
    history,
    unitOfWork,
    idGenerator: ids,
    clock,
  });
  const evaluateAll = new EvaluateAllSegments({ evaluate, updateProjection });
  return { evaluateAll, segments };
}

function def(id: string, ruleSet: RuleSet<boolean>): SegmentDefinition {
  return { id, name: id, version: 1, ruleSet, createdAt: "t0", updatedAt: "t0" };
}

function highValue(): SegmentDefinition {
  return def("high_value", {
    id: "high_value",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "hv-rule",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "gte", 1000),
        then: true,
      },
    ],
    fallback: false,
  });
}

function lowValue(): SegmentDefinition {
  return def("low_value", {
    id: "low_value",
    version: 1,
    mode: "first_match",
    rules: [
      {
        id: "lv-rule",
        priority: 1,
        when: Expr.where("profile.lifetime_value", "lt", 1000),
        then: true,
      },
    ],
    fallback: false,
  });
}

describe("EvaluateAllSegments", () => {
  it("evaluates every definition regardless of order — no ordering is imposed", async () => {
    const { evaluateAll, segments } = wire(5000);
    const result = await evaluateAll.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [lowValue(), highValue()],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const byId = new Map(result.value.results.map((r) => [r.segmentId, r]));
    expect(byId.get("high_value")?.isMember).toBe(true);
    expect(byId.get("low_value")?.isMember).toBe(false);
    // low_value never applied: a brand-new row evaluating to "not a member" is the no-op-from-nothing
    // case (applyMembershipUpdate never creates a row for it) — only high_value's entry is persisted.
    expect(result.value.applied).toEqual(["high_value"]);

    expect((await segments.getCurrent(identifier, "high_value", TENANT_A))?.status).toBe("entered");
    expect(await segments.getCurrent(identifier, "low_value", TENANT_A)).toBeNull();
  });

  it("does not re-apply when re-evaluated with unchanged inputs", async () => {
    const { evaluateAll } = wire(5000);
    const first = await evaluateAll.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [highValue()],
    });
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.applied).toEqual(["high_value"]);

    const second = await evaluateAll.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [highValue()],
    });
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.applied).toEqual([]);
  });
});

describe("collectReferencedPaths", () => {
  it("collects every ref/exists path from a rule set, including through and/or/not/compare/in", () => {
    const ruleSet: RuleSet<boolean> = {
      id: "combo",
      version: 1,
      mode: "first_match",
      rules: [
        {
          id: "r1",
          priority: 1,
          when: Expr.and(
            Expr.where("profile.ltv", "gte", 1000),
            Expr.not(Expr.exists("attributes.churn_flag")),
            Expr.or(
              Expr.where("journey.sessionCount", "gt", 1),
              Expr.in(Expr.ref("profile.country"), ["US", "CA"]),
            ),
          ),
          then: true,
        },
      ],
    };

    const paths = collectReferencedPaths(ruleSet);
    expect([...paths].sort()).toEqual(
      ["attributes.churn_flag", "journey.sessionCount", "profile.country", "profile.ltv"].sort(),
    );
  });

  it("returns an empty set for a rule set with only literal conditions", () => {
    const ruleSet: RuleSet<boolean> = {
      id: "always",
      version: 1,
      mode: "first_match",
      rules: [{ id: "r1", priority: 1, when: Expr.literal(true), then: true }],
    };
    expect(collectReferencedPaths(ruleSet).size).toBe(0);
  });
});

describe("toSegmentDependencyEdges", () => {
  it("builds one edge per (segmentId, factPath) pair across all definitions", () => {
    const edges = toSegmentDependencyEdges([highValue(), lowValue()]);
    expect(edges).toEqual([
      { attribute: "high_value", dependsOn: "profile.lifetime_value" },
      { attribute: "low_value", dependsOn: "profile.lifetime_value" },
    ]);
  });
});
