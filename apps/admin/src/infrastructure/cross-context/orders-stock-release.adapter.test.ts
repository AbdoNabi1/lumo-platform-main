import { describe, expect, it, vi } from "vitest";
import type { InventoryController, InventoryItemRepository } from "@platform/inventory";
import type { OrderController } from "@platform/orders";
import type { Logger } from "@platform/utils";
import { OrdersStockReleaseAdapter } from "./orders-stock-release.adapter";

function logger() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  log.child.mockReturnValue(log);
  return log as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

interface FakeItem {
  readonly product: { readonly value: string };
  readonly warehouseId: { readonly value: string };
  readonly variantRef: string | null;
  readonly reservations: readonly { id: { toString(): string }; reference: string }[];
}

function item(
  productId: string,
  warehouse: string,
  variantRef: string | null,
  reservations: readonly (readonly [string, string])[],
): FakeItem {
  return {
    product: { value: productId },
    warehouseId: { value: warehouse },
    variantRef,
    reservations: reservations.map(([id, reference]) => ({
      id: { toString: () => id },
      reference,
    })),
  };
}

function setup(
  items: Record<string, FakeItem[]>,
  release = vi.fn().mockResolvedValue({ status: 200 }),
) {
  const orders = {
    getOrder: vi.fn().mockResolvedValue({
      status: 200,
      body: {
        items: [
          { snapshot: { productId: "p-1" }, quantity: 2 },
          { snapshot: { productId: "p-2" }, quantity: 1 },
        ],
      },
    }),
  } as unknown as Pick<OrderController, "getOrder">;
  const findByProduct = vi
    .fn()
    .mockImplementation((productId: string) => Promise.resolve(items[productId] ?? []));
  return {
    orders,
    release,
    items: { findByProduct } as unknown as Pick<InventoryItemRepository, "findByProduct">,
    inventory: { release } as unknown as Pick<InventoryController, "release">,
  };
}

describe("OrdersStockReleaseAdapter (G-130: release the stock held for a cancelled order)", () => {
  it("releases every reservation of the order even when releasing removes it from the stock item as it goes (Plan 3C: a placed order can hold two)", async () => {
    const stockItem = item("p-1", "wh-1", "var-a", [
      ["res-1", "order-1"],
      ["res-2", "order-1"],
    ]);
    const live = stockItem.reservations as { id: { toString(): string }; reference: string }[];
    const release = vi.fn().mockImplementation(async (target: { reservationId: string }) => {
      // Inventory takes the reservation off the aggregate the adapter is walking.
      const at = live.findIndex((r) => r.id.toString() === target.reservationId);
      if (at >= 0) live.splice(at, 1);
      return { status: 200 };
    });
    const { orders, items, inventory } = setup({ "p-1": [stockItem] }, release);

    await new OrdersStockReleaseAdapter(orders, items, inventory, logger()).releaseOrderStock(
      "order-1",
      "tenant-a",
    );

    expect(release).toHaveBeenCalledTimes(2);
    expect(live).toHaveLength(0);
  });

  it("releases every reservation whose reference is the order, at whichever location and variant holds it", async () => {
    const { orders, items, inventory, release } = setup({
      "p-1": [
        item("p-1", "wh-1", "var-a", [
          ["res-1", "order-1"],
          ["res-x", "someone-else"],
        ]),
        item("p-1", "wh-2", null, [["res-2", "order-1"]]),
      ],
      "p-2": [item("p-2", "wh-1", "var-b", [["res-3", "order-1"]])],
    });

    await new OrdersStockReleaseAdapter(orders, items, inventory, logger()).releaseOrderStock(
      "order-1",
      "tenant-a",
    );

    expect(release).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      productId: "p-1",
      warehouseId: "wh-1",
      variantId: "var-a",
      reservationId: "res-1",
    });
    expect(release).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      productId: "p-1",
      warehouseId: "wh-2",
      reservationId: "res-2",
    });
    expect(release).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      productId: "p-2",
      warehouseId: "wh-1",
      variantId: "var-b",
      reservationId: "res-3",
    });
  });

  it("never releases another order's reservation", async () => {
    const { orders, items, inventory, release } = setup({
      "p-1": [item("p-1", "wh-1", null, [["res-9", "order-2"]])],
    });

    await new OrdersStockReleaseAdapter(orders, items, inventory, logger()).releaseOrderStock(
      "order-1",
      "tenant-a",
    );

    expect(release).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is reserved for the order", async () => {
    const { orders, items, inventory, release } = setup({});

    await new OrdersStockReleaseAdapter(orders, items, inventory, logger()).releaseOrderStock(
      "order-1",
      "tenant-a",
    );

    expect(release).not.toHaveBeenCalled();
  });

  it("keeps releasing the rest when one release is refused, and logs ids only", async () => {
    const release = vi
      .fn()
      .mockResolvedValueOnce({ status: 409, body: { message: "for guest@x.com" } })
      .mockResolvedValue({ status: 200 });
    const { orders, items, inventory } = setup(
      {
        "p-1": [item("p-1", "wh-1", null, [["res-1", "order-1"]])],
        "p-2": [item("p-2", "wh-1", null, [["res-2", "order-1"]])],
      },
      release,
    );
    const log = logger();

    await new OrdersStockReleaseAdapter(orders, items, inventory, log).releaseOrderStock(
      "order-1",
      "tenant-a",
    );

    expect(release).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("guest@x.com");
  });

  it("never throws when the order cannot be read", async () => {
    const unreadable = {
      getOrder: vi.fn().mockResolvedValue({ status: 404, body: {} }),
    } as unknown as Pick<OrderController, "getOrder">;
    const base = setup({});
    const log = logger();

    await expect(
      new OrdersStockReleaseAdapter(unreadable, base.items, base.inventory, log).releaseOrderStock(
        "order-1",
        "tenant-a",
      ),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("never throws when Inventory throws", async () => {
    const throwing = setup(
      { "p-1": [item("p-1", "wh-1", null, [["res-1", "order-1"]])] },
      vi.fn().mockRejectedValue(new Error("boom")),
    );
    const log = logger();

    await expect(
      new OrdersStockReleaseAdapter(
        throwing.orders,
        throwing.items,
        throwing.inventory,
        log,
      ).releaseOrderStock("order-1", "tenant-a"),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
