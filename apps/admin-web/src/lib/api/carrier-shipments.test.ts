import { beforeEach, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getAdminApi: vi.fn(),
  mutateAdminApi: vi.fn(),
  postAdminApiForBytes: vi.fn(),
}));
vi.mock("./client", () => client);
import {
  cancelCarrierShipment,
  fetchAwbPdf,
  fetchOrderCarrierShipment,
  shipOrdersWithCarrier,
  shipOrderWithCarrier,
} from "./carrier-shipments";

beforeEach(() => {
  expect.hasAssertions();
  vi.clearAllMocks();
});

it("reads the order's carrier shipment", async () => {
  client.getAdminApi.mockResolvedValue({ outcome: "error", message: "x" });
  await fetchOrderCarrierShipment("order 1");
  expect(client.getAdminApi).toHaveBeenCalledWith(
    "/api/v1/orders/order%201/carrier-shipment",
    expect.any(Function),
  );
});

it("ships one order with 30 seconds and the idempotency key", async () => {
  client.mutateAdminApi.mockResolvedValue({ outcome: "error", message: "x" });
  await shipOrderWithCarrier("o1", "bosta", "k1");
  expect(client.mutateAdminApi).toHaveBeenCalledWith(
    "/api/v1/orders/o1/carrier-shipments",
    expect.objectContaining({
      method: "POST",
      body: { carrierKey: "bosta" },
      idempotencyKey: "k1",
      timeoutMs: 30_000,
    }),
    expect.any(Function),
  );
});

it("ships many orders with 75 seconds", async () => {
  client.mutateAdminApi.mockResolvedValue({ outcome: "error", message: "x" });
  await shipOrdersWithCarrier(["a", "b"], "bosta", "k2");
  expect(client.mutateAdminApi).toHaveBeenCalledWith(
    "/api/v1/orders/carrier-shipments",
    expect.objectContaining({
      body: { orderIds: ["a", "b"], carrierKey: "bosta" },
      idempotencyKey: "k2",
      timeoutMs: 75_000,
    }),
    expect.any(Function),
  );
});

it("cancels a shipment with 30 seconds", async () => {
  client.mutateAdminApi.mockResolvedValue({ outcome: "error", message: "x" });
  await cancelCarrierShipment("s1", "k3");
  expect(client.mutateAdminApi).toHaveBeenCalledWith(
    "/api/v1/shipments/s1/cancel",
    expect.objectContaining({ method: "POST", idempotencyKey: "k3", timeoutMs: 30_000 }),
    expect.any(Function),
  );
});

it("fetches the waybill PDF as bytes with 30 seconds", async () => {
  client.postAdminApiForBytes.mockResolvedValue({ outcome: "not_found" });
  await fetchAwbPdf({ orderIds: ["a"], format: "A6", lang: "ar" });
  expect(client.postAdminApiForBytes).toHaveBeenCalledWith(
    "/api/v1/shipments/awb",
    { orderIds: ["a"], format: "A6", lang: "ar" },
    30_000,
  );
});

it("omits unset print options", async () => {
  client.postAdminApiForBytes.mockResolvedValue({ outcome: "not_found" });
  await fetchAwbPdf({ orderIds: ["a"] });
  expect(client.postAdminApiForBytes).toHaveBeenCalledWith(
    "/api/v1/shipments/awb",
    { orderIds: ["a"] },
    30_000,
  );
});
