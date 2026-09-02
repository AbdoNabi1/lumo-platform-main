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
  fetchFeatureFlagsPage,
  fetchFeatureFlag,
  createFeatureFlag,
  advanceFeatureFlag,
  setFeatureFlagRollout,
  addFeatureFlagRule,
  setFeatureFlagEnvironmentOverride,
} = await import("./feature-flags");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FLAG: unknown = {
  id: "flag-1",
  key: "new-checkout",
  name: "New checkout",
  description: null,
  status: "active",
  environments: [{ environment: "production", enabled: true, rolloutPercentage: 25 }],
  rules: [],
  rolloutPercentage: 25,
  changes: [{ action: "created", changedBy: "admin-1", details: null, occurredAt: "2026-01-01T00:00:00.000Z" }],
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchFeatureFlagsPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = { items: [FLAG], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchFeatureFlagsPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatureFlagsPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchFeatureFlag", () => {
  it("returns the flag on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, FLAG));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchFeatureFlag("flag-1");

    expect(result).toEqual({ outcome: "ok", flag: FLAG });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags/flag-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatureFlag("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("createFeatureFlag", () => {
  it("sends idempotencyKey in both the body and the header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "flag-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { key: "new-checkout", name: "New checkout" };
    const result = await createFeatureFlag(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "flag-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "key", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createFeatureFlag({ key: "", name: "" }, "key-1");

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "key", message: "must not be empty" }],
    });
  });
});

describe("advanceFeatureFlag", () => {
  it("posts toStatus and changedBy to the transitions route, with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await advanceFeatureFlag("flag-1", "killed", "admin-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags/flag-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "killed", changedBy: "admin-1" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("setFeatureFlagRollout", () => {
  it("posts percentage and changedBy to the rollout route, with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await setFeatureFlagRollout("flag-1", 50, "admin-1", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags/flag-1/rollout");
    expect(JSON.parse(init.body as string)).toEqual({ percentage: 50, changedBy: "admin-1" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("addFeatureFlagRule", () => {
  it("posts the rule without an idempotency header (not idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      type: "tenant" as const,
      values: ["tenant-1"],
      enabled: true,
      changedBy: "admin-1",
    };
    const result = await addFeatureFlagRule("flag-1", input);

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags/flag-1/rules");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});

describe("setFeatureFlagEnvironmentOverride", () => {
  it("posts the override with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      environment: "production",
      enabled: true,
      rolloutPercentage: 10,
      changedBy: "admin-1",
    };
    const result = await setFeatureFlagEnvironmentOverride("flag-1", input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-flags/flag-1/environment-overrides");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});
