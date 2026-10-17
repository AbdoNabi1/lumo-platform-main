import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeMerchantReset,
  exchangeMerchantPassword,
  requestMerchantReset,
  signUpMerchant,
  signupEnabled,
} from "./merchant";

const reply = (status: number, body: unknown = {}): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
const boom = (() => Promise.reject(new Error("network down"))) as typeof fetch;

interface Seen {
  url: string;
  init: RequestInit | undefined;
}
function spy(status: number, body: unknown = {}): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fetchImpl, seen };
}
const headerOf = (seen: Seen | undefined, name: string) =>
  (seen?.init?.headers as Record<string, string>)[name];

const base = { runtimeUrl: "https://api.test", tenantId: "platform-tenant" };
const signupBase = {
  ...base,
  storeName: "My Shop",
  email: "o@x.test",
  password: "fake-password-1",
  country: "EG" as const,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signupEnabled", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["", false],
  ])("ADMIN_SIGNUP_ENABLED=%j -> %s", (value, expected) => {
    vi.stubEnv("ADMIN_SIGNUP_ENABLED", value);
    expect(signupEnabled()).toBe(expected);
  });

  it("is off when unset", () => {
    vi.stubEnv("ADMIN_SIGNUP_ENABLED", undefined);
    expect(signupEnabled()).toBe(false);
  });
});

