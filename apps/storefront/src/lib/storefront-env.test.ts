import { describe, expect, it, vi } from "vitest";
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
  async function registerWith(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { register } = await import("../instrumentation");
    return register;
  }

  it("is silent outside production builds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const register = await registerWith({ NEXT_RUNTIME: "nodejs", NODE_ENV: "test" });
    register();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs the missing names when a production build runs under a dev-like APP_ENV", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const register = await registerWith({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      APP_ENV: "local",
    });
    register();
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toMatch(/STOREFRONT_ACCESS_SECRET.*STOREFRONT_REVALIDATE_SECRET.*ADMIN_ORIGIN/);
    error.mockRestore();
    vi.unstubAllEnvs();
  });

  it("throws, not logs, when APP_ENV is production", async () => {
    const register = await registerWith({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      APP_ENV: "production",
    });
    expect(() => register()).toThrow(/missing production configuration/);
    vi.unstubAllEnvs();
  });
});
