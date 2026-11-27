// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock("@/lib/auth/mfa-verify", () => ({ verifyLoginCode: verifyMock }));

const { POST } = await import("./route");

const ORIGIN = "https://admin.morbeh.example.com";
const CHALLENGE = "eyJhbGciOiJFUzI1NiJ9.challenge.signature";

function verifyRequest(
  fields: Record<string, string> = {},
  cookies: Record<string, string> = { morbeh_mfa_challenge: CHALLENGE, morbeh_mfa_via: "staff" },
): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries({ code: "123456", ...fields })) form.set(key, value);
  const headers = new Headers();
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie.length > 0) headers.set("cookie", cookie);
  return new NextRequest(new URL("/auth/native-login/verify", ORIGIN), {
    method: "POST",
    body: form,
    headers,
  });
}

const OK = { ok: true, token: "tok", expiresIn: 3600 } as const;

function cleared(response: Response): void {
  const setCookies = response.headers.getSetCookie();
  for (const name of ["morbeh_mfa_challenge", "morbeh_mfa_via"]) {
    const line = setCookies.find((entry) => entry.startsWith(`${name}=;`));
    expect(line, name).toBeDefined();
    expect(line).toMatch(/Max-Age=0/i);
    expect(line).toMatch(/HttpOnly/i);
  }
}

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /auth/native-login/verify", () => {
  it("success: clears both cookies, sets the session cookie and redirects to /", async () => {
    verifyMock.mockResolvedValue(OK);
    const response = await POST(verifyRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("tok");
    cleared(response);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("success: posts the cookie's challenge and the typed code through the path that issued it", async () => {
    verifyMock.mockResolvedValue(OK);
    await POST(
      verifyRequest(
        { code: " 654321 " },
        { morbeh_mfa_challenge: CHALLENGE, morbeh_mfa_via: "merchant" },
      ),
    );
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock.mock.calls[0]?.[0]).toMatchObject({
      via: "merchant",
      challenge: CHALLENGE,
      code: "654321",
    });
    expect(verifyMock.mock.calls[0]?.[0].tenantId).toBe("tenant-local");
  });

  it("success: goes to a safe return_to and ignores an unsafe one", async () => {
    verifyMock.mockResolvedValue(OK);
    expect((await POST(verifyRequest({ return_to: "/orders?x=1" }))).headers.get("location")).toBe(
      `${ORIGIN}/orders?x=1`,
    );
    expect(
      (await POST(verifyRequest({ return_to: "//evil.example" }))).headers.get("location"),
    ).toBe(`${ORIGIN}/`);
    expect(
      (await POST(verifyRequest({ return_to: "https://evil.example/a" }))).headers.get("location"),
    ).toBe(`${ORIGIN}/`);
  });

  it("a wrong code stays on the form (?error=code), keeps the cookies and sets no session", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "code" });
    const response = await POST(verifyRequest({ return_to: "/orders" }));
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login/verify?error=code&return_to=%2Forders`,
    );
    expect(response.headers.get("location")).not.toContain(CHALLENGE);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("an expired challenge clears both cookies and starts over (?error=expired)", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "expired" });
    const response = await POST(verifyRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=expired`);
    cleared(response);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("a rate limit says to wait (?error=limited) and keeps the cookies", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "limited" });
    const response = await POST(verifyRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify?error=limited`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("an outage is ?error=unavailable on the code form", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await POST(verifyRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify?error=unavailable`);
  });

  it("without the challenge cookie there is nothing to verify: back to /login, no API call", async () => {
    const response = await POST(verifyRequest({}, {}));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("an unknown or missing path cookie starts over without calling the API", async () => {
    for (const via of [undefined, "admin", ""]) {
      const cookies: Record<string, string> = { morbeh_mfa_challenge: CHALLENGE };
      if (via !== undefined) cookies["morbeh_mfa_via"] = via;
      const response = await POST(verifyRequest({}, cookies));
      expect(response.headers.get("location")).toBe(`${ORIGIN}/login?error=expired`);
      cleared(response);
    }
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("an empty or oversized code is a wrong code without calling the API", async () => {
    for (const code of ["", "   ", "x".repeat(33)]) {
      const response = await POST(verifyRequest({ code }));
      expect(response.headers.get("location")).toBe(`${ORIGIN}/login/verify?error=code`);
    }
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("outside native sign-in it goes to /login", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    const response = await POST(verifyRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
