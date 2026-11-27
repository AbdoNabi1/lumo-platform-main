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

const { fetchMediaDownloadUrl, fetchLibraryImages } = await import("./media");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // No session cookie by default — matches `orders.test.ts`'s "no session yet" baseline.
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchMediaDownloadUrl", () => {
  it("returns the ok outcome with the url from a successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { url: "https://storage.test/asset-1?sig=abc" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result).toEqual({ outcome: "ok", url: "https://storage.test/asset-1?sig=abc" });
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 403 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 404 to the not_found outcome when the asset id doesn't exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("missing-asset");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 500 to the error outcome with a message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result.outcome).toBe("error");
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaDownloadUrl("asset-1");
    expect(result.outcome).toBe("error");
  });

  it("sends the tenant header and calls the per-asset download-url route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { url: "https://storage.test/asset-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-x");
    vi.stubEnv("ADMIN_API_TOKEN", "");

    await fetchMediaDownloadUrl("asset-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/media/assets/asset-1/download-url");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-x");
    expect(headers["authorization"]).toBeUndefined();
  });

  it("URL-encodes the media asset id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { url: "https://storage.test/asset" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchMediaDownloadUrl("asset with spaces");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/media/assets/asset%20with%20spaces/download-url");
  });

  it("forwards the logged-in staff member's session token as a bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { url: "https://storage.test/asset-1" }));
    vi.stubGlobal("fetch", fetchMock);
    cookiesMock.mockResolvedValue({ get: () => ({ value: "staff-session-jwt" }) });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "identity-1", kind: "staff", roles: [] } });

    await fetchMediaDownloadUrl("asset-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer staff-session-jwt");
  });
});

const {
  uploadProductImage,
  updateMediaAlt,
  fetchMediaFilesPage,
  archiveMediaFile,
  isMediaFilesPage,
} = await import("./media");

describe("uploadProductImage (Plan 2C-3)", () => {
  const image = { id: "m-1", url: "https://cdn.test/a.webp", alt: null, width: 3, height: 2 };
  const bytes = new Uint8Array([1, 2, 3]);

  it("posts the raw bytes with the content type, the file name and an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, image));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-x");
    vi.stubEnv("ADMIN_API_TOKEN", "staff-token");

    const result = await uploadProductImage({
      bytes,
      contentType: "image/webp",
      fileName: "صورة حذاء.webp",
      idempotencyKey: "key-1",
    });

    expect(result).toEqual({ outcome: "ok", image });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/media/uploads");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bytes);
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("image/webp");
    expect(headers["idempotency-key"]).toBe("key-1");
    expect(headers["x-tenant-id"]).toBe("tenant-x");
    expect(headers["authorization"]).toBe("Bearer staff-token");
    expect(decodeURIComponent(headers["x-file-name"]!)).toBe("صورة حذاء.webp");
  });

  it.each([
    [503, { outcome: "unavailable" }],
    [413, { outcome: "too_large" }],
    [415, { outcome: "unsupported" }],
    [401, { outcome: "unauthorized" }],
    [403, { outcome: "unauthorized" }],
  ])("maps a %i to %j", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { code: "X" })));
    expect(
      await uploadProductImage({
        bytes,
        contentType: "image/png",
        fileName: "a.png",
        idempotencyKey: "k",
      }),
    ).toEqual(expected);
  });

  it("maps a network failure and an odd success body to the error outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const failed = await uploadProductImage({
      bytes,
      contentType: "image/png",
      fileName: "a.png",
      idempotencyKey: "k",
    });
    expect(failed).toEqual({ outcome: "error", message: "ECONNRESET" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(201, { nope: true })));
    const odd = await uploadProductImage({
      bytes,
      contentType: "image/png",
      fileName: "a.png",
      idempotencyKey: "k",
    });
    expect(odd.outcome).toBe("error");
  });
});

describe("updateMediaAlt (Plan 2C-3)", () => {
  it("PATCHes the alt text of one asset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { mediaAssetId: "m-1", alt: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await updateMediaAlt("m-1", "Red shoe", "key-2");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/media/assets/m-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ alt: "Red shoe" });
  });
});

describe("fetchLibraryImages (Part 3, Ruling 19)", () => {
  const item = (id: string, status: string, image: unknown) => ({
    id,
    name: id + ".png",
    storageKey: "tenants/t/" + id,
    folderRef: null,
    status,
    image,
  });
  const pic = { url: "https://cdn.test/a.png", alt: null, width: 10, height: 20 };

  it("asks for 24, keeps active items with an image and never returns the storage key", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [
          item("a", "active", pic),
          item("b", "archived", pic),
          item("c", "active", null),
          { id: "d", name: "d" },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cur-1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    const result = await fetchLibraryImages(null);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://runtime.test/api/v1/media/assets?first=24");
    expect(result).toEqual({
      outcome: "ok",
      data: {
        items: [{ id: "a", name: "a.png", image: { id: "a", ...pic } }],
        endCursor: "cur-1",
        hasNextPage: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain("storageKey");
  });

  it("passes the cursor along, encoded", async () => {
    expect.hasAssertions();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    const result = await fetchLibraryImages("a b/c");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://runtime.test/api/v1/media/assets?first=24&after=a+b%2Fc",
    );
    expect(result).toEqual({
      outcome: "ok",
      data: { items: [], endCursor: null, hasNextPage: false },
    });
  });

  it("fails the guard on a body without a page", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items: "x" })));
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    expect((await fetchLibraryImages(null)).outcome).toBe("error");
  });
});

