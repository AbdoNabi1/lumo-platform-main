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
  fetchSecurityDashboard,
  fetchSecurityAnalytics,
  fetchIdentityOverview,
  resolvePrincipal,
  resolveOrganization,
  resolveMachineIdentity,
  checkConsent,
  fetchPermissionExplorer,
  introspectSession,
  fetchAuditExplorer,
  verifyAuditChain,
  getCredentialLineage,
  fetchAiGovernanceExplorer,
  governAiIdentity,
  suspendAiIdentity,
  checkAiAction,
} = await import("./security");

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

describe("fetchSecurityDashboard", () => {
  it("returns the ok outcome with the dashboard on a successful response", async () => {
    const dashboard = { metrics: { "security.login.succeeded": 4 }, auditRecords: 10, chainValid: true };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, dashboard));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSecurityDashboard();
    expect(result).toEqual({ outcome: "ok", data: dashboard });
  });

  it("appends tenantRef to the querystring when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { metrics: {}, auditRecords: 0, chainValid: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchSecurityDashboard("tenant-42");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/security/console/dashboard?tenantRef=tenant-42");
  });

  it("omits tenantRef from the querystring when not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { metrics: {}, auditRecords: 0, chainValid: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchSecurityDashboard();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/security/console/dashboard?");
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSecurityDashboard();
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSecurityDashboard();
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSecurityDashboard();
    expect(result.outcome).toBe("error");
  });
});

describe("fetchSecurityAnalytics", () => {
  it("requests the analytics endpoint with no querystring", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        loginSuccess: 1,
        loginFailure: 0,
        mfaSuccess: 0,
        mfaFailure: 0,
        accessAllowed: 0,
        accessDenied: 0,
        accessChallenged: 0,
        tokenRefreshed: 0,
        threatsIndicated: 0,
        sessionsRevoked: 0,
        riskDistribution: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchSecurityAnalytics();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/security/console/analytics");
    expect(result.outcome).toBe("ok");
  });
});

describe("fetchIdentityOverview", () => {
  it("returns the ok outcome with an empty principals list", async () => {
    const overview = { total: 0, humans: 0, nonHumans: 0, byStatus: {}, principals: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, overview));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIdentityOverview();
    expect(result).toEqual({ outcome: "ok", data: overview });
  });
});

describe("resolvePrincipal", () => {
  it("URL-encodes the subjectRef path param and returns nullable fields as-is", async () => {
    const resolved = { principal: null, identityUser: null, memberships: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, resolved));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await resolvePrincipal("subject/with slash");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/security/resolve/principals/subject%2Fwith%20slash",
    );
    expect(result).toEqual({ outcome: "ok", data: resolved });
  });
});

describe("resolveOrganization", () => {
  it("maps a 404 to the not_found outcome, distinct from a generic error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveOrganization("org-1");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("returns the ok outcome with the resolved organization", async () => {
    const org = { organizationId: "org-1", slug: "acme", tenant: "tenant-1" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, org));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveOrganization("org-1");
    expect(result).toEqual({ outcome: "ok", data: org });
  });
});

describe("resolveMachineIdentity", () => {
  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveMachineIdentity("machine-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("checkConsent", () => {
  it("sends the purpose as a querystring param alongside the subjectRef path param", async () => {
    const decision = { subjectRef: "subject-1", purpose: "marketing", granted: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, decision));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await checkConsent("subject-1", "marketing");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/security/consent/subject-1?purpose=marketing",
    );
    expect(result).toEqual({ outcome: "ok", data: decision });
  });
});

describe("fetchPermissionExplorer", () => {
  it("returns roles and policies from a successful response", async () => {
    const explorer = { roles: [], policies: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, explorer));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPermissionExplorer();
    expect(result).toEqual({ outcome: "ok", data: explorer });
  });
});

describe("introspectSession", () => {
  it("returns an ok outcome with active:false and a null session for an unknown session", async () => {
    const introspection = { active: false, session: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, introspection));
    vi.stubGlobal("fetch", fetchMock);

    const result = await introspectSession("session-unknown");
    expect(result).toEqual({ outcome: "ok", data: introspection });
  });
});

