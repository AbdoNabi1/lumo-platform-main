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
  addShippingRate,
  createShippingZone,
  deleteShippingRate,
  deleteShippingZone,
  fetchShippingZones,
  updateShippingRate,
  updateShippingZone,
} = await import("./shipping-zones");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function stub(status = 200, body: unknown = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

const zone = {
  id: "z-1",
  name: "Cairo",
  profile: "general",
  countries: [{ code: "EG", provinces: ["EG-C"] }],
  rates: [],
};

describe("shipping zones API (Plan 3C)", () => {
  it("reads the zones from GET /shipping/zones", async () => {
    const fetchMock = stub(200, { items: [zone] });

    const result = await fetchShippingZones();

    expect(result).toEqual({ outcome: "ok", zones: [zone] });
    expect(requestOf(fetchMock)[0]).toBe("http://runtime.test/api/v1/shipping/zones");
  });

  it("refuses a response that is not a list of zones", async () => {
    stub(200, { items: [{ nope: true }] });
    expect((await fetchShippingZones()).outcome).toBe("error");
  });

  it("creates and updates a zone with the countries as given", async () => {
    const body = { name: "Cairo", countries: [{ code: "EG", provinces: ["EG-C"] }] };

    const create = stub();
    await createShippingZone(body, "k1");
    expect(requestOf(create)[0]).toBe("http://runtime.test/api/v1/shipping/zones");
    expect(requestOf(create)[1].method).toBe("POST");
    expect(JSON.parse(requestOf(create)[1].body as string)).toEqual(body);

    const update = stub();
    await updateShippingZone("z/1", body, "k2");
    expect(requestOf(update)[0]).toBe("http://runtime.test/api/v1/shipping/zones/z%2F1");
    expect(requestOf(update)[1].method).toBe("PUT");
  });

  it("deletes a zone", async () => {
    const fetchMock = stub();
    await deleteShippingZone("z-1", "k");
    expect(requestOf(fetchMock)[0]).toBe("http://runtime.test/api/v1/shipping/zones/z-1");
    expect(requestOf(fetchMock)[1].method).toBe("DELETE");
  });

  it("adds, updates and deletes a rate under its zone", async () => {
    const rate = {
      name: "Free over 1000",
      priceMinor: 0,
      condition: { type: "orderPrice", minMinor: 100_000 },
      description: null,
    } as const;

    const add = stub();
    await addShippingRate("z-1", rate, "k1");
    expect(requestOf(add)[0]).toBe("http://runtime.test/api/v1/shipping/zones/z-1/rates");
    expect(requestOf(add)[1].method).toBe("POST");
    expect(JSON.parse(requestOf(add)[1].body as string)).toEqual(rate);

    const update = stub();
    await updateShippingRate("z-1", "r-1", rate, "k2");
    expect(requestOf(update)[0]).toBe("http://runtime.test/api/v1/shipping/zones/z-1/rates/r-1");
    expect(requestOf(update)[1].method).toBe("PUT");

    const remove = stub();
    await deleteShippingRate("z-1", "r-1", "k3");
    expect(requestOf(remove)[0]).toBe("http://runtime.test/api/v1/shipping/zones/z-1/rates/r-1");
    expect(requestOf(remove)[1].method).toBe("DELETE");
    expect((requestOf(remove)[1].headers as Record<string, string>)["idempotency-key"]).toBe("k3");
  });
});
