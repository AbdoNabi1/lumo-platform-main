import { describe, expect, it } from "vitest";
import { config } from "./middleware";

// Next compiles the matcher with path-to-regexp; this pattern is also a plain regular expression.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher (preflight 24)", () => {
  it("skips only the exact excluded paths", () => {
    for (const path of [
      "/_next/static/chunk.js",
      "/favicon.ico",
      "/api/tls-allowed",
      "/api/revalidate",
      "/api/revalidate/",
      "/api/revalidate/x",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("keeps everything else behind the middleware, including look-alike prefixes", () => {
    for (const path of [
      "/",
      "/products/abc",
      "/api/revalidates",
      "/api/revalidate-x",
      "/favicon.ico2",
      "/favicon.icon",
      "/api/tls-allowedx",
    ]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});
