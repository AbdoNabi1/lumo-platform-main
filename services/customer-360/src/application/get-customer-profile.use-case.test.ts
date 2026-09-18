import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@platform/types";
import type { IdentifierType } from "@platform/tracking";
import { type DomainError, ValidationError } from "@platform/utils";
import {
  applyFieldUpdate,
  createEmptyProfile,
  type CustomerProfile,
} from "../domain/customer-profile";
import type { ProfileStore } from "../ports/profile-store";
import type {
  ResolveIdentity,
  ResolveIdentityInput,
  ResolveIdentityOutput,
} from "./resolve-identity.use-case";
import { GetCustomerProfile } from "./get-customer-profile.use-case";
import { TENANT_A } from "../test-support/tenants";

const visitor = { type: "visitor_id" as const, value: "v1" };
const customer = { type: "customer_id" as const, value: "cust-1" };

function fakeResolveIdentity(
  handler: (input: ResolveIdentityInput) => Promise<Result<ResolveIdentityOutput, DomainError>>,
): ResolveIdentity {
  return { execute: handler } as ResolveIdentity;
}

function storeWith(...profiles: readonly CustomerProfile[]): ProfileStore {
  const byId = new Map(profiles.map((p) => [p.identifierValue, p]));
  return {
    getCurrent: async (id) => byId.get(id.value) ?? null,
    saveCurrent: async () => {},
    listIdentifiers: async () =>
      [...byId.values()].map((p) => ({
        type: p.identifierType as IdentifierType,
        value: p.identifierValue,
      })),
  };
}

describe("GetCustomerProfile", () => {
  it("returns profile: null when nothing in the cluster has a profile", async () => {
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetCustomerProfile({ profiles: storeWith(), resolveIdentity });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier: visitor,
      now: "2026-07-21T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.profile).toBeNull();
    expect(result.value.mergedFrom).toEqual([]);
  });

  it("falls back to the seed identifier's own profile when it has never been observed by Identity", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(visitor.type, visitor.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetCustomerProfile({ profiles: storeWith(profile), resolveIdentity });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier: visitor,
      now: "2026-07-21T00:00:02.000Z",
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.profile?.fields.get("email")?.value).toBe("a@example.com");
    expect(result.value.mergedFrom).toEqual([visitor]);
  });

  it("merges profiles across every resolved cluster member (the 360 view)", async () => {
    const visitorProfile = applyFieldUpdate(
      createEmptyProfile(visitor.type, visitor.value, "t0"),
      "device",
      {
        value: "device-1",
        source: "tracking",
        confidence: "inferred",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const customerProfile = applyFieldUpdate(
      createEmptyProfile(customer.type, customer.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:02.000Z",
      },
    ).profile;

    const resolveIdentity = fakeResolveIdentity(async () =>
      ok({
        cluster: {
          id: "cluster-1",
          resolvedAt: "2026-07-21T00:00:03.000Z",
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

    const useCase = new GetCustomerProfile({
      profiles: storeWith(visitorProfile, customerProfile),
      resolveIdentity,
    });

    const result = await useCase.execute({
      tenantId: TENANT_A,
      identifier: visitor,
      now: "2026-07-21T00:00:04.000Z",
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.profile?.fields.get("device")?.value).toBe("device-1");
    expect(result.value.profile?.fields.get("email")?.value).toBe("a@example.com");
    expect(result.value.mergedFrom.map((m) => m.value).sort()).toEqual(["cust-1", "v1"]);
  });

  it("computes completeness only when expectedFields is supplied", async () => {
    const profile = applyFieldUpdate(
      createEmptyProfile(visitor.type, visitor.value, "t0"),
      "email",
      {
        value: "a@example.com",
        source: "orders",
        confidence: "verified",
        occurredAt: "2026-07-21T00:00:01.000Z",
      },
    ).profile;
    const resolveIdentity = fakeResolveIdentity(async () => ok({ cluster: null }));
    const useCase = new GetCustomerProfile({ profiles: storeWith(profile), resolveIdentity });

    const withoutExpectation = await useCase.execute({
      tenantId: TENANT_A,
      identifier: visitor,
      now: "t1",
    });
    if (!withoutExpectation.ok) throw new Error("unreachable");
    expect(withoutExpectation.value.completeness).toBeNull();

    const withExpectation = await useCase.execute({
      tenantId: TENANT_A,
      identifier: visitor,
      now: "t1",
      expectedFields: ["email", "phone"],
    });
    if (!withExpectation.ok) throw new Error("unreachable");
    expect(withExpectation.value.completeness).toBe(0.5);
  });

  it("propagates a resolution error instead of masking it", async () => {
    const resolveIdentity = fakeResolveIdentity(async () =>
      err(new ValidationError("boom", [{ field: "type", message: "bad" }])),
    );
    const useCase = new GetCustomerProfile({ profiles: storeWith(), resolveIdentity });

    const result = await useCase.execute({ tenantId: TENANT_A, identifier: visitor, now: "t1" });
    expect(result.ok).toBe(false);
  });
});
