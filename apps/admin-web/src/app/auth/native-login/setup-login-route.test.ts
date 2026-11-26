// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";
import type * as Native from "@/lib/auth/native";

/**
 * Wave 1f: the password step when the member has no two-step yet. The real shape of the sign-in route is
 * covered in route.test.ts; this file pins the new branch: the setup cookie, the 303 to /login/setup and
 * the rule that the signed challenge is never in the Location.
 */
const { staffMock, merchantMock } = vi.hoisted(() => ({
  staffMock: vi.fn(),
  merchantMock: vi.fn(),
}));
vi.mock("@/lib/auth/native", async (importOriginal) => ({
  ...(await importOriginal<typeof Native>()),
  exchangePassword: staffMock,
}));
vi.mock("@/lib/auth/merchant", () => ({ exchangeMerchantPassword: merchantMock }));

const { POST } = await import("./route");

const ORIGIN = "https://admin.morbeh.example.com";
const SETUP = "eyJhbG...setup.sig";

function loginRequest(fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    email: "a@b.co",
    password: "pw-12345678",
    ...fields,
  })) {
    form.set(key, value);
  }
  return new NextRequest(new URL("/auth/native-login", ORIGIN), { method: "POST", body: form });
}

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /auth/native-login — setup at sign-in (Wave 1f)", () => {
  it("stores the setup challenge in an httpOnly cookie, remembers the staff path and goes to /login/setup", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({
      ok: false,
      reason: "mfa_setup",
      setupChallenge: SETUP,
      setupChallengeExpiresIn: 600,
    });
    const response = await POST(loginRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/setup`);
    expect(response.headers.get("location")).not.toContain(SETUP);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get("morbeh_mfa_setup")).toMatchObject({
      value: SETUP,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    expect(response.cookies.get("morbeh_mfa_via")).toMatchObject({
      value: "staff",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    // No cookie other than the two, and the code-step challenge cookie is expired, not set.
    expect(response.cookies.get("morbeh_mfa_challenge")?.value).toBe("");
  });

  it("remembers the merchant path when the store directory asked for the setup, without asking staff", async () => {
    merchantMock.mockResolvedValue({
      ok: false,
      reason: "mfa_setup",
      setupChallenge: SETUP,
      setupChallengeExpiresIn: 120,
    });
    const response = await POST(loginRequest());
    expect(response.cookies.get("morbeh_mfa_via")?.value).toBe("merchant");
    expect(response.cookies.get("morbeh_mfa_setup")?.maxAge).toBe(120);
    expect(staffMock).not.toHaveBeenCalled();
  });

  it("defaults the lifetime to 600 s and keeps a safe return_to in the Location (never the challenge)", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "mfa_setup", setupChallenge: SETUP });
    const response = await POST(loginRequest({ return_to: "/orders" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/setup?return_to=%2Forders`);
    expect(response.cookies.get("morbeh_mfa_setup")?.maxAge).toBe(600);
  });

  it("drops an unsafe return_to", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "mfa_setup", setupChallenge: SETUP });
    const response = await POST(loginRequest({ return_to: "//evil.example/x" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/setup`);
  });

  it("a code step after an earlier setup attempt expires the stale setup cookie", async () => {
    merchantMock.mockResolvedValue({
      ok: false,
      reason: "mfa",
      challenge: "c",
      challengeExpiresIn: 300,
    });
    const response = await POST(loginRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify`);
    expect(response.cookies.get("morbeh_mfa_challenge")?.value).toBe("c");
    expect(response.cookies.get("morbeh_mfa_setup")?.value).toBe("");
  });

  it("a wrong password never starts a setup (no cookie, ?error=invalid)", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const response = await POST(loginRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid`);
    expect(response.cookies.get("morbeh_mfa_setup")).toBeUndefined();
  });
});
