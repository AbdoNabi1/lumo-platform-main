import { beforeEach, expect, it, vi } from "vitest";
import { ar } from "@/messages/ar";

const shipping = vi.hoisted(() => ({
  advanceShipment: vi.fn(),
  createShipment: vi.fn(),
  createShipmentLabel: vi.fn(),
  recordShipmentWebhook: vi.fn(),
  retryShipment: vi.fn(),
  updateShipmentTracking: vi.fn(),
  voidShipmentLabel: vi.fn(),
}));
vi.mock("@/lib/api/shipping", () => shipping);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: "ar" }) }),
}));

const { advanceShipmentAction, voidShipmentLabelAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  expect.hasAssertions();
  vi.resetAllMocks();
});

it("void shows the use-cancel message when the API answers CARRIER_USE_CANCEL", async () => {
  shipping.voidShipmentLabel.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_USE_CANCEL",
    message: "x",
  });
  const result = await voidShipmentLabelAction(
    { status: "idle" },
    form({ orderId: "o1", shipmentId: "s1" }),
  );
  expect(result).toEqual({
    status: "error",
    message: ar.carrierShipping.errors.CARRIER_USE_CANCEL,
    fieldErrors: {},
  });
});

it("advance shows the use-cancel message too", async () => {
  shipping.advanceShipment.mockResolvedValue({
    outcome: "conflict",
    code: "CARRIER_USE_CANCEL",
    message: "x",
  });
  const result = await advanceShipmentAction(
    { status: "idle" },
    form({ orderId: "o1", shipmentId: "s1", toStatus: "cancelled" }),
  );
  expect(result).toMatchObject({
    status: "error",
    message: ar.carrierShipping.errors.CARRIER_USE_CANCEL,
  });
});

it("other conflicts keep the existing form-state projection", async () => {
  shipping.voidShipmentLabel.mockResolvedValue({ outcome: "conflict", message: "stale" });
  const result = await voidShipmentLabelAction(
    { status: "idle" },
    form({ orderId: "o1", shipmentId: "s1" }),
  );
  expect(result).toEqual({ status: "error", message: "stale", fieldErrors: {} });
});
