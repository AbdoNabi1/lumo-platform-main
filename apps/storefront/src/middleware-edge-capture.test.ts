// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  VENDOR_BUILDER_KEYS,
  collect,
  observationFromEnvelope,
  vendorEventName,
  type EnrichedEnvelope,
} from "@platform/tracking";

const EDGE_SECRET = "edge-secret-for-tests-".padEnd(40, "0");
const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";
const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const PREVIEW_TOKEN = "T".repeat(43);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EXISTING_ID = "11111111-2222-4333-8444-555555555555";

interface CollectCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly raw: string;
  readonly body: {
    tenantId: string;
    event: { context: { attribution: Record<string, unknown> } } & Record<string, unknown>;
    client: {
      ip: string | null;
      userAgent: string | null;
      pageUrl: string | null;
      referrer: string | null;
      cookies: Record<string, string>;
    };
  };
}

let collectCalls: CollectCall[];
let otherCalls: string[];
/** What the runtime answers to a collect: the Cookie Keeper's directives. */
let keeperCookies: unknown[];
let collectStatus: number;
let hosts: Record<string, { shopId: string; shopStatus: string }>;
let logged: string[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.resetModules();
  collectCalls = [];
  otherCalls = [];
  keeperCookies = [];
  collectStatus = 202;
  logged = [];
  hosts = {
    "a.example": { shopId: "shop-a", shopStatus: "active" },
    "b.example": { shopId: "shop-b", shopStatus: "active" },
  };
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "off");
  vi.stubEnv("TENANT_DEFAULT_ID", "shop-a");
  vi.stubEnv("STOREFRONT_ACCESS_SECRET", "m".repeat(32));
  vi.stubEnv("ADMIN_ORIGIN", "https://admin.example");
  vi.stubEnv("TRACKING_EDGE_SECRET", EDGE_SECRET);
  vi.stubEnv("RUNTIME_API_URL", "https://runtime.example");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("STOREFRONT_TRUSTED_PROXIES", "");
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.pathname.endsWith("/public/tracking/collect")) {
        const raw = init?.body as string;
        collectCalls.push({
          url: input,
          headers,
          raw,
          body: JSON.parse(raw) as CollectCall["body"],
        });
        return json({ eventId: "evt-1", cookies: keeperCookies }, collectStatus);
      }
      if (url.pathname.endsWith("/public/domains/resolve")) {
        const shop = hosts[url.searchParams.get("host") ?? ""];
        return shop === undefined
          ? json({}, 404)
          : json({ ...shop, hostname: "h", primaryHostname: "h" });
      }
      if (url.pathname.endsWith("/public/online-store")) {
        return headers["x-preview-token"] === PREVIEW_TOKEN
          ? json({ mode: "preview", previewExpiresAt: new Date(NOW + 3_600_000).toISOString() })
          : json({ code: "PREVIEW_INVALID" }, 401);
      }
      otherCalls.push(input);
      return json({ locked: false, accessVersion: 1, message: {} });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface Visit {
  readonly cookie?: string;
  readonly ua?: string | null;
  readonly host?: string;
  readonly headers?: Record<string, string>;
  readonly method?: string;
}

/** One middleware pass; returns the response and waits for everything handed to waitUntil. */
async function visit(path: string, options: Visit = {}) {
  const { middleware } = await import("./middleware");
  const host = options.host ?? "a.example";
  const headers = new Headers({
    accept: "text/html,application/xhtml+xml",
    host,
    ...(options.ua === null ? {} : { "user-agent": options.ua ?? BROWSER_UA }),
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    ...options.headers,
  });
  const waits: Promise<unknown>[] = [];
  const event = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise) };
  const response = await middleware(
    new NextRequest(new URL(path, `https://${host}`), { method: options.method ?? "GET", headers }),
    event as never,
  );
  await Promise.all(waits);
  return { response, waits: waits.length };
}

