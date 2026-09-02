import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type DomainError } from "@platform/utils";
import {
  applyAttributeUpdate,
  createEmptyComputedAttribute,
  type ComputedAttribute,
} from "../domain/computed-attribute";
import type { AttributeStore } from "../ports/attribute-store";
import type {
  ResolveIdentity,
  ResolveIdentityInput,
  ResolveIdentityOutput,
} from "./resolve-identity.use-case";
import { GetComputedAttributes } from "./get-computed-attributes.use-case";

const visitor = { type: "visitor_id" as const, value: "v1" };
const customer = { type: "customer_id" as const, value: "cust-1" };

function fakeResolveIdentity(
  handler: (input: ResolveIdentityInput) => Promise<Result<ResolveIdentityOutput, DomainError>>,
): ResolveIdentity {
  return { execute: handler } as ResolveIdentity;
}

function storeWith(...attributes: readonly ComputedAttribute[]): AttributeStore {
  const byId = new Map(attributes.map((a) => [a.identifierValue, a]));
  return {
    getCurrent: async (id) => byId.get(id.value) ?? null,
    saveCurrent: async () => {},
    listIdentifiers: async () => [],
  };
}

describe("GetComputedAttributes", () => {
  it("returns attribute: null when nothing in the cluster has a computed attribute yet", async () => {
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetComputedAttributes({ attributes: storeWith(), resolveIdentity });

    const result = await useCase.execute({ identifier: visitor, now: "t1" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.attribute).toBeNull();
    expect(result.value.mergedFrom).toEqual([]);
  });

  it("falls back to the seed identifier's own attribute set when it has no resolved cluster", async () => {
    const attribute = applyAttributeUpdate(
      createEmptyComputedAttribute(visitor.type, visitor.value, "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetComputedAttributes({
      attributes: storeWith(attribute),
      resolveIdentity,
    });

    const result = await useCase.execute({ identifier: visitor, now: "t1" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.attribute?.attributes.get("is_vip")?.value).toBe(true);
    expect(result.value.mergedFrom).toEqual([visitor]);

    // Every field of the stored explainability record survives the read path unchanged.
    const value = result.value.attribute?.attributes.get("is_vip");
    expect(value?.matchedRuleIds).toEqual([]);
    expect(value?.definitionId).toBe("is_vip");
  });

  it("merges computed attributes across every resolved cluster member", async () => {
    const visitorAttrs = applyAttributeUpdate(
      createEmptyComputedAttribute(visitor.type, visitor.value, "t0"),
      "engagement",
      {
        value: "high",
        definitionId: "engagement",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;
    const customerAttrs = applyAttributeUpdate(
      createEmptyComputedAttribute(customer.type, customer.value, "t0"),
      "is_vip",
      {
        value: true,
        definitionId: "is_vip",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      },
    ).attribute;

    const resolveIdentity = fakeResolveIdentity(async () =>
      ok({
        cluster: {
          id: "cluster-1",
          resolvedAt: "t1",
          resolved: {
            seed: { type: visitor.type, value: visitor.value, firstSeenAt: "t0" },
            members: [
              { type: visitor.type, value: visitor.value, firstSeenAt: "t0" },
              { type: customer.type, value: customer.value, firstSeenAt: "t0" },
            ],
            confidenceScore: 1,
            confidence: "deterministic",
            evidence: [],
          },
        },
      }),
    );

    const useCase = new GetComputedAttributes({
      attributes: storeWith(visitorAttrs, customerAttrs),
      resolveIdentity,
    });

    const result = await useCase.execute({ identifier: visitor, now: "t2" });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.attribute?.attributes.get("engagement")?.value).toBe("high");
    expect(result.value.attribute?.attributes.get("is_vip")?.value).toBe(true);
    expect(result.value.mergedFrom.map((m) => m.value).sort()).toEqual(["cust-1", "v1"]);
  });

  it("propagates a resolution error instead of masking it", async () => {
    const resolveIdentity = fakeResolveIdentity(async () =>
      err(new ValidationError("boom", [{ field: "type", message: "bad" }])),
    );
    const useCase = new GetComputedAttributes({ attributes: storeWith(), resolveIdentity });

    const result = await useCase.execute({ identifier: visitor, now: "t1" });
    expect(result.ok).toBe(false);
  });
});
