import { describe, expect, it } from "vitest";
import { primaryHostnameOf, shopLinkUrl } from "./shop-link-url";

describe("shop link URL (spec §3.6)", () => {
  it("uses the shop's primary VERIFIED hostname", () => {
    expect(
      primaryHostnameOf([
        { hostname: "pending.example", status: "pending", isPrimary: false },
        { hostname: "shop.morbeh.app", status: "verified", isPrimary: false },
        { hostname: "www.sara.shop", status: "verified", isPrimary: true },
      ]),
    ).toBe("www.sara.shop");
  });

  it("has none when no domain is both primary and verified", () => {
    expect(primaryHostnameOf([])).toBeNull();
    expect(
      primaryHostnameOf([{ hostname: "x.shop", status: "pending", isPrimary: true }]),
    ).toBeNull();
  });

  it("builds an https URL, or null so admin-web falls back to STOREFRONT_URL", () => {
    expect(shopLinkUrl("www.sara.shop", "/c/abc")).toBe("https://www.sara.shop/c/abc");
    expect(shopLinkUrl(null, "/c/abc")).toBeNull();
  });
});
