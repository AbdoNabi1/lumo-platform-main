import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import type { PolicyType } from "@platform/storefront-content";

/** Each run of a cached function: its key, and whether the real unstable_cache would store it. */
const cacheRuns: { keyParts: string[]; tags: string[]; revalidate: number; outcome?: string }[] =
  [];
/** Next 15 throws when `headers()` is called inside `unstable_cache` (preflight 1); so does this. */
let cacheDepth = 0;
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    opts: { tags: string[]; revalidate: number },
  ) => {
    return async () => {
      const run: (typeof cacheRuns)[number] = {
        keyParts,
        tags: opts.tags,
        revalidate: opts.revalidate,
      };
      cacheRuns.push(run);
      cacheDepth += 1;
      try {
        const value = await fn();
        run.outcome = "stored";
        return value;
      } catch (error) {
        run.outcome = "threw";
        throw error;
      } finally {
        cacheDepth -= 1;
      }
    };
  },
}));
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => {
    if (cacheDepth > 0) throw new Error("E127: headers() inside unstable_cache");
    return { get: (k: string) => requestHeaders.get(k) ?? null };
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));

const {
  collectSitemapPaths,
  getSitemapPaths,
  SITEMAP_BUDGET_MS,
  SITEMAP_MAX_CALLS,
  SITEMAP_MAX_URLS,
} = await import("./sitemap");
type Reads = Parameters<typeof collectSitemapPaths>[0];

type Item = { slug: unknown; status: unknown };
interface FakeOptions {
  collections?: Item[][];
  products?: Item[][];
  /** Every list that has pages says it has another, forever. */
  endless?: boolean;
  pages?: { handle: unknown; updatedAt: unknown }[] | null;
  policies?: Partial<Record<PolicyType, unknown>>;
  productsFail?: boolean;
  collectionsFail?: boolean;
  policyError?: PolicyType;
  /** Override a page's pageInfo (cursor loop cases). */
  pageInfo?: (index: number) => { hasNextPage: boolean; endCursor: string | null };
  /** Runs on every read (a clock, say). */
  onCall?: () => void;
}

/** Fake reads over in-memory pages; `calls()` counts every Runtime read. */
function reads(options: FakeOptions): Reads & { calls(): number; afters: (string | undefined)[] } {
  let calls = 0;
  const afters: (string | undefined)[] = [];
  const paged = (pages: Item[][] | undefined, fail: boolean | undefined) => {
    return async (after?: string) => {
      calls += 1;
      options.onCall?.();
      afters.push(after);
      if (fail === true) return null;
      const list = pages ?? [];
      const index = after === undefined ? 0 : Number(after);
      const items = list[index] ?? [];
      const pageInfo = options.pageInfo?.(index) ?? {
        hasNextPage: (options.endless === true && pages !== undefined) || index < list.length - 1,
        endCursor: String(index + 1),
      };
      return { items: items as never, pageInfo };
    };
  };
  return {
    products: paged(options.products, options.productsFail),
    collections: paged(options.collections, options.collectionsFail),
    pages: async () => {
      calls += 1;
      options.onCall?.();
      return options.pages === undefined ? [] : (options.pages as never);
    },
    policy: async (type: PolicyType) => {
      calls += 1;
      options.onCall?.();
      if (options.policyError === type) return { status: "error" };
      const policies = options.policies ?? {};
      if (!(type in policies)) return { status: "not-found" };
      return { status: "ok", value: { updatedAt: policies[type] as string | null } };
    },
    calls: () => calls,
    afters,
  };
}

