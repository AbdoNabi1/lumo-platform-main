import { describe, expect, it } from "vitest";
import { POLICY_SLUGS, POLICY_TYPES } from "@platform/storefront-content";
import { LOCKED_REACHABLE_ROUTES, LOCKED_VIEW_HEADER, reachWhileLocked } from "./locked-routes";

describe("LOCKED_REACHABLE_ROUTES (Decision 34, Ruling 5)", () => {
  it("is exactly seven routes: the five policies, robots and the sitemap", () => {
    expect(LOCKED_REACHABLE_ROUTES).toHaveLength(3);
    for (const path of [
      "/policies/refund-policy",
      "/policies/shipping-policy",
      "/policies/privacy-policy",
      "/policies/terms-of-service",
      "/policies/contact-information",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(reachWhileLocked(path, "GET", LOCKED_REACHABLE_ROUTES), path).toBe("reachable");
      expect(reachWhileLocked(path, "POST", LOCKED_REACHABLE_ROUTES), path).toBe("forbidden");
    }
  });

  it("the policy alternation is every policy slug, and nothing else", () => {
    for (const type of POLICY_TYPES) {
      const path = `/policies/${POLICY_SLUGS[type]}`;
      expect(reachWhileLocked(path, "HEAD", LOCKED_REACHABLE_ROUTES), path).toBe("reachable");
    }
    expect(LOCKED_REACHABLE_ROUTES[0]?.source).toBe(
      "^\\/policies\\/(refund-policy|shipping-policy|privacy-policy|terms-of-service|contact-information)$",
    );
  });

  it("everything near them stays gated (Review Focus 1)", () => {
    for (const path of [
      "/policies/refund",
      "/policies/constructor",
      "/policies/__proto__",
      "/policies/refund-policy/",
      "/policies/Refund-Policy",
      "/policies/refund-policy/x",
      "/policies/..%2Fproducts%2Fx",
      "/policies/refund%2Dpolicy",
      "/policies",
      "/robots.txt/x",
      "/sitemap.xml.gz",
      "/sitemap-0.xml",
      "/password/x",
      "/robotsxtxt",
      "/sitemapxxml",
      "/x/robots.txt",
      "/policies/refund-policy\n",
    ]) {
      expect(reachWhileLocked(path, "GET", LOCKED_REACHABLE_ROUTES), path).toBe("gated");
    }
  });

  it("names the locked-view header the middleware sets", () => {
    expect(LOCKED_VIEW_HEADER).toBe("x-morbeh-locked-view");
  });
});

describe("reachWhileLocked (review M-2)", () => {
  it("a listed route is reachable for GET and HEAD only; other methods are forbidden", () => {
    const routes = [/^\/policies\/[a-z0-9-]+$/];
    expect(reachWhileLocked("/policies/refund-policy", "GET", routes)).toBe("reachable");
    expect(reachWhileLocked("/policies/refund-policy", "HEAD", routes)).toBe("reachable");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(reachWhileLocked("/policies/refund-policy", method, routes), method).toBe("forbidden");
    }
    expect(reachWhileLocked("/policies/a/b", "GET", routes)).toBe("gated");
    expect(reachWhileLocked("/products/a", "GET", routes)).toBe("gated");
  });
});
