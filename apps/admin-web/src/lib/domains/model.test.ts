import { describe, expect, it } from "vitest";
import {
  dnsHostKind,
  dnsRecordsFor,
  isDnsTargetDto,
  isShopDomainDto,
  NO_DNS_TARGET,
  platformDomain,
  primaryDomain,
  type ShopDomainDto,
} from "./model";

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

describe("DNS target", () => {
  const target = { cname: "shops.morbeh.store", ipv4: ["203.0.113.10", "203.0.113.11"] };

  it("guards the runtime's dnsTarget shape", () => {
    expect(isDnsTargetDto(target)).toBe(true);
    expect(isDnsTargetDto(NO_DNS_TARGET)).toBe(true);
    expect(isDnsTargetDto({ cname: null, ipv4: [] })).toBe(true);
    expect(isDnsTargetDto({ cname: 1, ipv4: [] })).toBe(false);
    expect(isDnsTargetDto({ cname: null, ipv4: [1] })).toBe(false);
    expect(isDnsTargetDto({ cname: null })).toBe(false);
    expect(isDnsTargetDto(null)).toBe(false);
  });

  it.each([
    ["example.com", "apex"],
    ["Example.COM.", "apex"],
    ["shop.example.com", "subdomain"],
    ["www.example.com", "subdomain"],
    ["shop.example.com.eg", "subdomain"],
    ["example.com.eg", "unsure"],
    ["example.co.uk", "unsure"],
    ["localhost", "unsure"],
  ] as const)("reads %s as %s", (hostname, kind) => {
    expect(dnsHostKind(hostname)).toBe(kind);
  });

  it("asks a subdomain for a CNAME and an apex for A records", () => {
    expect(dnsRecordsFor("shop.example.com", target)).toEqual([
      { type: "CNAME", target: "shops.morbeh.store" },
    ]);
    expect(dnsRecordsFor("example.com", target)).toEqual([
      { type: "A", targets: ["203.0.113.10", "203.0.113.11"] },
    ]);
  });

  it("offers both records when the host could be either", () => {
    expect(dnsRecordsFor("example.com.eg", target)).toEqual([
      { type: "CNAME", target: "shops.morbeh.store" },
      { type: "A", targets: ["203.0.113.10", "203.0.113.11"] },
    ]);
    expect(dnsRecordsFor("example.com.eg", { cname: null, ipv4: ["203.0.113.10"] })).toEqual([
      { type: "A", targets: ["203.0.113.10"] },
    ]);
  });

  it("returns no record (contact support) when the needed target is not configured", () => {
    expect(dnsRecordsFor("shop.example.com", { cname: null, ipv4: ["203.0.113.10"] })).toEqual([]);
    expect(dnsRecordsFor("example.com", { cname: "shops.morbeh.store", ipv4: [] })).toEqual([]);
    expect(dnsRecordsFor("example.com.eg", NO_DNS_TARGET)).toEqual([]);
  });
});
