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

const { fetchBrandsPage, createBrand, updateBrand, deleteBrand } = await import("./brands");

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

describe("fetchBrandsPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = {
      items: [{ id: "brand-1", name: "Acme", slug: "acme" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchBrandsPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/brands?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBrandsPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("createBrand", () => {
  it("sends the right path, method, body and idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "brand-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { name: "Acme", slug: "acme" };
    const result = await createBrand(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/brands");
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

    const result = await createBrand({ name: "Acme", slug: "" }, "key-1");

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "slug", message: "must not be empty" }],
    });
  });
});

describe("updateBrand", () => {
  it("sends the name body to the rename route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await updateBrand("brand-1", "Acme Renamed", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/brands/brand-1");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme Renamed" });
  });
});

describe("deleteBrand", () => {
  it("posts to the delete route with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await deleteBrand("brand-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/brands/brand-1/delete");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});
