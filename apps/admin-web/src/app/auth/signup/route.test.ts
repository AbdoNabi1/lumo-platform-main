// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/config";
import type * as Merchant from "@/lib/auth/merchant";

const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));
vi.mock("@/lib/auth/merchant", async (importOriginal) => ({
  ...(await importOriginal<typeof Merchant>()),
  signUpMerchant: signUpMock,
}));

const { POST } = await import("./route");

const ORIGIN = "https://admin.morbeh.example.com";

function signupRequest(fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  const values = {
    storeName: "Nile Shop",
    email: "owner@nile.example",
    password: "pw-12345678",
    country: "EG",
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return new NextRequest(new URL("/auth/signup", ORIGIN), { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
  vi.stubEnv("ADMIN_SIGNUP_ENABLED", "1");
});

describe("POST /auth/signup", () => {
  it("opens the store, sets the session cookie and lands on the welcome home", async () => {
    signUpMock.mockResolvedValue({ ok: true, token: "tok", expiresIn: 3600 });
    const response = await POST(signupRequest());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?welcome=1`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("tok");
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeName: "Nile Shop",
        email: "owner@nile.example",
        password: "pw-12345678",
        country: "EG",
      }),
    );
  });

  it("trims the store name and email before sending them", async () => {
    signUpMock.mockResolvedValue({ ok: true, token: "tok", expiresIn: 3600 });
    await POST(signupRequest({ storeName: "  Nile Shop  ", email: " owner@nile.example " }));
    expect(signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ storeName: "Nile Shop", email: "owner@nile.example" }),
    );
  });

  it("sends the visitor to sign in when the runtime asks for it, with no cookie", async () => {
    signUpMock.mockResolvedValue({ ok: true, signInRequired: true });
    const response = await POST(signupRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?signup=done`);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it.each(["taken", "limited", "invalid", "unavailable"] as const)(
    "maps %s back to the form without a cookie",
    async (reason) => {
      signUpMock.mockResolvedValue({ ok: false, reason });
      const response = await POST(signupRequest());
      expect(response.headers.get("location")).toBe(`${ORIGIN}/signup?error=${reason}`);
      expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    },
  );

  it.each([
    ["a short store name", { storeName: " a " }],
    ["a too long store name", { storeName: "x".repeat(61) }],
    ["an email without @", { email: "nobody" }],
    ["a short password", { password: "short" }],
    ["an unknown country", { country: "US" }],
    ["a missing country", { country: "" }],
  ])("redirects %s to invalid without calling the runtime", async (_label, fields) => {
    const response = await POST(signupRequest(fields));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/signup?error=invalid`);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("never puts the email or store name in a redirect URL", async () => {
    for (const result of [
      { ok: false, reason: "taken" },
      { ok: true, signInRequired: true },
      { ok: true, token: "tok", expiresIn: 60 },
    ]) {
      signUpMock.mockResolvedValue(result);
      const location = (await POST(signupRequest())).headers.get("location") ?? "";
      expect(location).not.toContain("owner");
      expect(location).not.toContain("Nile");
      expect(location).not.toContain("pw-");
    }
  });

  it("goes to login when native sign-in is off or sign-up is disabled", async () => {
    vi.stubEnv("ADMIN_SIGNUP_ENABLED", "");
    const response = await POST(signupRequest());
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
