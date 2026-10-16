/**
 * TEST-ONLY (Plan 2B-3). Never import this from production code.
 *
 * Completing a checkout now refuses a stock-limited line that no active location can cover, so every
 * suite that completes a checkout needs a real location holding real stock for its product. This is
 * the one place that knows how to put it there, next to `seed-catalog.ts` and with the same two
 * drivers: the raw admin Inventory facade (`controllerStockDriver`, for suites that hold a
 * `wireAdmin()` composition) or the staff HTTP API (`httpStockDriver`, for suites that only hold the
 * running pipeline). It drives the REAL inventory use cases — it never writes a repository row.
 *
 * The location is registered once per tenant (found again by its code on every later call), so
 * seeding several products, or the same product from several suites' helpers, shares one location.
 */

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

/** What `seedStock` needs from Inventory; implemented over the admin facade and over HTTP. */
export interface StockSeedDriver {
  /** The id of the tenant's location with this code, if one is registered. */
  findLocation(code: string): Promise<string | null>;
  registerLocation(code: string, name: string): Promise<Reply>;
  receive(input: {
    productId: string;
    variantId?: string;
    warehouseId: string;
    quantity: number;
  }): Promise<Reply>;
}

export interface SeedStockSpec {
  readonly productId: string;
  /** Omit for a product whose stock is recorded without a variant. */
  readonly variantId?: string;
  readonly quantity: number;
  /** Default `"SEED-MAIN"`. A different code gives a second location. */
  readonly locationCode?: string;
}

function ensure(reply: Reply, what: string): unknown {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(`seedStock: ${what} failed (${reply.status}): ${JSON.stringify(reply.body)}`);
  }
  return reply.body;
}

/** Makes sure the location exists, then receives `quantity` of the product/variant there. Returns the location id. */
export async function seedStock(driver: StockSeedDriver, spec: SeedStockSpec): Promise<string> {
  const code = spec.locationCode ?? "SEED-MAIN";
  let warehouseId = await driver.findLocation(code);
  if (warehouseId === null) {
    const registered = ensure(
      await driver.registerLocation(code, `Location ${code}`),
      "registerLocation",
    ) as { warehouseId: string };
    warehouseId = registered.warehouseId;
  }
  ensure(
    await driver.receive({
      productId: spec.productId,
      ...(spec.variantId === undefined ? {} : { variantId: spec.variantId }),
      warehouseId,
      quantity: spec.quantity,
    }),
    "receive",
  );
  return warehouseId;
}

/** Drives `wireAdmin().inventory` as `principal` (a staff principal allowed to register and receive). */
export function controllerStockDriver<P>(
  inventory: {
    listWarehouses(principal: P, input: { tenantId: string; first: number }): Promise<Reply>;
    registerWarehouse(
      principal: P,
      input: { tenantId: string; code: string; name: string },
    ): Promise<Reply>;
    receiveStock(
      principal: P,
      input: {
        tenantId: string;
        productId: string;
        variantId?: string;
        warehouseId: string;
        quantity: number;
      },
    ): Promise<Reply>;
  },
  principal: P,
  tenantId: string,
): StockSeedDriver {
  return {
    findLocation: async (code) => {
      const page = ensure(
        await inventory.listWarehouses(principal, { tenantId, first: 100 }),
        "listWarehouses",
      ) as { items: readonly { warehouseId: string; code: string }[] };
      return page.items.find((w) => w.code === code)?.warehouseId ?? null;
    },
    registerLocation: (code, name) =>
      inventory.registerWarehouse(principal, { tenantId, code, name }),
    receive: (input) => inventory.receiveStock(principal, { tenantId, ...input }),
  };
}

/** Drives the staff inventory routes of a running pipeline, as the tenant that owns the token the sender carries. */
export function httpStockDriver(
  send: (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
  ) => Promise<{
    statusCode: number;
    json: () => unknown;
  }>,
): StockSeedDriver {
  const reply = async (method: "GET" | "POST", url: string, payload?: unknown): Promise<Reply> => {
    const res = await send(method, url, payload);
    return { status: res.statusCode, body: res.json() };
  };
  return {
    findLocation: async (code) => {
      const page = ensure(await reply("GET", "/warehouses?first=100"), "listWarehouses") as {
        items: readonly { id: string; code: string }[];
      };
      return page.items.find((w) => w.code === code)?.id ?? null;
    },
    registerLocation: (code, name) => reply("POST", "/warehouses", { code, name }),
    receive: (input) => reply("POST", "/inventory/receive", input),
  };
}
