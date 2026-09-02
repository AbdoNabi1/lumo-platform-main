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
  fetchShipmentByFulfillment,
  createShipment,
  advanceShipment,
  createShipmentLabel,
  voidShipmentLabel,
  updateShipmentTracking,
  retryShipment,
  recordShipmentWebhook,
} = await import("./shipping");

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

const shipmentDetail = {
  id: "shipment-1",
  fulfillmentRef: "fulfillment-1",
  status: "created",
  carrier: null,
  carrierService: null,
  trackingNumber: null,
  shippedAt: null,
  deliveredAt: null,
};

describe("fetchShipmentByFulfillment", () => {
  it("returns the ok outcome with the shipment for a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, shipmentDetail));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchShipmentByFulfillment("fulfillment-1");
    expect(result).toEqual({ outcome: "ok", shipment: shipmentDetail });
  });

  it("maps a 404 to not_found (no shipment opened for this fulfillment order)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchShipmentByFulfillment("fulfillment-1");
    expect(result).toEqual({ outcome: "not_found" });
  });
});

/**
 * T5.4's 7 shipping write functions. None of their handlers map the response through a DTO (see
 * `shipping.ts`'s own doc comment above `isUnknown`), so every one of these asserts the request
 * shape only (path, method, body, idempotency header) plus the ok mapping.
 */
describe("T5.4 shipping write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("createShipment posts to /shipments with fulfillmentRef and packages", async () => {
    const fetchMock = stubOk();
    const input = {
      fulfillmentRef: "fulfillment-1",
      packages: [{ reference: "box-1", itemRefs: ["item-1"], weightGrams: 500 }],
    };
    const result = await createShipment(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("advanceShipment posts toStatus to /shipments/:id/transitions", async () => {
    const fetchMock = stubOk();
    await advanceShipment("shipment-1", "cancelled", "key-2");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "cancelled" });
  });

  it("createShipmentLabel posts to /shipments/:id/label with no body", async () => {
    const fetchMock = stubOk();
    await createShipmentLabel("shipment-1", "key-3");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/label");
    expect(init.body).toBeUndefined();
  });

  it("voidShipmentLabel posts to /shipments/:id/label-void with no body", async () => {
    const fetchMock = stubOk();
    await voidShipmentLabel("shipment-1", "key-4");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/label-void");
    expect(init.body).toBeUndefined();
  });

  it("updateShipmentTracking posts description and an optional location to /shipments/:id/tracking, with the idempotency header even though the route itself is not idempotent", async () => {
    const fetchMock = stubOk();
    await updateShipmentTracking(
      "shipment-1",
      { description: "Left facility", location: "Hub 3" },
      "key-5",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/tracking");
    expect(JSON.parse(init.body as string)).toEqual({
      description: "Left facility",
      location: "Hub 3",
    });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-5");
  });

  it("updateShipmentTracking omits location from the body when not given", async () => {
    const fetchMock = stubOk();
    await updateShipmentTracking("shipment-1", { description: "Left facility" }, "key-5b");
    const [, init] = requestOf(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({ description: "Left facility" });
  });

  it("retryShipment posts to /shipments/:id/retry with no body", async () => {
    const fetchMock = stubOk();
    await retryShipment("shipment-1", "key-6");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/retry");
    expect(init.body).toBeUndefined();
  });

  it("recordShipmentWebhook posts carrier/eventId/kind to /shipments/:id/webhook", async () => {
    const fetchMock = stubOk();
    await recordShipmentWebhook(
      "shipment-1",
      { carrier: "dhl", eventId: "evt-1", kind: "delivered" },
      "key-7",
    );
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/shipments/shipment-1/webhook");
    expect(JSON.parse(init.body as string)).toEqual({
      carrier: "dhl",
      eventId: "evt-1",
      kind: "delivered",
    });
  });

  it("maps a 409 to conflict with the server's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(409, { message: "Already labeled" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createShipmentLabel("shipment-1", "key-8");
    expect(result).toEqual({ outcome: "conflict", message: "Already labeled" });
  });
});
