import { describe, expect, it } from "vitest";
import { isShopDomainDto, platformDomain, primaryDomain, type ShopDomainDto } from "./model";

function domain(overrides: Partial<ShopDomainDto>): ShopDomainDto {
  return {
    id: "d1",
    shopId: "shop-1",
    hostname: "acme.morbeh.test",
    kind: "platform",
    status: "verified",
    isPrimary: false,
    verifiedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("domain helpers", () => {
  const platform = domain({ id: "p", isPrimary: true });
  const custom = domain({
    id: "c",
    hostname: "shop.acme.com",
    kind: "custom",
    status: "pending",
    verifiedAt: null,
  });

  it("finds the primary domain", () => {
    expect(primaryDomain([custom, platform])).toBe(platform);
    expect(primaryDomain([custom])).toBeNull();
    expect(primaryDomain([])).toBeNull();
  });

  it("finds the platform domain", () => {
    expect(platformDomain([custom, platform])).toBe(platform);
    expect(platformDomain([custom])).toBeNull();
  });

  it("guards the runtime's domain shape", () => {
    expect(isShopDomainDto(platform)).toBe(true);
    expect(isShopDomainDto(custom)).toBe(true);
    expect(isShopDomainDto({ ...platform, kind: "other" })).toBe(false);
    expect(isShopDomainDto({ ...platform, status: "failed" })).toBe(false);
    expect(isShopDomainDto({ ...platform, isPrimary: "yes" })).toBe(false);
    expect(isShopDomainDto({ ...platform, verifiedAt: undefined })).toBe(false);
    expect(isShopDomainDto(null)).toBe(false);
  });
});
