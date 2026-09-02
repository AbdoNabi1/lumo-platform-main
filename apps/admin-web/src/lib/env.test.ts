import { afterEach, describe, expect, it, vi } from "vitest";
import { optionalEnv, requireProdEnv } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireProdEnv", () => {
  it("returns the dev default when APP_ENV is unset (defaults to local)", () => {
    vi.stubEnv("APP_ENV", "");
    delete process.env["APP_ENV"];
    delete process.env["HYDRA_PUBLIC_URL"];
    expect(requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toBe(
      "http://localhost:4444",
    );
  });

  it("returns the dev default when APP_ENV=local and the var is unset", () => {
    vi.stubEnv("APP_ENV", "local");
    delete process.env["HYDRA_PUBLIC_URL"];
    expect(requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toBe(
      "http://localhost:4444",
    );
  });

  it("returns the dev default when APP_ENV=development and the var is unset", () => {
    vi.stubEnv("APP_ENV", "development");
    delete process.env["HYDRA_PUBLIC_URL"];
    expect(requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toBe(
      "http://localhost:4444",
    );
  });

  it("throws when APP_ENV=production and the var is unset — never falls back to localhost", () => {
    vi.stubEnv("APP_ENV", "production");
    delete process.env["HYDRA_PUBLIC_URL"];
    expect(() => requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toThrow(
      /Missing production environment variable: HYDRA_PUBLIC_URL/,
    );
  });

  it("throws when APP_ENV=staging and the var is unset", () => {
    vi.stubEnv("APP_ENV", "staging");
    delete process.env["HYDRA_PUBLIC_URL"];
    expect(() => requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toThrow();
  });

  it("returns the real value when set, regardless of APP_ENV", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("HYDRA_PUBLIC_URL", "https://auth.lumo.example.com");
    expect(requireProdEnv("HYDRA_PUBLIC_URL", "http://localhost:4444")).toBe(
      "https://auth.lumo.example.com",
    );
  });
});

describe("optionalEnv", () => {
  it("returns the fallback when unset", () => {
    delete process.env["AUTH_AUDIENCE"];
    expect(optionalEnv("AUTH_AUDIENCE", "lumo-admin")).toBe("lumo-admin");
  });

  it("returns the real value when set, even in production", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("AUTH_AUDIENCE", "custom-audience");
    expect(optionalEnv("AUTH_AUDIENCE", "lumo-admin")).toBe("custom-audience");
  });
});
