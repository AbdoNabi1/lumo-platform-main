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
  receiveStock,
  adjustStock,
  reserveStock,
  releaseReservation,
  commitReservation,
  transferStock,
  registerWarehouse,
  deactivateWarehouse,
} = await import("./inventory");

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

/**
 * T5.5's 8 Inventory/Warehouse write functions. None of their handlers map the response through a
 * DTO (see `inventory.ts`'s own doc comment above `isUnknown`), so every one of these asserts the
 * request shape only (path, method, body, idempotency header) plus the ok mapping — same discipline
 * `fulfillment.test.ts`'s T5.4 write-function tests use.
 */
describe("T5.5 inventory/warehouse write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("receiveStock posts productId/warehouseId/quantity to /inventory/receive", async () => {
    const fetchMock = stubOk();
    const input = { productId: "product-1", warehouseId: "warehouse-1", quantity: 10 };
    const result = await receiveStock(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/receive");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("adjustStock posts productId/warehouseId/onHand to /inventory/adjust", async () => {
    const fetchMock = stubOk();
    const input = { productId: "product-1", warehouseId: "warehouse-1", onHand: 0 };
    await adjustStock(input, "key-2");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/adjust");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("reserveStock posts to /inventory/reserve and still sends the idempotency header even though the route itself is not idempotent", async () => {
    const fetchMock = stubOk();
    const input = {
      productId: "product-1",
      warehouseId: "warehouse-1",
      quantity: 3,
      reference: "order-1",
    };
    await reserveStock(input, "key-3");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/reserve");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("releaseReservation posts productId/warehouseId/reservationId to /inventory/release", async () => {
    const fetchMock = stubOk();
    const input = { productId: "product-1", warehouseId: "warehouse-1", reservationId: "res-1" };
    await releaseReservation(input, "key-4");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/release");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("commitReservation posts productId/warehouseId/reservationId to /inventory/commit", async () => {
    const fetchMock = stubOk();
    const input = { productId: "product-1", warehouseId: "warehouse-1", reservationId: "res-1" };
    await commitReservation(input, "key-5");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/commit");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("transferStock posts productId/sourceWarehouseId/destinationWarehouseId/quantity to /inventory/transfer", async () => {
    const fetchMock = stubOk();
    const input = {
      productId: "product-1",
      sourceWarehouseId: "warehouse-1",
      destinationWarehouseId: "warehouse-2",
      quantity: 5,
    };
    await transferStock(input, "key-6");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/inventory/transfer");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("registerWarehouse posts code/name to /warehouses", async () => {
    const fetchMock = stubOk();
    const input = { code: "WH-1", name: "Main warehouse" };
    await registerWarehouse(input, "key-7");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/warehouses");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("deactivateWarehouse posts to /warehouses/:warehouseId/deactivate with no body", async () => {
    const fetchMock = stubOk();
    await deactivateWarehouse("warehouse-1", "key-8");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/warehouses/warehouse-1/deactivate");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-8");
  });

  it("maps a 403 to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adjustStock(
      { productId: "product-1", warehouseId: "warehouse-1", onHand: 0 },
      "key-9",
    );
    expect(result).toEqual({ outcome: "forbidden" });
  });
});
