import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertStorefrontProductionEnv, storefrontSecrets } from "./storefront-env";

const S = "s".repeat(32);

describe("storefront env (spec 1.12 Environment)", () => {
  it("accepts only secrets of at least 32 bytes and a real admin origin", () => {
    expect(
      storefrontSecrets({
        STOREFRONT_ACCESS_SECRET: "short",
        STOREFRONT_REVALIDATE_SECRET: S,
        ADMIN_ORIGIN: "https://admin.example.com/path",
      }),
    ).toEqual({
      accessSecret: null,
      revalidateSecret: S,
      adminOrigin: "https://admin.example.com",
    });
  });

  it("asserts in production, names every missing item, and is silent in local", () => {
    expect(() => assertStorefrontProductionEnv({ APP_ENV: "production" })).toThrow(
      /STOREFRONT_ACCESS_SECRET.*STOREFRONT_REVALIDATE_SECRET.*ADMIN_ORIGIN/,
    );
    expect(() =>
      assertStorefrontProductionEnv({
        APP_ENV: "production",
        STOREFRONT_ACCESS_SECRET: S,
        STOREFRONT_REVALIDATE_SECRET: S,
        ADMIN_ORIGIN: "https://admin.example.com",
      }),
    ).not.toThrow();
    expect(() => assertStorefrontProductionEnv({})).not.toThrow();
  });
});

describe("register() (preflight 26)", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // Pin every variable register() reads, so a developer's shell cannot change the outcome.
    for (const name of [
      "STOREFRONT_ACCESS_SECRET",
      "STOREFRONT_REVALIDATE_SECRET",
      "ADMIN_ORIGIN",
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    error.mockRestore();
    vi.unstubAllEnvs();
  });

  const loadRegister = async () => (await import("../instrumentation")).register;

  it("is silent outside production builds", async () => {
    vi.stubEnv("NODE_ENV", "test");
    (await loadRegister())();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs the missing names when a production build runs under a dev-like APP_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "local");
    (await loadRegister())();
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toMatch(/STOREFRONT_ACCESS_SECRET.*STOREFRONT_REVALIDATE_SECRET.*ADMIN_ORIGIN/);
  });

  it("is silent under a dev-like APP_ENV when nothing is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("STOREFRONT_ACCESS_SECRET", S);
    vi.stubEnv("STOREFRONT_REVALIDATE_SECRET", S);
    vi.stubEnv("ADMIN_ORIGIN", "https://admin.example.com");
    (await loadRegister())();
    expect(error).not.toHaveBeenCalled();
  });

  it("throws, not logs, when APP_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    expect(await loadRegister()).toThrow(/missing production configuration/);
    expect(error).not.toHaveBeenCalled();
  });
});
