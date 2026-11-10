import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";

const cacheCalls: { keyParts: string[]; tags: string[]; revalidate: number }[] = [];
/** What the real unstable_cache would do with each run: store the value, or store nothing. */
const cacheOutcomes: ("stored" | "threw")[] = [];
/** Next 15 throws when `headers()` is called inside `unstable_cache` (preflight 1); so does this. */
let insideCache = false;
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: () => Promise<unknown>,
    keyParts: string[],
    opts: { tags: string[]; revalidate: number },
  ) => {
    cacheCalls.push({ keyParts, tags: opts.tags, revalidate: opts.revalidate });
    return async () => {
      insideCache = true;
      try {
        const value = await fn();
        cacheOutcomes.push("stored");
        return value;
      } catch (error) {
        cacheOutcomes.push("threw");
        throw error;
      } finally {
        insideCache = false;
      }
    };
  },
}));
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => {
    if (insideCache) throw new Error("E127: headers() inside unstable_cache");
    return { get: (k: string) => requestHeaders.get(k) ?? null };
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  cache: <T>(fn: T) => fn,
}));

const { fetchJson, getPage, getPolicy, PAGE_HANDLE, readPage, readPageList, readPolicy } =
  await import("./content");

type Init = RequestInit & { headers: Record<string, string> };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(500, {}));
/** The stubbed fetch's next (and every later) response. */
const answer = (status: number, body: unknown) => {
  fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(status, body));
  vi.stubGlobal("fetch", fetchMock);
};
const lastUrl = () => fetchMock.mock.calls.at(-1)?.[0];
const lastInit = () => fetchMock.mock.calls.at(-1)?.[1] as Init | undefined;

const pageBody = {
  handle: "about",
  title: { en: "About" },
  body: { en: "Hi" },
  metaDescription: {},
  updatedAt: "2026-11-04T10:00:00.000Z",
};

