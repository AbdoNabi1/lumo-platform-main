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

const { fetchCustomerProfile, fetchIdentityTimeline, fetchJourneyTimeline, fetchJourneyState } =
  await import("./customer-360");

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

describe("fetchCustomerProfile", () => {
  it("returns the ok outcome with a merged profile from a successful response", async () => {
    const body = {
      profile: {
        identifierType: "customer_id",
        identifierValue: "customer-1",
        fields: {},
        version: 3,
        updatedAt: "2026-07-05T00:00:00.000Z",
      },
      mergedFrom: [{ type: "customer_id", value: "customer-1" }],
      completeness: null,
      confidence: { verified: 1, inferred: 0, overall: "verified" },
      freshness: {},
      sources: {},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "ok", data: body });
  });

  it("returns an ok outcome with a null profile — a normal empty state, not an error", async () => {
    const body = {
      profile: null,
      mergedFrom: [],
      completeness: null,
      confidence: null,
      freshness: null,
      sources: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "ok", data: body });
  });

  it("maps a 401 to the unauthorized outcome, never demo data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" })),
    );

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 404 to the not_found outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" })));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 500 to the error outcome with a message, never demo data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" })));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result.outcome).toBe("error");
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })));

    const result = await fetchCustomerProfile("customer_id", "customer-1");
    expect(result.outcome).toBe("error");
  });

  it("builds the identifier-type/value path and sends the tenant header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        profile: null,
        mergedFrom: [],
        completeness: null,
        confidence: null,
        freshness: null,
        sources: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-x");
    vi.stubEnv("ADMIN_API_TOKEN", "");

    await fetchCustomerProfile("visitor_id", "visitor-42");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/customer-360/profile/visitor_id/visitor-42");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-x");
  });
});

describe("fetchIdentityTimeline", () => {
  it("returns the ok outcome with the timeline entries from a successful response", async () => {
    const body = {
      entries: [
        {
          kind: "observed",
          occurredAt: "2026-07-01T00:00:00.000Z",
          counterpartType: "email_hash",
          counterpartValue: "hash-1",
          confidence: "deterministic",
          source: "checkout",
        },
        {
          kind: "merged",
          occurredAt: "2026-07-02T00:00:00.000Z",
          decisionId: "decision-1",
          counterpartType: "visitor_id",
          counterpartValue: "visitor-1",
          reason: "matched loyalty account",
          actor: "staff-1",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchIdentityTimeline("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "ok", data: body });
  });

  it("returns an ok outcome with an empty list when there is no history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { entries: [] })));

    const result = await fetchIdentityTimeline("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "ok", data: { entries: [] } });
  });

  it("maps a 403 to the unauthorized outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" })));

    const result = await fetchIdentityTimeline("customer_id", "customer-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("rejects an entry with an unrecognized kind as an unexpected response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          entries: [{ kind: "unknown", occurredAt: "2026-07-01T00:00:00.000Z" }],
        }),
      ),
    );

    const result = await fetchIdentityTimeline("customer_id", "customer-1");
    expect(result.outcome).toBe("error");
  });
});

describe("fetchJourneyTimeline", () => {
  it("returns the ok outcome with session and transition entries", async () => {
    const body = {
      entries: [
        { kind: "session_started", occurredAt: "2026-07-01T00:00:00.000Z", sessionId: "s1" },
        {
          kind: "transition",
          occurredAt: "2026-07-01T00:05:00.000Z",
          transitionId: "t1",
          transitionKind: "anonymous_to_identified",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));

    const result = await fetchJourneyTimeline("visitor-1");
    expect(result).toEqual({ outcome: "ok", data: body });
  });

  it("builds the visitorId path, never customerId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { entries: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchJourneyTimeline("visitor-1");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/customer-360/journeys/visitor-1/timeline");
  });
});

describe("fetchJourneyState", () => {
  it("returns the ok outcome with the unwrapped journey state", async () => {
    const state = {
      visitorId: "visitor-1",
      sessionCount: 2,
      currentSessionId: "s2",
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastActivityAt: "2026-07-02T00:00:00.000Z",
      identified: true,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { state })));

    const result = await fetchJourneyState("visitor-1");
    expect(result).toEqual({ outcome: "ok", data: state });
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await fetchJourneyState("visitor-1");
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });
});
