import { describe, expect, it } from "vitest";
import {
  claimTenantResolver,
  domainTenantResolver,
  headerTenantResolver,
  PUBLIC_PRINCIPAL_ID,
  publicHeaderTenantResolver,
  resolveTenant,
} from "./tenant-resolution";

const base = { headers: {}, hostname: "shop.example.com", principal: null, claims: null };

describe("tenant resolution chain (ADR-0008: first hit wins, no default)", () => {
  it("resolves from the verified JWT claim (Sprint 2.7 activation)", () => {
    expect(
      resolveTenant([claimTenantResolver, headerTenantResolver], {
        ...base,
        claims: { tenant_id: "t-jwt" },
        headers: { "x-tenant-id": "t-header" },
      }),
    ).toBe("t-jwt");
  });

  it("falls through claim → header → domain in order", () => {
    const resolvers = [
      claimTenantResolver,
      headerTenantResolver,
      domainTenantResolver((host) => (host === "shop.example.com" ? "t-domain" : null)),
    ];
    expect(resolveTenant(resolvers, { ...base, headers: { "x-tenant-id": "t-h" } })).toBe("t-h");
    expect(resolveTenant(resolvers, base)).toBe("t-domain");
  });

  it("returns null when nothing resolves — the transport rejects, never defaults", () => {
    expect(resolveTenant([claimTenantResolver], base)).toBeNull();
  });
});

describe("publicHeaderTenantResolver (T10.5: the header never names a tenant for a verified principal)", () => {
  const withHeader = { ...base, headers: { "x-tenant-id": "t-header" } };

  it("honours the header when there is no principal or only the fixed public one", () => {
    expect(publicHeaderTenantResolver({ ...withHeader, principal: null })).toBe("t-header");
    expect(
      publicHeaderTenantResolver({
        ...withHeader,
        principal: { id: PUBLIC_PRINCIPAL_ID, kind: "customer", roles: [] },
      }),
    ).toBe("t-header");
  });

  it("returns null for a verified principal — a tokenless-claim principal cannot pick a tenant", () => {
    const chain = [claimTenantResolver, publicHeaderTenantResolver];
    const staff = { id: "staff-1", kind: "staff" as const, roles: ["admin"] };
    expect(resolveTenant(chain, { ...withHeader, principal: staff, claims: {} })).toBeNull();
    // ...and a claim still resolves, ahead of any header.
    expect(
      resolveTenant(chain, { ...withHeader, principal: staff, claims: { tenant_id: "t-claim" } }),
    ).toBe("t-claim");
  });
});

/**
 * WP-10 definition of done: "no resolvable tenant is rejected, never defaulted", for every way a tenant
 * can fail to arrive. Each row is a value a client (or a mis-mapped identity provider) can actually
 * send; every one must resolve to `null`, so the transport answers 403 instead of running a request
 * under a tenant nobody chose.
 */
describe("a tenant that is absent, empty or malformed never resolves", () => {
  const staff = { id: "staff-1", kind: "staff" as const, roles: ["admin"] };

  it.each([
    ["absent", {}],
    ["null", { tenant_id: null }],
    ["empty string", { tenant_id: "" }],
    ["blank string", { tenant_id: "   " }],
    ["a number", { tenant_id: 42 }],
    ["a boolean", { tenant_id: true }],
    ["an array", { tenant_id: ["t-a"] }],
    ["an object", { tenant_id: { id: "t-a" } }],
  ])("claim: %s → null", (_label, claims) => {
    expect(claimTenantResolver({ ...base, principal: staff, claims })).toBeNull();
    expect(
      resolveTenant([claimTenantResolver, publicHeaderTenantResolver], {
        ...base,
        principal: staff,
        claims,
      }),
    ).toBeNull();
  });

  it("claim: surrounding whitespace does not name a different tenant than the trimmed id", () => {
    expect(claimTenantResolver({ ...base, claims: { tenant_id: " t-a " } })).toBe("t-a");
  });

  it.each([
    ["absent", {}],
    ["empty", { "x-tenant-id": "" }],
    ["blank", { "x-tenant-id": "   " }],
    ["undefined", { "x-tenant-id": undefined }],
  ])("header: %s → null", (_label, headers) => {
    expect(headerTenantResolver({ ...base, headers })).toBeNull();
    expect(publicHeaderTenantResolver({ ...base, headers })).toBeNull();
  });

  it("header: surrounding whitespace is trimmed, never kept as a distinct tenant", () => {
    expect(headerTenantResolver({ ...base, headers: { "x-tenant-id": " t-a " } })).toBe("t-a");
  });
});
