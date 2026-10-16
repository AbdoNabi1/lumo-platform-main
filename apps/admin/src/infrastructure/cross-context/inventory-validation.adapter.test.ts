import { describe, expect, it } from "vitest";
import type { Product, ProductController } from "@platform/catalog";
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
  variantRef?: string,
): CheckoutItem {
  return must(
    CheckoutItem.create(
      productRef,
      quantity,
      unitPriceAmountMinor,
      currency,
      variantRef === undefined
        ? undefined
        : { variantRef, sku: `sku-${variantRef}`, title: productRef, variantTitle: null },
    ),
  );
}

/**
 * A minimal `Warehouse`-shaped fixture — only `id.value` and `active` are read by
 * `InventoryValidationAdapter`, so the fixture carries just those (same minimal-cast convention as
 * `pricing-validation.adapter.test.ts`'s `publishedPriceFixture`).
 */
function warehouseFixture(id: string, active = true): Warehouse {
  return { id: { value: id }, active } as unknown as Warehouse;
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

interface CheckCall {
  readonly productId: string;
  readonly variantId?: string;
}

interface FakeInventory extends Pick<InventoryController, "checkAvailability"> {
  readonly calls: CheckCall[];
  /** Every warehouse asked about, in call order (Plan 2B-3). */
  readonly warehousesAsked: string[];
}

/**
 * A fake owning controller (Common Structure step 3) — narrowed to `checkAvailability`, the only
 * method `InventoryValidationAdapter` calls (see the adapter's own doc comment for why it accepts
 * `Pick<InventoryController, "checkAvailability">` rather than a full `InventoryController`).
 * Stock is keyed `productId` (any variant) or `productId:variantId` (Plan 2B-1, that variant only);
 * Plan 2B-3: prefix a key with `<warehouseId>/` to give that one location its own quantity. A key
 * absent from the map simulates "no inventory record" (404, mirroring `CheckAvailability`'s real
 * `NotFoundError` behavior via `present()`).
 */
function fakeInventoryController(stock: Readonly<Record<string, number>>): FakeInventory {
  const calls: CheckCall[] = [];
  const warehousesAsked: string[] = [];
  return {
    calls,
    warehousesAsked,
    async checkAvailability(input) {
      calls.push({
        productId: input.productId,
        ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
      });
      warehousesAsked.push(input.warehouseId);
      const where = `${input.warehouseId}/`;
      const available =
        stock[`${where}${input.productId}:${input.variantId ?? ""}`] ??
        stock[`${where}${input.productId}`] ??
        stock[`${input.productId}:${input.variantId ?? ""}`] ??
        stock[input.productId];
      if (available === undefined) {
        return { status: 404, body: { code: "NOT_FOUND", message: "Inventory item not found" } };
      }
      return { status: 200, body: { available } };
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
        variants: specs.map((spec) => {
          const tracksInventory = spec.tracksInventory ?? true;
          const inventoryPolicy = spec.inventoryPolicy ?? "deny";
          return {
            id: { toString: () => spec.id },
            attributes: { tracksInventory, inventoryPolicy },
            isStockLimited: () => tracksInventory && inventoryPolicy === "deny",
          };
        }),
      } as unknown as Product;
      return { status: 200, body: product };
    },
  };
}

describe("InventoryValidationAdapter (Checkout -> Inventory, C-3)", () => {
  it("valid: single warehouse, sufficient stock for every item", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 5 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

    const result = await adapter.validate(
      [checkoutItem("product-1", 2, 1999, "USD"), checkoutItem("product-2", 5, 999, "USD")],
      "tenant-a",
    );

    expect(result).toEqual({ valid: true });
  });

  it("invalid: insufficient stock for one of the items", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 3 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

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
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

    const result = await adapter.validate(
      [checkoutItem("product-missing", 1, 1999, "USD")],
      "tenant-a",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-missing");
  });

  it("invalid: zero active locations — a stock-limited line has nowhere to be served from", async () => {
    const inventory = fakeInventoryController({ "product-1": 10 });
    const warehouses = new FakeWarehouseRepository([]);
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

    const result = await adapter.validate([checkoutItem("product-1", 1, 1999, "USD")], "tenant-a");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-1");
    expect(inventory.calls).toEqual([]);
  });

  it("checks every item, not just the first", async () => {
    const inventory = fakeInventoryController({ "product-1": 10, "product-2": 1 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

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
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

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
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );

    await adapter.validate(
      [checkoutItem("product-1", 1, 1999, "USD"), checkoutItem("product-2", 1, 999, "USD")],
      "tenant-a",
    );

    expect(listCalls).toBe(1);
  });

  it("one adapter instance serves two tenants, passing each call's tenant to the warehouse lookup (ADR-0014)", async () => {
    const inventory = fakeInventoryController({ "product-1": 10 });
    const warehouses = new FakeWarehouseRepository([warehouseFixture("wh-1")]);
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      warehouses,
    );
    const items = [checkoutItem("product-1", 1, 1999, "USD")];

    await adapter.validate(items, "tenant-a");
    await adapter.validate(items, "tenant-b");

    expect(warehouses.tenantsSeen).toEqual(["tenant-a", "tenant-b"]);
  });
});