beforeEach(() => {
  cacheCalls.length = 0;
  cacheOutcomes.length = 0;
  requestHeaders.clear();
  insideCache = false;
  vi.stubEnv("STOREFRONT_HOST_ROUTING", "on");
  requestHeaders.set("x-shop-id", "shop-a");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("content reads (spec 2.8, Rulings 3 and 4)", () => {
  it("a page is cached per shop and handle with the shop's tag", async () => {
    answer(200, {
      handle: "about",
      title: { en: "About" },
      body: { en: "Hi" },
      metaDescription: {},
      updatedAt: "2026-11-04T10:00:00.000Z",
    });
    expect(await getPage("about")).toMatchObject({
      status: "ok",
      value: { handle: "about", title: { en: "About" } },
    });
    expect(cacheCalls).toEqual([
      {
        keyParts: ["online-store", "shop-a", "page", "about"],
        tags: ["os:shop-a"],
        revalidate: 60,
      },
    ]);
    expect(lastUrl()).toMatch(/\/api\/v1\/public\/pages\/about$/);
    expect(lastInit()?.headers["x-tenant-id"]).toBe("shop-a");
    expect(lastInit()?.cache).toBe("no-store");
  });

  it("two shops, two keys (Review Focus 5)", async () => {
    answer(200, pageBody);
    await getPage("about");
    requestHeaders.set("x-shop-id", "shop-b");
    await getPage("about");
    expect(cacheCalls.map((c) => c.keyParts[1])).toEqual(["shop-a", "shop-b"]);
    expect(fetchMock.mock.calls.map((c) => (c[1] as Init).headers["x-tenant-id"])).toEqual([
      "shop-a",
      "shop-b",
    ]);
  });

  it("a 404 is never cached; a failure is an error, never cached", async () => {
    answer(404, { code: "PAGE_NOT_FOUND" });
    expect(await getPage("nope")).toEqual({ status: "not-found" });
    answer(503, {});
    expect(await getPage("about")).toEqual({ status: "error" });
    expect(cacheOutcomes).toEqual(["threw", "threw"]);
  });

  it("a network failure, a timeout, another status or an unusable 200 is an error, not stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    expect(await getPage("about")).toEqual({ status: "error" });
    for (const [status, body] of [
      [422, { code: "VALIDATION_FAILED" }],
      [414, {}],
      [200, "garbage"],
      [200, []],
    ] as const) {
      answer(status, body);
      expect(await getPage("about")).toEqual({ status: "error" });
    }
    expect(cacheOutcomes).toEqual(["threw", "threw", "threw", "threw", "threw"]);
  });

  it("a malformed handle is not-found without any read", async () => {
    answer(200, pageBody);
    for (const handle of ["About", "a/b", "..", "a".repeat(101), "%2e%2e", ""]) {
      expect(await getPage(handle)).toEqual({ status: "not-found" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cacheCalls).toEqual([]);
    expect(PAGE_HANDLE.test("about-us_2")).toBe(true);
  });

  it("a hostile body is re-normalised and capped", async () => {
    answer(200, {
      ...pageBody,
      title: { en: "t".repeat(300) },
      updatedAt: "not a date",
      body: { en: 5 },
    });
    const read = await getPage("about");
    expect(read.status === "ok" && read.value.title.en?.length).toBe(255);
    expect(read.status === "ok" && read.value.updatedAt).toBeNull();
    expect(read.status === "ok" && read.value.body).toEqual({});
  });

  it("caps the meta description at 320 and a body at 100,000, keeping its lines", async () => {
    answer(200, {
      ...pageBody,
      handle: "someone-else",
      metaDescription: { ar: "م".repeat(400) },
      body: { en: `line one\nline two${"x".repeat(100_100)}` },
      id: "p-1",
      status: "draft",
    });
    const read = await getPage("about");
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.value.handle).toBe("about");
    expect(read.value.metaDescription.ar).toHaveLength(320);
    expect(read.value.body.en).toHaveLength(100_000);
    expect(read.value.body.en?.startsWith("line one\nline two")).toBe(true);
    expect(Object.keys(read.value).sort()).toEqual(
      ["body", "handle", "metaDescription", "title", "updatedAt"].sort(),
    );
  });

  it("a policy uses its own key, and the Runtime path is /public/policies/<type>", async () => {
    answer(200, { type: "refund", body: { ar: "نص" }, updatedAt: null });
    expect(await getPolicy("refund")).toMatchObject({ status: "ok", value: { type: "refund" } });
    expect(lastUrl()).toMatch(/\/api\/v1\/public\/policies\/refund$/);
    expect(cacheCalls[0]?.keyParts).toEqual(["online-store", "shop-a", "policy", "refund"]);
    expect(cacheCalls[0]?.tags).toEqual(["os:shop-a"]);
  });

  it("a policy that is not set is not-found; a failed policy read is an error", async () => {
    answer(404, { code: "POLICY_NOT_FOUND" });
    expect(await getPolicy("terms")).toEqual({ status: "not-found" });
    answer(500, {});
    expect(await getPolicy("terms")).toEqual({ status: "error" });
    expect(cacheOutcomes).toEqual(["threw", "threw"]);
  });

  it("a policy body is re-normalised: a valid date stays, the body keeps its lines", async () => {
    answer(200, {
      type: "shipping",
      body: { en: "## Delivery\r\n2 to 5 days", ar: 3 },
      updatedAt: "2026-11-04T10:00:00.000Z",
      version: 4,
    });
    expect(await getPolicy("shipping")).toEqual({
      status: "ok",
      value: {
        type: "shipping",
        body: { en: "## Delivery\n2 to 5 days" },
        updatedAt: "2026-11-04T10:00:00.000Z",
      },
    });
  });

  it("every read carries the 3 s timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    answer(200, pageBody);
    await getPage("about");
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(lastInit()?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("shop-explicit reads for the sitemap (preflight 1)", () => {
  it("readPolicy and readPage take the shop and never read request headers inside the cache", async () => {
    requestHeaders.clear();
    answer(200, { type: "privacy", body: { en: "We collect" }, updatedAt: null });
    expect(await readPolicy("shop-z", "privacy")).toMatchObject({ status: "ok" });
    expect(lastInit()?.headers["x-tenant-id"]).toBe("shop-z");
    answer(200, pageBody);
    expect(await readPage("shop-z", "about")).toMatchObject({ status: "ok" });
    expect(lastInit()?.headers["x-tenant-id"]).toBe("shop-z");
    expect(cacheCalls.map((c) => c.keyParts)).toEqual([
      ["online-store", "shop-z", "policy", "privacy"],
      ["online-store", "shop-z", "page", "about"],
    ]);
    expect(cacheOutcomes).toEqual(["stored", "stored"]);
  });

  it("readPageList keeps well-formed handles and valid dates, at most 500", async () => {
    answer(200, {
      pages: [
        { handle: "about", updatedAt: "2026-11-04T10:00:00.000Z" },
        { handle: "Bad/../x", updatedAt: null },
        { handle: "faq", updatedAt: "</loc><script>" },
        "garbage",
        ...Array.from({ length: 600 }, (_, i) => ({ handle: `p-${i}`, updatedAt: null })),
      ],
    });
    const list = await readPageList("shop-z");
    expect(lastUrl()).toMatch(/\/api\/v1\/public\/pages$/);
    expect(lastInit()?.headers["x-tenant-id"]).toBe("shop-z");
    expect(list?.slice(0, 2)).toEqual([
      { handle: "about", updatedAt: "2026-11-04T10:00:00.000Z" },
      { handle: "faq", updatedAt: null },
    ]);
    expect(list).toHaveLength(500);
    expect(cacheCalls).toEqual([]);
  });

  it("readPageList is null on any failure (the sitemap then throws and stores nothing)", async () => {
    for (const [status, body] of [
      [500, {}],
      [200, { pages: "x" }],
      [200, null],
    ] as const) {
      answer(status, body);
      expect(await readPageList("shop-z")).toBeNull();
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(await readPageList("shop-z")).toBeNull();
  });

  it("fetchJson never throws: a failed read is status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(await fetchJson("shop-z", "/public/pages")).toEqual({ status: 0, body: null });
  });
});
