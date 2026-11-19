import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import { DEFAULT_HOMEPAGE_SECTIONS } from "@platform/storefront-content";

/** Each run of a cached function: its key, its options, and whether the real cache would store it. */
const cacheRuns: {
  keyParts: string[];
  options: { tags: string[]; revalidate: number };
  outcome?: "stored" | "threw";
}[] = [];
/** Next 15 throws when `headers()` is called inside `unstable_cache` (F24); so does this mock. */
let cacheDepth = 0;
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    options: { tags: string[]; revalidate: number },
  ) => {
    return async () => {
      const run: (typeof cacheRuns)[number] = { keyParts, options };
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
const headersOutside = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => {
    if (cacheDepth > 0) throw new Error("E127: headers() inside unstable_cache");
    headersOutside();
    return { get: (k: string) => requestHeaders.get(k) ?? null };
  },
  cookies: async () => {
    throw new Error("cookies() must not be read by the homepage");
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));

const { DEFAULT_HOME, getHomepage, parseHome } = await import("./homepage");
const { unstable_cache } = await import("next/cache");
const { headers } = await import("next/headers");

type Init = RequestInit & { headers: Record<string, string> };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ID = "00000000-0000-4000-8000-000000000201";
const richText = (mode: "live" | "preview") => ({
  mode,
  sections: [
    {
      id: ID,
      type: "rich_text",
      ...(mode === "preview" ? { hidden: false } : {}),
      settings: { heading: { en: `${mode} story` }, body: {}, button: null, align: "start" },
    },
  ],
});

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: Init) => Promise<Response>>>;
const stubFetch = (answer: (url: string, init: Init) => Response | Promise<Response>) => {
  fetchMock = vi.fn(async (url: string, init: Init) => answer(url, init));
  vi.stubGlobal("fetch", fetchMock);
};
const isPreview = (init: Init) => init.headers["x-preview-token"] !== undefined;

