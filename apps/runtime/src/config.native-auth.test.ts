import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

// Fake local values, nothing real; the signing key is generated in memory and never written anywhere.
const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
} satisfies NodeJS.ProcessEnv;

const key = Buffer.from(
  generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
).toString("base64");

describe("AUTH_MODE (Plan 1B-2)", () => {
  it("defaults to ory with the usual defaults", () => {
    const c = loadRuntimeConfig({ ...base, APP_ENV: "local" });
    expect(c.AUTH_MODE).toBe("ory");
    expect(c.STAFF_TOKEN_TTL_SECONDS).toBe(7200);
  });

  it("ory outside local still demands the Ory URLs", () => {
    expect(() => loadRuntimeConfig({ ...base, APP_ENV: "production" })).toThrow(/KETO_WRITE_URL/);
  });

  it("native needs a signing key and an issuer", () => {
    expect(() => loadRuntimeConfig({ ...base, APP_ENV: "local", AUTH_MODE: "native" })).toThrow(
      /AUTH_SIGNING_KEY/,
    );
    expect(() =>
      loadRuntimeConfig({
        ...base,
        APP_ENV: "local",
        AUTH_MODE: "native",
        AUTH_SIGNING_KEY: key,
      }),
    ).toThrow(/AUTH_ISSUER_URL/);
  });

  it("native outside local does not demand the Ory URLs", () => {
    const c = loadRuntimeConfig({
      ...base,
      APP_ENV: "production",
      AUTH_MODE: "native",
      AUTH_SIGNING_KEY: key,
      AUTH_ISSUER_URL: "https://api.example.test/",
    });
    expect(c.AUTH_MODE).toBe("native");
    expect(c.AUTH_JWKS_URL).toBeUndefined();
  });

  it("bootstrap owner email and password come together; the password is at least 12", () => {
    expect(() =>
      loadRuntimeConfig({ ...base, APP_ENV: "local", BOOTSTRAP_OWNER_EMAIL: "o@x.test" }),
    ).toThrow();
    expect(() =>
      loadRuntimeConfig({
        ...base,
        APP_ENV: "local",
        BOOTSTRAP_OWNER_EMAIL: "o@x.test",
        BOOTSTRAP_OWNER_PASSWORD: "short",
      }),
    ).toThrow();
  });

  it("the TOTP key must be at least 32 characters", () => {
    expect(() => loadRuntimeConfig({ ...base, APP_ENV: "local", MFA_TOTP_KEY: "short" })).toThrow();
    expect(
      loadRuntimeConfig({ ...base, APP_ENV: "local", MFA_TOTP_KEY: "k".repeat(32) }).MFA_TOTP_KEY,
    ).toHaveLength(32);
  });
});