/** The Set-Cookie header of `name`, parsed: value plus the attribute flags. */
function setCookie(response: Response, name: string) {
  const line = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined) return undefined;
  const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
  const flags = attributes.map((attribute) => attribute.toLowerCase());
  return {
    value: decodeURIComponent(pair.slice(name.length + 1)),
    maxAge: Number(flags.find((flag) => flag.startsWith("max-age="))?.slice(8)),
    secure: flags.includes("secure"),
    httpOnly: flags.includes("httponly"),
    sameSite: flags.find((flag) => flag.startsWith("samesite="))?.slice(9),
    path: flags.find((flag) => flag.startsWith("path="))?.slice(5),
    domain: flags.find((flag) => flag.startsWith("domain=")),
  };
}

describe("master cookie _mb_id", () => {
  it("a new visitor gets one on the page response: UUID, 400 days, Secure, SameSite=Lax, not HttpOnly, host-only", async () => {
    const { response } = await visit("/");

    const master = setCookie(response, "_mb_id");
    expect(master?.value).toMatch(UUID);
    expect(master).toMatchObject({
      maxAge: 400 * 24 * 60 * 60,
      secure: true,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
    });
    expect(master?.domain).toBeUndefined();
  });

  it("is Secure only in production (a local http dev server would otherwise drop it)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { response } = await visit("/");

    expect(setCookie(response, "_mb_id")?.secure).toBe(false);
  });

  it("a returning visitor keeps the SAME id (its 400 days slide) and a plain page view makes no network call", async () => {
    const { response, waits } = await visit("/products/shirt", { cookie: `_mb_id=${EXISTING_ID}` });

    expect(setCookie(response, "_mb_id")?.value).toBe(EXISTING_ID);
    expect(setCookie(response, "_mb_id")?.maxAge).toBe(400 * 24 * 60 * 60);
    expect(waits).toBe(0);
    expect(collectCalls).toEqual([]);
    // Only the lock-state read the middleware always did — nothing tracking added.
    expect(otherCalls).toHaveLength(1);
  });

  it("replaces a malformed id (the browser can edit its cookies) instead of trusting it", async () => {
    const { response } = await visit("/", { cookie: "_mb_id=evil;<x>" });

    expect(setCookie(response, "_mb_id")?.value).toMatch(UUID);
  });

  it("is minted on page navigations only: assets, RSC and prefetch requests never create a visitor", async () => {
    const asset = await visit("/img/hero.webp", {
      headers: { accept: "image/avif,image/webp,*/*" },
    });
    const rsc = await visit("/products", { headers: { rsc: "1" } });
    const prefetch = await visit("/products", { headers: { "next-router-prefetch": "1" } });
    const action = await visit("/", { method: "POST" });

    for (const { response } of [asset, rsc, prefetch, action]) {
      expect(setCookie(response, "_mb_id")).toBeUndefined();
    }
    expect(collectCalls).toEqual([]);
  });
});

