// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";
import type * as Native from "@/lib/auth/native";

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

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const ORIGIN = "https://admin.morbeh.example.com";

function loginRequest(fields: Record<string, string> = {}): NextRequest {
  const body = formOf({ email: "a@b.co", password: "pw-12345678", ...fields });
  return new NextRequest(new URL("/auth/native-login", ORIGIN), { method: "POST", body });
}

const OK = { ok: true, token: "tok", expiresIn: 3600 } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /auth/native-login", () => {
  it("signs a merchant in without asking the staff directory", async () => {
    merchantMock.mockResolvedValue(OK);
    const response = await POST(loginRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("tok");
    expect(staffMock).not.toHaveBeenCalled();
  });

  it("falls back to staff sign-in when the merchant directory says invalid", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue(OK);
    const response = await POST(loginRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("tok");
    expect(staffMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to staff sign-in when the merchant directory is unavailable", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "unavailable" });
    staffMock.mockResolvedValue(OK);
    const response = await POST(loginRequest());
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("tok");
  });

  it("reports invalid when both directories refuse", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const response = await POST(loginRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("reports unavailable over invalid when either side was down", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await POST(loginRequest())).headers.get("location")).toBe(
      `${ORIGIN}/login?error=unavailable`,
    );
    merchantMock.mockResolvedValue({ ok: false, reason: "unavailable" });
    staffMock.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await POST(loginRequest())).headers.get("location")).toBe(
      `${ORIGIN}/login?error=unavailable`,
    );
  });

  it("ignores a merchant directory that is disabled on this deployment (single mode)", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "disabled" });
    staffMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const refused = await POST(loginRequest());
    expect(refused.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid`);
    expect(refused.cookies.get(SESSION_COOKIE)).toBeUndefined();

    staffMock.mockResolvedValue(OK);
    const signed = await POST(loginRequest());
    expect(signed.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(signed.cookies.get(SESSION_COOKIE)?.value).toBe("tok");

    staffMock.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect((await POST(loginRequest())).headers.get("location")).toBe(
      `${ORIGIN}/login?error=unavailable`,
    );
  });

  it("reports mfa from either side", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "mfa" });
    expect((await POST(loginRequest())).headers.get("location")).toBe(`${ORIGIN}/login?error=mfa`);
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "mfa" });
    expect((await POST(loginRequest())).headers.get("location")).toBe(`${ORIGIN}/login?error=mfa`);
  });

  it("keeps a safe return_to on failure", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const response = await POST(loginRequest({ return_to: "/products" }));
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login?error=invalid&return_to=%2Fproducts`,
    );
  });
});

describe("POST /auth/native-login — the code step (Wave 1e)", () => {
  const CHALLENGE = "eyJhbGciOiJFUzI1NiJ9.challenge.signature";

  it("stores the challenge in an httpOnly cookie, remembers the staff path and goes to /login/verify", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({
      ok: false,
      reason: "mfa",
      challenge: CHALLENGE,
      challengeExpiresIn: 300,
    });
    const response = await POST(loginRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify`);
    expect(response.headers.get("location")).not.toContain(CHALLENGE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const challenge = response.cookies.get("morbeh_mfa_challenge");
    expect(challenge).toMatchObject({
      value: CHALLENGE,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });
    expect(response.cookies.get("morbeh_mfa_via")).toMatchObject({
      value: "staff",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("remembers the merchant path when the store directory asked for the code", async () => {
    merchantMock.mockResolvedValue({
      ok: false,
      reason: "mfa",
      challenge: CHALLENGE,
      challengeExpiresIn: 120,
    });
    const response = await POST(loginRequest());
    expect(response.cookies.get("morbeh_mfa_via")?.value).toBe("merchant");
    expect(response.cookies.get("morbeh_mfa_challenge")?.maxAge).toBe(120);
    expect(staffMock).not.toHaveBeenCalled();
  });

  it("keeps a safe return_to in the Location (never the challenge) and defaults the lifetime to 300 s", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "mfa", challenge: CHALLENGE });
    const response = await POST(loginRequest({ return_to: "/orders" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify?return_to=%2Forders`);
    expect(response.cookies.get("morbeh_mfa_challenge")?.maxAge).toBe(300);
  });

  it("drops an unsafe return_to", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "mfa", challenge: CHALLENGE });
    const response = await POST(loginRequest({ return_to: "https://evil.example/x" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify`);
  });

  it("goes back to the form with ?error=mfa and sets no cookie when the 403 has no challenge", async () => {
    merchantMock.mockResolvedValue({ ok: false, reason: "invalid" });
    staffMock.mockResolvedValue({ ok: false, reason: "mfa" });
    const response = await POST(loginRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=mfa`);
    expect(response.cookies.get("morbeh_mfa_challenge")).toBeUndefined();
    expect(response.cookies.get("morbeh_mfa_via")).toBeUndefined();
  });
});
