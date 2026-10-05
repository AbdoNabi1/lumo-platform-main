import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

// Same placeholder base as api-exposure.test.ts: fake local values, nothing real.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

describe("Plan 1A config", () => {
  it("is all optional and off by default", () => {
    const config = loadRuntimeConfig({ ...base });
    expect(config.PLATFORM_STORE_DOMAIN).toBeUndefined();
    expect(config.STOREFRONT_CNAME_TARGET).toBeUndefined();
    expect(config.STOREFRONT_IPV4).toEqual([]);
  });

  it("parses a comma-separated IPv4 list", () => {
    const config = loadRuntimeConfig({
      ...base,
      PLATFORM_STORE_DOMAIN: "morbeh.store",
      STOREFRONT_CNAME_TARGET: "shops.morbeh.store",
      STOREFRONT_IPV4: " 203.0.113.10, 203.0.113.11 ",
    });
    expect(config.PLATFORM_STORE_DOMAIN).toBe("morbeh.store");
    expect(config.STOREFRONT_IPV4).toEqual(["203.0.113.10", "203.0.113.11"]);
  });

  it("rejects a non-IPv4 entry", () => {
    expect(() => loadRuntimeConfig({ ...base, STOREFRONT_IPV4: "not-an-ip" })).toThrow();
  });
});
