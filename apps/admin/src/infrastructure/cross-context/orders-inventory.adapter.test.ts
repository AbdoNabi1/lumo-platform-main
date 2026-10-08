import { describe, expect, it } from "vitest";
import type { Product, ProductController } from "@platform/catalog";
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
  readonly variantRef?: string;
  readonly quantity: number;
}

/** A fake `OrderController` narrowed to `getOrder` — the only method this adapter calls. Order bodies mirror the real `Order` domain shape (`items: [{snapshot: {productId, variantRef?}, quantity}]`) since `getOrder` returns the live domain object in-process, not a stripped DTO. */
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
            snapshot: {
              productId: line.productId,
              ...(line.variantRef === undefined ? {} : { variantRef: line.variantRef }),
            },
            quantity: line.quantity,
          })),
        },
      };
    },
  };
}

interface VariantSpec {
  readonly id: string;
  readonly tracksInventory?: boolean;
  readonly inventoryPolicy?: "deny" | "continue";
}

/** A fake `ProductController.get` (Plan 2B-1): products by id, each with the given variants. */
function fakeProducts(
  byProduct: Readonly<Record<string, readonly VariantSpec[]>> | "single-default-variant",
): Pick<ProductController, "get"> {
  return {
    async get(input) {
      const specs =
        byProduct === "single-default-variant"
          ? [{ id: `v-${input.productId}` }]
          : byProduct[input.productId];
      if (specs === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Product not found" } };
      }
      const product = {
        variants: specs.map((spec) => ({
          id: { toString: () => spec.id },
          attributes: {
            tracksInventory: spec.tracksInventory ?? true,
            inventoryPolicy: spec.inventoryPolicy ?? "deny",
          },
        })),
      } as unknown as Product;
      return { status: 200, body: product };
    },
  };
}

interface ReserveCall {
  readonly tenantId: string;
  readonly productId: string;
  readonly variantId?: string;
  readonly warehouseId: string;
  readonly quantity: number;
  readonly reference: string;
}

interface FakeItemRecord {
  readonly id: string;
  readonly available: number;
  readonly reservations: { readonly reference: string }[];
}

