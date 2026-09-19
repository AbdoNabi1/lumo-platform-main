import { describe, expect, it } from "vitest";
import type {
  InventoryController,
  InventoryItem,
  InventoryItemRepository,
  Warehouse,
  WarehouseRepository,
} from "@platform/inventory";
import type { OrderController } from "@platform/orders";
import type { CursorPage, Paginated } from "@platform/types";
import { OrdersInventoryAdapter } from "./orders-inventory.adapter";

/**
 * A minimal `Warehouse`-shaped fixture — only `id.value` is read by `OrdersInventoryAdapter` (same
 * minimal-cast convention as `inventory-validation.adapter.test.ts`'s `warehouseFixture`).
 */
function warehouseFixture(id: string): Warehouse {
  return { id: { value: id } } as unknown as Warehouse;
}

/** A fake `WarehouseRepository` — only `list` is exercised by this adapter. */
class FakeWarehouseRepository implements WarehouseRepository {
  constructor(private readonly warehouses: readonly Warehouse[]) {}

  async list(page: CursorPage): Promise<Paginated<Warehouse>> {
    const limit = page.first ?? this.warehouses.length;
    const items = this.warehouses.slice(0, limit);
    return {
      items,
      pageInfo: { hasNextPage: items.length < this.warehouses.length, endCursor: null },
    };
  }

  save(): Promise<void> {
    throw new Error("not used by OrdersInventoryAdapter");
  }
  findById(): Promise<Warehouse | null> {
    throw new Error("not used by OrdersInventoryAdapter");
  }
  findByCode(): Promise<Warehouse | null> {
    throw new Error("not used by OrdersInventoryAdapter");
  }
}

interface FakeOrderLine {
  readonly productId: string;
  readonly quantity: number;
}

/** A fake `OrderController` narrowed to `getOrder` — the only method this adapter calls. Order bodies mirror the real `Order` domain shape (`items: [{snapshot: {productId}, quantity}]`) since `getOrder` returns the live domain object in-process, not a stripped DTO. */
function fakeOrderController(
  ordersById: Readonly<Record<string, readonly FakeOrderLine[]>>,
): Pick<OrderController, "getOrder"> {
  return {
    async getOrder(input) {
      const lines = ordersById[input.orderId];
      if (lines === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Order not found" } };
      }
      return {
        status: 200,
        body: {
          items: lines.map((line) => ({
            snapshot: { productId: line.productId },
            quantity: line.quantity,
          })),
        },
      };
    },
  };
}

interface ReserveCall {
  readonly tenantId: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly quantity: number;
  readonly reference: string;
}

interface FakeItemRecord {
  readonly id: string;
  readonly reservations: { readonly reference: string }[];
}

/** A minimal `InventoryItem`-shaped fixture — only `id` (via `.toString()`) is read by `OrdersInventoryAdapter`. */
function fakeInventoryItem(id: string): InventoryItem {
  return { id: { toString: () => id } } as unknown as InventoryItem;
}

/**
 * A realistic `InventoryItemRepository` + `InventoryController` fake pair, sharing state via
 * `itemsByKey` — this is the whole point of this fixture: `findByReservationReference` only finds a
 * match AFTER `reserve()` has actually recorded one for that `reference`, mirroring the real
 * `ReserveStock`/`InventoryItem.reserve()` relationship (`reserve()` itself does NOT dedupe by
 * `reference` — see the adapter's class doc). A fake that ignored `reference` entirely (as an
 * earlier version of this test did) could never catch a real double-reservation; this one can,
 * because a bug that skips the `findByReservationReference` check would show up here as `reserve()`
 * being called twice for the same product/order pair.
 */
class FakeInventorySystem {
  private readonly itemsByKey = new Map<string, FakeItemRecord>();
  private nextItemId = 1;
  readonly reserveCalls: ReserveCall[] = [];
  private reserveCounter = 0;
  private failReserve = false;

  registerItem(productId: string, warehouseId: string): void {
    this.itemsByKey.set(`${productId}:${warehouseId}`, {
      id: `item-${this.nextItemId++}`,
      reservations: [],
    });
  }

  /** Makes every subsequent `reserve()` call fail (409), without touching state. */
  failReservations(): void {
    this.failReserve = true;
  }

  items(): Pick<
    InventoryItemRepository,
    "findByProductAndWarehouse" | "findByReservationReference"
  > {
    return {
      findByProductAndWarehouse: async (productId, warehouseId) => {
        const record = this.itemsByKey.get(`${productId}:${warehouseId}`);
        return record === undefined ? null : fakeInventoryItem(record.id);
      },
      findByReservationReference: async (itemId, reference) => {
        for (const record of this.itemsByKey.values()) {
          if (record.id === itemId && record.reservations.some((r) => r.reference === reference)) {
            return fakeInventoryItem(record.id);
          }
        }
        return null;
      },
    };
  }

