import { describe, expect, it } from "vitest";
import { isStorefrontPagePath, randomRouteToken, routePathFromTitle } from "./route-path";

describe("routePathFromTitle (Ruling 19)", () => {
  it("slugifies a Latin title; an Arabic-only title gets page-<random> (Ruling 19)", () => {
    expect(routePathFromTitle({ en: "About Us!  2026" })).toBe("/pages/about-us-2026");
    expect(routePathFromTitle({ ar: "من نحن", en: "" }, () => "k3x9")).toBe("/pages/page-k3x9");
    expect(routePathFromTitle({ en: "a".repeat(80) })).toBe(`/pages/${"a".repeat(60)}`);
    expect(isStorefrontPagePath("/pages/about")).toBe(true);
    expect(isStorefrontPagePath("/landing")).toBe(false);
  });
  it("never ends on a dash after cutting at 60, and drops accents rather than letters", () => {
    expect(routePathFromTitle({ en: `${"a".repeat(59)} b` })).toBe(`/pages/${"a".repeat(59)}`);
    expect(routePathFromTitle({ en: "Café crème" })).toBe("/pages/cafe-creme");
  });
  it("uses Latin words from the Arabic title when the English one is empty", () => {
    expect(routePathFromTitle({ ar: "سياسة FAQ" }, () => "zzzz")).toBe("/pages/faq");
  });
  it("is a path the storefront serves, so a derived address is always on the storefront", () => {
    expect(isStorefrontPagePath(routePathFromTitle({ en: "Shipping & returns" }))).toBe(true);
    expect(isStorefrontPagePath(routePathFromTitle({ ar: "من نحن" }))).toBe(true);
  });
  it("draws four lower-case letters or digits for the random part", () => {
    for (let i = 0; i < 50; i += 1) expect(randomRouteToken()).toMatch(/^[a-z0-9]{4}$/);
  });
  it("only /pages/<handle> with the storefront's handle rule is on the storefront", () => {
    expect(isStorefrontPagePath("/pages/")).toBe(false);
    expect(isStorefrontPagePath("/pages/a/b")).toBe(false);
    expect(isStorefrontPagePath("/pages/About")).toBe(false);
    expect(isStorefrontPagePath(`/pages/${"a".repeat(101)}`)).toBe(false);
  });
});
