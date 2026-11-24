import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://u:***@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  AUTH_ISSUER_URL: "https://issuer.example/",
  AUTH_JWKS_URL: "https://issuer.example/.well-known/jwks.json",
} satisfies NodeJS.ProcessEnv;

describe("TENANT_DEFAULT_ID (the deployment tenant, also the platform scope of the WhatsApp webhook)", () => {
  it("omitted: the repository's existing default is kept", () => {
    expect.hasAssertions();
    expect(loadRuntimeConfig({ ...base }).TENANT_DEFAULT_ID).toBe("tenant-local");
  });

  it("configured: used as given", () => {
    expect.hasAssertions();
    expect(loadRuntimeConfig({ ...base, TENANT_DEFAULT_ID: "shop-42" }).TENANT_DEFAULT_ID).toBe(
      "shop-42",
    );
  });

  it.each([
    ["explicitly empty", ""],
    ["a space", " "],
    ["only whitespace", " \t\n "],
  ])("%s is rejected at config validation, never defaulted", (_name, value) => {
    expect.hasAssertions();
    expect(() => loadRuntimeConfig({ ...base, TENANT_DEFAULT_ID: value })).toThrow(
      /TENANT_DEFAULT_ID/,
    );
  });
});