beforeEach(() => {
  expect.hasAssertions();
  cacheRuns.length = 0;
  cacheDepth = 0;
  requestHeaders.clear();
  headersOutside.mockClear();
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
  requestHeaders.set("x-shop-id", "shop-a");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getHomepage (spec 3.6, Ruling 15)", () => {
  it("live: one cache entry per shop, key [online-store, shop, home], tags os: and catalog:", async () => {
    stubFetch(() => json(200, richText("live")));
    await getHomepage(null);
    requestHeaders.set("x-shop-id", "shop-b");
    await getHomepage(null);
    expect(cacheRuns.map((r) => r.keyParts)).toEqual([
      ["online-store", "shop-a", "home"],
      ["online-store", "shop-b", "home"],
    ]);
    expect(cacheRuns[0]!.options).toEqual({
      tags: ["os:shop-a", "catalog:shop-a"],
      revalidate: 60,
    });
    expect(cacheRuns[1]!.options.tags).toEqual(["os:shop-b", "catalog:shop-b"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/api\/v1\/public\/online-store\/home$/);
    expect(init.headers["x-tenant-id"]).toBe("shop-a");
    expect(init.headers["x-preview-token"]).toBeUndefined();
    expect(fetchMock.mock.calls[1]![1].headers["x-tenant-id"]).toBe("shop-b");
  });

  it("the cached read never touches next/headers: the shop is resolved outside the cache (F24)", async () => {
    // The mock is real: headers() works outside a cached function and throws inside one.
    await expect(headers()).resolves.toBeDefined();
    await expect(
      unstable_cache(async () => headers(), ["probe"], { revalidate: 1 })(),
    ).rejects.toThrow("E127");
    cacheRuns.length = 0;
    headersOutside.mockClear();

    stubFetch(() => json(200, richText("live")));
    const home = await getHomepage(null);
    // A read that touched headers() inside the cache would have thrown and given DEFAULT_HOME.
    expect(home).not.toEqual(DEFAULT_HOME);
    expect(home.sections).toHaveLength(1);
    expect(cacheRuns.map((r) => r.outcome)).toEqual(["stored"]);
    expect(headersOutside).toHaveBeenCalledTimes(1);
  });

  it("preview sends x-preview-token with cache: no-store and never uses unstable_cache", async () => {
    stubFetch((_url, init) => json(200, richText(isPreview(init) ? "preview" : "live")));
    const home = await getHomepage("tok");
    expect(home.mode).toBe("preview");
    expect(home.sections[0]).toMatchObject({ id: ID, hidden: false });
    expect(cacheRuns).toEqual([]);
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers["x-preview-token"]).toBe("tok");
    expect(init.headers["x-tenant-id"]).toBe("shop-a");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a 401 in preview gives the live home", async () => {
    stubFetch((_url, init) =>
      isPreview(init) ? json(401, { code: "PREVIEW_INVALID" }) : json(200, richText("live")),
    );
    const home = await getHomepage("old");
    expect(home.mode).toBe("live");
    expect(home.sections[0]).toMatchObject({ settings: { heading: { en: "live story" } } });
    expect(cacheRuns.map((r) => r.keyParts)).toEqual([["online-store", "shop-a", "home"]]);
  });

  it("a failed home read renders the default homepage and is not cached", async () => {
    for (const answer of [
      () => json(500, {}),
      () => json(200, "garbage"),
      () => json(200, { mode: "live" }),
      () => Promise.reject(new Error("ECONNREFUSED")),
    ]) {
      cacheRuns.length = 0;
      stubFetch(answer);
      expect(await getHomepage(null)).toBe(DEFAULT_HOME);
      expect(cacheRuns.map((r) => r.outcome)).toEqual(["threw"]);
    }
  });

  it("a body labelled with the other mode is unusable", async () => {
    // A live read answered as a preview: never stored, the default renders.
    stubFetch(() => json(200, richText("preview")));
    expect(await getHomepage(null)).toBe(DEFAULT_HOME);
    expect(cacheRuns.map((r) => r.outcome)).toEqual(["threw"]);
    // A preview read answered as live is not a preview: the live read takes over.
    cacheRuns.length = 0;
    stubFetch(() => json(200, richText("live")));
    const home = await getHomepage("tok");
    expect(home.mode).toBe("live");
    expect(cacheRuns.map((r) => r.outcome)).toEqual(["stored"]);
    expect(parseHome(richText("live"), "preview")).toBeNull();
    expect(parseHome(richText("preview"), "live")).toBeNull();
  });
});

describe("parseHome", () => {
  it("re-validates every section; an empty list is an empty homepage", () => {
    expect(parseHome({ mode: "live", sections: [] }, "live")).toEqual({
      mode: "live",
      sections: [],
    });
    expect(parseHome({ mode: "live", sections: "x" }, "live")).toBeNull();
    expect(parseHome(null, "live")).toBeNull();
    const incomplete = { id: ID, type: "hero", hidden: true, incomplete: true };
    expect(parseHome({ mode: "live", sections: [incomplete] }, "live")).toEqual({
      mode: "live",
      sections: [],
    });
    expect(parseHome({ mode: "preview", sections: [incomplete] }, "preview")?.sections).toEqual([
      incomplete,
    ]);
  });
});

describe("DEFAULT_HOME", () => {
  it("is the public form of DEFAULT_HOMEPAGE_SECTIONS: newest 8 in 2 columns, then all in 2", () => {
    expect(DEFAULT_HOME.mode).toBe("live");
    expect(DEFAULT_HOME.sections.map((s) => s.id)).toEqual(
      DEFAULT_HOMEPAGE_SECTIONS.map((s) => s.id),
    );
    expect(DEFAULT_HOME.sections).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000101",
        type: "featured_products",
        settings: {
          source: "newest",
          count: 8,
          heading: { ar: "المنتجات", en: "Products" },
          columns: 2,
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        type: "collection_list",
        settings: { source: "all", heading: { ar: "المجموعات", en: "Collections" }, columns: 2 },
      },
    ]);
    expect(Object.isFrozen(DEFAULT_HOME)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HOME.sections[0])).toBe(true);
  });
});
