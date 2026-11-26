import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("exchangePassword — the code step (Wave 1e)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("carries the challenge and its lifetime from a 403 for a member with two-step on", async () => {
    const body = {
      error: { code: "MFA_REQUIRED", message: "Enter the code from your authenticator app" },
      mfaRequirement: "required",
      challenge: "signed.challenge.jwt",
      challengeExpiresIn: 300,
    };
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, body) })).toEqual({
      ok: false,
      reason: "mfa",
      challenge: "signed.challenge.jwt",
      challengeExpiresIn: 300,
    });
  });

  it("is a plain mfa result (no challenge keys) when the 403 carries none", async () => {
    const result = await exchangePassword({
      ...base,
      fetchImpl: ok(403, { error: { code: "MFA_REQUIRED" }, mfaRequirement: "required" }),
    });
    expect(result).toEqual({ ok: false, reason: "mfa" });
    expect("challenge" in result).toBe(false);
  });

  it("ignores a challenge that is not a non-empty string, and caps a huge lifetime", async () => {
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, { challenge: 7 }) })).toEqual({
      ok: false,
      reason: "mfa",
    });
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, { challenge: "" }) })).toEqual({
      ok: false,
      reason: "mfa",
    });
    expect(
      await exchangePassword({
        ...base,
        fetchImpl: ok(403, { challenge: "c", challengeExpiresIn: 99999 }),
      }),
    ).toEqual({ ok: false, reason: "mfa", challenge: "c", challengeExpiresIn: 600 });
  });

  it("survives a 403 whose body is not JSON", async () => {
    const fetchImpl = (async () => new Response("<html>", { status: 403 })) as typeof fetch;
    expect(await exchangePassword({ ...base, fetchImpl })).toEqual({ ok: false, reason: "mfa" });
  });
});

describe("exchangePassword — setup at sign-in (Wave 1f)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const SETUP_BODY = {
    error: { code: "MFA_SETUP_REQUIRED", message: "Set up two-step verification to continue" },
    setupChallenge: "signed.setup.jwt",
    setupChallengeExpiresIn: 600,
  };

  it("carries the setup challenge and its lifetime from the nested MFA_SETUP_REQUIRED 403", async () => {
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, SETUP_BODY) })).toEqual({
      ok: false,
      reason: "mfa_setup",
      setupChallenge: "signed.setup.jwt",
      setupChallengeExpiresIn: 600,
    });
  });

  it("caps the lifetime at 600 s and drops a nonsense one", async () => {
    expect(
      await exchangePassword({
        ...base,
        fetchImpl: ok(403, { ...SETUP_BODY, setupChallengeExpiresIn: 99999 }),
      }),
    ).toMatchObject({ reason: "mfa_setup", setupChallengeExpiresIn: 600 });
    const noLifetime = await exchangePassword({
      ...base,
      fetchImpl: ok(403, { ...SETUP_BODY, setupChallengeExpiresIn: -4 }),
    });
    expect(noLifetime).toEqual({
      ok: false,
      reason: "mfa_setup",
      setupChallenge: "signed.setup.jwt",
    });
  });

  it("is a plain mfa result when MFA_SETUP_REQUIRED names no usable challenge", async () => {
    const body = { error: { code: "MFA_SETUP_REQUIRED" }, setupChallenge: "" };
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, body) })).toEqual({
      ok: false,
      reason: "mfa",
    });
  });

  it("still reads an MFA_REQUIRED 403 as the code step, never as setup", async () => {
    const body = { error: { code: "MFA_REQUIRED" }, challenge: "c", setupChallenge: "nope" };
    expect(await exchangePassword({ ...base, fetchImpl: ok(403, body) })).toEqual({
      ok: false,
      reason: "mfa",
      challenge: "c",
    });
  });
});
