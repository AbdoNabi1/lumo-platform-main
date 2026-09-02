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

const { fetchUsageCounters, LICENSING_USAGE_RESOURCES } = await import("./licensing");

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

describe("fetchUsageCounters", () => {
  it("returns the ok outcome with one counter per registered resource", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const resource = new URL(url).searchParams.get("resource");
      return jsonResponse(200, { amount: resource === "AI_TOKEN" ? 42 : 0, unit: "count" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") throw new Error("expected ok");
    expect(result.counters).toHaveLength(LICENSING_USAGE_RESOURCES.length);
    expect(result.counters.find((c) => c.resource === "AI_TOKEN")).toEqual({
      resource: "AI_TOKEN",
      amount: 42,
      unit: "count",
    });
    expect(fetchMock).toHaveBeenCalledTimes(LICENSING_USAGE_RESOURCES.length);
  });

  it("returns amount 0 and an empty unit for a resource with no counter recorded yet", async () => {
    // Every resource is fetched concurrently, so a fresh Response must be created per call —
    // `mockResolvedValue` would hand out the same (already-consumed) body to every caller.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { amount: 0, unit: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") throw new Error("expected ok");
    for (const counter of result.counters) {
      expect(counter).toEqual({ resource: counter.resource, amount: 0, unit: "" });
    }
  });

  it("maps a 401 on any resource to the unauthorized outcome, never demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 403 on any resource to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 500 on any resource to the error outcome, never a partial table", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();
    expect(result.outcome).toBe("error");
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();
    expect(result.outcome).toBe("error");
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageCounters();
    expect(result.outcome).toBe("error");
  });

  it("sends the tenant header and both tenantRef and resource query params", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { amount: 0, unit: "" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-x");
    vi.stubEnv("ADMIN_API_TOKEN", "");

    await fetchUsageCounters();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe("http://runtime.test");
    expect(parsed.pathname).toBe("/api/v1/usage-counters");
    expect(parsed.searchParams.get("tenantRef")).toBe("tenant-x");
    expect(LICENSING_USAGE_RESOURCES).toContain(parsed.searchParams.get("resource"));
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-x");
  });

  it("forwards the logged-in staff member's session token as a bearer token", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(200, { amount: 0, unit: "" }));
    vi.stubGlobal("fetch", fetchMock);
    cookiesMock.mockResolvedValue({ get: () => ({ value: "staff-session-jwt" }) });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "identity-1", kind: "staff", roles: [] } });

    await fetchUsageCounters();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer staff-session-jwt");
  });
});
