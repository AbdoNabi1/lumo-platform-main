import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { ShopDomain } from "./shop-domain";
import { Hostname } from "./value-objects/hostname";

function host(raw: string): Hostname {
  const result = Hostname.create(raw);
  if (!result.ok) throw new Error("bad fixture");
  return result.value;
}

const at = new Date("2026-10-05T00:00:00.000Z");

describe("ShopDomain", () => {
  it("a platform domain is born verified and primary", () => {
    const domain = ShopDomain.platform(
      UniqueEntityId.from("d-1"),
      "shop-1",
      host("acme.morbeh.store"),
      at,
    );
    expect(domain.kind).toBe("platform");
    expect(domain.status).toBe("verified");
    expect(domain.isPrimary).toBe(true);
    expect(domain.verifiedAt).toEqual(at);
  });

  it("a custom domain is born pending and not primary", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-2"), "shop-1", host("acme.com"));
    expect(domain.status).toBe("pending");
    expect(domain.isPrimary).toBe(false);
    expect(domain.verifiedAt).toBeUndefined();
  });

  it("refuses to make a pending domain primary", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-3"), "shop-1", host("acme.com"));
    expect(() => domain.makePrimary()).toThrow(/verified/);
  });

  it("verify is idempotent and keeps the first verification time", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-4"), "shop-1", host("acme.com"));
    domain.verify(at);
    domain.verify(new Date("2027-01-01T00:00:00.000Z"));
    expect(domain.status).toBe("verified");
    expect(domain.verifiedAt).toEqual(at);
    domain.makePrimary();
    expect(domain.isPrimary).toBe(true);
    domain.demote();
    expect(domain.isPrimary).toBe(false);
  });

  it("raises no domain events (no new event types, G-80)", () => {
    const domain = ShopDomain.platform(UniqueEntityId.from("d-5"), "shop-1", host("a.b.c"), at);
    expect(domain.pullDomainEvents()).toEqual([]);
  });
});
