// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signAccessCookie } from "./lib/access-cookie";
import { config } from "./middleware";

const SECRET = "m".repeat(32);
const TOKEN = "T".repeat(43);
const UNKNOWN_TOKEN = "U".repeat(43);
type Answer = { status: number; body: unknown } | "hang" | "throw";
let access: Record<string, { locked: boolean; accessVersion: number } | "fail" | "hang">;
let hosts: Record<string, string>;
/** What `GET /public/online-store` answers for a preview token (anything absent: 401). */
let previews: Record<string, Answer>;
let fetchMock: ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Never answers, but honours the abort signal like the real fetch. */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

const previewCalls = () =>
  fetchMock.mock.calls.filter(([input]) => new URL(input).pathname.endsWith("/online-store"));

beforeEach(() => {
  vi.resetModules();
  access = { "shop-a": { locked: false, accessVersion: 1 } };
  hosts = { "a.example": "shop-a", "b.example": "shop-b" };
  previews = { [TOKEN]: { status: 200, body: { mode: "preview" } } };
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "off");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", SECRET);
  vi.stubEnv("ADMIN_ORIGIN", "https://admin.example");
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.pathname.endsWith("/public/domains/resolve")) {
      const shop = hosts[url.searchParams.get("host") ?? ""];
      return shop === undefined
        ? json({}, 404)
        : json({ shopId: shop, hostname: "h", primaryHostname: "h", shopStatus: "active" });
    }
    if (url.pathname.endsWith("/public/online-store")) {
      const answer = previews[headers["x-preview-token"] ?? ""] ?? {
        status: 401,
        body: { code: "PREVIEW_INVALID" },
      };
      if (answer === "hang") return hang(init);
      if (answer === "throw") throw new Error("down");
      return json(answer.body, answer.status);
    }
    const state = access[headers["x-tenant-id"] ?? ""];
    if (state === "hang") return hang(init);
    if (state === "fail" || state === undefined) return json({}, 503);
    return json({ ...state, message: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function run(
  path: string,
  options: {
    method?: string;
    cookie?: string;
    host?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { middleware } = await import("./middleware");
  const headers = new Headers(options.headers ?? {});
  if (options.cookie !== undefined)
    headers.set("cookie", `morbeh-storefront-access=${options.cookie}`);
  headers.set("host", options.host ?? "a.example");
  return middleware(
    new NextRequest(new URL(path, `https://${options.host ?? "a.example"}`), {
      method: options.method ?? "GET",
      headers,
    }),
  );
}
const cookieFor = (
  shopId: string,
  accessVersion: number,
  expUnix = Math.floor(Date.now() / 1000) + 3600,
  secret = SECRET,
) => signAccessCookie({ secret, shopId, accessVersion, expUnix });
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

// Next compiles the matcher with path-to-regexp; this pattern is also a plain regular expression.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher (preflight 24, 27)", () => {
  it("skips only the exact excluded paths", () => {
    for (const path of [
      "/_next/static/chunk.js",
      "/_next/image",
      "/favicon.ico",
      "/api/tls-allowed",
      "/api/revalidate",
      "/api/revalidate/",
      "/api/revalidate/x",
      "/api/healthz",
      "/api/healthz/",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("keeps everything else behind the middleware, including look-alike prefixes", () => {
    for (const path of [
      "/",
      "/products/abc",
      "/password",
      "/api/revalidates",
      "/api/revalidate-x",
      "/favicon.ico2",
      "/favicon.icon",
      "/api/tls-allowedx",
      "/api/healthzx",
      "/_nextx",
      "/next/static/x.js",
    ]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});

describe("storefront middleware (spec 1.12)", () => {
  it("an unlocked shop passes; responses forbid framing except by itself", async () => {
    const res = await run("/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    // Preflight 25: the Ingress no longer sets this, so the app does.
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("strips client-sent x-shop-id and x-morbeh-preview", async () => {
    const res = await run("/", {
      headers: { "x-shop-id": "shop-evil", "x-morbeh-preview": "forged" },
    });
    expect(forwarded(res, "x-morbeh-preview")).toBeNull();
    expect(forwarded(res, "x-shop-id")).toBeNull();
  });

  it("an unlocked shop forwards a well-shaped preview token without asking the Runtime (the layout validates)", async () => {
    const res = await run(`/?preview=${UNKNOWN_TOKEN}`);
    expect(res.headers.get("location")).toBeNull();
    expect(forwarded(res, "x-morbeh-preview")).toBe(UNKNOWN_TOKEN);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(previewCalls()).toHaveLength(0);
  });

  describe("locked shop", () => {
    beforeEach(() => {
      access["shop-a"] = { locked: true, accessVersion: 3 };
    });

    it("GET without a cookie → 302 /password?return_to=<path> (preview param dropped), noindex", async () => {
      const res = await run("/products/lamp?color=red");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "https://a.example/password?return_to=%2Fproducts%2Flamp%3Fcolor%3Dred",
      );
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("POST without a cookie → 403", async () => {
      expect((await run("/cart", { method: "POST" })).status).toBe(403);
    });

    it("a valid cookie passes; expired, other shop, old version or no secret do not", async () => {
      expect(
        (await run("/", { cookie: await cookieFor("shop-a", 3) })).headers.get("location"),
      ).toBeNull();
      expect((await run("/", { cookie: await cookieFor("shop-a", 3, 1) })).status).toBe(302);
      expect((await run("/", { cookie: await cookieFor("shop-b", 3) })).status).toBe(302);
      expect((await run("/", { cookie: await cookieFor("shop-a", 2) })).status).toBe(302);
      const valid = await cookieFor("shop-a", 3);
      vi.stubEnv("STOREFRONT_ACCESS_SECRET", "");
      expect((await run("/", { cookie: valid })).status).toBe(302); // fail closed
    });

    it("a valid cookie lets a POST through (the shop's own actions work once unlocked)", async () => {
      const res = await run("/cart", { method: "POST", cookie: await cookieFor("shop-a", 3) });
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("a forged or tampered cookie is redirected", async () => {
      const forged = await cookieFor("shop-a", 3, undefined, "x".repeat(32));
      expect((await run("/", { cookie: forged })).status).toBe(302);
      const valid = await cookieFor("shop-a", 3);
      const [, , exp, mac] = valid.split(".");
      const later = `v1.3.${Number(exp) + 86_400}.${mac}`; // extended expiry, same signature
      expect((await run("/", { cookie: later })).status).toBe(302);
      const flipped = `${valid.slice(0, -2)}${valid.at(-2) === "a" ? "b" : "a"}${valid.at(-1)}`;
      expect((await run("/", { cookie: flipped })).status).toBe(302);
      expect((await run("/", { cookie: "v1.3.9999999999.not-a-mac" })).status).toBe(302);
    });

    it("a stale accessVersion (password changed, or re-locked) is revoked", async () => {
      const before = await cookieFor("shop-a", 3);
      expect((await run("/", { cookie: before })).headers.get("location")).toBeNull();
      access["shop-a"] = { locked: true, accessVersion: 4 };
      vi.resetModules(); // a fresh access cache, as after the 15 s TTL
      expect((await run("/", { cookie: before })).status).toBe(302);
    });

    it("exempt paths stay reachable: /password, /policies/*, robots, sitemap, Next assets", async () => {
      for (const path of [
        "/password",
        "/password?return_to=%2F",
        "/policies/refund-policy",
        "/robots.txt",
        "/sitemap.xml",
        "/_next/static/chunks/main.js",
        "/_next/image?url=https%3A%2F%2Fcdn.test%2Fa.jpg&w=640&q=75",
      ]) {
        expect((await run(path)).headers.get("location"), path).toBeNull();
      }
    });

    it("look-alikes of exempt paths are gated", async () => {
      for (const path of [
        "/passwords",
        "/Password",
        "/policies",
        "/policiesx/a",
        "/robots.txt/x",
      ]) {
        expect((await run(path)).status, path).toBe(302);
      }
    });

    it("the password page is noindex and never cached", async () => {
      const res = await run("/password");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("a GET with a VALID preview token passes, private and frameable by the admin only (Ruling 36)", async () => {
      const res = await run(`/products/lamp?preview=${TOKEN}`);
      expect(res.headers.get("location")).toBeNull();
      expect(forwarded(res, "x-morbeh-preview")).toBe(TOKEN);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'self' https://admin.example",
      );
      const [call] = previewCalls();
      expect(call?.[1]?.headers).toEqual({ "x-tenant-id": "shop-a", "x-preview-token": TOKEN });
    });

    it("a well-shaped but unknown or expired token → 302, and nothing is forwarded", async () => {
      const res = await run(`/products/lamp?preview=${UNKNOWN_TOKEN}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        "https://a.example/password?return_to=%2Fproducts%2Flamp",
      );
      expect(forwarded(res, "x-morbeh-preview")).toBeNull();
    });

    it("a proxy that drops the preview header gets the live 200: that is NOT a preview → 302", async () => {
      previews[TOKEN] = { status: 200, body: { mode: "live", locked: true } };
      expect((await run(`/?preview=${TOKEN}`)).status).toBe(302);
    });

    it("the token check answering 429, 503, garbage or throwing → 302 (fail closed)", async () => {
      for (const answer of [
        { status: 429, body: { mode: "preview" } },
        { status: 503, body: {} },
        { status: 200, body: "garbage" },
        "throw" as const,
      ]) {
        previews[TOKEN] = answer;
        expect((await run(`/?preview=${TOKEN}`)).status, JSON.stringify(answer)).toBe(302);
      }
    });

    it("a preview token is checked every time (never cached)", async () => {
      await run(`/?preview=${TOKEN}`);
      previews[TOKEN] = { status: 401, body: {} }; // revoked or expired
      expect((await run(`/?preview=${TOKEN}`)).status).toBe(302);
      expect(previewCalls()).toHaveLength(2);
    });

    it("an invalid token with a valid cookie passes as an ordinary unlocked visit", async () => {
      const res = await run(`/?preview=${UNKNOWN_TOKEN}`, {
        cookie: await cookieFor("shop-a", 3),
      });
      expect(res.headers.get("location")).toBeNull();
      expect(forwarded(res, "x-morbeh-preview")).toBeNull();
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    });

    it("a malformed preview value is ignored (gated like any GET, never sent to the Runtime)", async () => {
      expect((await run("/?preview=<script>")).status).toBe(302);
      expect((await run(`/?preview=${"T".repeat(31)}`)).status).toBe(302);
      expect((await run(`/?preview=${"T".repeat(101)}`)).status).toBe(302);
      expect(previewCalls()).toHaveLength(0);
    });

    it("a hung token check fails closed after its timeout → 302", { timeout: 10_000 }, async () => {
      previews[TOKEN] = "hang";
      expect((await run(`/?preview=${TOKEN}`)).status).toBe(302);
    });

    it(
      "a hung Runtime with no known lock state → 503 after the timeout, not a hung page",
      { timeout: 10_000 },
      async () => {
        access["shop-a"] = "hang";
        expect((await run("/")).status).toBe(503);
      },
    );

    it("a Runtime that fails AFTER a known state keeps the gate locked (stale for 5 min)", async () => {
      expect((await run("/")).status).toBe(302);
      access["shop-a"] = "fail";
      expect((await run("/")).status).toBe(302);
    });
  });

  describe("GET /password (preflight 21)", () => {
    it("an unlocked store sends the visitor on to a safe return_to", async () => {
      const res = await run("/password?return_to=%2Fproducts%2Flamp%3Fc%3D1");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://a.example/products/lamp?c=1");
    });

    it("never redirects off the shop (open redirect attempts)", async () => {
      for (const raw of [
        "//evil.example",
        "/\\evil.example",
        "/\t/evil.example",
        "/\n/evil.example",
        "https://evil.example/",
      ]) {
        const res = await run(`/password?return_to=${encodeURIComponent(raw)}`);
        expect(res.headers.get("location"), JSON.stringify(raw)).toBe("https://a.example/");
      }
    });

    it("a locked store renders the page", async () => {
      access["shop-a"] = { locked: true, accessVersion: 3 };
      const res = await run("/password?return_to=%2F");
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    });

    it("an unknown lock state renders the page (never a 503, never a redirect)", async () => {
      access["shop-a"] = "fail";
      const res = await run("/password");
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    });

    it("the unlock POST itself goes through, locked or not", async () => {
      access["shop-a"] = { locked: true, accessVersion: 3 };
      const res = await run("/password?return_to=%2F", { method: "POST" });
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  it("any POST carrying ?preview= is refused, locked or not (view-only preview, Ruling 15)", async () => {
    expect((await run(`/products/lamp?preview=${TOKEN}`, { method: "POST" })).status).toBe(403);
    expect((await run("/cart?preview=x", { method: "PUT" })).status).toBe(403);
    expect((await run("/password?preview=x", { method: "POST" })).status).toBe(403);
    access["shop-a"] = { locked: true, accessVersion: 3 };
    vi.resetModules();
    const cookie = await cookieFor("shop-a", 3);
    expect((await run(`/cart?preview=${TOKEN}`, { method: "POST", cookie })).status).toBe(403);
    expect(previewCalls()).toHaveLength(0);
  });

  it("unknown access with a failing Runtime → 503 (fail closed)", async () => {
    access["shop-a"] = "fail";
    const res = await run("/");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("host routing on: A's cookie on B's host is redirected (Review Focus 2)", async () => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    access["shop-a"] = { locked: true, accessVersion: 3 };
    access["shop-b"] = { locked: true, accessVersion: 3 };
    const aCookie = await cookieFor("shop-a", 3);
    expect(
      (await run("/", { host: "a.example", cookie: aCookie })).headers.get("location"),
    ).toBeNull();
    expect((await run("/", { host: "b.example", cookie: aCookie })).status).toBe(302);
    expect((await run("/", { host: "nowhere.example" })).status).toBe(404);
  });

  it("host routing on: a preview token is checked against the host's shop, not the default", async () => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    access["shop-b"] = { locked: true, accessVersion: 3 };
    const res = await run(`/?preview=${TOKEN}`, { host: "b.example" });
    const [call] = previewCalls();
    expect((call?.[1]?.headers as Record<string, string>)["x-tenant-id"]).toBe("shop-b");
    expect(forwarded(res, "x-shop-id")).toBe("shop-b");
  });
});
