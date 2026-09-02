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
  fetchExperimentsPage,
  fetchExperiment,
  createExperiment,
  advanceExperiment,
  recordExperimentResult,
  declareExperimentWinner,
} = await import("./experimentation");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EXPERIMENT: unknown = {
  id: "experiment-1",
  name: "Checkout button color",
  hypothesis: "Green converts better than blue",
  variants: [
    { key: "control", allocationPercentage: 50, isControl: true },
    { key: "variant-a", allocationPercentage: 50, isControl: false },
  ],
  audiencePercentage: 100,
  audienceSegmentRefs: null,
  goalMetricRef: "checkout_conversion",
  featureFlagRef: null,
  status: "draft",
  results: [],
  winnerVariantKey: null,
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchExperimentsPage", () => {
  it("returns items and pageInfo on success", async () => {
    const page = { items: [EXPERIMENT], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchExperimentsPage({ first: 20 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/experiments?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchExperimentsPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchExperiment", () => {
  it("returns the experiment on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, EXPERIMENT));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchExperiment("experiment-1");

    expect(result).toEqual({ outcome: "ok", experiment: EXPERIMENT });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/experiments/experiment-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchExperiment("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("createExperiment", () => {
  it("sends idempotencyKey in both the body and the header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "experiment-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      name: "Checkout button color",
      variants: [
        { key: "control", allocationPercentage: 50, isControl: true },
        { key: "variant-a", allocationPercentage: 50, isControl: false },
      ],
      goalMetricRef: "checkout_conversion",
    };
    const result = await createExperiment(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "experiment-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/experiments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "variants", message: "allocations must sum to 100" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createExperiment(
      {
        name: "x",
        variants: [{ key: "control", allocationPercentage: 40, isControl: true }],
        goalMetricRef: "g",
      },
      "key-1",
    );

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "variants", message: "allocations must sum to 100" }],
    });
  });
});

describe("advanceExperiment", () => {
  it("posts only toStatus to the transitions route (no changedBy field on this domain)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await advanceExperiment("experiment-1", "running", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/experiments/experiment-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "running" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});

describe("recordExperimentResult", () => {
  it("posts the result without an idempotency header (not idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { variantKey: "control", metricValue: 0.12, sampleSize: 500 };
    const result = await recordExperimentResult("experiment-1", input);

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/experiments/experiment-1/results");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});

describe("declareExperimentWinner", () => {
  it("posts variantKey to the winner route, with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await declareExperimentWinner("experiment-1", "control", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/experiments/experiment-1/winner");
    expect(JSON.parse(init.body as string)).toEqual({ variantKey: "control" });
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});
