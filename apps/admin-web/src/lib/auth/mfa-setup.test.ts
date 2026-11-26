import { beforeEach, describe, expect, it } from "vitest";
import { confirmLoginSetup, startLoginSetup } from "./mfa-setup";

const reply = (status: number, body: unknown = {}): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
const boom = (() => Promise.reject(new Error("network down"))) as typeof fetch;

interface Seen {
  url: string;
  init: RequestInit | undefined;
}
function spy(status: number, body: unknown): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const ENROLLMENT = "0b8a4a06-3a0c-4b41-8d6b-6c1f5e5f6a11";
const SETUP = {
  enrollmentId: ENROLLMENT,
  manualKey: "JBSWY3DPEHPK3PXP",
  provisioningUri: "otpauth://totp/Morbeh:a@b.co?secret=JBSWY3DPEHPK3PXP",
};
const base = {
  runtimeUrl: "https://api.test",
  tenantId: "platform-tenant",
  via: "staff" as const,
  setupChallenge: "signed.setup.jwt",
};
const codes = Array.from(
  { length: 10 },
  (_, index) => `aaaa-bbbb-${String(index).padStart(4, "0")}`,
);

beforeEach(() => {
  expect.hasAssertions();
});

describe("startLoginSetup", () => {
  it("posts the setup challenge in the body to the path that issued it and returns the key", async () => {
    const staff = spy(201, SETUP);
    expect(await startLoginSetup({ ...base, fetchImpl: staff.fetchImpl })).toEqual({
      ok: true,
      setup: SETUP,
    });
    expect(staff.seen[0]?.url).toBe("https://api.test/api/v1/public/auth/staff/login/setup/start");
    expect(JSON.parse(String(staff.seen[0]?.init?.body))).toEqual({
      setupChallenge: "signed.setup.jwt",
    });
    expect((staff.seen[0]?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe(
      "platform-tenant",
    );
    expect(staff.seen[0]?.url).not.toContain("signed.setup.jwt");

    const merchant = spy(201, SETUP);
    await startLoginSetup({ ...base, via: "merchant", fetchImpl: merchant.fetchImpl });
    expect(merchant.seen[0]?.url).toBe(
      "https://api.test/api/v1/public/auth/merchant/login/setup/start",
    );
  });

  it.each([
    [401, { error: { code: "CHALLENGE_EXPIRED" } }, "expired"],
    [401, { error: { code: "INVALID_CODE" } }, "expired"],
    [429, { code: "RATE_LIMITED" }, "limited"],
    [503, { code: "NOT_CONFIGURED" }, "unavailable"],
    [500, null, "unavailable"],
  ] as const)("maps %i %j to %s", async (status, body, reason) => {
    expect(await startLoginSetup({ ...base, fetchImpl: reply(status, body) })).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses a 201 that is not a setup, and an outage", async () => {
    expect(await startLoginSetup({ ...base, fetchImpl: reply(201, { manualKey: "x" }) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      await startLoginSetup({
        ...base,
        fetchImpl: reply(201, { ...SETUP, provisioningUri: "https://evil.example" }),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await startLoginSetup({ ...base, fetchImpl: boom })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("confirmLoginSetup", () => {
  const input = { ...base, enrollmentId: ENROLLMENT, code: "123456" };

  it("posts the challenge, the enrolment and the code, and returns token + backup codes", async () => {
    const seen = spy(200, {
      accessToken: "tok",
      tokenType: "Bearer",
      expiresIn: 3600,
      backupCodes: codes,
    });
    expect(await confirmLoginSetup({ ...input, fetchImpl: seen.fetchImpl })).toEqual({
      ok: true,
      token: "tok",
      expiresIn: 3600,
      backupCodes: codes,
    });
    expect(seen.seen[0]?.url).toBe("https://api.test/api/v1/public/auth/staff/login/setup/confirm");
    expect(JSON.parse(String(seen.seen[0]?.init?.body))).toEqual({
      setupChallenge: "signed.setup.jwt",
      enrollmentId: ENROLLMENT,
      code: "123456",
    });
  });

  it("reads the error code as body.error?.code ?? body.code", async () => {
    expect(
      await confirmLoginSetup({
        ...input,
        fetchImpl: reply(401, {
          error: { code: "INVALID_CODE", message: "That code did not work" },
        }),
      }),
    ).toEqual({ ok: false, reason: "code" });
    expect(
      await confirmLoginSetup({ ...input, fetchImpl: reply(401, { code: "INVALID_CODE" }) }),
    ).toEqual({ ok: false, reason: "code" });
    expect(
      await confirmLoginSetup({
        ...input,
        fetchImpl: reply(401, { error: { code: "CHALLENGE_EXPIRED" } }),
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(await confirmLoginSetup({ ...input, fetchImpl: reply(401, null) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("maps a shape refusal, a rate limit, an outage and a 200 without the pieces", async () => {
    expect(await confirmLoginSetup({ ...input, fetchImpl: reply(422, {}) })).toEqual({
      ok: false,
      reason: "code",
    });
    expect(
      await confirmLoginSetup({ ...input, fetchImpl: reply(429, { code: "RATE_LIMITED" }) }),
    ).toEqual({ ok: false, reason: "limited" });
    expect(await confirmLoginSetup({ ...input, fetchImpl: reply(503, {}) })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await confirmLoginSetup({ ...input, fetchImpl: boom })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      await confirmLoginSetup({
        ...input,
        fetchImpl: reply(200, { accessToken: "tok", expiresIn: 3600 }),
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(
      await confirmLoginSetup({ ...input, fetchImpl: reply(200, { backupCodes: codes }) }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});
