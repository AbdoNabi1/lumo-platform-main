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

const { addMyDomain, fetchMyDomains, makeMyDomainPrimary, verifyMyDomain } =
  await import("./store-domains");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const platform = {
  id: "d1",
  shopId: "shop-1",
  hostname: "acme.morbeh.test",
  kind: "platform",
  status: "verified",
  isPrimary: true,
  verifiedAt: "2026-10-01T00:00:00.000Z",
} as const;
const custom = {
  id: "d2",
  shopId: "shop-1",
  hostname: "shop.acme.com",
  kind: "custom",
  status: "pending",
  isPrimary: false,
  verifiedAt: null,
} as const;

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("store domains API", () => {
  it("reads GET /store/domains and unwraps { items }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [platform, custom] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMyDomains();

    expect(result).toEqual({ outcome: "ok", domains: [platform, custom] });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/store/domains",
    );
  });

  it("refuses a bare array or a malformed domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [platform])));
    expect((await fetchMyDomains()).outcome).toBe("error");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { items: [{ ...platform, kind: "x" }] })),
    );
    expect((await fetchMyDomains()).outcome).toBe("error");
  });

  it("passes a failed read through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    expect(await fetchMyDomains()).toEqual({ outcome: "unauthorized" });
  });

  it("POSTs a hostname with the idempotency key and answers { id }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "d2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await addMyDomain("shop.acme.com", "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "d2" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/domains");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ hostname: "shop.acme.com" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("POSTs verify and answers the domain", async () => {
    const verified = { ...custom, status: "verified", verifiedAt: "2026-10-17T00:00:00.000Z" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, verified));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyMyDomain("d2", "key-2");

    expect(result).toEqual({ outcome: "ok", data: verified });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/domains/d2/verify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-2");
  });

  it("POSTs make-primary and answers the domain", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...custom, isPrimary: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeMyDomainPrimary("d2", "key-3");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/domains/d2/primary");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("encodes the domain id in the path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);
    expect((await verifyMyDomain("a/b", "k")).outcome).toBe("not_found");
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/store/domains/a%2Fb/verify",
    );
  });
});
