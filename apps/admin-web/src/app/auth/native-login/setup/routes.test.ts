// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";

/**
 * Wave 1f: the two route handlers behind /login/setup. The contract under test: the signed setup challenge
 * is read from the httpOnly cookie only; the key and the backup codes come back `no-store`; the confirm
 * handler sets the session cookie ITSELF and returns nothing but the backup codes (the access token never
 * reaches client JS); a wrong code keeps the cookies; an expired challenge clears them.
 */
const { startMock, confirmMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  confirmMock: vi.fn(),
}));
vi.mock("@/lib/auth/mfa-setup", () => ({
  startLoginSetup: startMock,
  confirmLoginSetup: confirmMock,
}));

const { POST: START } = await import("./start/route");
const { POST: CONFIRM } = await import("./confirm/route");

const ORIGIN = "https://admin.morbeh.example.com";
const SETUP = "eyJhbG...setup.sig";
const ENROLLMENT = "0b8a4a06-3a0c-4b41-8d6b-6c1f5e5f6a11";
const KEY = {
  enrollmentId: ENROLLMENT,
  manualKey: "JBSWY3DPEHPK3PXP",
  provisioningUri: "otpauth://totp/Morbeh:a@b.co?secret=JBSWY3DPEHPK3PXP",
};
const CODES = Array.from(
  { length: 10 },
  (_, index) => `aaaa-bbbb-${String(index).padStart(4, "0")}`,
);

function request(
  path: string,
  body: unknown,
  options: { cookies?: Record<string, string>; contentType?: string | null } = {},
): NextRequest {
  const headers = new Headers();
  const cookies = options.cookies ?? { morbeh_mfa_setup: SETUP, morbeh_mfa_via: "staff" };
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie.length > 0) headers.set("cookie", cookie);
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new NextRequest(new URL(path, ORIGIN), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const startRequest = (options?: Parameters<typeof request>[2]) =>
  request("/auth/native-login/setup/start", {}, options);
const confirmRequest = (
  body: unknown = { enrollmentId: ENROLLMENT, code: "123456" },
  options?: Parameters<typeof request>[2],
) => request("/auth/native-login/setup/confirm", body, options);

function cleared(response: Response): void {
  const lines = response.headers.getSetCookie();
  for (const name of ["morbeh_mfa_setup", "morbeh_mfa_via"]) {
    const line = lines.find((entry) => entry.startsWith(`${name}=;`));
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

describe("POST /auth/native-login/setup/start", () => {
  it("starts with the cookie's challenge through the path that issued it and returns the key, no-store", async () => {
    startMock.mockResolvedValue({ ok: true, setup: KEY });
    const response = await START(
      startRequest({ cookies: { morbeh_mfa_setup: SETUP, morbeh_mfa_via: "merchant" } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(KEY);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock.mock.calls[0]?.[0]).toMatchObject({
      via: "merchant",
      setupChallenge: SETUP,
      tenantId: "tenant-local",
    });
    // The key is not stored anywhere but the answer.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("without the challenge cookie or with an unknown path there is nothing to start: expired, no API call", async () => {
    const variants: Record<string, string>[] = [
      {},
      { morbeh_mfa_via: "staff" },
      { morbeh_mfa_setup: SETUP, morbeh_mfa_via: "admin" },
    ];
    for (const cookies of variants) {
      const response = await START(startRequest({ cookies }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "expired" });
    }
    expect(startMock).not.toHaveBeenCalled();
  });

  it("an expired challenge answers expired and clears both cookies", async () => {
    startMock.mockResolvedValue({ ok: false, reason: "expired" });
    const response = await START(startRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "expired" });
    cleared(response);
  });

  it.each([
    ["limited", 429],
    ["unavailable", 503],
  ] as const)("%s is a %i that keeps the cookies", async (reason, status) => {
    startMock.mockResolvedValue({ ok: false, reason });
    const response = await START(startRequest());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a request that is not JSON (a cross-site form post) without calling the API", async () => {
    const response = await START(
      startRequest({ contentType: "application/x-www-form-urlencoded" }),
    );
    expect(response.status).toBe(415);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("outside native sign-in it is expired", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    const response = await START(startRequest());
    expect(response.status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe("POST /auth/native-login/setup/confirm", () => {
  it("success: sets the session cookie, clears the setup cookies and returns ONLY the backup codes", async () => {
    confirmMock.mockResolvedValue({
      ok: true,
      token: "secret-access-token",
      expiresIn: 3600,
      backupCodes: CODES,
    });
    const response = await CONFIRM(confirmRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
      value: "secret-access-token",
      httpOnly: true,
      secure: true,
      maxAge: 3600,
    });
    cleared(response);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ backupCodes: CODES });
    expect(text).not.toContain("secret-access-token");
    expect(confirmMock.mock.calls[0]?.[0]).toMatchObject({
      via: "staff",
      setupChallenge: SETUP,
      enrollmentId: ENROLLMENT,
      code: "123456",
    });
  });

  it("strips spaces from the code before it is sent", async () => {
    confirmMock.mockResolvedValue({ ok: true, token: "t", expiresIn: 60, backupCodes: CODES });
    await CONFIRM(confirmRequest({ enrollmentId: ENROLLMENT, code: " 123 456 " }));
    expect(confirmMock.mock.calls[0]?.[0].code).toBe("123456");
  });

  it("a wrong code is 401 {error: code}, keeps the cookies and sets no session", async () => {
    confirmMock.mockResolvedValue({ ok: false, reason: "code" });
    const response = await CONFIRM(confirmRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "code" });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("an expired or spent challenge clears the cookies and sets no session", async () => {
    confirmMock.mockResolvedValue({ ok: false, reason: "expired" });
    const response = await CONFIRM(confirmRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "expired" });
    cleared(response);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it.each([
    ["limited", 429],
    ["unavailable", 503],
  ] as const)("%s is a %i that keeps the cookies", async (reason, status) => {
    confirmMock.mockResolvedValue({ ok: false, reason });
    const response = await CONFIRM(confirmRequest());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("a malformed body never reaches the API", async () => {
    for (const body of [
      {},
      { code: "123456" },
      { enrollmentId: "not-a-uuid", code: "123456" },
      { enrollmentId: ENROLLMENT },
      { enrollmentId: ENROLLMENT, code: "12345" },
      { enrollmentId: ENROLLMENT, code: "JBSWY3DPEHPK3PXP" },
      { enrollmentId: ENROLLMENT, code: 123456 },
    ]) {
      const response = await CONFIRM(confirmRequest(body));
      expect([400, 401]).toContain(response.status);
    }
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("without the challenge cookie there is nothing to confirm", async () => {
    const response = await CONFIRM(confirmRequest(undefined, { cookies: {} }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "expired" });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("refuses a request that is not JSON without calling the API", async () => {
    const response = await CONFIRM(confirmRequest(undefined, { contentType: "text/plain" }));
    expect(response.status).toBe(415);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
