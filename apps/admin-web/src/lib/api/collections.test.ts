import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  fetchCollectionsPage,
  fetchCollection,
  fetchCollectionMembers,
  createCollection,
  renameCollection,
  addCollectionProduct,
  removeCollectionProduct,
  reorderCollectionProducts,
  publishCollection,
  unpublishCollection,
  deleteCollection,
} = await import("./collections");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const collection = {
  id: "c-1",
  name: "Summer",
  slug: "summer",
  status: "draft" as const,
  productIds: [] as string[],
  productCount: 0,
};

beforeEach(() => {
  expect.hasAssertions();
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchCollectionsPage", () => {
  it("requests first/query and maps a 200 body to ok + items + pageInfo", async () => {
    const page = { items: [collection], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCollectionsPage({ first: 20, query: "sum" });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/collections?first=20&query=sum");
  });

  it("sends no query string when there is nothing to ask", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchCollectionsPage({});

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("http://runtime.test/api/v1/collections");
  });

  it("maps 401 to unauthorized and a 500 to error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(401, {})));
    expect(await fetchCollectionsPage({})).toEqual({ outcome: "unauthorized" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(500, {})));
    expect((await fetchCollectionsPage({})).outcome).toBe("error");
  });
});

describe("fetchCollection", () => {
  it("returns the collection, encoding the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, collection));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCollection("c 1");

    expect(result).toEqual({ outcome: "ok", collection });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/collections/c%201",
    );
  });

  it("maps 404 to not_found and 403 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(404, {})));
    expect(await fetchCollection("c-1")).toEqual({ outcome: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(403, {})));
    expect(await fetchCollection("c-1")).toEqual({ outcome: "unauthorized" });
  });

  it("refuses a body that is not a collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: 1 })));
    expect((await fetchCollection("c-1")).outcome).toBe("error");
  });
});

describe("fetchCollectionMembers", () => {
  it("passes first/after and returns members with positions and missing flags", async () => {
    const page = {
      items: [
        { productId: "p-1", position: 50, name: "Tee", status: "draft", missing: false },
        { productId: "p-2", position: 51, name: null, status: null, missing: true },
      ],
      pageInfo: { hasNextPage: false, endCursor: "51" },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCollectionMembers("c/1", { first: 50, after: "49" });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/collections/c%2F1/products?first=50&after=49",
    );
  });

  it("maps 404 to not_found and 401 to unauthorized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(404, {})));
    expect(await fetchCollectionMembers("c-1")).toEqual({ outcome: "not_found" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(401, {})));
    expect(await fetchCollectionMembers("c-1")).toEqual({ outcome: "unauthorized" });
  });
});

describe("writes", () => {
  it("createCollection POSTs the JSON body with the idempotency key and returns the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "c-9" }));
    vi.stubGlobal("fetch", fetchMock);

    const input = { name: "Summer", slug: "summer" };
    const result = await createCollection(input, "k1");

    expect(result).toEqual({ outcome: "ok", data: { id: "c-9" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/collections");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
  });

  it("maps a duplicate slug (409) to conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "CONFLICT", message: "Slug in use" })),
    );
    expect(await createCollection({ name: "A", slug: "a" }, "k")).toEqual({
      outcome: "conflict",
      message: "Slug in use",
      code: "CONFLICT",
    });
  });

  it("removeCollectionProduct encodes both ids in the path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await removeCollectionProduct("c 1", "p/2", "k");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/collections/c%201/products/p%2F2/delete");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["rename", () => renameCollection("c 1", "New", "k"), "/c%201", { name: "New" }],
    [
      "add product",
      () => addCollectionProduct("c 1", "p-1", "k"),
      "/c%201/products",
      { productId: "p-1" },
    ],
    [
      "reorder",
      () => reorderCollectionProducts("c 1", ["b", "a"], "k"),
      "/c%201/reorder",
      { productIds: ["b", "a"] },
    ],
    ["publish", () => publishCollection("c 1", "k"), "/c%201/publish", undefined],
    ["unpublish", () => unpublishCollection("c 1", "k"), "/c%201/unpublish", undefined],
    ["delete", () => deleteCollection("c 1", "k"), "/c%201/delete", undefined],
  ])("%s posts to the right path with the right body", async (_name, call, suffix, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await call();

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://runtime.test/api/v1/collections${suffix}`);
    expect(init.method).toBe("POST");
    expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k");
  });
});
