import { describe, expect, it } from "vitest";
import { LOCKED_REACHABLE_ROUTES, reachWhileLocked } from "./locked-routes";

describe("reachWhileLocked (Decision 34, review M-1, M-2)", () => {
  it("lists no route in Part 1: nothing renders for a locked store without access", () => {
    expect(LOCKED_REACHABLE_ROUTES).toEqual([]);
    for (const path of ["/policies/refund-policy", "/robots.txt", "/sitemap.xml", "/password/x"]) {
      expect(reachWhileLocked(path, "GET", LOCKED_REACHABLE_ROUTES), path).toBe("gated");
    }
  });

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
