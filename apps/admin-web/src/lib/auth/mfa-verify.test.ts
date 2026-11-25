import { beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf, verifyLoginCode } from "./mfa-verify";

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

const base = {
  runtimeUrl: "https://api.test",
  tenantId: "tenant-local",
  challenge: "signed.challenge.jwt",
  code: "123456",
};

beforeEach(() => {
  expect.hasAssertions();
});

describe("verifyLoginCode", () => {
  it("posts { challenge, code } to the staff verify route with the tenant header", async () => {
    const { fetchImpl, seen } = spy(200, {
      accessToken: "tok",
      tokenType: "Bearer",
      expiresIn: 7200,
    });
    expect(await verifyLoginCode({ ...base, via: "staff", fetchImpl })).toEqual({
      ok: true,
      token: "tok",
      expiresIn: 7200,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.test/api/v1/public/auth/staff/login/verify");
    expect(seen[0]?.init?.method).toBe("POST");
    expect((seen[0]?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe("tenant-local");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      challenge: "signed.challenge.jwt",
      code: "123456",
    });
  });

  it("uses the merchant verify route for a merchant sign-in", async () => {
    const { fetchImpl, seen } = spy(200, { accessToken: "tok", expiresIn: 60 });
    await verifyLoginCode({ ...base, via: "merchant", fetchImpl });
    expect(seen[0]?.url).toBe("https://api.test/api/v1/public/auth/merchant/login/verify");
  });

  it("maps the nested INVALID_CODE 401 to code (try again on the form)", async () => {
    const { fetchImpl } = spy(401, {
      error: { code: "INVALID_CODE", message: "That code didn't work. Try again." },
    });
    expect(await verifyLoginCode({ ...base, via: "staff", fetchImpl })).toEqual({
      ok: false,
      reason: "code",
    });
  });

  it("reads a flat code envelope too (body.error?.code ?? body.code)", async () => {
    const { fetchImpl } = spy(401, { code: "INVALID_CODE" });
    expect(await verifyLoginCode({ ...base, via: "staff", fetchImpl })).toEqual({
      ok: false,
      reason: "code",
    });
  });

  it.each([
    ["CHALLENGE_EXPIRED", { error: { code: "CHALLENGE_EXPIRED" } }],
    ["a deactivated member (UNAUTHENTICATED)", { error: { code: "UNAUTHENTICATED" } }],
    ["no body at all", null],
  ])("maps a 401 for %s to expired (start over)", async (_name, body) => {
    const { fetchImpl } = spy(401, body);
    expect(await verifyLoginCode({ ...base, via: "staff", fetchImpl })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("maps 429 to limited and a refused shape (422) to code", async () => {
    expect(
      await verifyLoginCode({
        ...base,
        via: "staff",
        fetchImpl: spy(429, { code: "RATE_LIMITED" }).fetchImpl,
      }),
    ).toEqual({ ok: false, reason: "limited" });
    expect(
      await verifyLoginCode({
        ...base,
        via: "staff",
        fetchImpl: spy(422, { code: "VALIDATION" }).fetchImpl,
      }),
    ).toEqual({ ok: false, reason: "code" });
  });

  it.each([[500], [503], [403]])("maps %s to unavailable", async (status) => {
    expect(
      await verifyLoginCode({ ...base, via: "staff", fetchImpl: spy(status, {}).fetchImpl }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("treats a 200 without a token as unavailable, and a network failure as unavailable", async () => {
    expect(
      await verifyLoginCode({ ...base, via: "staff", fetchImpl: spy(200, { nope: 1 }).fetchImpl }),
    ).toEqual({ ok: false, reason: "unavailable" });
    const down = (() => Promise.reject(new Error("down"))) as typeof fetch;
    expect(await verifyLoginCode({ ...base, via: "staff", fetchImpl: down })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("errorCodeOf", () => {
  it("prefers the nested code and falls back to the flat one", () => {
    expect(errorCodeOf({ error: { code: "A" }, code: "B" })).toBe("A");
    expect(errorCodeOf({ code: "B" })).toBe("B");
    expect(errorCodeOf(null)).toBeUndefined();
    expect(errorCodeOf({ error: "text" })).toBeUndefined();
  });
});