describe("the touch event (waitUntil, signed, never blocking)", () => {
  it("a new visitor sends exactly one background touch with the visitor, the page and the trusted IP", async () => {
    const { response, waits } = await visit("/", {
      headers: {
        "x-forwarded-for": "1.2.3.4, 203.0.113.7",
        referer: "https://www.google.com/",
      },
    });

    expect(waits).toBe(1);
    expect(collectCalls).toHaveLength(1);
    const call = collectCalls[0]!;
    expect(call.url).toBe("https://runtime.example/api/v1/public/tracking/collect");
    expect(call.body.tenantId).toBe("shop-a");
    expect(call.headers["x-tenant-id"]).toBe("shop-a");
    expect(call.body.event).toMatchObject({
      eventName: "visitor_touch",
      environment: "production",
      source: "edge",
    });
    expect(call.body.client).toMatchObject({
      ip: "203.0.113.7",
      userAgent: BROWSER_UA,
      pageUrl: "https://a.example/",
      referrer: "https://www.google.com/",
    });
    expect(call.body.client.cookies["visitorId"]).toBe(setCookie(response, "_mb_id")?.value);
    expect(call.body.client.cookies["sessionId"]).toBe(setCookie(response, "morbeh_sid")?.value);
  });

  it("is signed over `<seconds>.<exact body bytes>` with TRACKING_EDGE_SECRET", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    await visit("/");

    const call = collectCalls[0]!;
    const seconds = String(Math.floor(NOW / 1000));
    expect(call.headers["x-mb-ts"]).toBe(seconds);
    expect(call.headers["x-mb-sig"]).toBe(
      createHmac("sha256", EDGE_SECRET).update(`${seconds}.${call.raw}`).digest("hex"),
    );
  });

  it("the page does not wait for the send: the response is returned while the touch is still pending", async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: string, init?: RequestInit) =>
      new URL(input).pathname.endsWith("/public/tracking/collect")
        ? new Promise<Response>((resolve) => (release = resolve))
        : base(input, init),
    );
    const { middleware } = await import("./middleware");
    const waits: Promise<unknown>[] = [];

    const response = await middleware(
      new NextRequest("https://a.example/", {
        headers: { accept: "text/html", host: "a.example", "user-agent": BROWSER_UA },
      }),
      { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never,
    );

    expect(response.status).toBe(200);
    expect(waits).toHaveLength(1);
    // The signature is computed first (async), then the request goes out — and stays pending here.
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/tracking/collect"))).toBe(
        true,
      );
    });
    release(json({ eventId: "e", cookies: [] }, 202));
    await Promise.all(waits);
  });

  it("a landing with click ids and UTMs from a RETURNING visitor sends one touch carrying them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const { waits } = await visit(
      "/products/shirt?fbclid=IwAR-abc&gclid=G-1&utm_source=facebook&utm_medium=cpc&utm_campaign=ramadan",
      { cookie: `_mb_id=${EXISTING_ID}`, headers: { referer: "https://l.facebook.com/" } },
    );

    expect(waits).toBe(1);
    const { event, client } = collectCalls[0]!.body;
    expect(client.cookies["visitorId"]).toBe(EXISTING_ID);
    expect(event.context.attribution).toMatchObject({
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: "ramadan",
      referrer: "https://l.facebook.com/",
      clickIds: [
        { name: "fbclid", value: "IwAR-abc", capturedAt: new Date(NOW).toISOString() },
        { name: "gclid", value: "G-1", capturedAt: new Date(NOW).toISOString() },
      ],
    });
    expect(client.cookies["fbc"]).toBe(`fb.1.${String(NOW)}.IwAR-abc`);
    expect(client.pageUrl).toContain("gclid=G-1");
  });

  it("a new visitor without a campaign is throttled to one touch a minute per address + agent", async () => {
    await visit("/", { headers: { "x-forwarded-for": "203.0.113.7" } });
    await visit("/", { headers: { "x-forwarded-for": "203.0.113.7" } }); // cookie-less client again
    await visit("/", { headers: { "x-forwarded-for": "203.0.113.8" } });

    expect(collectCalls.map((call) => call.body.client.ip)).toEqual(["203.0.113.7", "203.0.113.8"]);
  });

  it("without TRACKING_EDGE_SECRET nothing is sent and the page is unaffected (fail safe)", async () => {
    vi.stubEnv("TRACKING_EDGE_SECRET", "");

    const { response, waits } = await visit("/?gclid=G-1");

    expect(response.status).toBe(200);
    expect(waits).toBe(0);
    expect(collectCalls).toEqual([]);
    expect(setCookie(response, "_mb_id")?.value).toMatch(UUID); // the cookies still work
  });

  it("a runtime failure or a network fault never touches the page", async () => {
    collectStatus = 503;
    expect((await visit("/?gclid=G-1")).response.status).toBe(200);

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    expect((await visit("/?gclid=G-2")).response.status).toBe(200);
  });
});