describe("signUpMerchant", () => {
  it("posts the sign-up body with the platform tenant header", async () => {
    const { fetchImpl, seen } = spy(201, {
      tenantId: "t1",
      storeUrl: "https://s.test",
      accessToken: "tok",
      tokenType: "Bearer",
      expiresIn: 900,
    });
    const result = await signUpMerchant({ ...signupBase, fetchImpl });
    expect(result).toEqual({ ok: true, token: "tok", expiresIn: 900 });
    expect(seen[0]?.url).toBe("https://api.test/api/v1/public/merchant-signup");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(headerOf(seen[0], "x-tenant-id")).toBe("platform-tenant");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      storeName: "My Shop",
      email: "o@x.test",
      password: "fake-password-1",
      country: "EG",
    });
  });

  it("maps a 201 with signInRequired to signInRequired", async () => {
    const fetchImpl = reply(201, {
      tenantId: "t1",
      storeUrl: "https://s.test",
      signInRequired: true,
    });
    expect(await signUpMerchant({ ...signupBase, fetchImpl })).toEqual({
      ok: true,
      signInRequired: true,
    });
  });

  it("maps a 201 with neither token nor signInRequired to unavailable", async () => {
    expect(await signUpMerchant({ ...signupBase, fetchImpl: reply(201, {}) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("maps 409 to taken", async () => {
    expect(
      await signUpMerchant({ ...signupBase, fetchImpl: reply(409, { code: "EMAIL_TAKEN" }) }),
    ).toEqual({ ok: false, reason: "taken" });
  });

  it.each([400, 422])("maps %s to invalid and carries the envelope's fields", async (status) => {
    const fields = [{ field: "password", message: "too short" }];
    expect(
      await signUpMerchant({
        ...signupBase,
        fetchImpl: reply(status, { code: "VALIDATION", fields }),
      }),
    ).toEqual({ ok: false, reason: "invalid", fields });
  });

  it("maps 400 without usable fields to invalid with no fields", async () => {
    expect(
      await signUpMerchant({ ...signupBase, fetchImpl: reply(400, { fields: "nope" }) }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("maps 429 to limited", async () => {
    expect(await signUpMerchant({ ...signupBase, fetchImpl: reply(429) })).toEqual({
      ok: false,
      reason: "limited",
    });
  });

  it.each([500, 503])("maps %s to unavailable", async (status) => {
    expect(await signUpMerchant({ ...signupBase, fetchImpl: reply(status) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("maps a network failure to unavailable", async () => {
    expect(await signUpMerchant({ ...signupBase, fetchImpl: boom })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("exchangeMerchantPassword", () => {
  const loginBase = { ...base, email: "o@x.test", password: "fake-password-1" };

  it("posts credentials to the merchant login route and returns the token", async () => {
    const { fetchImpl, seen } = spy(200, { accessToken: "tok", expiresIn: 900 });
    expect(await exchangeMerchantPassword({ ...loginBase, fetchImpl })).toEqual({
      ok: true,
      token: "tok",
      expiresIn: 900,
    });
    expect(seen[0]?.url).toBe("https://api.test/api/v1/public/auth/merchant/login");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(headerOf(seen[0], "x-tenant-id")).toBe("platform-tenant");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      email: "o@x.test",
      password: "fake-password-1",
    });
  });

  it("maps 401 to invalid", async () => {
    expect(await exchangeMerchantPassword({ ...loginBase, fetchImpl: reply(401) })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("maps the runtime's nested 403 MFA_REQUIRED envelope to mfa", async () => {
    expect(
      await exchangeMerchantPassword({
        ...loginBase,
        fetchImpl: reply(403, {
          error: { code: "MFA_REQUIRED", message: "An additional factor is required" },
          mfaRequirement: "totp",
        }),
      }),
    ).toEqual({ ok: false, reason: "mfa" });
  });

  it("also accepts a flat 403 MFA_REQUIRED envelope", async () => {
    expect(
      await exchangeMerchantPassword({
        ...loginBase,
        fetchImpl: reply(403, { code: "MFA_REQUIRED" }),
      }),
    ).toEqual({ ok: false, reason: "mfa" });
  });

  it("maps any other 403 to unavailable", async () => {
    expect(
      await exchangeMerchantPassword({
        ...loginBase,
        fetchImpl: reply(403, { code: "FORBIDDEN" }),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([429, 500, 503])("maps %s to unavailable", async (status) => {
    expect(await exchangeMerchantPassword({ ...loginBase, fetchImpl: reply(status) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("maps a 200 with a malformed body to unavailable", async () => {
    expect(await exchangeMerchantPassword({ ...loginBase, fetchImpl: reply(200, {}) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("maps a network failure to unavailable", async () => {
    expect(await exchangeMerchantPassword({ ...loginBase, fetchImpl: boom })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("requestMerchantReset", () => {
  const requestBase = { ...base, email: "o@x.test" };

  it("posts the email to the merchant request route with the platform tenant header", async () => {
    const { fetchImpl, seen } = spy(202);
    expect(await requestMerchantReset({ ...requestBase, fetchImpl })).toBe("sent");
    expect(seen[0]?.url).toBe(
      "https://api.test/api/v1/public/auth/merchant/password-reset/request",
    );
    expect(seen[0]?.init?.method).toBe("POST");
    expect(headerOf(seen[0], "x-tenant-id")).toBe("platform-tenant");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ email: "o@x.test" });
  });

  it.each([
    [429, "limited"],
    [400, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps %s to %s", async (status, outcome) => {
    expect(await requestMerchantReset({ ...requestBase, fetchImpl: reply(status) })).toBe(outcome);
  });

  it("maps a network failure to unavailable", async () => {
    expect(await requestMerchantReset({ ...requestBase, fetchImpl: boom })).toBe("unavailable");
  });
});

describe("completeMerchantReset", () => {
  const completeBase = {
    ...base,
    store: "shop-1",
    token: "fake-token-value",
    password: "fake-password-1",
  };

  it("posts store, token and password to the merchant complete route", async () => {
    const { fetchImpl, seen } = spy(200);
    expect(await completeMerchantReset({ ...completeBase, fetchImpl })).toBe("done");
    expect(seen[0]?.url).toBe(
      "https://api.test/api/v1/public/auth/merchant/password-reset/complete",
    );
    expect(seen[0]?.init?.method).toBe("POST");
    expect(headerOf(seen[0], "x-tenant-id")).toBe("platform-tenant");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      store: "shop-1",
      token: "fake-token-value",
      password: "fake-password-1",
    });
  });

  it.each([
    [200, "done"],
    [400, "invalid"],
    [422, "weak"],
    [429, "limited"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps %s to %s", async (status, outcome) => {
    expect(await completeMerchantReset({ ...completeBase, fetchImpl: reply(status) })).toBe(
      outcome,
    );
  });

  it("maps a network failure to unavailable", async () => {
    expect(await completeMerchantReset({ ...completeBase, fetchImpl: boom })).toBe("unavailable");
  });
});
