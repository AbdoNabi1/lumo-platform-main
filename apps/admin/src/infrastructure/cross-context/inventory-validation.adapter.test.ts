import { describe, expect, it } from "vitest";
import { CheckoutItem } from "@platform/checkout";
import type { InventoryController } from "@platform/inventory";
import type { CursorPage, Paginated } from "@platform/types";
import type { Warehouse, WarehouseRepository } from "@platform/inventory";
import { InventoryValidationAdapter } from "./inventory-validation.adapter";

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function checkoutItem(
  productRef: string,
  quantity: number,
  unitPriceAmountMinor: number,
  currency: string,
): CheckoutItem {
  return must(CheckoutItem.create(productRef, quantity, unitPriceAmountMinor, currency));
}

/**
 * A minimal `Warehouse`-shaped fixture — only `id.value` is read by `InventoryValidationAdapter`,
 * so the fixture carries just that (same minimal-cast convention as
 * `pricing-validation.adapter.test.ts`'s `publishedPriceFixture`).
 */
function warehouseFixture(id: string): Warehouse {
  return { id: { value: id } } as unknown as Warehouse;
}

/** A fake `WarehouseRepository` (Common Structure step 3) — only `list` is exercised by this adapter; every other method is unused and throws if ever called. */
class FakeWarehouseRepository implements WarehouseRepository {
  readonly tenantsSeen: string[] = [];

  constructor(private readonly warehouses: readonly Warehouse[]) {}

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Warehouse>> {
    this.tenantsSeen.push(tenantId);
    const limit = page.first ?? this.warehouses.length;
    const items = this.warehouses.slice(0, limit);
    return {
      items,
      pageInfo: { hasNextPage: items.length < this.warehouses.length, endCursor: null },
    };
  }

  save(): Promise<void> {
    throw new Error("not used by InventoryValidationAdapter");
  }
  findById(): Promise<Warehouse | null> {
    throw new Error("not used by InventoryValidationAdapter");
  }
  findByCode(): Promise<Warehouse | null> {
    throw new Error("not used by InventoryValidationAdapter");
  }
}

/**
 * A fake owning controller (Common Structure step 3) — narrowed to `checkAvailability`, the only
 * method `InventoryValidationAdapter` calls (see the adapter's own doc comment for why it accepts
 * `Pick<InventoryController, "checkAvailability">` rather than a full `InventoryController`).
 * Stock is keyed `productId -> available`; a product absent from the map simulates "no inventory
 * record for this product at this warehouse" (404, mirroring `CheckAvailability`'s real
 * `NotFoundError` behavior via `present()`).
 */
function fakeInventoryController(
  stockByProduct: Readonly<Record<string, number>>,
): Pick<InventoryController, "checkAvailability"> {
  return {
    async checkAvailability(input) {
      const available = stockByProduct[input.productId];
      if (available === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Inventory item not found" } };
      }
      return { status: 200, body: { available } };
    },
  };
}

describe("InventoryValidationAdapter (Checkout -> Inventory, C-3)", () => {
  it("valid: single warehouse, sufficient stock for every item", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 5 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD"), checkoutItem("product-2", 5, 999, "USD")],
      "tenant-a",
    );

    expect(result).toEqual({ valid: true });
  });

  it("invalid: insufficient stock for one of the items", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 3 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD"), checkoutItem("product-2", 5, 999, "USD")],
      "tenant-a",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-2");
  });

  it("invalid: no inventory record for the product at the resolved warehouse", async () => {
    const inventory = fakeInventoryController({});
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate(
      [checkoutItem("product-missing", 1, 1999, "USD")],
      "tenant-a",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-missing");
  });

  it("invalid: zero warehouses registered — reports the gap instead of guessing", async () => {
    const inventory = fakeInventoryController({ "product-1": 10 });
    const warehouses = new FakeWarehouseRepository([]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate([checkoutItem("product-1", 1, 1999, "USD")], "tenant-a");

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/warehouse/i);
  });

  it("invalid: more than one warehouse registered — reports the gap instead of guessing", async () => {
    const inventory = fakeInventoryController({ "product-1": 10 });
    const warehouses = new FakeWarehouseRepository([
      warehouseFixture("wh-1"),
      warehouseFixture("wh-2"),
    ]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate([checkoutItem("product-1", 1, 1999, "USD")], "tenant-a");

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/warehouse/i);
  });

  it("checks every item, not just the first", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 1 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate(
      [checkoutItem("product-1", 1, 1999, "USD"), checkoutItem("product-2", 5, 999, "USD")],
      "tenant-a",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-2");
  });

  it("empty items: vacuously valid — nothing to check, no warehouse resolution needed", async () => {
    const inventory = fakeInventoryController({});
    const warehouses = new FakeWarehouseRepository([]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    const result = await adapter.validate([], "tenant-a");

    expect(result).toEqual({ valid: true });
  });

  it("resolves the warehouse once per validate() call, not once per item", async () => {
    let listCalls = 0;
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 10 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const originalList = warehouses.list.bind(warehouses);
    warehouses.list = async (page: CursorPage, tenantId: string) => {
      listCalls += 1;
      return originalList(page, tenantId);
    };
    const adapter = new InventoryValidationAdapter(inventory, warehouses);

    await adapter.validate(
      [checkoutItem("product-1", 1, 1999, "USD"), checkoutItem("product-2", 1, 999, "USD")],
      "tenant-a",
    );

    expect(listCalls).toBe(1);
  });

  it("one adapter instance serves two tenants, passing each call's tenant to the warehouse lookup (ADR-0014)", async () => {
    const inventory = fakeInventoryController({ "product-1": 10 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(inventory, warehouses);
    const items = [checkoutItem("product-1", 1, 1999, "USD")];

    await adapter.validate(items, "tenant-a");
    await adapter.validate(items, "tenant-b");

    expect(warehouses.tenantsSeen).toEqual(["tenant-a", "tenant-b"]);
  });
});
