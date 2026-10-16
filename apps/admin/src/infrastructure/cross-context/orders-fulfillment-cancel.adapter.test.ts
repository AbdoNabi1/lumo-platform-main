import { describe, expect, it, vi } from "vitest";
import type { FulfillmentController } from "@platform/fulfillment";
import type { Logger } from "@platform/utils";
import { OrdersFulfillmentCancelAdapter } from "./orders-fulfillment-cancel.adapter";

type Fulfillment = Pick<FulfillmentController, "getByOrder" | "advance">;

function logger() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  log.child.mockReturnValue(log);
  return log as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

/** `getByOrder` answers with the fulfillment order entity: its status is a value object with `.value`. */
function fulfillmentIn(status: string, advance = vi.fn().mockResolvedValue({ status: 200 })) {
  const fulfillment: Fulfillment = {
    getByOrder: vi.fn().mockResolvedValue({
      status: 200,
      body: { id: { toString: () => "fo-1" }, orderRef: "order-1", status: { value: status } },
    }),
    advance,
  };
  return { fulfillment, advance };
}

describe("OrdersFulfillmentCancelAdapter (G-130: cancel a cancelled order's open fulfillment)", () => {
  it.each(["created", "confirmed", "failed"])(
    "cancels a fulfillment order that is %s, through Fulfillment's own transition",
    async (status) => {
      const { fulfillment, advance } = fulfillmentIn(status);

      await new OrdersFulfillmentCancelAdapter(fulfillment, logger()).cancelOpenFulfillment(
        "order-1",
        "tenant-a",
      );

      expect(fulfillment.getByOrder).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        orderRef: "order-1",
      });
      expect(advance).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        fulfillmentOrderId: "fo-1",
        toStatus: "cancelled",
      });
    },
  );

  it.each([
    "picking_started",
    "packing_completed",
    "shipment_dispatched",
    "delivered",
    "cancelled",
    "closed",
  ])(
    "leaves a fulfillment order that is already %s alone, and says so when it is still moving",
    async (status) => {
      const { fulfillment, advance } = fulfillmentIn(status);
      const log = logger();

      await new OrdersFulfillmentCancelAdapter(fulfillment, log).cancelOpenFulfillment(
        "order-1",
        "tenant-a",
      );

      expect(advance).not.toHaveBeenCalled();
      const stillMoving = !["cancelled", "closed", "delivered"].includes(status);
      expect(log.warn).toHaveBeenCalledTimes(stillMoving ? 1 : 0);
    },
  );

  it("does nothing when the order has no fulfillment order", async () => {
    const fulfillment: Fulfillment = {
      getByOrder: vi.fn().mockResolvedValue({ status: 404, body: {} }),
      advance: vi.fn(),
    };
    const log = logger();

    await new OrdersFulfillmentCancelAdapter(fulfillment, log).cancelOpenFulfillment(
      "order-1",
      "tenant-a",
    );

    expect(fulfillment.advance).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs and carries on when Fulfillment refuses, with ids only", async () => {
    const refused = vi
      .fn()
      .mockResolvedValue({ status: 409, body: { message: "for guest@x.com" } });
    const log = logger();

    await new OrdersFulfillmentCancelAdapter(
      fulfillmentIn("created", refused).fulfillment,
      log,
    ).cancelOpenFulfillment("order-1", "tenant-a");

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("guest@x.com");
  });

  it("never throws, even when Fulfillment throws", async () => {
    const throwing: Fulfillment = {
      getByOrder: vi.fn().mockRejectedValue(new Error("boom")),
      advance: vi.fn(),
    };
    const log = logger();

    await expect(
      new OrdersFulfillmentCancelAdapter(throwing, log).cancelOpenFulfillment(
        "order-1",
        "tenant-a",
      ),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
