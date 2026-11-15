// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { staffMock, merchantMock } = vi.hoisted(() => ({
  staffMock: vi.fn(),
  merchantMock: vi.fn(),
}));
vi.mock("@/lib/auth/password-reset", () => ({ requestReset: staffMock }));
vi.mock("@/lib/auth/merchant", () => ({ requestMerchantReset: merchantMock }));

const { POST } = await import("./route");

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const ORIGIN = "https://admin.morbeh.example.com";

function forgotRequest(email = "a@b.co"): NextRequest {
  return new NextRequest(new URL("/auth/forgot", ORIGIN), {
    method: "POST",
    body: formOf({ email }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /auth/forgot", () => {
  it("asks both the merchant and the staff directory and answers neutrally", async () => {
    merchantMock.mockResolvedValue("sent");
    staffMock.mockResolvedValue("sent");
    const response = await POST(forgotRequest());
    expect(merchantMock).toHaveBeenCalledWith(expect.objectContaining({ email: "a@b.co" }));
    expect(staffMock).toHaveBeenCalledWith(expect.objectContaining({ email: "a@b.co" }));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?reset=sent`);
  });

  it("still answers neutrally when a side is unavailable", async () => {
    merchantMock.mockResolvedValue("unavailable");
    staffMock.mockResolvedValue("sent");
    expect((await POST(forgotRequest())).headers.get("location")).toBe(
      `${ORIGIN}/login?reset=sent`,
    );
  });

  it("reports limited when either side is rate limited", async () => {
    merchantMock.mockResolvedValue("limited");
    staffMock.mockResolvedValue("sent");
    expect((await POST(forgotRequest())).headers.get("location")).toBe(
      `${ORIGIN}/forgot-password?error=limited`,
    );
    merchantMock.mockResolvedValue("sent");
    staffMock.mockResolvedValue("limited");
    expect((await POST(forgotRequest())).headers.get("location")).toBe(
      `${ORIGIN}/forgot-password?error=limited`,
    );
  });
});
