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

const { fetchMediaDownloadUrl } = await import("./media");

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

const { uploadProductImage, updateMediaAlt } = await import("./media");

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
