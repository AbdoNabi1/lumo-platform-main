import { beforeEach, describe, expect, it, vi } from "vitest";
import { shipInBulk } from "./bulk-ship";

beforeEach(() => {
  expect.hasAssertions();
});
const okOutcome = (orderId: string) => ({
  ok: true as const,
  value: {
    orderId,
    orderNumber: orderId,
    shipmentId: `s-${orderId}`,
    trackingNumber: "track",
    carrierKey: "bosta",
  },
});

describe("bulk shipping", () => {
  it("orders after the budget are CARRIER_TIMEOUT and never attempted (Review Focus 5)", async () => {
    let now = 0;
    const ship = vi.fn((orderId: string, _key: string) => {
      now += 20_000;
      return Promise.resolve(okOutcome(orderId));
    });
    const result = await shipInBulk(
      ship,
      { orderIds: ["a", "b", "c", "d"], idempotencyKey: "k" },
      () => now,
    );
    expect(result.shipped.map((s) => s.orderId)).toEqual(["a", "b"]);
    expect(result.failed).toEqual([
      { orderId: "c", code: "CARRIER_TIMEOUT", attempted: false },
      { orderId: "d", code: "CARRIER_TIMEOUT", attempted: false },
    ]);
    expect(ship).toHaveBeenCalledTimes(2);
    expect(ship.mock.calls[0]).toEqual(["a", "k:a"]);
  });
  it("a failed order doesn't stop the next", async () => {
    const result = await shipInBulk(
      (id) =>
        Promise.resolve(
          id === "b"
            ? {
                ok: false as const,
                code: "ADDRESS_NOT_SHIPPABLE",
                httpStatus: 422,
                reason: "CITY_NOT_FOUND",
                orderNumber: "1002",
              }
            : okOutcome(id),
        ),
      { orderIds: ["a", "b", "c"], idempotencyKey: "k" },
      () => 0,
    );
    expect(result.shipped.map((s) => s.orderId)).toEqual(["a", "c"]);
    expect(result.failed).toEqual([
      {
        orderId: "b",
        code: "ADDRESS_NOT_SHIPPABLE",
        reason: "CITY_NOT_FOUND",
        orderNumber: "1002",
        attempted: true,
      },
    ]);
  });
  it("reports thrown errors and continues", async () => {
    const result = await shipInBulk(
      (id) => (id === "a" ? Promise.reject(new Error("oops")) : Promise.resolve(okOutcome(id))),
      { orderIds: ["a", "b"], idempotencyKey: "k" },
      () => 0,
    );
    expect(result.failed).toEqual([{ orderId: "a", code: "CARRIER_UNAVAILABLE", attempted: true }]);
    expect(result.shipped.map((s) => s.orderId)).toEqual(["b"]);
  });
});
