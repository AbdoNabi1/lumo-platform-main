import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

const validEnv = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://lumo:lumo@localhost:5432/lumo",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:19092",
  AUTH_ISSUER_URL: "https://auth.morbeh.local",
  AUTH_JWKS_URL: "https://auth.morbeh.local/.well-known/jwks.json",
  KETO_WRITE_URL: "https://keto.morbeh.local:4467",
  KRATOS_PUBLIC_URL: "https://kratos.morbeh.local:4433",
  KRATOS_ADMIN_URL: "https://kratos.morbeh.local:4434",
} as NodeJS.ProcessEnv;

describe("MEDIA_PUBLIC_BASE_URL (Plan 2C-3)", () => {
  it("is absent by default, so uploads answer 503 instead of pretending", () => {
    expect(loadRuntimeConfig(validEnv).MEDIA_PUBLIC_BASE_URL).toBeUndefined();
  });

  it("reads a url", () => {
    const config = loadRuntimeConfig({
      ...validEnv,
      MEDIA_PUBLIC_BASE_URL: "https://cdn.example.test/storage/v1/object/public/media",
    });
    expect(config.MEDIA_PUBLIC_BASE_URL).toBe(
      "https://cdn.example.test/storage/v1/object/public/media",
    );
  });

  it("treats the empty placeholder from the env example as unset", () => {
    expect(
      loadRuntimeConfig({ ...validEnv, MEDIA_PUBLIC_BASE_URL: "" }).MEDIA_PUBLIC_BASE_URL,
    ).toBeUndefined();
  });

  it("refuses a value that is not a url, naming the variable", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, MEDIA_PUBLIC_BASE_URL: "not a url" })).toThrow(
      /MEDIA_PUBLIC_BASE_URL/,
    );
  });
});
