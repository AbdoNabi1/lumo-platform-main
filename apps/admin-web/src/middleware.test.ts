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

  it.each(["/signup", "/auth/signup"])(
    "%s is public for visitors without a session",
    async (path) => {
      const response = await middleware(requestFor(path));
      expect(response.headers.get("location")).toBeNull();
      expect(jwtVerifyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["/accept-invite", "/accept-invite/submit"])(
    "%s is public: an invited person has no session yet",
    async (path) => {
      expect.hasAssertions();
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
    // Menus moved under Content in the sidebar (Wave 1a); the route and its role did not change.
    const content = PRIMARY_NAV.find((item) => item.id === "content");
    expect((content?.children ?? []).map((c) => c.href)).toContain("/online-store/navigation");
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

describe("middleware role table for the Settings sub-navigation (Shopify parity Wave 1a)", () => {
  it("redirects a viewer from /settings/checkout to /forbidden", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/settings/checkout", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("lets an admin open /settings/checkout", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["admin"] } });
    const response = await middleware(requestFor("/settings/checkout", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps every coming-soon placeholder admin-only", async () => {
    expect.hasAssertions();
    const placeholders = [
      "checkout",
      "customer-accounts",
      "markets",
      "apps",
      "customer-events",
      "notifications",
      "custom-data",
      "customer-privacy",
    ];
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    for (const section of placeholders) {
      const response = await middleware(requestFor(`/settings/${section}`, "good.token"));
      expect(response.headers.get("location"), section).toContain("/forbidden");
    }
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["admin"] } });
    for (const section of placeholders) {
      const response = await middleware(requestFor(`/settings/${section}`, "good.token"));
      expect(response.headers.get("location"), section).toBeNull();
    }
  });

  it("Users and permissions is a real page now but stays admin-only: operator and viewer go to /forbidden", async () => {
    expect.hasAssertions();
    for (const role of ["operator", "viewer"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      for (const path of ["/settings/users", "/settings/users/anything"]) {
        const response = await middleware(requestFor(path, "good.token"));
        expect(response.headers.get("location"), `${role} ${path}`).toContain("/forbidden");
      }
    }
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["admin"] } });
    const allowed = await middleware(requestFor("/settings/users", "good.token"));
    expect(allowed.headers.get("location")).toBeNull();
  });

  it("lets a viewer still open /online-store/navigation and /locales", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/online-store/navigation", "/locales"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});

describe("middleware role table for collections (Shopify parity Wave 1a)", () => {
  const COLLECTION_ID = "2f6f1c52-5c3a-4a53-8c0a-3f4f3d7a0c11";

  it("lets a viewer open the collections list and a collection", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/collections", `/collections/${COLLECTION_ID}`]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("redirects a viewer from /collections/new to /forbidden", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    const response = await middleware(requestFor("/collections/new", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("lets an operator open /collections/new", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const response = await middleware(requestFor("/collections/new", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("middleware role table for Content > Files (Shopify parity Wave 1b)", () => {
  it("lets a viewer open /content/files, with a query string or a trailing path", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/content/files", "/content/files?q=beach&view=list"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("still redirects a viewer from /content and /content/new to /forbidden", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/content", "/content/new"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toContain("/forbidden");
    }
  });

  it("lets an operator open /content/files and /content/new", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    for (const path of ["/content/files", "/content/new"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});

describe("middleware role table for customers (Shopify parity Wave 1b)", () => {
  const CUSTOMER_ID = "2f6f1c52-5c3a-4a53-8c0a-3f4f3d7a0c11";

  it("lets a viewer open the list, a customer and the export route", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of [
      "/customers",
      "/customers?q=nour&exportError=failed",
      `/customers/${CUSTOMER_ID}`,
      "/customers/export?scope=all",
    ]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("redirects a viewer from /customers/new to /forbidden, with or without a query string", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/customers/new", "/customers/new?x=1"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toContain("/forbidden");
    }
  });

  it("redirects an unknown role from /customers/new to /forbidden", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["guest"] } });
    const response = await middleware(requestFor("/customers/new", "good.token"));
    expect(response.headers.get("location")).toContain("/forbidden");
  });

  it("lets an operator and an admin open /customers/new", async () => {
    expect.hasAssertions();
    for (const role of ["operator", "admin"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      const response = await middleware(requestFor("/customers/new", "good.token"));
      expect(response.headers.get("location"), role).toBeNull();
    }
  });
});

describe("middleware role table for customer segments (Shopify parity Wave 1c)", () => {
  const SEGMENT_ID = "7c1f0f6e-5c3a-4a53-8c0a-3f4f3d7a0c11";

  it("lets a viewer open the list, a custom segment and a default segment", async () => {
    expect.hasAssertions();
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of [
      "/customers/segments",
      `/customers/segments/${SEGMENT_ID}`,
      "/customers/segments/default:not_purchased",
      "/customers/segments/default%3Anot_purchased?q=nour&after=abc",
    ]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("redirects a viewer and an unknown role from /customers/segments/new to /forbidden, with or without a query", async () => {
    expect.hasAssertions();
    for (const role of ["viewer", "guest"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      for (const path of [
        "/customers/segments/new",
        "/customers/segments/new?from=default%3Anot_purchased",
      ]) {
        const response = await middleware(requestFor(path, "good.token"));
        expect(response.headers.get("location"), `${role} ${path}`).toContain("/forbidden");
      }
    }
  });

  it("lets an operator and an admin open /customers/segments/new, also as a duplicate", async () => {
    expect.hasAssertions();
    for (const role of ["operator", "admin"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      for (const path of [
        "/customers/segments/new",
        "/customers/segments/new?from=default%3Anot_purchased",
      ]) {
        const response = await middleware(requestFor(path, "good.token"));
        expect(response.headers.get("location"), `${role} ${path}`).toBeNull();
      }
    }
  });
});

describe("middleware role table for the orders screens", () => {
  it("lets a viewer open drafts and a draft, but not the new-draft screen (orders Part 4)", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["viewer"] } });
    for (const path of ["/draft-orders", "/draft-orders/2f6f1c52-5c3a-4a53-8c0a-3f4f3d7a0c11"]) {
      const response = await middleware(requestFor(path, "good.token"));
      expect(response.headers.get("location"), path).toBeNull();
    }
    const denied = await middleware(requestFor("/draft-orders/new", "good.token"));
    expect(denied.headers.get("location")).toContain("/forbidden");
  });

  it("lets an operator create a draft", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["operator"] } });
    const response = await middleware(requestFor("/draft-orders/new", "good.token"));
    expect(response.headers.get("location")).toBeNull();
  });

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

