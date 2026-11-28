import { beforeEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

beforeEach(() => {
  expect.hasAssertions();
});

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:***@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

describe("AD_PLATFORM_CREDENTIALS_KEK_REF (Lead Site Part D1)", () => {
  it("is absent by default, so saving an ad platform token answers 503 instead of storing a stub", () => {
    expect(loadRuntimeConfig(validEnv).AD_PLATFORM_CREDENTIALS_KEK_REF).toBeUndefined();
  });

  it("refuses 31 characters, naming the variable", () => {
    expect(() =>
      loadRuntimeConfig({ ...validEnv, AD_PLATFORM_CREDENTIALS_KEK_REF: "k".repeat(31) }),
    ).toThrow(/AD_PLATFORM_CREDENTIALS_KEK_REF/);
  });

  it("accepts 32 characters", () => {
    expect(
      loadRuntimeConfig({ ...validEnv, AD_PLATFORM_CREDENTIALS_KEK_REF: "k".repeat(32) })
        .AD_PLATFORM_CREDENTIALS_KEK_REF,
    ).toBe("k".repeat(32));
  });

  it("is independent of PAYMENT_CREDENTIALS_KEK_REF", () => {
    const config = loadRuntimeConfig({ ...validEnv, PAYMENT_CREDENTIALS_KEK_REF: "p".repeat(40) });
    expect(config.AD_PLATFORM_CREDENTIALS_KEK_REF).toBeUndefined();
  });
});
