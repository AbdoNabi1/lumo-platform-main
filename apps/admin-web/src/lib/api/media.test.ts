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
