import { beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

beforeEach(() => {
  expect.hasAssertions();
});

const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

describe("carrier config", () => {
  it("is optional and absent by default", () => {
    const config = loadRuntimeConfig({ ...base });
    expect(config.SHIPPING_CREDENTIALS_KEK_REF).toBeUndefined();
    expect(config.ADMIN_API_PUBLIC_URL).toBeUndefined();
  });

  it("accepts a 32+ char KEK ref and a url", () => {
    const config = loadRuntimeConfig({
      ...base,
      SHIPPING_CREDENTIALS_KEK_REF: "k".repeat(32),
      ADMIN_API_PUBLIC_URL: "https://api.example.com",
    });
    expect(config.SHIPPING_CREDENTIALS_KEK_REF).toBe("k".repeat(32));
    expect(config.ADMIN_API_PUBLIC_URL).toBe("https://api.example.com");
  });

  it("rejects a short KEK ref and a non-url origin", () => {
    expect(() => loadRuntimeConfig({ ...base, SHIPPING_CREDENTIALS_KEK_REF: "short" })).toThrow(
      /SHIPPING_CREDENTIALS_KEK_REF/,
    );
    expect(() => loadRuntimeConfig({ ...base, ADMIN_API_PUBLIC_URL: "not a url" })).toThrow(
      /ADMIN_API_PUBLIC_URL/,
    );
  });
});