describe("collectSitemapPaths (spec 2.8)", () => {
  it("home, search, published collections, listed products, pages and set policies (spec 2.8)", async () => {
    const paths = await collectSitemapPaths(
      reads({
        collections: [
          [
            { slug: "sale", status: "published" },
            { slug: "soon", status: "draft" },
          ],
        ],
        products: [
          [
            { slug: "lamp", status: "published" },
            { slug: "hidden", status: "unlisted" },
          ],
        ],
        pages: [{ handle: "about", updatedAt: "2026-11-01T00:00:00.000Z" }],
        policies: { refund: "2026-11-02T00:00:00.000Z" },
      }),
    );
    expect(paths).toEqual([
      { path: "/" },
      { path: "/search" },
      { path: "/collections/sale" },
      { path: "/products/lamp" },
      { path: "/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
      { path: "/policies/refund-policy", lastModified: "2026-11-02T00:00:00.000Z" },
    ]);
  });

  it("a set policy or page without a date has no lastModified; policies keep POLICY_TYPES order", async () => {
    const paths = await collectSitemapPaths(
      reads({
        pages: [{ handle: "faq", updatedAt: null }],
        policies: { contact: null, refund: "2026-11-02T00:00:00.000Z", terms: null },
      }),
    );
    expect(paths.slice(2)).toEqual([
      { path: "/pages/faq" },
      { path: "/policies/refund-policy", lastModified: "2026-11-02T00:00:00.000Z" },
      { path: "/policies/terms-of-service" },
      { path: "/policies/contact-information" },
    ]);
  });

  it("pages through collections and products with each page's cursor", async () => {
    const r = reads({
      collections: [[{ slug: "a", status: "published" }], [{ slug: "b", status: "published" }]],
      products: [
        [{ slug: "p1", status: "published" }],
        [{ slug: "p2", status: "published" }],
        [{ slug: "p3", status: "published" }],
      ],
    });
    const paths = await collectSitemapPaths(r);
    expect(paths.map((p) => p.path)).toEqual([
      "/",
      "/search",
      "/collections/a",
      "/collections/b",
      "/products/p1",
      "/products/p2",
      "/products/p3",
    ]);
    expect(r.afters).toEqual([undefined, "1", undefined, "1", "2"]);
  });

  it("pages through products until the cap: 5,000 URLs, at most 60 Runtime calls", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ slug: `p-${i}`, status: "published" }));
    const r = reads({ products: Array.from({ length: 80 }, () => many), endless: true });
    const paths = await collectSitemapPaths(r);
    expect(paths).toHaveLength(SITEMAP_MAX_URLS);
    expect(r.calls()).toBeLessThanOrEqual(SITEMAP_MAX_CALLS);
  });

  it("never more than 60 Runtime calls, even with tiny endless pages; pages and policies still read", async () => {
    const r = reads({
      collections: [[{ slug: "c", status: "published" }]],
      products: [[{ slug: "p", status: "published" }]],
      endless: true,
      policies: { refund: null },
    });
    const paths = await collectSitemapPaths(r);
    expect(r.calls()).toBe(SITEMAP_MAX_CALLS);
    expect(paths.at(-1)).toEqual({ path: "/policies/refund-policy" });
  });

  it("stops paging on a missing or repeated cursor (no loop)", async () => {
    const missing = reads({
      products: [[{ slug: "p", status: "published" }]],
      pageInfo: () => ({ hasNextPage: true, endCursor: null }),
    });
    await collectSitemapPaths(missing);
    expect(missing.calls()).toBe(2 + 1 + 5); // collections, products, pages, five policies
    const repeated = reads({
      products: [[{ slug: "p", status: "published" }]],
      pageInfo: () => ({ hasNextPage: true, endCursor: "0" }),
    });
    await collectSitemapPaths(repeated);
    // Once per list (collections, then products), never again.
    expect(repeated.afters.filter((a) => a === "0")).toHaveLength(2);
    expect(repeated.calls()).toBe(2 + 2 + 1 + 5);
  });

  it("a failed read throws (the cached function stores nothing)", async () => {
    await expect(collectSitemapPaths(reads({ productsFail: true }))).rejects.toThrow();
    await expect(collectSitemapPaths(reads({ collectionsFail: true }))).rejects.toThrow();
    await expect(collectSitemapPaths(reads({ pages: null }))).rejects.toThrow();
    await expect(collectSitemapPaths(reads({ policyError: "privacy" }))).rejects.toThrow();
  });

  it("keeps only safe slugs, handles and dates (preflight 8: Next writes them raw into XML)", async () => {
    const hostile = [
      "<script>",
      "a&b",
      'a"b',
      "a'b",
      "../x",
      "a/b",
      "A",
      "a--b",
      "-a",
      "a-",
      "",
      "a b",
      "a%20b",
      "а",
    ];
    const items = [
      ...hostile.map((slug) => ({ slug, status: "published" })),
      { slug: 42, status: "published" },
      { slug: null, status: "published" },
      { slug: "ok-1", status: "published" },
    ];
    const paths = await collectSitemapPaths(
      reads({
        collections: [items],
        products: [items],
        pages: [
          { handle: "<x>", updatedAt: null },
          { handle: "../etc", updatedAt: null },
          { handle: "a&b", updatedAt: null },
          { handle: 'a"', updatedAt: null },
          { handle: "A", updatedAt: null },
          { handle: "a".repeat(101), updatedAt: null },
          { handle: 7, updatedAt: null },
          { handle: "good_one", updatedAt: "</lastmod><x>" },
          { handle: "dated", updatedAt: "2026-11-01T00:00:00Z" },
          { handle: "bad-date", updatedAt: "2026-13-45" },
          { handle: "no-date", updatedAt: 1_700_000_000_000 },
        ],
        policies: { refund: "not a date", shipping: "<x>", privacy: "2026-11-02" },
      }),
    );
    expect(paths).toEqual([
      { path: "/" },
      { path: "/search" },
      { path: "/collections/ok-1" },
      { path: "/products/ok-1" },
      { path: "/pages/good_one" },
      { path: "/pages/dated", lastModified: "2026-11-01T00:00:00.000Z" },
      { path: "/pages/bad-date" },
      { path: "/pages/no-date" },
      { path: "/policies/refund-policy" },
      { path: "/policies/shipping-policy" },
      { path: "/policies/privacy-policy", lastModified: "2026-11-02T00:00:00.000Z" },
    ]);
    for (const { path, lastModified } of paths) {
      expect(path).toMatch(/^\/[a-z0-9/_-]*$/);
      if (lastModified !== undefined) expect(lastModified).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    }
  });

  it("throws once the 20 s total budget is exceeded (preflight 9)", async () => {
    let now = 1_000_000;
    const r = reads({
      products: [[{ slug: "p", status: "published" }]],
      endless: true,
      onCall: () => {
        now += 3_000;
      },
    });
    await expect(collectSitemapPaths(r, { now: () => now })).rejects.toThrow(/budget/);
    expect(r.calls()).toBeLessThanOrEqual(Math.ceil(SITEMAP_BUDGET_MS / 3_000) + 1);
    expect(SITEMAP_BUDGET_MS).toBe(20_000);
  });
});