  controller(): Pick<InventoryController, "reserve"> {
    return {
      reserve: async (input) => {
        this.reserveCalls.push(input);
        if (this.failReserve) {
          return { status: 409, body: { code: "CONFLICT", message: "insufficient stock" } };
        }
        // Mirrors the real `ReserveStock`/`InventoryItem.reserve()`: unconditionally records a new
        // reservation, no dedupe by `reference` at this layer (that's the whole point).
        const key = `${input.productId}:${input.warehouseId}`;
        const record = this.itemsByKey.get(key);
        if (record !== undefined) {
          record.reservations.push({ reference: input.reference });
        }
        this.reserveCounter += 1;
        return {
          status: 201,
          body: { reservationId: `res-${this.reserveCounter}`, available: 0 },
        };
      },
    };
  }
}

describe("OrdersInventoryAdapter (Orders -> Inventory, C-3)", () => {
  it("single warehouse, multi-item order: reserves every line with the order's id as reference and returns orderId as the ref", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    system.registerItem("product-2", "wh-1");
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({
      "order-1": [
        { productId: "product-1", quantity: 2 },
        { productId: "product-2", quantity: 5 },
      ],
    });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    const result = await adapter.requestReservation("order-1", "tenant-a");

    expect(result).toEqual({ reservationRef: "order-1" });
    expect(system.reserveCalls).toEqual([
      {
        tenantId: "tenant-a",
        productId: "product-1",
        warehouseId: "wh-1",
        quantity: 2,
        reference: "order-1",
      },
      {
        tenantId: "tenant-a",
        productId: "product-2",
        warehouseId: "wh-1",
        quantity: 5,
        reference: "order-1",
      },
    ]);
  });

  it("zero warehouses registered: throws instead of fabricating a reservationRef", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    const warehouses = new FakeWarehouseRepository([]);
    const orders = fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    await expect(adapter.requestReservation("order-1", "tenant-a")).rejects.toThrow(/warehouse/i);
  });

  it("more than one warehouse registered: throws instead of guessing", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    const warehouses = new FakeWarehouseRepository([
      warehouseFixture("wh-1"),
      warehouseFixture("wh-2"),
    ]);
    const orders = fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    await expect(adapter.requestReservation("order-1", "tenant-a")).rejects.toThrow(/warehouse/i);
  });

  it("order not found: throws a clear error rather than reserving nothing silently", async () => {
    const system = new FakeInventorySystem();
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({});
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    await expect(adapter.requestReservation("missing-order", "tenant-a")).rejects.toThrow(
      /missing-order/,
    );
  });

  it("a failed per-item reservation throws instead of returning a partial success", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    system.failReservations();
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    await expect(adapter.requestReservation("order-1", "tenant-a")).rejects.toThrow(/product-1/);
  });

  it("idempotency: retrying requestReservation(orderId) for an already-reserved order does not create a second reservation for any line item", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    system.registerItem("product-2", "wh-1");
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({
      "order-1": [
        { productId: "product-1", quantity: 1 },
        { productId: "product-2", quantity: 3 },
      ],
    });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    const first = await adapter.requestReservation("order-1", "tenant-a");
    const second = await adapter.requestReservation("order-1", "tenant-a");

    expect(first).toEqual({ reservationRef: "order-1" });
    expect(second).toEqual({ reservationRef: "order-1" });
    // The real assertion: `reserve()` was called exactly once per line item across BOTH calls, not
    // once per line item PER call. A fake/adapter that ignored the reservation-reference check would
    // report 4 calls here (2 items x 2 attempts) instead of 2 — this is what a naive
    // `InventoryController.reserve` retry would do against real Inventory data (double-decrementing
    // stock or throwing once availability is exhausted), which is exactly the bug this test guards
    // against.
    expect(system.reserveCalls).toHaveLength(2);
    expect(system.reserveCalls.map((call) => call.productId).sort()).toEqual([
      "product-1",
      "product-2",
    ]);
  });

  it("idempotency: a partially-completed prior attempt only re-reserves the lines that weren't already reserved", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    system.registerItem("product-2", "wh-1");
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({
      "order-1": [
        { productId: "product-1", quantity: 1 },
        { productId: "product-2", quantity: 3 },
      ],
    });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    // Simulate a prior partial success: product-1 got reserved (e.g. a crash/timeout hit before
    // product-2's `reserve()` call went out — RequestFulfillment's own documented RESIDUAL RISK #1).
    await system.controller().reserve({
      tenantId: "tenant-a",
      productId: "product-1",
      warehouseId: "wh-1",
      quantity: 1,
      reference: "order-1",
    });
    system.reserveCalls.length = 0; // reset so the assertion below only sees THIS adapter call

    const result = await adapter.requestReservation("order-1", "tenant-a");

    expect(result).toEqual({ reservationRef: "order-1" });
    // Only product-2 should have been reserved by the adapter — product-1 was already covered.
    expect(system.reserveCalls).toEqual([
      {
        tenantId: "tenant-a",
        productId: "product-2",
        warehouseId: "wh-1",
        quantity: 3,
        reference: "order-1",
      },
    ]);
  });

  it("uses the per-call tenant for the order lookup and every reservation (ADR-0014)", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1");
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] });
    const adapter = new OrdersInventoryAdapter(
      system.controller(),
      warehouses,
      system.items(),
      orders,
    );

    await adapter.requestReservation("order-1", "tenant-b");

    expect(system.reserveCalls.map((call) => call.tenantId)).toEqual(["tenant-b"]);
  });
});
