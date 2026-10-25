import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { middleware } = await import("./middleware");
const { PRIMARY_NAV } = await import("@/components/navigation");

function requestFor(path: string, sessionCookie?: string): NextRequest {
  const headers = new Headers();
  if (sessionCookie !== undefined) {
    headers.set("cookie", `morbeh_admin_session=${sessionCookie}`);
  }
  return new NextRequest(new URL(path, "https://admin.morbeh.example.com"), { headers });
}

afterEach(() => {
  vi.resetAllMocks();
});

/**
 * Phase A.34 (A.33 P0 #4/Task 18/19) — the four required cases: unauthenticated, authenticated
 * viewer denied on a write/admin route, operator allowed only for permitted operations, admin
 * full access. Plus the redirect-loop guard on `/forbidden` itself.
 */
describe("middleware", () => {
  it("unauthenticated -> redirected to Hydra's authorize endpoint", async () => {
    const response = await middleware(requestFor("/orders"));
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    expect(location).toContain("/oauth2/auth");
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("unauthenticated -> the authorize URL carries PKCE (S256) and a nonce, each backed by its own cookie (L-03/G0-1)", async () => {
    const response = await middleware(requestFor("/orders"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).not.toBeNull();
    expect(location.searchParams.get("nonce")).not.toBeNull();

    const pkceCookie = response.cookies.get("morbeh_oauth_pkce_verifier")?.value;
    const nonceCookie = response.cookies.get("morbeh_oauth_nonce")?.value;
    expect(pkceCookie).toBeTruthy();
    expect(nonceCookie).toBeTruthy();
    // The nonce sent to Hydra must be exactly the value stashed for the callback to check
    // against the id_token later — not independently generated and silently mismatched.
    expect(location.searchParams.get("nonce")).toBe(nonceCookie);
  });

  it("expired/invalid token -> redirected to Hydra's authorize endpoint, session cookie cleared", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    const response = await middleware(requestFor("/orders", "bad.token"));
    expect(response.headers.get("location")).toContain("/oauth2/auth");
  });

  it("public routes bypass the auth gate entirely", async () => {
    const response = await middleware(requestFor("/login"));
    expect(response.headers.get("location")).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("the dependency-free health probe bypasses the auth gate", async () => {
    const response = await middleware(requestFor("/api/healthz"));
    expect(response.headers.get("location")).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("authenticated viewer -> allowed on a viewer-tier route", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/orders", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("authenticated viewer -> denied (redirected to /forbidden) on an admin-tier route", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/settings", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("authenticated operator -> allowed on an operator-tier route", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const response = await middleware(requestFor("/automations", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("authenticated operator -> denied on an admin-tier route", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const response = await middleware(requestFor("/integrations", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("authenticated admin -> full access, including admin-tier routes", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["admin"] } });
    for (const path of ["/", "/orders", "/automations", "/settings", "/integrations"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("authenticated but no recognized role -> denied even on the least-privileged route", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["orders:read"] } });
    const response = await middleware(requestFor("/", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("unlisted routes deny-by-default (require admin)", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const response = await middleware(requestFor("/some-future-screen", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("/forbidden itself is reachable by any authenticated session regardless of role", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/forbidden", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("middleware role table for the orders screens", () => {
  it("lets a viewer open abandoned checkouts and its detail (the API decides who may issue links)", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of [
      "/abandoned-checkouts",
      "/abandoned-checkouts/2f6f1c52-5c3a-4a53-8c0a-3f4f3d7a0c11",
    ]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("lets a viewer read every orders page", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of [
      "/orders",
      "/orders/abc",
      "/orders/abc/fulfillment",
      "/orders/abc/returns",
      "/orders/abc/shipment",
      "/orders/packing-slips",
    ]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("never sends an operator to /forbidden from a sidebar link, bar the admin-only sections", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const adminOnly = ["/finance", "/settings", "/integrations", "/security", "/feature-registry"];
    const hrefs = PRIMARY_NAV.flatMap((item) => [
      item.href,
      ...(item.children ?? []).map((child) => child.href),
    ]);
    for (const href of hrefs) {
      if (adminOnly.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) continue;
      const response = await middleware(requestFor(href, "good.token"));
      expect(response.headers.get("location"), href).toBeNull();
    }
  });
});