/** A minimal `InventoryItem`-shaped fixture — only `id` (via `.toString()`) and `stockLevel.available` are read by `OrdersInventoryAdapter`. */
function fakeInventoryItem(record: FakeItemRecord): InventoryItem {
  return {
    id: { toString: () => record.id },
    stockLevel: { available: record.available },
  } as unknown as InventoryItem;
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
 *
 * Plan 2B-1: items are keyed by variant too. A lookup naming a variant finds that variant's item,
 * else the product's variant-less (legacy) item; `lookups` records every variant asked for.
 */
class FakeInventorySystem {
  private readonly itemsByKey = new Map<string, FakeItemRecord>();
  private nextItemId = 1;
  readonly reserveCalls: ReserveCall[] = [];
  readonly lookups: { productId: string; variantId?: string }[] = [];
  private reserveCounter = 0;
  private failReserve = false;

  registerItem(productId: string, warehouseId: string, available = 100, variantId = ""): void {
    this.itemsByKey.set(`${productId}:${variantId}:${warehouseId}`, {
      id: `item-${this.nextItemId++}`,
      available,
      reservations: [],
    });
  }

  /** Makes every subsequent `reserve()` call fail (409), without touching state. */
  failReservations(): void {
    this.failReserve = true;
  }

  private find(productId: string, warehouseId: string, variantId?: string) {
    return (
      this.itemsByKey.get(`${productId}:${variantId ?? ""}:${warehouseId}`) ??
      this.itemsByKey.get(`${productId}::${warehouseId}`)
    );
  }

  items(): Pick<
    InventoryItemRepository,
    "findByProductAndWarehouse" | "findByReservationReference"
  > {
    return {
      findByProductAndWarehouse: async (productId, warehouseId, _tenantId, _tx, variantId) => {
        this.lookups.push({ productId, ...(variantId === undefined ? {} : { variantId }) });
        const record = this.find(productId, warehouseId, variantId);
        return record === undefined ? null : fakeInventoryItem(record);
      },
      findByReservationReference: async (itemId, reference) => {
        for (const record of this.itemsByKey.values()) {
          if (record.id === itemId && record.reservations.some((r) => r.reference === reference)) {
            return fakeInventoryItem(record);
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
        const record = this.find(input.productId, input.warehouseId, input.variantId);
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

function build(
  system: FakeInventorySystem,
  warehouses: WarehouseRepository,
  orders: Pick<OrderController, "getOrder">,
  products: Pick<ProductController, "get"> = fakeProducts("single-default-variant"),
) {
  return new OrdersInventoryAdapter(
    products,
    system.controller(),
    warehouses,
    system.items(),
    orders,
  );
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
    const adapter = build(system, warehouses, orders);

    const result = await adapter.requestReservation("order-1", "tenant-a");

    expect(result).toEqual({ reservationRef: "order-1" });
    expect(system.reserveCalls).toEqual([
      {
        tenantId: "tenant-a",
        productId: "product-1",
        variantId: "v-product-1",
        warehouseId: "wh-1",
        quantity: 2,
        reference: "order-1",
      },
      {
        tenantId: "tenant-a",
        productId: "product-2",
        variantId: "v-product-2",
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
    const adapter = build(system, warehouses, orders);

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
    const adapter = build(system, warehouses, orders);

    await expect(adapter.requestReservation("order-1", "tenant-a")).rejects.toThrow(/warehouse/i);
  });

  it("order not found: throws a clear error rather than reserving nothing silently", async () => {
    const system = new FakeInventorySystem();
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const orders = fakeOrderController({});
    const adapter = build(system, warehouses, orders);

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
    const adapter = build(system, warehouses, orders);

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
    const adapter = build(system, warehouses, orders);

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
    const adapter = build(system, warehouses, orders);

    // Simulate a prior partial success: product-1 got reserved (e.g. a crash/timeout hit before
    // product-2's `reserve()` call went out — RequestFulfillment's own documented RESIDUAL RISK #1).
    await system.controller().reserve({
      tenantId: "tenant-a",
      productId: "product-1",
      variantId: "v-product-1",
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
        variantId: "v-product-2",
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
    const adapter = build(system, warehouses, orders);

    await adapter.requestReservation("order-1", "tenant-b");

    expect(system.reserveCalls.map((call) => call.tenantId)).toEqual(["tenant-b"]);
  });
});

describe("OrdersInventoryAdapter — the variant's own stock (Plan 2B-1)", () => {
  const warehouses = () => new FakeWarehouseRepository([warehouseFixture("wh-1")]);

  it("a tracked deny line reserves its full quantity against its variant", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1", 10, "v-m");
    system.registerItem("product-1", "wh-1", 10, "v-l");
    const adapter = build(
      system,
      warehouses(),
      fakeOrderController({
        "order-1": [{ productId: "product-1", variantRef: "v-m", quantity: 4 }],
      }),
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
    );

    await adapter.requestReservation("order-1", "t");

    expect(system.reserveCalls).toEqual([
      {
        tenantId: "t",
        productId: "product-1",
        variantId: "v-m",
        warehouseId: "wh-1",
        quantity: 4,
        reference: "order-1",
      },
    ]);
  });

  it("an untracked line is not reserved", async () => {
    const system = new FakeInventorySystem();
    const adapter = build(
      system,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 4 }] }),
      fakeProducts({ "product-1": [{ id: "v-1", tracksInventory: false }] }),
    );

    const result = await adapter.requestReservation("order-1", "t");

    expect(result).toEqual({ reservationRef: "order-1" });
    expect(system.reserveCalls).toEqual([]);
  });

  it("a continue line reserves only what is available, and nothing (without throwing) at zero", async () => {
    const products = fakeProducts({ "product-1": [{ id: "v-1", inventoryPolicy: "continue" }] });

    const some = new FakeInventorySystem();
    some.registerItem("product-1", "wh-1", 2, "v-1");
    await build(
      some,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 5 }] }),
      products,
    ).requestReservation("order-1", "t");
    expect(some.reserveCalls.map((call) => call.quantity)).toEqual([2]);

    const none = new FakeInventorySystem();
    none.registerItem("product-1", "wh-1", 0, "v-1");
    const result = await build(
      none,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 5 }] }),
      products,
    ).requestReservation("order-1", "t");
    expect(result).toEqual({ reservationRef: "order-1" });
    expect(none.reserveCalls).toEqual([]);
  });

  it("the idempotency check looks up the item for that variant and still skips a reserved line", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1", 10, "v-m");
    const adapter = build(
      system,
      warehouses(),
      fakeOrderController({
        "order-1": [{ productId: "product-1", variantRef: "v-m", quantity: 2 }],
      }),
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
    );

    await adapter.requestReservation("order-1", "t");
    await adapter.requestReservation("order-1", "t");

    expect(system.reserveCalls).toHaveLength(1);
    expect(system.lookups).toEqual([
      { productId: "product-1", variantId: "v-m" },
      { productId: "product-1", variantId: "v-m" },
    ]);
  });

  it("an order line with no variant on a single-variant product reserves against that variant", async () => {
    const system = new FakeInventorySystem();
    system.registerItem("product-1", "wh-1", 10);
    const adapter = build(
      system,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 3 }] }),
      fakeProducts({ "product-1": [{ id: "v-only" }] }),
    );

    await adapter.requestReservation("order-1", "t");

    expect(system.reserveCalls).toEqual([
      expect.objectContaining({ productId: "product-1", variantId: "v-only", quantity: 3 }),
    ]);
  });

  it("throws when the product or the variant cannot be resolved", async () => {
    const system = new FakeInventorySystem();
    const missingProduct = build(
      system,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] }),
      fakeProducts({}),
    );
    await expect(missingProduct.requestReservation("order-1", "t")).rejects.toThrow(/product-1/);

    const ambiguous = build(
      system,
      warehouses(),
      fakeOrderController({ "order-1": [{ productId: "product-1", quantity: 1 }] }),
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
    );
    await expect(ambiguous.requestReservation("order-1", "t")).rejects.toThrow(/product-1/);
  });
});
