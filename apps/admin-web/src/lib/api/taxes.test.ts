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

const { deleteTaxRegion, fetchTaxSettings, updateTaxFlags, upsertTaxRegion } =
  await import("./taxes");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settings = {
  pricesIncludeTax: true,
  chargeTaxOnShipping: false,
  regions: [
    {
      countryCode: "EG",
      rateBasisPoints: 1400,
      provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
    },
  ],
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function stub(status = 200, body: unknown = settings): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

describe("taxes API (Plan 3C)", () => {
  it("reads GET /taxes", async () => {
    const fetchMock = stub();

    expect(await fetchTaxSettings()).toEqual({ outcome: "ok", settings });
    expect(requestOf(fetchMock)[0]).toBe("http://runtime.test/api/v1/taxes");
  });

  it("refuses a response that is not tax settings", async () => {
    stub(200, { pricesIncludeTax: "yes" });
    expect((await fetchTaxSettings()).outcome).toBe("error");
  });

  it("PUTs the two switches", async () => {
    const fetchMock = stub();

    await updateTaxFlags({ pricesIncludeTax: false, chargeTaxOnShipping: true }, "k1");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/taxes/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      pricesIncludeTax: false,
      chargeTaxOnShipping: true,
    });
  });

  it("PUTs a region under its country, rates as basis points", async () => {
    const fetchMock = stub();
    const region = { rateBasisPoints: 1400, provinces: [{ code: "EG-C", rateBasisPoints: 1000 }] };

    await upsertTaxRegion("EG", region, "k2");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/taxes/regions/EG");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(region);
  });

  it("DELETEs a region", async () => {
    const fetchMock = stub();

    await deleteTaxRegion("EG", "k3");

    expect(requestOf(fetchMock)[0]).toBe("http://runtime.test/api/v1/taxes/regions/EG");
    expect(requestOf(fetchMock)[1].method).toBe("DELETE");
    expect((requestOf(fetchMock)[1].headers as Record<string, string>)["idempotency-key"]).toBe(
      "k3",
    );
  });
});
