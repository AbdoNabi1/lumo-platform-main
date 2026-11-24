// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptMock } = vi.hoisted(() => ({ acceptMock: vi.fn() }));
vi.mock("@/lib/auth/invitation", () => ({ acceptInvitation: acceptMock }));

const { POST } = await import("./route");

const ORIGIN = "https://admin.morbeh.example.com";

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

function submit(fields: Record<string, string> = {}): NextRequest {
  const body = formOf({
    token: "tok-1",
    store: "acme",
    password: "correct horse 1",
    confirm: "correct horse 1",
    ...fields,
  });
  return new NextRequest(new URL("/accept-invite/submit", ORIGIN), { method: "POST", body });
}

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "native");
});

describe("POST /accept-invite/submit", () => {
  it("accepts through the merchant route when a store is present and goes to /login?invited=1", async () => {
    acceptMock.mockResolvedValue("done");
    const response = await POST(submit());
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ store: "acme", token: "tok-1", password: "correct horse 1" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?invited=1`);
  });

  it("accepts through the staff route when there is no store", async () => {
    acceptMock.mockResolvedValue("done");
    const response = await POST(submit({ store: "" }));
    expect(acceptMock.mock.calls[0]?.[0]).not.toHaveProperty("store");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?invited=1`);
  });

  it("a password mismatch never reaches the API and returns to the form with the link", async () => {
    const response = await POST(submit({ confirm: "something else 1" }));
    expect(acceptMock).not.toHaveBeenCalled();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/accept-invite");
    expect(location.searchParams.get("error")).toBe("mismatch");
    expect(location.searchParams.get("token")).toBe("tok-1");
    expect(location.searchParams.get("store")).toBe("acme");
    expect(location.search).not.toContain("correct horse");
  });

  it.each(["short1", "x".repeat(257)])(
    "a %s-sized password is weak without a request",
    async (password) => {
      const response = await POST(submit({ password, confirm: password }));
      expect(acceptMock).not.toHaveBeenCalled();
      expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe(
        "weak",
      );
    },
  );

  it("a dead link (410) goes back WITHOUT the token", async () => {
    acceptMock.mockResolvedValue("invalid");
    const response = await POST(submit());
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("invalid");
    expect(location.searchParams.has("token")).toBe(false);
    expect(location.searchParams.has("store")).toBe(false);
    expect(location.href).not.toContain("tok-1");
  });

  it.each(["weak", "limited", "unavailable"] as const)(
    "%s keeps the link so the visitor can try again",
    async (result) => {
      acceptMock.mockResolvedValue(result);
      const response = await POST(submit());
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.searchParams.get("error")).toBe(result);
      expect(location.searchParams.get("token")).toBe("tok-1");
      expect(location.search).not.toContain("correct horse");
    },
  );

  it("a missing token is the invalid-link state", async () => {
    const response = await POST(submit({ token: "" }));
    expect(acceptMock).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid",
    );
  });

  it("outside native sign-in it just goes to /login", async () => {
    vi.stubEnv("AUTH_MODE", "ory");
    const response = await POST(submit());
    expect(acceptMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
  });
});
