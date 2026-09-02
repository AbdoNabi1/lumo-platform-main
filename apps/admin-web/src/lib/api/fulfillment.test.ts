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
  fetchFulfillmentByOrder,
  createFulfillment,
  advanceFulfillment,
  reserveFulfillment,
  shipFulfillment,
  recordFulfillmentWebhook,
} = await import("./fulfillment");

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

const fulfillmentDetail = {
  id: "fulfillment-1",
  orderRef: "order-1",
  status: "created",
  items: [{ productRef: "product-1", quantity: 2 }],
  carrier: null,
  carrierShipmentId: null,
  trackingNumber: null,
  deliveredAt: null,
  packages: [],
};

describe("fetchFulfillmentByOrder", () => {
  it("returns the ok outcome with the fulfillment for a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, fulfillmentDetail));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFulfillmentByOrder("order-1");
    expect(result).toEqual({ outcome: "ok", fulfillment: fulfillmentDetail });
  });

  it("maps a 404 to not_found (no fulfillment opened for this order)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFulfillmentByOrder("order-1");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 401 to unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFulfillmentByOrder("order-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

/**
 * T5.4's 5 fulfillment write functions. None of their handlers map the response through a DTO
 * (see `fulfillment.ts`'s own doc comment above `isUnknown`), so every one of these asserts the
 * request shape only (path, method, body, idempotency header) plus the ok mapping — same
 * discipline `returns.test.ts`'s T5.3 write-function tests use.
 */
describe("T5.4 fulfillment write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("createFulfillment posts to /fulfillments with orderRef and items", async () => {
    const fetchMock = stubOk();
    const input = { orderRef: "order-1", items: [{ productRef: "product-1", quantity: 2 }] };
    const result = await createFulfillment(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/fulfillments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("advanceFulfillment posts toStatus to /fulfillments/:id/transitions", async () => {
    const fetchMock = stubOk();
    await advanceFulfillment("fulfillment-1", "cancelled", "key-2");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/fulfillments/fulfillment-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "cancelled" });
  });

  it("reserveFulfillment posts to /fulfillments/:id/reserve with no body but the idempotency header even though the route itself is not idempotent", async () => {
    const fetchMock = stubOk();
    await reserveFulfillment("fulfillment-1", "key-3");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/fulfillments/fulfillment-1/reserve");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("shipFulfillment posts to /fulfillments/:id/shipments with no body", async () => {
    const fetchMock = stubOk();
    await shipFulfillment("fulfillment-1", "key-4");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/fulfillments/fulfillment-1/shipments");
    expect(init.body).toBeUndefined();
  });

  it("recordFulfillmentWebhook posts carrier/eventId/kind to /fulfillments/:id/webhook", async () => {
    const fetchMock = stubOk();
    await recordFulfillmentWebhook(
      "fulfillment-1",
      { carrier: "dhl", eventId: "evt-1", kind: "confirmed" },
      "key-5",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/fulfillments/fulfillment-1/webhook");
    expect(JSON.parse(init.body as string)).toEqual({
      carrier: "dhl",
      eventId: "evt-1",
      kind: "confirmed",
    });
  });

  it("maps a 403 to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await advanceFulfillment("fulfillment-1", "cancelled", "key-6");
    expect(result).toEqual({ outcome: "forbidden" });
  });
});
