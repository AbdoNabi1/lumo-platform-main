// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { staffMock, merchantMock } = vi.hoisted(() => ({
  staffMock: vi.fn(),
  merchantMock: vi.fn(),
}));
vi.mock("@/lib/auth/password-reset", () => ({ completeReset: staffMock }));
vi.mock("@/lib/auth/merchant", () => ({ completeMerchantReset: merchantMock }));

const { POST } = await import("./route");

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const ORIGIN = "https://admin.morbeh.example.com";

function resetRequest(fields: Record<string, string> = {}): NextRequest {
  const body = formOf({
    token: "tok-1",
    password: "new-pass-123",
    confirm: "new-pass-123",
    ...fields,
  });
  return new NextRequest(new URL("/auth/reset", ORIGIN), { method: "POST", body });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /auth/reset", () => {
  it("completes a merchant reset when a store is present", async () => {
    merchantMock.mockResolvedValue("done");
    const response = await POST(resetRequest({ store: "acme" }));
    expect(merchantMock).toHaveBeenCalledWith(
      expect.objectContaining({ store: "acme", token: "tok-1", password: "new-pass-123" }),
    );
    expect(staffMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?reset=done`);
  });

  it("completes a staff reset when there is no store", async () => {
    staffMock.mockResolvedValue("done");
    const response = await POST(resetRequest());
    expect(staffMock).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-1" }));
    expect(merchantMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?reset=done`);
  });

  it("sends a retryable merchant error back to the page with token and store", async () => {
    merchantMock.mockResolvedValue("weak");
    const response = await POST(resetRequest({ store: "acme" }));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/reset-password");
    expect(location.searchParams.get("token")).toBe("tok-1");
    expect(location.searchParams.get("store")).toBe("acme");
    expect(location.searchParams.get("error")).toBe("weak");
    expect(location.search).not.toContain("new-pass-123");
  });

  it("does not call either directory when the passwords differ", async () => {
    const response = await POST(resetRequest({ store: "acme", confirm: "other-pass-1" }));
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "mismatch",
    );
    expect(merchantMock).not.toHaveBeenCalled();
    expect(staffMock).not.toHaveBeenCalled();
  });
});