describe("fetchAuditExplorer / verifyAuditChain", () => {
  it("fetchAuditExplorer appends tenantRef when provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { count: 0, chainValid: true, timeline: [] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchAuditExplorer("tenant-9");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/security/console/audit-explorer?tenantRef=tenant-9");
  });

  it("verifyAuditChain returns the ok outcome with the chain report", async () => {
    const report = { valid: true, count: 12 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, report));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyAuditChain();
    expect(result).toEqual({ outcome: "ok", data: report });
  });
});

describe("getCredentialLineage", () => {
  it("maps a 404 to the not_found outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCredentialLineage("credential-1");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("returns the ok outcome with the credential chain", async () => {
    const lineage = {
      chain: [
        {
          id: "credential-1",
          principalRef: "principal-1",
          kind: "api_key",
          status: "active",
          kmsKeyRef: null,
          supersedesRef: null,
          expiresAt: null,
          rotationDueAt: null,
          autoRotate: false,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, lineage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCredentialLineage("credential-1");
    expect(result).toEqual({ outcome: "ok", data: lineage });
  });
});

describe("fetchAiGovernanceExplorer", () => {
  it("returns the ok outcome with an empty identities list", async () => {
    const explorer = { total: 0, active: 0, suspended: 0, identities: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, explorer));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAiGovernanceExplorer();
    expect(result).toEqual({ outcome: "ok", data: explorer });
  });

  it("maps a 500 to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAiGovernanceExplorer();
    expect(result.outcome).toBe("error");
  });
});

/** T5.12a's 3 write functions — same discipline as `products.test.ts`'s "T5.1 write functions". */
describe("governAiIdentity / suspendAiIdentity / checkAiAction", () => {
  function stubOk(body: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  const profile = {
    principalRef: "principal-1",
    status: "active",
    tokenBudget: null,
    callQuota: null,
    tokensConsumed: 0,
    callsConsumed: 0,
    isolationLevel: "sandboxed",
    allowedTools: [],
    allowedResources: [],
  };

  it("governAiIdentity posts the config body, URL-encoded externalId, and idempotency header", async () => {
    const fetchMock = stubOk(profile);

    const result = await governAiIdentity(
      "external id/1",
      { tokenBudget: 1000, isolationLevel: "isolated" },
      "key-1",
    );

    expect(result).toEqual({ outcome: "ok", data: profile });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/security/ai-identities/external%20id%2F1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      config: { tokenBudget: 1000, isolationLevel: "isolated" },
    });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("governAiIdentity sends an explicit null to clear a budget/quota", async () => {
    const fetchMock = stubOk(profile);

    await governAiIdentity("principal-1", { tokenBudget: null, callQuota: null }, "key-2");

    const [, init] = requestOf(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({
      config: { tokenBudget: null, callQuota: null },
    });
  });

  it("suspendAiIdentity posts to /suspend with no body", async () => {
    const fetchMock = stubOk({ ...profile, status: "suspended" });

    const result = await suspendAiIdentity("principal-1", "key-3");

    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/security/ai-identities/principal-1/suspend");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("checkAiAction posts to the actions/check path with the check body", async () => {
    const decision = { allowed: true, remainingTokens: 500, remainingCalls: null };
    const fetchMock = stubOk(decision);

    const result = await checkAiAction("principal-1", { tool: "search", tokens: 10 }, "key-4");

    expect(result).toEqual({ outcome: "ok", data: decision });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/security/ai-identities/principal-1/actions/check");
    expect(JSON.parse(init.body as string)).toEqual({ tool: "search", tokens: 10 });
  });

  it("checkAiAction maps a denial (allowed: false with a reason) through as ok, not an error", async () => {
    const decision = { allowed: false, reason: "over budget", remainingTokens: 0, remainingCalls: 2 };
    stubOk(decision);

    const result = await checkAiAction("principal-1", {}, "key-5");

    expect(result).toEqual({ outcome: "ok", data: decision });
  });

  it("maps a 403 from any of the three to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await suspendAiIdentity("principal-1", "key-6");
    expect(result).toEqual({ outcome: "forbidden" });
  });
});
