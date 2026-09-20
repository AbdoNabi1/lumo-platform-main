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
