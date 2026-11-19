import { beforeEach, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";

const api = vi.hoisted(() => ({
  shipOrderWithCarrier: vi.fn(),
  shipOrdersWithCarrier: vi.fn(),
  cancelCarrierShipment: vi.fn(),
}));
const shipping = vi.hoisted(() => ({ retryShipment: vi.fn() }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/carrier-shipments", () => api);
vi.mock("@/lib/api/shipping", () => shipping);
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "ar" }) }),
}));

const {
  bulkShipWithCarrierAction,
  cancelCarrierShipmentAction,
  retryCarrierShipmentAction,
  shipWithCarrierAction,
} = await import("./carrier-actions");

const shipped = {
  orderId: "o1",
  orderNumber: "1001",
  shipmentId: "s1",
  trackingNumber: "TN1",
  carrierKey: "bosta",
};

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
});

it("a malformed order id never calls the API", async () => {
  const result = await shipWithCarrierAction("../x", "bosta");
  expect(result).toEqual({ status: "error", message: ar.formErrors.invalid });
  expect(api.shipOrderWithCarrier).not.toHaveBeenCalled();
});

it("a malformed carrier key never calls the API", async () => {
  const result = await shipWithCarrierAction("o1", "Bad Key");
  expect(result).toEqual({ status: "error", message: ar.formErrors.invalid });
  expect(api.shipOrderWithCarrier).not.toHaveBeenCalled();
});

it("51 ids are refused", async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `o${i}`);
  const result = await bulkShipWithCarrierAction(ids, "bosta");
  expect(result).toEqual({ status: "error", message: ar.formErrors.invalid });
  expect(api.shipOrdersWithCarrier).not.toHaveBeenCalled();
});

it("duplicate and empty id lists are refused", async () => {
  expect(await bulkShipWithCarrierAction(["a", "a"], "bosta")).toEqual({
    status: "error",
    message: ar.formErrors.invalid,
  });
  expect(await bulkShipWithCarrierAction([], "bosta")).toEqual({
    status: "error",
    message: ar.formErrors.invalid,
  });
  expect(api.shipOrdersWithCarrier).not.toHaveBeenCalled();
});

it("ships one order and revalidates both screens", async () => {
  api.shipOrderWithCarrier.mockResolvedValue({ outcome: "ok", data: shipped });
  const result = await shipWithCarrierAction("o1", "bosta");
  expect(result).toEqual({ status: "success", trackingNumber: "TN1" });
  expect(revalidatePath).toHaveBeenCalledWith("/orders");
  expect(revalidatePath).toHaveBeenCalledWith("/orders/o1");
});

it("ORDER_NOT_PAID shows the Egyptian message", async () => {
  api.shipOrderWithCarrier.mockResolvedValue({
    outcome: "conflict",
    code: "ORDER_NOT_PAID",
    message: "x",
  });
  const result = await shipWithCarrierAction("o1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.carrierShipping.errors.ORDER_NOT_PAID });
});

it("a thrown fetch returns the localised fallback", async () => {
  api.shipOrderWithCarrier.mockRejectedValue(new Error("boom"));
  const result = await shipWithCarrierAction("o1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.formErrors.unexpected });
});

it("bulk ship reports counts and localised failures with the order number", async () => {
  api.shipOrdersWithCarrier.mockResolvedValue({
    outcome: "ok",
    data: {
      shipped: [shipped],
      failed: [
        { orderId: "o2", code: "ORDER_NOT_PAID", orderNumber: "1002", attempted: true },
        { orderId: "o3", code: "CARRIER_TIMEOUT", attempted: false },
      ],
    },
  });
  const result = await bulkShipWithCarrierAction(["o1", "o2", "o3"], "bosta");
  expect(result).toEqual({
    status: "success",
    shipped: 1,
    failed: [
      { orderId: "o2", orderNumber: "1002", message: ar.carrierShipping.errors.ORDER_NOT_PAID },
      { orderId: "o3", message: ar.carrierShipping.errors.CARRIER_TIMEOUT },
    ],
  });
});

it("cancel returns a FormState error with fieldErrors", async () => {
  api.cancelCarrierShipment.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_CANCEL_NOT_ALLOWED",
    message: "x",
  });
  const result = await cancelCarrierShipmentAction("o1", "s1");
  expect(result).toEqual({
    status: "error",
    message: ar.carrierShipping.errors.CARRIER_CANCEL_NOT_ALLOWED,
    fieldErrors: {},
  });
});