type Init = RequestInit & { headers: Record<string, string> };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getSitemapPaths (host routing on, preflight 1)", () => {
  let routes: Record<string, () => Response>;
  let fetchMock: ReturnType<typeof vi.fn<(url: string, init: Init) => Promise<Response>>>;
  const outer = () => cacheRuns.filter((r) => r.keyParts.includes("sitemap"));

  beforeEach(() => {
    cacheRuns.length = 0;
    cacheDepth = 0;
    requestHeaders.clear();
    vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
    requestHeaders.set("x-shop-id", "shop-a");
    routes = {
      "/api/v1/public/collections": () =>
        json(200, {
          items: [{ slug: "sale", status: "published" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      "/api/v1/public/products": () =>
        json(200, {
          items: [{ slug: "lamp", status: "published" }],
          pageInfo: { hasNextPage: false, endCursor: "c1" },
        }),
      "/api/v1/public/pages": () =>
        json(200, { pages: [{ handle: "about", updatedAt: "2026-11-01T00:00:00.000Z" }] }),
      "/api/v1/public/policies/refund": () =>
        json(200, { type: "refund", body: { en: "x" }, updatedAt: "2026-11-02T00:00:00.000Z" }),
    };
    fetchMock = vi.fn(async (url: string) => {
      const route = routes[new URL(url).pathname];
      return route === undefined ? json(404, { code: "NOT_FOUND" }) : route();
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the shop outside the cache; every read names it and has a 3 s timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(await getSitemapPaths()).toEqual([
      { path: "/" },
      { path: "/search" },
      { path: "/collections/sale" },
      { path: "/products/lamp" },
      { path: "/pages/about", lastModified: "2026-11-01T00:00:00.000Z" },
      { path: "/policies/refund-policy", lastModified: "2026-11-02T00:00:00.000Z" },
    ]);
    expect(outer()).toEqual([
      {
        keyParts: ["online-store", "shop-a", "sitemap"],
        tags: ["os:shop-a"],
        revalidate: 3600,
        outcome: "stored",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 1 + 1 + 5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["x-tenant-id"]).toBe("shop-a");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(timeout).toHaveBeenCalledTimes(fetchMock.mock.calls.length);
    expect(timeout.mock.calls.every(([ms]) => ms === 3_000)).toBe(true);
    const products = new URL(fetchMock.mock.calls.find(([u]) => u.includes("/products"))![0]);
    expect(products.searchParams.get("first")).toBe("100");
    expect(products.searchParams.has("after")).toBe(false);
  });

  it("asks for the next page with the cursor", async () => {
    let page = 0;
    routes["/api/v1/public/products"] = () => {
      page += 1;
      return json(200, {
        items: [{ slug: `p${page}`, status: "published" }],
        pageInfo: { hasNextPage: page < 2, endCursor: `c${page}` },
      });
    };
    const paths = await getSitemapPaths();
    expect(paths.map((p) => p.path)).toContain("/products/p2");
    const urls = fetchMock.mock.calls
      .map(([u]) => new URL(u))
      .filter((u) => u.pathname.endsWith("/products"));
    expect(urls.map((u) => u.searchParams.get("after"))).toEqual([null, "c1"]);
  });

  it("a failed read throws inside the cache, so nothing is stored", async () => {
    routes["/api/v1/public/products"] = () => json(503, {});
    await expect(getSitemapPaths()).rejects.toThrow();
    expect(outer().map((r) => r.outcome)).toEqual(["threw"]);
    routes["/api/v1/public/products"] = () => json(200, { items: "nope" });
    await expect(getSitemapPaths()).rejects.toThrow();
    routes["/api/v1/public/pages"] = () => json(500, {});
    await expect(getSitemapPaths()).rejects.toThrow();
  });

  it("a policy read that fails throws; one that is not set is skipped", async () => {
    routes["/api/v1/public/policies/terms"] = () => json(502, {});
    await expect(getSitemapPaths()).rejects.toThrow();
    expect(outer().map((r) => r.outcome)).toEqual(["threw"]);
  });

  it("past the 20 s budget the sitemap throws and is not stored (preflight 9)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T10:00:00.000Z"));
    routes["/api/v1/public/products"] = () => {
      vi.setSystemTime(Date.now() + 2_900);
      return json(200, {
        items: [{ slug: "p", status: "published" }],
        pageInfo: { hasNextPage: true, endCursor: String(Date.now()) },
      });
    };
    await expect(getSitemapPaths()).rejects.toThrow(/budget/);
    expect(outer().map((r) => r.outcome)).toEqual(["threw"]);
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
  });
});
