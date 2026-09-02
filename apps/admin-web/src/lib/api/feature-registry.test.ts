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
  fetchFeatures,
  resolveFeature,
  fetchCapabilityGraph,
  fetchRegistryValidation,
  fetchFeatureBundles,
  deriveCapabilityEdges,
} = await import("./feature-registry");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFeature(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    key: "checkout.express",
    name: "Express checkout",
    lifecycle: "active",
    category: "checkout",
    visibility: "public",
    publishedVersion: 3,
    versionCount: 3,
    hasDraft: false,
    replacementKey: null,
    requiredPlans: ["pro"],
    requiredPermissions: [],
    requiredCapabilities: [],
    dependencies: [{ featureKey: "checkout.core", minVersion: 1 }],
    groups: ["checkout"],
    compatibility: {
      compatibleWith: [],
      requires: ["payments.core"],
      conflictsWith: [],
      replaces: [],
      deprecatedBy: "",
      migrationTarget: "",
    },
    ai: {},
    lifecyclePolicy: "general_availability",
    constraints: {},
    cost: {},
    documentation: {},
    analytics: {},
    ...overrides,
  };
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchFeatures", () => {
  it("returns the ok outcome with the catalog on a successful response", async () => {
    const feature = makeFeature();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { features: [feature] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatures();
    expect(result).toEqual({ outcome: "ok", features: [feature] });
  });

  it("appends lifecycle and category to the querystring when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { features: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchFeatures({ lifecycle: "active", category: "checkout" });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/feature-registry/features?lifecycle=active&category=checkout",
    );
  });

  it("omits filters from the querystring when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { features: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchFeatures();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-registry/features?");
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatures();
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatures();
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatures();
    expect(result.outcome).toBe("error");
  });

  it("rejects a feature missing a required field", async () => {
    const badFeature = makeFeature();
    delete (badFeature as Record<string, unknown>)["lifecycle"];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { features: [badFeature] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatures();
    expect(result.outcome).toBe("error");
  });
});

describe("resolveFeature", () => {
  it("URL-encodes the key and returns the resolved feature", async () => {
    const resolved = { ...makeFeature(), available: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, resolved));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await resolveFeature("checkout/express beta");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/feature-registry/features/checkout%2Fexpress%20beta/resolve",
    );
    expect(result).toEqual({ outcome: "ok", data: resolved });
  });

  it("maps a 404 to the not_found outcome, distinct from a generic error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFeature("unknown.feature");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFeature("checkout.express");
    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchCapabilityGraph", () => {
  it("requests without a key querystring when none is given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { nodes: [], cycles: [], acyclic: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchCapabilityGraph();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-registry/capability-graph?");
    expect(result).toEqual({
      outcome: "ok",
      data: { nodes: [], cycles: [], acyclic: true },
    });
  });

  it("sends the key querystring and returns the focus subset when given", async () => {
    const graph = {
      nodes: ["a", "b"],
      cycles: [],
      acyclic: true,
      focus: { key: "a", dependencies: ["b"], transitiveDependencies: ["b"], dependents: [], impact: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, graph));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchCapabilityGraph("a");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/feature-registry/capability-graph?key=a");
  });

  it("returns cycles as an array of key chains", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { nodes: ["a", "b"], cycles: [["a", "b", "a"]], acyclic: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCapabilityGraph();
    expect(result).toEqual({
      outcome: "ok",
      data: { nodes: ["a", "b"], cycles: [["a", "b", "a"]], acyclic: false },
    });
  });
});

describe("fetchRegistryValidation", () => {
  it("returns the ok outcome with a passing report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { valid: true, issues: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegistryValidation();
    expect(result).toEqual({ outcome: "ok", data: { valid: true, issues: [] } });
  });

  it("returns the ok outcome with a failing report and its issues", async () => {
    const report = {
      valid: false,
      issues: [
        { code: "MISSING_DEPENDENCY", severity: "error", key: "checkout.express", message: "depends on an unknown feature" },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, report));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegistryValidation();
    expect(result).toEqual({ outcome: "ok", data: report });
  });

  it("maps a 500 to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegistryValidation();
    expect(result.outcome).toBe("error");
  });
});

describe("fetchFeatureBundles", () => {
  it("returns the ok outcome with an empty bundle list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { bundles: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatureBundles();
    expect(result).toEqual({ outcome: "ok", bundles: [] });
  });

  it("returns the ok outcome with bundles from a successful response", async () => {
    const bundle = {
      key: "starter-bundle",
      name: "Starter",
      description: "The starter plan bundle",
      status: "active",
      featureKeys: ["checkout.express"],
      groups: ["checkout"],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { bundles: [bundle] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatureBundles();
    expect(result).toEqual({ outcome: "ok", bundles: [bundle] });
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeatureBundles();
    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("deriveCapabilityEdges", () => {
  it("returns one edge per dependency and one per compatibility.requires entry", () => {
    const features = [
      makeFeature({
        key: "checkout.express",
        dependencies: [{ featureKey: "checkout.core", minVersion: 1 }],
        compatibility: {
          compatibleWith: [],
          requires: ["payments.core"],
          conflictsWith: [],
          replaces: [],
          deprecatedBy: "",
          migrationTarget: "",
        },
      }),
    ] as unknown as Parameters<typeof deriveCapabilityEdges>[0];

    const edges = deriveCapabilityEdges(features);

    expect(edges).toEqual([
      { from: "checkout.express", to: "checkout.core", relationship: "dependency" },
      { from: "checkout.express", to: "payments.core", relationship: "requires" },
    ]);
  });

  it("returns an empty list for a feature with no dependencies or requirements", () => {
    const features = [
      makeFeature({ dependencies: [], compatibility: { ...makeFeature()["compatibility"] as object, requires: [] } }),
    ] as unknown as Parameters<typeof deriveCapabilityEdges>[0];

    expect(deriveCapabilityEdges(features)).toEqual([]);
  });
});