describe("click ids: cookies and the Click ID Restorer", () => {
  it("_mb_clk: HttpOnly, 90 days, the click per platform; _fbc is derived in Meta's format", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const { response } = await visit("/?fbclid=IwAR-abc&ttclid=TT-1&ScCid=sc-1", {
      cookie: `_mb_id=${EXISTING_ID}`,
    });

    const clk = setCookie(response, "_mb_clk");
    expect(clk).toMatchObject({
      httpOnly: true,
      maxAge: 90 * 24 * 60 * 60,
      sameSite: "lax",
      secure: true,
    });
    expect(JSON.parse(clk!.value)).toEqual({
      fbclid: { v: "IwAR-abc", t: NOW },
      ttclid: { v: "TT-1", t: NOW },
      scclid: { v: "sc-1", t: NOW },
    });
    const fbc = setCookie(response, "_fbc");
    expect(fbc?.value).toBe(`fb.1.${String(NOW)}.IwAR-abc`);
    expect(fbc).toMatchObject({ httpOnly: false, maxAge: 90 * 24 * 60 * 60 });
  });

  it("swaps backup parameters in, and the touch carries the restored native ones", async () => {
    const { response } = await visit("/?mb_gclid=restored-g&mb_sccid=restored-s");

    expect(JSON.parse(setCookie(response, "_mb_clk")!.value)).toMatchObject({
      gclid: { v: "restored-g" },
      scclid: { v: "restored-s" },
    });
    const url = new URL(collectCalls[0]!.body.client.pageUrl!);
    expect(url.searchParams.get("gclid")).toBe("restored-g");
    expect(url.searchParams.get("ScCid")).toBe("restored-s");
    expect(url.searchParams.has("mb_gclid")).toBe(false);
  });

  it("the latest click per platform wins and other platforms are kept", async () => {
    const old = JSON.stringify({
      ttclid: { v: "old-tt", t: NOW - 86_400_000 },
      gclid: { v: "old-g", t: NOW - 86_400_000 },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const { response } = await visit("/?ttclid=new-tt", {
      cookie: `_mb_id=${EXISTING_ID}; _mb_clk=${encodeURIComponent(old)}`,
    });

    expect(JSON.parse(setCookie(response, "_mb_clk")!.value)).toEqual({
      ttclid: { v: "new-tt", t: NOW },
      gclid: { v: "old-g", t: NOW - 86_400_000 },
    });
  });

  it("keeps a 1000-character ttclid whole in the cookie", async () => {
    const long = "T".repeat(1000);

    const { response } = await visit(`/?ttclid=${long}`);

    expect(JSON.parse(setCookie(response, "_mb_clk")!.value).ttclid.v).toBe(long);
  });

  it("does not replace an _fbc that already holds the same click, but replaces one from an older click", async () => {
    const same = await visit("/?fbclid=IwAR-abc", {
      cookie: `_mb_id=${EXISTING_ID}; _fbc=fb.1.1764000000000.IwAR-abc`,
    });
    const newer = await visit("/?fbclid=IwAR-new", {
      cookie: `_mb_id=${EXISTING_ID}; _fbc=fb.1.1764000000000.IwAR-abc`,
    });

    expect(setCookie(same.response, "_fbc")).toBeUndefined();
    expect(setCookie(newer.response, "_fbc")?.value).toMatch(/^fb\.1\.\d+\.IwAR-new$/u);
    // …and the touch reports the cookie that is actually current.
    expect(collectCalls[0]!.body.client.cookies["fbc"]).toBe("fb.1.1764000000000.IwAR-abc");
    expect(collectCalls[1]!.body.client.cookies["fbc"]).toMatch(/^fb\.1\.\d+\.IwAR-new$/u);
  });

  it("a page without a click id sets no click cookie", async () => {
    const { response } = await visit("/products?page=2", { cookie: `_mb_id=${EXISTING_ID}` });

    expect(setCookie(response, "_mb_clk")).toBeUndefined();
    expect(setCookie(response, "_fbc")).toBeUndefined();
  });
});

describe("client IP trust", () => {
  it("ignores a spoofed left-most X-Forwarded-For value", async () => {
    await visit("/", { headers: { "x-forwarded-for": "198.51.100.99, 10.1.1.1, 203.0.113.7" } });

    expect(collectCalls[0]!.body.client.ip).toBe("203.0.113.7");
    expect(JSON.stringify(collectCalls[0]!.body)).not.toContain("198.51.100.99");
  });

  it("sends no address when the header is garbage or absent", async () => {
    await visit("/", { headers: { "x-forwarded-for": "not-an-ip" } });
    await visit("/?gclid=G-1");

    expect(collectCalls.map((call) => call.body.client.ip)).toEqual([null, null]);
  });

  it("honours STOREFRONT_TRUSTED_PROXIES", async () => {
    vi.stubEnv("STOREFRONT_TRUSTED_PROXIES", "2");

    await visit("/", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 104.16.0.1" } });

    expect(collectCalls[0]!.body.client.ip).toBe("203.0.113.7");
  });
});

describe("what is never captured", () => {
  it("crawlers and tools: no cookie, no touch", async () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "curl/8.4.0", null]) {
      const { response, waits } = await visit("/?gclid=G-1", { ua });
      expect(setCookie(response, "_mb_id")).toBeUndefined();
      expect(setCookie(response, "_mb_clk")).toBeUndefined();
      expect(waits).toBe(0);
    }
    expect(collectCalls).toEqual([]);
  });

  it("a staff preview is never visitor traffic", async () => {
    const { response, waits } = await visit(`/?preview=${PREVIEW_TOKEN}&gclid=G-1`);

    expect(response.status).toBe(200);
    expect(setCookie(response, "_mb_id")).toBeUndefined();
    expect(setCookie(response, "_mb_clk")).toBeUndefined();
    expect(waits).toBe(0);
  });

  it("a refusal (unknown host) or a redirect to the password gate carries no tracking cookie", async () => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    const unknown = await visit("/", { host: "nobody.example" });
    expect(unknown.response.status).toBe(404);
    expect(setCookie(unknown.response, "_mb_id")).toBeUndefined();
    expect(collectCalls).toEqual([]);
  });
});