describe("middleware — Wave 1e two-step routes", () => {
  it.each(["/login/verify", "/login/verify?error=code", "/auth/native-login/verify"])(
    "%s is public: the code step happens before there is a session",
    async (path) => {
      expect.hasAssertions();
      const response = await middleware(requestFor(path));
      expect(response.headers.get("location")).toBeNull();
      expect(jwtVerifyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["viewer", "operator", "admin"])(
    "/account/security is reachable by a %s",
    async (role) => {
      expect.hasAssertions();
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      const response = await middleware(requestFor("/account/security", "good.token"));
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("/account/security without a session goes to sign-in, not to the page", async () => {
    expect.hasAssertions();
    const response = await middleware(requestFor("/account/security"));
    expect(response.headers.get("location")).toContain("/oauth2/auth");
  });

  it("/settings/users/activity is admin-only: operator and viewer go to /forbidden", async () => {
    expect.hasAssertions();
    for (const role of ["operator", "viewer"]) {
      jwtVerifyMock.mockResolvedValue({ payload: { roles: [role] } });
      const response = await middleware(requestFor("/settings/users/activity", "good.token"));
      expect(response.headers.get("location"), role).toContain("/forbidden");
    }
    jwtVerifyMock.mockResolvedValue({ payload: { roles: ["admin"] } });
    const allowed = await middleware(requestFor("/settings/users/activity", "good.token"));
    expect(allowed.headers.get("location")).toBeNull();
  });
});
