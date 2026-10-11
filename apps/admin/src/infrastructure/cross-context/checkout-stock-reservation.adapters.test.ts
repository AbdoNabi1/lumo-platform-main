import { describe, expect, it, vi } from "vitest";
import type { OrderController } from "@platform/orders";
import {
  CheckoutOrderCancellationAdapter,
  CheckoutStockReservationAdapter,
} from "./checkout-stock-reservation.adapters";
import type { OrdersInventoryAdapter } from "./orders-inventory.adapter";
import type { OrdersStockReleaseAdapter } from "./orders-stock-release.adapter";

describe("CheckoutStockReservationAdapter (Plan 3C, G-114)", () => {
  function build(options: { requestReservation?: () => Promise<{ reservationRef: string }> } = {}) {
    const requestReservation = vi
      .fn<(orderId: string, tenantId: string) => Promise<{ reservationRef: string }>>()
      .mockImplementation(options.requestReservation ?? (async () => ({ reservationRef: "o-1" })));
    const releaseOrderStock = vi
      .fn<(orderId: string, tenantId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    const adapter = new CheckoutStockReservationAdapter(
      { requestReservation } as unknown as Pick<OrdersInventoryAdapter, "requestReservation">,
      { releaseOrderStock } as unknown as Pick<OrdersStockReleaseAdapter, "releaseOrderStock">,
    );
    return { adapter, requestReservation, releaseOrderStock };
  }

  it("reserves through the Orders inventory adapter, keyed by the order id and the caller's tenant", async () => {
    const { adapter, requestReservation } = build();

    const result = await adapter.reserve("o-1", [], "tenant-a");

    expect(result).toEqual({ ok: true });
    expect(requestReservation).toHaveBeenCalledWith("o-1", "tenant-a");
  });

  it("answers 'not reserved' when no location can supply a line, without leaking the internal message", async () => {
    const { adapter } = build({
      requestReservation: async () => {
        throw new Error(
          'OrdersInventoryAdapter: no active location can supply product "p-1" on order "o-1"',
        );
      },
    });

    const result = await adapter.reserve("o-1", [], "tenant-a");

    expect(result).toEqual({ ok: false, reason: "insufficient stock" });
  });

  it("releases through the Orders stock-release adapter", async () => {
    const { adapter, releaseOrderStock } = build();

    await adapter.release("o-1", "tenant-a");

    expect(releaseOrderStock).toHaveBeenCalledWith("o-1", "tenant-a");
  });
});

describe("CheckoutOrderCancellationAdapter (Plan 3C)", () => {
  it("cancels the order through Orders' own transition, in the caller's tenant", async () => {
    const advance = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const adapter = new CheckoutOrderCancellationAdapter({ advance } as unknown as Pick<
      OrderController,
      "advance"
    >);

    await adapter.cancel("o-1", "tenant-a");

    expect(advance).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      orderId: "o-1",
      toStatus: "cancelled",
    });
  });

  it("throws when Orders refuses, so the caller knows the order is still standing", async () => {
    const adapter = new CheckoutOrderCancellationAdapter({
      advance: async () => ({ status: 409, body: {} }),
    } as unknown as Pick<OrderController, "advance">);

    await expect(adapter.cancel("o-1", "tenant-a")).rejects.toThrow(/409/);
  });
});
