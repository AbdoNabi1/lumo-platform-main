import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSection } from "@platform/storefront-content";

/** Each cached read: its key parts, its options, and whether the real cache would store it. */
const cacheCalls: {
  keyParts: string[];
  options: { tags: string[]; revalidate: number };
  outcome?: "stored" | "threw";
}[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    options: { tags: string[]; revalidate: number },
  ) => {
    return async () => {
      const call: (typeof cacheCalls)[number] = { keyParts, options };
      cacheCalls.push(call);
      try {
        const value = await fn();
        call.outcome = "stored";
        return value;
      } catch (error) {
        call.outcome = "threw";
        throw error;
      }
    };
  },
}));
// Every section read takes the shop explicitly: touching request headers at all is a bug here.
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("E127: headers() inside unstable_cache");
  },
  cookies: async () => {
    throw new Error("E127: cookies() inside unstable_cache");
  },
}));

const {
  loadSectionData,
  readCollectionProducts,
  readNewestProducts,
  readProductsByIds,
  readPublishedCollections,
} = await import("./section-data");

type Init = RequestInit & { headers: Record<string, string> };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const page = (items: unknown[]) =>
  json(200, { items, pageInfo: { hasNextPage: false, endCursor: null } });

const product = (id: string, status = "published", slug = `slug-${id}`) => ({
  id,
  sku: `SKU-${id}`,
  name: `Product ${id}`,
  slug,
  status,
  description: null,
  productType: null,
  tags: [],
  options: [],
  variants: [],
});
const collection = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Collection ${id}`,
  slug: `col-${id}`,
  status: "published",
  productIds: ["p1", "p2", "p3"],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: Init) => Promise<Response>>>;
const fetchCalls: { url: string; headers: Record<string, string> }[] = [];
const stubFetch = (answer: (url: string) => Response | Promise<Response>) => {
  fetchMock = vi.fn(async (url: string, init: Init) => {
    fetchCalls.push({ url, headers: init.headers });
    return answer(url);
  });
  vi.stubGlobal("fetch", fetchMock);
};
const path = (url: string) => url.replace(/^.*\/api\/v1/, "");

const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COLLECTION_REF = { id: "c1", slug: "col-c1", name: "Summer" };

beforeEach(() => {
  expect.hasAssertions();
  cacheCalls.length = 0;
  fetchCalls.length = 0;
  stubFetch(() => page([product("p1")]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("section data reads (spec 3.6, Ruling 15)", () => {
  it("two shops, two keys, both tags (Review Focus 4)", async () => {
    await readNewestProducts("shop-a", 8);
    await readNewestProducts("shop-b", 8);
    expect(cacheCalls.map((c) => c.keyParts)).toEqual([
      ["online-store", "shop-a", "section-data", "newest", "8"],
      ["online-store", "shop-b", "section-data", "newest", "8"],
    ]);
    expect(cacheCalls[0]!.options).toEqual({
      tags: ["os:shop-a", "catalog:shop-a"],
      revalidate: 60,
    });
    expect(cacheCalls[1]!.options).toEqual({
      tags: ["os:shop-b", "catalog:shop-b"],
      revalidate: 60,
    });
    expect(fetchCalls.map((c) => c.headers["x-tenant-id"])).toEqual(["shop-a", "shop-b"]);
    expect(path(fetchCalls[0]!.url)).toBe("/public/products?sort=newest&first=8");
  });

  it("cached reads never read request headers (they take the shop explicitly)", async () => {
    await expect(readProductsByIds("shop-a", ["p1"])).resolves.toBeDefined(); // next/headers throws if touched
    expect(fetchCalls[0]!.headers["x-tenant-id"]).toBe("shop-a");
    expect(fetchCalls[0]!.url).toContain("/api/v1/public/products?ids=p1");
    await expect(readPublishedCollections("shop-a")).resolves.toBeDefined();
    await expect(readCollectionProducts("shop-a", "col-c1", 4)).resolves.toBeDefined();
    await expect(readNewestProducts("shop-a", 4)).resolves.toBeDefined();
    expect(fetchCalls.every((c) => c.headers["x-tenant-id"] === "shop-a")).toBe(true);
  });

  it("errors are never cached: a 500, a timeout or garbage throws inside the cached function", async () => {
    const failures: (() => Response | Promise<Response>)[] = [
      () => json(500, { items: [] }),
      () => json(404, {}),
      () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
      () => json(200, "garbage"),
      () => json(200, { items: "x" }),
    ];
    for (const failure of failures) {
      cacheCalls.length = 0;
      stubFetch(failure);
      await expect(readNewestProducts("shop-a", 8)).rejects.toThrow();
      await expect(readProductsByIds("shop-a", ["p1"])).rejects.toThrow();
      await expect(readCollectionProducts("shop-a", "col-c1", 8)).rejects.toThrow();
      await expect(readPublishedCollections("shop-a")).rejects.toThrow();
      expect(cacheCalls.map((c) => c.outcome)).toEqual(["threw", "threw", "threw", "threw"]);
    }
  });

  it("keeps published products only, in order, capped at the count", async () => {
    stubFetch(() =>
      page([
        product("a"),
        product("b", "draft"),
        product("c"),
        product("d", "unlisted"),
        product("e", "published", "../..//evil.example"),
        product("f"),
        product("g"),
      ]),
    );
    const newest = await readNewestProducts("shop-a", 3);
    expect(newest.map((p) => p.id)).toEqual(["a", "c", "f"]);
    expect(newest.every((p) => p.status === "published")).toBe(true);
  });

  it("by ids: request order, only the ids asked for, at most the products field's max", async () => {
    stubFetch(() => page([product("p2"), product("x9"), product("p1"), product("p3", "unlisted")]));
    const picked = await readProductsByIds("shop-a", ["p1", "p2", "p3"]);
    expect(picked.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(path(fetchCalls[0]!.url)).toBe("/public/products?ids=p1,p2,p3");
    expect(cacheCalls[0]!.keyParts).toEqual([
      "online-store",
      "shop-a",
      "section-data",
      "by-ids",
      "p1,p2,p3",
    ]);
    // No ids: nothing to read, no request (the API refuses an empty list).
    fetchCalls.length = 0;
    await expect(readProductsByIds("shop-a", [])).resolves.toEqual([]);
    expect(fetchCalls).toEqual([]);
    // More than the field allows is refused whole, never cut.
    const thirteen = Array.from({ length: 13 }, (_, i) => `p${i}`);
    await expect(readProductsByIds("shop-a", thirteen)).rejects.toThrow();
    await expect(readProductsByIds("shop-a", ["../x"])).rejects.toThrow();
    expect(fetchCalls).toEqual([]);
  });

  it("collection products: /public/collections/<encoded slug>/products?first=<count>", async () => {
    stubFetch(() => page([product("p1"), product("p2", "draft"), product("p3")]));
    const products = await readCollectionProducts("shop-a", "col-c1", 6);
    expect(products.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(path(fetchCalls[0]!.url)).toBe("/public/collections/col-c1/products?first=6");
    expect(cacheCalls[0]!.keyParts).toEqual([
      "online-store",
      "shop-a",
      "section-data",
      "collection",
      "col-c1",
      "6",
    ]);
    fetchCalls.length = 0;
    await expect(readCollectionProducts("shop-a", "../..//evil.example", 6)).rejects.toThrow();
    expect(fetchCalls).toEqual([]);
  });

  it("collections: /public/collections?first=100, published with a catalog slug only (F5)", async () => {
    stubFetch(() =>
      page([
        collection("c1"),
        collection("c2", { status: "draft" }),
        collection("c3", { slug: "../..//evil.example" }),
        collection("c4", { productIds: ["p1", 7, null] }),
      ]),
    );
    const collections = await readPublishedCollections("shop-a");
    expect(path(fetchCalls[0]!.url)).toBe("/public/collections?first=100");
    expect(cacheCalls[0]!.keyParts).toEqual([
      "online-store",
      "shop-a",
      "section-data",
      "collections",
    ]);
    expect(collections.map((c) => c.id)).toEqual(["c1", "c4"]);
    expect(collections[1]).toEqual({
      id: "c4",
      name: "Collection c4",
      slug: "col-c4",
      status: "published",
      productIds: ["p1"],
    });
  });
});

describe("loadSectionData", () => {
  const newest: PublicSection = {
    id: sid(1),
    type: "featured_products",
    settings: { source: "newest", count: 2, heading: {}, columns: 2 },
  };
  const featured: PublicSection = {
    id: sid(2),
    type: "featured_collection",
    settings: {
      collection: COLLECTION_REF,
      heading: {},
      productCount: 4,
      columns: 2,
      showViewAll: true,
    },
  };

  it("loadSectionData runs every section's read in parallel and marks a failure as error, logged without merchant text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending: (() => void)[] = [];
    const answers = new Map<string, () => Response>([
      ["/public/products?sort=newest&first=2", () => page([product("p1"), product("p2")])],
      ["/public/collections/col-c1/products?first=4", () => json(500, {})],
    ]);
    stubFetch(
      (url) =>
        new Promise<Response>((resolve) => {
          pending.push(() => resolve(answers.get(path(url))!()));
        }),
    );
    const loading = loadSectionData("shop-a", [newest, featured]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Both requests are out before either answers: the reads run in parallel.
    expect(pending).toHaveLength(2);
    for (const release of pending) release();
    const data = await loading;
    expect(data.get(sid(1))).toMatchObject({ kind: "products" });
    expect(
      (data.get(sid(1)) as unknown as { products: { id: string }[] }).products.map((p) => p.id),
    ).toEqual(["p1", "p2"]);
    expect(data.get(sid(2))).toBe("error");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("storefront home: section data unavailable", {
      shopId: "shop-a",
      type: "featured_collection",
    });
  });

  it("collection_list manual joins the collections list for counts; an item missing from it keeps its name", async () => {
    stubFetch(() =>
      page([collection("c1", { name: "Summer (renamed)", productIds: ["p1", "p2"] })]),
    );
    const image = { url: "https://cdn.test/c.png", alt: null, width: 10, height: 10 };
    const manual: PublicSection = {
      id: sid(3),
      type: "collection_list",
      settings: {
        source: "manual",
        items: [
          { collection: COLLECTION_REF, image },
          { collection: { id: "c9", slug: "col-c9", name: "Old name" }, image: null },
        ],
        heading: {},
        columns: 2,
      },
    };
    const data = await loadSectionData("shop-a", [manual]);
    expect(data.get(sid(3))).toEqual({
      kind: "collections",
      collections: [
        { id: "c1", slug: "col-c1", name: "Summer (renamed)", productCount: 2, image },
        { id: "c9", slug: "col-c9", name: "Old name", productCount: null, image: null },
      ],
    });
  });

  it("collection_list all lists every published collection with its product count", async () => {
    stubFetch(() => page([collection("c1"), collection("c2", { status: "archived" })]));
    const all: PublicSection = {
      id: sid(4),
      type: "collection_list",
      settings: { source: "all", heading: {}, columns: 2 },
    };
    const data = await loadSectionData("shop-a", [all]);
    expect(data.get(sid(4))).toEqual({
      kind: "collections",
      collections: [
        { id: "c1", slug: "col-c1", name: "Collection c1", productCount: 3, image: null },
      ],
    });
  });

  it("featured_products manual reads its ids; an empty ?ids= answer is an empty product list", async () => {
    stubFetch(() => page([product("p2", "unlisted")]));
    const manual: PublicSection = {
      id: sid(5),
      type: "featured_products",
      settings: { source: "manual", productIds: ["p2"], heading: {}, columns: 2 },
    };
    const data = await loadSectionData("shop-a", [manual]);
    expect(path(fetchCalls[0]!.url)).toBe("/public/products?ids=p2");
    expect(data.get(sid(5))).toEqual({ kind: "products", products: [] });
  });

  it("text-only sections need no read (kind none) and no fetch happens for them", async () => {
    const sections: PublicSection[] = [
      {
        id: sid(6),
        type: "rich_text",
        settings: { heading: { en: "Hi" }, body: {}, button: null, align: "start" },
      },
      {
        id: sid(7),
        type: "whatsapp_cta",
        settings: {
          heading: {},
          text: {},
          buttonLabel: {},
          phone: "201001234567",
          message: {},
        },
      },
      { id: sid(8), type: "featured_collection", hidden: false, incomplete: true },
    ];
    const data = await loadSectionData("shop-a", sections);
    expect([...data.entries()]).toEqual([
      [sid(6), { kind: "none" }],
      [sid(7), { kind: "none" }],
      [sid(8), { kind: "none" }],
    ]);
    expect(fetchCalls).toEqual([]);
    expect(cacheCalls).toEqual([]);
  });
});
