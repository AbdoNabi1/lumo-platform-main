import { describe, expect, it } from "vitest";
import {
  claimTenantResolver,
  domainTenantResolver,
  headerTenantResolver,
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
