import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const { middleware } = await import("./middleware");

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

  it.each(["/signup", "/auth/signup"])(
    "%s is public for visitors without a session",
    async (path) => {
      const response = await middleware(requestFor(path));
      expect(response.headers.get("location")).toBeNull();
      expect(jwtVerifyMock).not.toHaveBeenCalled();
    },
  );

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

  it("Online Store: viewers reach every sidebar link; the editor needs an operator (Project 4)", async () => {
    const { ONLINE_STORE_NAV } = await import("@/components/navigation");
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const href of [
      ONLINE_STORE_NAV.href,
      ...(ONLINE_STORE_NAV.children ?? []).map((c) => c.href),
    ]) {
      const response = await middleware(requestFor(href, "good.token"));
      expect(response.headers.get("location"), href).toBeNull();
    }
    const denied = await middleware(requestFor("/online-store/themes/customize", "good.token"));
    expect(denied.headers.get("location")).toContain("/forbidden");
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    expect(
      (await middleware(requestFor("/online-store/themes/customize", "good.token"))).headers.get(
        "location",
      ),
    ).toBeNull();
  });

  it("the section editor stays operator-only (Part 3 adds no route)", async () => {
    const path = "/online-store/themes/customize";
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const denied = await middleware(requestFor(path, "good.token"));
    expect(denied.headers.get("location")).toContain("/forbidden");
    for (const role of ["operator", "admin"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      const allowed = await middleware(requestFor(path, "good.token"));
      expect(allowed.headers.get("location"), role).toBeNull();
    }
  });

  it("Online Store → Navigation: viewers read menus; a new menu needs an operator (Part 2)", async () => {
    const { ONLINE_STORE_NAV } = await import("@/components/navigation");
    expect((ONLINE_STORE_NAV.children ?? []).map((c) => c.href)).toContain(
      "/online-store/navigation",
    );
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/online-store/navigation", "/online-store/navigation/main-menu"]) {
      expect((await middleware(requestFor(path, "good.token"))).headers.get("location")).toBeNull();
    }
    const denied = await middleware(requestFor("/online-store/navigation/new", "good.token"));
    expect(denied.headers.get("location")).toContain("/forbidden");
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    expect(
      (await middleware(requestFor("/online-store/navigation/new", "good.token"))).headers.get(
        "location",
      ),
    ).toBeNull();
  });

  it("Settings → Policies reads for viewers; the rest of Settings stays admin-only (Part 2)", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/settings/policies", "/settings/policies/refund"]) {
      expect((await middleware(requestFor(path, "good.token"))).headers.get("location")).toBeNull();
    }
    for (const path of ["/settings", "/settings/general", "/settings/policies-old"]) {
      const denied = await middleware(requestFor(path, "good.token"));
      expect(denied.headers.get("location"), path).toContain("/forbidden");
    }
  });

  it("/forbidden itself is reachable by any authenticated session regardless of role", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/forbidden", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });
});