it("cancel succeeds and revalidates", async () => {
  api.cancelCarrierShipment.mockResolvedValue({ outcome: "ok", data: {} });
  expect(await cancelCarrierShipmentAction("o1", "s1")).toEqual({ status: "success" });
  expect(revalidatePath).toHaveBeenCalledWith("/orders/o1");
});

it("cancel with a malformed shipment id never calls the API", async () => {
  const result = await cancelCarrierShipmentAction("o1", "a/b");
  expect(result).toEqual({ status: "error", message: ar.formErrors.invalid, fieldErrors: {} });
  expect(api.cancelCarrierShipment).not.toHaveBeenCalled();
});

it("retry calls the retry route then ships", async () => {
  const order: string[] = [];
  shipping.retryShipment.mockImplementation(() => {
    order.push("retry");
    return Promise.resolve({ outcome: "ok", data: {} });
  });
  api.shipOrderWithCarrier.mockImplementation(() => {
    order.push("ship");
    return Promise.resolve({ outcome: "ok", data: shipped });
  });
  const result = await retryCarrierShipmentAction("o1", "s1", "bosta");
  expect(order).toEqual(["retry", "ship"]);
  expect(result).toEqual({ status: "success", trackingNumber: "TN1" });
});

it("a failed retry returns its error and ships nothing", async () => {
  shipping.retryShipment.mockResolvedValue({ outcome: "forbidden" });
  const result = await retryCarrierShipmentAction("o1", "s1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.formErrors.forbidden });
  expect(api.shipOrderWithCarrier).not.toHaveBeenCalled();
});

it("CARRIER_RESULT_UNKNOWN on a single ship still revalidates both screens", async () => {
  api.shipOrderWithCarrier.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_RESULT_UNKNOWN",
    message: "x",
  });
  const result = await shipWithCarrierAction("o1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.carrierShipping.needsReview });
  expect(revalidatePath).toHaveBeenCalledWith("/orders");
  expect(revalidatePath).toHaveBeenCalledWith("/orders/o1");
});

it("a successful retry followed by a failed ship revalidates both screens", async () => {
  shipping.retryShipment.mockResolvedValue({ outcome: "ok", data: {} });
  api.shipOrderWithCarrier.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_RESULT_UNKNOWN",
    message: "x",
  });
  const result = await retryCarrierShipmentAction("o1", "s1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.carrierShipping.needsReview });
  expect(revalidatePath).toHaveBeenCalledWith("/orders");
  expect(revalidatePath).toHaveBeenCalledWith("/orders/o1");
});

it("a successful retry followed by a thrown ship revalidates and returns the fallback", async () => {
  shipping.retryShipment.mockResolvedValue({ outcome: "ok", data: {} });
  api.shipOrderWithCarrier.mockRejectedValue(new Error("boom"));
  const result = await retryCarrierShipmentAction("o1", "s1", "bosta");
  expect(result).toEqual({ status: "error", message: ar.formErrors.unexpected });
  expect(revalidatePath).toHaveBeenCalledWith("/orders");
  expect(revalidatePath).toHaveBeenCalledWith("/orders/o1");
});

it("invalid arguments never reach the API or revalidate", async () => {
  await retryCarrierShipmentAction("../x", "s1", "bosta");
  await shipWithCarrierAction("o1", "Bad Key");
  expect(shipping.retryShipment).not.toHaveBeenCalled();
  expect(api.shipOrderWithCarrier).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
});
