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

const { fetchCategoriesPage, createCategory, moveCategory, deleteCategory } =
  await import("./categories");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchCategoriesPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = {
      items: [{ id: "cat-1", name: "Outdoor", slug: "outdoor", parentId: null }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchCategoriesPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/categories?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCategoriesPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("createCategory", () => {
  it("sends the right path, method, body and idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "cat-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { name: "Outdoor", slug: "outdoor" };
    const result = await createCategory(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/categories");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "slug", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCategory({ name: "Outdoor", slug: "" }, "key-1");

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "slug", message: "must not be empty" }],
    });
  });
});

describe("moveCategory", () => {
  it("sends the newParentId body to the move route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await moveCategory("cat-1", "cat-2", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/categories/cat-1/move");
    expect(JSON.parse(init.body as string)).toEqual({ newParentId: "cat-2" });
  });

  it("sends a null newParentId when clearing the parent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await moveCategory("cat-1", null, "key-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ newParentId: null });
  });
});

describe("deleteCategory", () => {
  it("posts to the delete route with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await deleteCategory("cat-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/categories/cat-1/delete");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});
