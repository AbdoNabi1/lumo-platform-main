import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangePassword, jwksFetchHeaders, nativeTenantId } from "./native";

const ok = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

const base = {
  runtimeUrl: "https://api.test",
  tenantId: "tenant-local",
  email: "o@x.test",
  password: "fake-password-1",
};

describe("exchangePassword", () => {
  it("returns the token on 200 and posts to the staff login route with the tenant header", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ accessToken: "t", tokenType: "Bearer", expiresIn: 7200 }),
        { status: 200 },
      );
    }) as typeof fetch;
    expect(await exchangePassword({ ...base, fetchImpl })).toEqual({
      ok: true,
      token: "t",
      expiresIn: 7200,
    });
    expect(seen?.url).toBe("https://api.test/api/v1/public/auth/staff/login");
    expect((seen?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe("tenant-local");
  });

  it.each([
    [401, "invalid"],
    [403, "mfa"],
    [429, "unavailable"],
    [503, "unavailable"],
    [500, "unavailable"],
  ] as const)("maps %s to %s", async (status, reason) => {
    expect(await exchangePassword({ ...base, fetchImpl: ok(status, {}) })).toEqual({
      ok: false,
      reason,
    });
  });

  it("a network failure is 'unavailable', never a throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    expect(await exchangePassword({ ...base, fetchImpl })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("tenant for native sign-in", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds no JWKS header in ory mode, and the tenant header only when native", () => {
    vi.stubEnv("TENANT_DEFAULT_ID", "shop-1");
    expect(jwksFetchHeaders()).toEqual({});
    vi.stubEnv("AUTH_MODE", "native");
    expect(jwksFetchHeaders()).toEqual({ "x-tenant-id": "shop-1" });
  });

  it("falls back to tenant-local only in local, and fails closed outside it", () => {
    vi.stubEnv("TENANT_DEFAULT_ID", "");
    vi.stubEnv("APP_ENV", "local");
    expect(nativeTenantId()).toBe("tenant-local");
    vi.stubEnv("APP_ENV", "production");
    expect(() => nativeTenantId()).toThrow(/TENANT_DEFAULT_ID/);
  });
});