describe("fetchMediaFilesPage (Wave 1b Task 2)", () => {
  const row = {
    id: "m-1",
    name: "Beach.png",
    storageKey: "tenants/t/m-1",
    folderRef: null,
    status: "active",
    contentType: "image/png",
    byteSize: 2048,
    createdAt: "2026-10-14T00:00:00.000Z",
    image: { url: "https://cdn.test/m-1.png", alt: "A beach", width: 10, height: 20 },
  };
  const page = (items: unknown[]) => ({
    items,
    pageInfo: { hasNextPage: true, endCursor: "cur-1" },
  });

  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  it("always sends status=active and defaults first to 50", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(page([]));
    await fetchMediaFilesPage({});
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://runtime.test/api/v1/media/assets?status=active&first=50",
    );
  });

  it("sends first, after, search and sort, encoded", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(page([]));
    await fetchMediaFilesPage({ first: 20, after: "a b/c", search: "sea & sand", sort: "newest" });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v1/media/assets");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("first")).toBe("20");
    expect(url.searchParams.get("after")).toBe("a b/c");
    expect(url.searchParams.get("search")).toBe("sea & sand");
    expect(url.searchParams.get("sort")).toBe("newest");
    expect(url.search).toContain("search=sea+%26+sand");
  });

  it("omits blank after and search", async () => {
    expect.hasAssertions();
    const fetchMock = stubFetch(page([]));
    await fetchMediaFilesPage({ after: "", search: "", sort: "oldest" });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://runtime.test/api/v1/media/assets?status=active&first=50&sort=oldest",
    );
  });

  it("returns the page without the storage key or folder reference", async () => {
    expect.hasAssertions();
    stubFetch(page([row]));
    const result = await fetchMediaFilesPage({});
    expect(result).toEqual({
      outcome: "ok",
      data: {
        items: [
          {
            id: "m-1",
            name: "Beach.png",
            status: "active",
            contentType: "image/png",
            byteSize: 2048,
            createdAt: "2026-10-14T00:00:00.000Z",
            image: { url: "https://cdn.test/m-1.png", alt: "A beach", width: 10, height: 20 },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cur-1" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("storageKey");
    expect(JSON.stringify(result)).not.toContain("folderRef");
  });

  it("maps a malformed row to the error outcome", async () => {
    expect.hasAssertions();
    stubFetch(page([{ ...row, byteSize: "big" }]));
    expect((await fetchMediaFilesPage({})).outcome).toBe("error");
  });

  it("maps 403 to unauthorized", async () => {
    expect.hasAssertions();
    stubFetch({ code: "FORBIDDEN" }, 403);
    expect(await fetchMediaFilesPage({})).toEqual({ outcome: "unauthorized" });
  });
});

describe("isMediaFilesPage", () => {
  const ok = {
    id: "m",
    name: "n",
    status: "active",
    contentType: null,
    byteSize: null,
    createdAt: null,
    image: null,
  };
  const info = { hasNextPage: false, endCursor: null };

  it("accepts nullable fields and a null image", () => {
    expect.hasAssertions();
    expect(isMediaFilesPage({ items: [ok], pageInfo: info })).toBe(true);
    expect(
      isMediaFilesPage({
        items: [{ ...ok, image: { url: "u", alt: null, width: null, height: null } }],
        pageInfo: info,
      }),
    ).toBe(true);
  });

  it("rejects a wrong type in every field", () => {
    expect.hasAssertions();
    const bad: Record<string, unknown>[] = [
      { id: 1 },
      { name: null },
      { status: 2 },
      { contentType: 3 },
      { byteSize: "1" },
      { createdAt: 5 },
      { image: {} },
      { image: { url: "u", alt: 1, width: null, height: null } },
      { image: { url: "u", alt: null, width: "1", height: null } },
      { image: { url: "u", alt: null, width: null, height: "1" } },
      { image: undefined },
    ];
    for (const patch of bad) {
      expect(
        isMediaFilesPage({ items: [{ ...ok, ...patch }], pageInfo: info }),
        JSON.stringify(patch),
      ).toBe(false);
    }
    expect(
      isMediaFilesPage({ items: [ok], pageInfo: { hasNextPage: "no", endCursor: null } }),
    ).toBe(false);
    expect(isMediaFilesPage({ items: [ok], pageInfo: { hasNextPage: true, endCursor: 1 } })).toBe(
      false,
    );
    expect(isMediaFilesPage({ items: [ok] })).toBe(false);
    expect(isMediaFilesPage({ items: "x", pageInfo: info })).toBe(false);
    expect(isMediaFilesPage(null)).toBe(false);
  });
});

describe("archiveMediaFile (Wave 1b Task 2)", () => {
  it("POSTs the archive route with the idempotency key and no body, encoding the id", async () => {
    expect.hasAssertions();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { mediaAssetId: "m 1/x" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    const result = await archiveMediaFile("m 1/x", "key-9");
    expect(result).toEqual({ outcome: "ok", data: { mediaAssetId: "m 1/x" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/media/assets/m%201%2Fx/archive");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-9");
  });

  it("keeps the conflict code, so the action can tell BUSINESS_RULE from contention", async () => {
    expect.hasAssertions();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(409, { code: "BUSINESS_RULE", message: "Already archived" }),
        ),
    );
    const result = await archiveMediaFile("m-1", "k");
    expect(result).toMatchObject({ outcome: "conflict", code: "BUSINESS_RULE" });
  });

  it("maps 404 to not_found and 403 to forbidden", async () => {
    expect.hasAssertions();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" })));
    expect((await archiveMediaFile("m-1", "k")).outcome).toBe("not_found");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" })));
    expect((await archiveMediaFile("m-1", "k")).outcome).toBe("forbidden");
  });
});