describe("tenant and domain isolation", () => {
  beforeEach(() => {
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
  });

  it("each touch is for the shop the HOST resolved, whatever the request claims", async () => {
    await visit("/", {
      host: "a.example",
      headers: { "x-tenant-id": "shop-b", "x-morbeh-shop-id": "shop-b" },
    });
    await visit("/", { host: "b.example", headers: { "x-forwarded-for": "203.0.113.9" } });

    expect(collectCalls.map((call) => [call.body.tenantId, call.headers["x-tenant-id"]])).toEqual([
      ["shop-a", "shop-a"],
      ["shop-b", "shop-b"],
    ]);
  });

  it("cookies are host-only: no Domain attribute that could leak a visitor across shops", async () => {
    const a = await visit("/", { host: "a.example" });
    const b = await visit("/", {
      host: "b.example",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    for (const { response } of [a, b]) {
      expect(setCookie(response, "_mb_id")?.domain).toBeUndefined();
    }
    expect(setCookie(a.response, "_mb_id")?.value).not.toBe(setCookie(b.response, "_mb_id")?.value);
  });

  it("cookies restored for a visitor of shop A are never applied on shop B, even for the same id", async () => {
    keeperCookies = [{ name: "_ttp", value: "restored-ttp", maxAgeSeconds: 3600 }];
    await visit("/?gclid=G-1", { host: "a.example", cookie: `_mb_id=${EXISTING_ID}` });

    const onB = await visit("/products", { host: "b.example", cookie: `_mb_id=${EXISTING_ID}` });
    const onA = await visit("/products", { host: "a.example", cookie: `_mb_id=${EXISTING_ID}` });

    expect(setCookie(onB.response, "_ttp")).toBeUndefined();
    expect(setCookie(onA.response, "_ttp")?.value).toBe("restored-ttp");
  });
});

describe("Cookie Keeper: restoring what the browser lost", () => {
  const LOST = [
    { name: "_ttp", value: "restored-ttp", maxAgeSeconds: 34_128_000 },
    { name: "_fbp", value: "fb.1.1763000000000.123", maxAgeSeconds: 7_776_000 },
  ];

  it("the touch's answer is set on that visitor's NEXT request, first-party, with the keeper's lifetimes", async () => {
    keeperCookies = LOST;
    await visit("/?gclid=G-1", { cookie: `_mb_id=${EXISTING_ID}` });

    const next = await visit("/products/shirt", { cookie: `_mb_id=${EXISTING_ID}` });

    expect(setCookie(next.response, "_ttp")).toMatchObject({
      value: "restored-ttp",
      maxAge: 34_128_000,
      secure: true,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
    });
    expect(setCookie(next.response, "_fbp")?.value).toBe("fb.1.1763000000000.123");
    expect(next.waits).toBe(0); // restoring made no network call
    // Once only.
    const again = await visit("/products/shirt", { cookie: `_mb_id=${EXISTING_ID}` });
    expect(setCookie(again.response, "_ttp")).toBeUndefined();
  });

  it("never overwrites a cookie the browser has", async () => {
    keeperCookies = LOST;
    await visit("/?gclid=G-1", { cookie: `_mb_id=${EXISTING_ID}` });

    const next = await visit("/", { cookie: `_mb_id=${EXISTING_ID}; _ttp=browser-ttp` });

    expect(setCookie(next.response, "_ttp")).toBeUndefined();
    expect(setCookie(next.response, "_fbp")?.value).toBe("fb.1.1763000000000.123");
  });

  it("the touch tells the runtime which cookies the browser still holds", async () => {
    await visit("/?gclid=G-1", {
      cookie: `_mb_id=${EXISTING_ID}; _fbp=fb.1.1.1; _ga=GA1.1.1.2; ttclid=tt; _scclid=sc; _gcl_aw=GCL.1.g; li_fat_id=li; _epik=ep; _ttp=t; _scid=s`,
    });

    expect(collectCalls[0]!.body.client.cookies).toMatchObject({
      fbp: "fb.1.1.1",
      ga: "GA1.1.1.2",
      ttclid: "tt",
      scclid: "sc",
      gclAw: "GCL.1.g",
      liFatId: "li",
      epik: "ep",
      ttp: "t",
      scid: "s",
    });
  });

  it("ignores names outside the allow-list and unsafe values or lifetimes from the answer", async () => {
    keeperCookies = [
      { name: "morbeh_access", value: "x", maxAgeSeconds: 3600 },
      { name: "_mb_id", value: "attacker-id-0000000000", maxAgeSeconds: 3600 },
      { name: "_ttp", value: "a; Domain=evil.example", maxAgeSeconds: 3600 },
      { name: "_fbp", value: "ok-value", maxAgeSeconds: 99_999_999_999 },
      { name: "_scid", value: "ok-value", maxAgeSeconds: -5 },
    ];
    await visit("/?gclid=G-1", { cookie: `_mb_id=${EXISTING_ID}` });

    const next = await visit("/", { cookie: `_mb_id=${EXISTING_ID}` });

    for (const name of ["morbeh_access", "_ttp", "_fbp", "_scid"]) {
      expect(setCookie(next.response, name), name).toBeUndefined();
    }
    expect(setCookie(next.response, "_mb_id")?.value).toBe(EXISTING_ID);
  });

  it("forgets a restore the visitor did not come back for within 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    keeperCookies = LOST;
    await visit("/?gclid=G-1", { cookie: `_mb_id=${EXISTING_ID}` });
    vi.setSystemTime(NOW + 6 * 60_000);

    const late = await visit("/", { cookie: `_mb_id=${EXISTING_ID}` });

    expect(setCookie(late.response, "_ttp")).toBeUndefined();
  });
});

describe("the touch is a valid capture the profile learns from — and no vendor receives", () => {
  it("passes the runtime's own collect() and teaches the profile the visitor, the click ids and the landing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await visit(
      "/p/1?mb_gclid=G-restored&ttclid=TT-1&fbclid=F-1&utm_source=facebook&utm_campaign=ramadan",
      {
        cookie: `_mb_id=${EXISTING_ID}; _fbp=fb.1.1.1`,
        headers: { "x-forwarded-for": "203.0.113.7", referer: "https://l.facebook.com/" },
      },
    );
    const { event, client, tenantId } = collectCalls[0]!.body;

    // The route merges the signed client context into the event exactly like this before collect().
    const outcome = collect(
      {
        body: {
          writeKey: tenantId,
          event: {
            ...event,
            context: {
              ...event.context,
              page: { url: client.pageUrl, referrer: client.referrer },
            },
          },
        },
        headers: (name) => (name === "user-agent" ? (client.userAgent ?? undefined) : undefined),
        cookies: (name) =>
          ({
            morbeh_vid: client.cookies["visitorId"],
            _fbp: client.cookies["fbp"],
            _fbc: client.cookies["fbc"],
          })[name],
        ...(client.ip === null ? {} : { remoteAddress: client.ip }),
      },
      {
        writeKeys: { resolve: (key) => (key === tenantId ? { tenantId } : null) },
        idGenerator: { generate: () => "generated-id" },
        clock: { now: () => new Date(NOW) },
        ipPolicy: { trustedProxyCount: 0 },
      },
    );

    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    const learned = observationFromEnvelope(
      { ...outcome.envelope, dedupId: "d", eventTimestampMs: NOW } as unknown as EnrichedEnvelope,
      {},
    );
    expect(learned).toMatchObject({
      tenantId: "shop-a",
      visitorId: EXISTING_ID,
      ip: "203.0.113.7",
      userAgent: BROWSER_UA,
      browser: { fbp: "fb.1.1.1", fbc: expect.stringMatching(/^fb\.1\.\d+\.F-1$/u) },
      landing: {
        utmSource: "facebook",
        utmCampaign: "ramadan",
        referrer: "https://l.facebook.com/",
      },
    });
    expect(Object.keys(learned.clickIds).sort()).toEqual(["fbclid", "gclid", "ttclid"]);
    expect(learned.clickIds.gclid?.value).toBe("G-restored");
    expect(learned.clickIds.ttclid?.value).toBe("TT-1");
  });

  it("is routed to no vendor: `visitor_touch` has no event name on any builder", () => {
    for (const builder of VENDOR_BUILDER_KEYS) {
      expect(vendorEventName(builder, "visitor_touch"), builder).toBeNull();
    }
  });
});

describe("privacy of the capture path", () => {
  it("logs nothing — no IP, agent, click id, cookie id or URL reaches a log line", async () => {
    vi.stubEnv("TRACKING_EDGE_SECRET", EDGE_SECRET);
    collectStatus = 503;
    await visit("/?gclid=G-secret-1&utm_source=x", {
      cookie: `_mb_id=${EXISTING_ID}`,
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom 203.0.113.7"),
    );
    await visit("/?gclid=G-secret-2", { headers: { "x-forwarded-for": "203.0.113.8" } });

    expect(logged).toEqual([]);
  });

  it("the signed body holds no cookie value beyond the allow-listed identifiers", async () => {
    await visit("/?gclid=G-1", {
      cookie: `_mb_id=${EXISTING_ID}; morbeh-storefront-access=unlock-proof; session=secret-session`,
    });

    const raw = collectCalls[0]!.raw;
    expect(raw).not.toContain("unlock-proof");
    expect(raw).not.toContain("secret-session");
  });
});