describe("InventoryValidationAdapter — several locations (Plan 2B-3)", () => {
  const twoLocations = () =>
    new FakeWarehouseRepository([warehouseFixture("wh-1"), warehouseFixture("wh-2")]);

  it("is valid when one of two active locations holds enough (it was always invalid before)", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      fakeInventoryController({ "wh-1/product-1": 0, "wh-2/product-1": 6 }),
      twoLocations(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 5, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
  });

  it("is invalid when no single location covers the quantity, and names the product", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      fakeInventoryController({ "wh-1/product-1": 0, "wh-2/product-1": 6 }),
      twoLocations(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 7, 100, "USD")], "t");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-1");
  });

  it("ignores an inactive location even when it holds the stock", async () => {
    const inventory = fakeInventoryController({ "wh-1/product-1": 2, "wh-2/product-1": 10 });
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      inventory,
      new FakeWarehouseRepository([warehouseFixture("wh-1"), warehouseFixture("wh-2", false)]),
    );

    const result = await adapter.validate([checkoutItem("product-1", 5, 100, "USD")], "t");

    expect(result.valid).toBe(false);
    expect(inventory.warehousesAsked).toEqual(["wh-1"]);
  });

  it("asks the named variant's stock at each active location only", async () => {
    const inventory = fakeInventoryController({ "product-1:v-m": 5 });
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
      inventory,
      new FakeWarehouseRepository([
        warehouseFixture("wh-1"),
        warehouseFixture("wh-2", false),
        warehouseFixture("wh-3"),
      ]),
    );

    await adapter.validate([checkoutItem("product-1", 1, 100, "USD", "v-m")], "t");

    expect(inventory.calls).toEqual([
      { productId: "product-1", variantId: "v-m" },
      { productId: "product-1", variantId: "v-m" },
    ]);
    expect(inventory.warehousesAsked).toEqual(["wh-1", "wh-3"]);
  });

  it("an untracked line is valid with zero active locations", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-1", tracksInventory: false }] }),
      fakeInventoryController({}),
      new FakeWarehouseRepository([]),
    );

    const result = await adapter.validate([checkoutItem("product-1", 9, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
  });

  it("a location with no stock record counts as zero, not as a failure of the others", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts("single-default-variant"),
      fakeInventoryController({ "wh-2/product-1": 4 }),
      twoLocations(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 3, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
  });
});

describe("InventoryValidationAdapter — the variant's own stock (Plan 2B-1)", () => {
  const warehouses = () => new FakeWarehouseRepository([warehouseFixture("wh-1")]);

  it("a stock-limited variant is valid within its stock and invalid beyond it, naming the product", async () => {
    const products = fakeProducts({ "product-1": [{ id: "v-1" }] });
    const adapter = new InventoryValidationAdapter(
      products,
      fakeInventoryController({ "product-1": 3 }),
      warehouses(),
    );

    expect(await adapter.validate([checkoutItem("product-1", 2, 100, "USD")], "t")).toEqual({
      valid: true,
    });
    const over = await adapter.validate([checkoutItem("product-1", 4, 100, "USD")], "t");
    expect(over.valid).toBe(false);
    expect(over.reason).toContain("product-1");
  });

  it("an untracked variant is valid with no stock row at all, and Inventory is not asked", async () => {
    const inventory = fakeInventoryController({});
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-1", tracksInventory: false }] }),
      inventory,
      warehouses(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 9, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
    expect(inventory.calls).toEqual([]);
  });

  it("a continue-selling variant is valid at zero stock", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-1", inventoryPolicy: "continue" }] }),
      fakeInventoryController({ "product-1": 0 }),
      warehouses(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 5, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
  });

  it("checks the named variant's stock, not another variant's", async () => {
    const inventory = fakeInventoryController({ "product-1:v-m": 5, "product-1:v-l": 0 });
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
      inventory,
      warehouses(),
    );

    const m = await adapter.validate([checkoutItem("product-1", 3, 100, "USD", "v-m")], "t");
    const l = await adapter.validate([checkoutItem("product-1", 1, 100, "USD", "v-l")], "t");

    expect(m).toEqual({ valid: true });
    expect(l.valid).toBe(false);
    expect(inventory.calls).toEqual([
      { productId: "product-1", variantId: "v-m" },
      { productId: "product-1", variantId: "v-l" },
    ]);
  });

  it("a legacy line with no variant on a single-variant product is checked against that variant", async () => {
    const inventory = fakeInventoryController({ "product-1": 4 });
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-only" }] }),
      inventory,
      warehouses(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 2, 100, "USD")], "t");

    expect(result).toEqual({ valid: true });
    expect(inventory.calls).toEqual([{ productId: "product-1", variantId: "v-only" }]);
  });

  it("invalid when the product cannot be loaded — never assumes stock", async () => {
    const inventory = fakeInventoryController({ "product-1": 100 });
    const adapter = new InventoryValidationAdapter(fakeProducts({}), inventory, warehouses());

    const result = await adapter.validate([checkoutItem("product-1", 1, 100, "USD")], "t");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-1");
    expect(inventory.calls).toEqual([]);
  });

  it("invalid when a several-variant product's line names no variant — never guesses", async () => {
    const adapter = new InventoryValidationAdapter(
      fakeProducts({ "product-1": [{ id: "v-m" }, { id: "v-l" }] }),
      fakeInventoryController({ "product-1": 100 }),
      warehouses(),
    );

    const result = await adapter.validate([checkoutItem("product-1", 1, 100, "USD")], "t");

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("product-1");
  });
});
