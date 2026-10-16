import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@platform/types";
import { ValidationError, type DomainError } from "@platform/utils";
import { applyMembershipUpdate } from "../domain/segment-membership";
import { InMemorySegmentStore } from "../infrastructure/in-memory-segment-store";
import type {
  ResolveIdentity,
  ResolveIdentityInput,
  ResolveIdentityOutput,
} from "./resolve-identity.use-case";
import { GetCustomerSegments } from "./get-customer-segments.use-case";
import { TENANT_A } from "../test-support/tenants";

const visitor = { type: "visitor_id" as const, value: "v1" };
const customer = { type: "customer_id" as const, value: "cust-1" };

function fakeResolveIdentity(
  handler: (input: ResolveIdentityInput) => Promise<Result<ResolveIdentityOutput, DomainError>>,
): ResolveIdentity {
  return { execute: handler } as ResolveIdentity;
}

describe("GetCustomerSegments", () => {
  it("returns an empty membership map when nothing in the cluster has a segment yet", async () => {
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetCustomerSegments({
      segments: new InMemorySegmentStore(),
      resolveIdentity,
    });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier: visitor });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.segment.memberships.size).toBe(0);
    expect(result.value.mergedFrom).toEqual([]);
  });

  it("falls back to the seed identifier's own memberships when it has no resolved cluster", async () => {
    const segments = new InMemorySegmentStore();
    const membership = applyMembershipUpdate(null, visitor.type, visitor.value, "high_value", {
      isMember: true,
      definitionId: "high_value",
      definitionVersion: 1,
      matchedRuleIds: [],
      inputs: new Map(),
      evaluatedAt: "t0",
    }).membership!;
    await segments.saveCurrent(membership, TENANT_A);

    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetCustomerSegments({ segments, resolveIdentity });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier: visitor });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.segment.memberships.get("high_value")?.status).toBe("entered");
    expect(result.value.mergedFrom).toEqual([visitor]);
  });

  it("merges memberships across every resolved cluster member", async () => {
    const segments = new InMemorySegmentStore();
    await segments.saveCurrent(
      applyMembershipUpdate(null, visitor.type, visitor.value, "engaged", {
        isMember: true,
        definitionId: "engaged",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      }).membership!,
      TENANT_A,
    );
    await segments.saveCurrent(
      applyMembershipUpdate(null, customer.type, customer.value, "high_value", {
        isMember: true,
        definitionId: "high_value",
        definitionVersion: 1,
        matchedRuleIds: [],
        inputs: new Map(),
        evaluatedAt: "t0",
      }).membership!,
      TENANT_A,
    );

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

    const useCase = new GetCustomerSegments({ segments, resolveIdentity });
    const result = await useCase.execute({ tenantId: TENANT_A, identifier: visitor });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.segment.memberships.get("engaged")?.status).toBe("entered");
    expect(result.value.segment.memberships.get("high_value")?.status).toBe("entered");
    expect(result.value.mergedFrom.map((m) => m.value).sort()).toEqual(["cust-1", "v1"]);
  });

  it("propagates a resolution error instead of masking it", async () => {
    const resolveIdentity = fakeResolveIdentity(async () =>
      err(new ValidationError("boom", [{ field: "type", message: "bad" }])),
    );
    const useCase = new GetCustomerSegments({
      segments: new InMemorySegmentStore(),
      resolveIdentity,
    });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier: visitor });
    expect(result.ok).toBe(false);
  });
});
