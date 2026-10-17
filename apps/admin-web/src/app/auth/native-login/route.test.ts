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
