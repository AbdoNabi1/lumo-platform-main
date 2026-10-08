import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin, type WiredAdmin } from "../composition";
import { cartRoutes } from "./cart-routes";
import { publicCartRoutes, type PublicCartDto } from "./public-cart-routes";
import {
  controllerDriver,
  seedCatalogProduct,
  seedSingleVariantProduct,
  type SeededProduct,
} from "./testing/seed-catalog";

/**
 * Plan 2A — the variant is what is sold. Drives the REAL `wireAdmin()` composition (in-memory
 * branch) through `RouteDefinition.handle()` for the guest cart routes and the staff cart routes:
 * two sizes of one product are two lines, each priced by its own variant, snapshotted with SKU,
 * product title and variant label; quantity and remove address one line by its variant; and the
 * price still never comes from the caller.
 */

const clock: Clock = { now: () => new Date("2026-10-08T00:00:00.000Z") };
const T = "tenant-local";
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: T };

function buildAdmin(): WiredAdmin {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireAdmin({ serializer: new InMemoryEventSerializer(), idGenerator, clock, tenantId: T });
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

function route(routes: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

function call(r: RouteDefinition, params: Record<string, string>, body: unknown): Promise<Reply> {
  return r.handle({
    body,
    params,
    query: {},
    context: { tenantId: T, principal: staff, requestId: "req-1" },
  } as never) as Promise<Reply>;
}

function unwrap<R>(reply: Reply, what: string): R {
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(`${what} failed (${reply.status}): ${JSON.stringify(reply.body)}`);
  }
  return reply.body as R;
}

interface World {
  readonly admin: WiredAdmin;
  readonly shirt: SeededProduct;
  readonly mug: SeededProduct;
  readonly s: string;
  readonly l: string;
}

async function world(): Promise<World> {
  const admin = buildAdmin();
  const driver = controllerDriver(admin.publicReads.products, T);
  // Product B: Size [S, L]; S = 10000, L = 12000.
  const shirt = await seedCatalogProduct(driver, {
    sku: "SHIRT",
    name: "Shirt",
    options: [{ name: "Size", values: ["S", "L"] }],
    variants: [
      { sku: "SHIRT-S", priceAmountMinor: 10000, selection: { Size: "S" } },
      { sku: "SHIRT-L", priceAmountMinor: 12000, selection: { Size: "L" } },
    ],
  });
  // Product A: a single variant.
  const mug = await seedSingleVariantProduct(driver, "MUG", 5000);
  const idOf = (sku: string): string => {
    const found = shirt.variants.find((v) => v.sku === sku);
    if (found === undefined) throw new Error(`variant ${sku} missing`);
    return found.id;
  };
  return { admin, shirt, mug, s: idOf("SHIRT-S"), l: idOf("SHIRT-L") };
}

function guest(admin: WiredAdmin) {
  const routes = publicCartRoutes(admin);
  const sessionRef = "session-1";
  return {
    sessionRef,
    open: async (): Promise<string> =>
      unwrap<PublicCartDto>(
        await call(route(routes, "POST", "/public/carts"), {}, { sessionRef, currency: "USD" }),
        "create cart",
      ).id,
    add: (cartId: string, body: object) =>
      call(
        route(routes, "POST", "/public/carts/:cartId/items"),
        { cartId },
        { sessionRef, ...body },
      ),
    quantity: (cartId: string, body: object) =>
      call(
        route(routes, "POST", "/public/carts/:cartId/items/quantity"),
        { cartId },
        { sessionRef, ...body },
      ),
    remove: (cartId: string, body: object) =>
      call(
        route(routes, "POST", "/public/carts/:cartId/items/remove"),
        { cartId },
        { sessionRef, ...body },
      ),
    addSchema: () => route(routes, "POST", "/public/carts/:cartId/items").schema?.body,
  };
}

describe("public cart — variants are what is sold (Plan 2A)", () => {
  it("two sizes of one product are two lines, each with its own price and snapshot", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    unwrap(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.s, quantity: 1 }),
      "add S",
    );
    const cart = unwrap<PublicCartDto>(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.l, quantity: 1 }),
      "add L",
    );

    expect(
      cart.items.map((i) => [i.variantId, i.sku, i.title, i.variantTitle, i.unitPriceAmountMinor]),
    ).toEqual([
      [w.s, "SHIRT-S", "Shirt", "S", 10000],
      [w.l, "SHIRT-L", "Shirt", "L", 12000],
    ]);
    expect(cart.subtotalAmountMinor).toBe(22000);
  });

  it("adding the same size twice increments its line instead of adding a second", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    unwrap(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.l, quantity: 1 }),
      "add",
    );
    const cart = unwrap<PublicCartDto>(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.l, quantity: 2 }),
      "add again",
    );

    expect(cart.items.map((i) => [i.variantId, i.quantity])).toEqual([[w.l, 3]]);
  });

  it("a multi-variant product without a variantId is 422 VARIANT_REQUIRED", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    const reply = await g.add(cartId, { productId: w.shirt.productId, quantity: 1 });

    expect(reply.status).toBe(422);
    expect((reply.body as { code: string }).code).toBe("VARIANT_REQUIRED");
  });

  it("a single-variant product works without a variantId and snapshots the variant", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    const cart = unwrap<PublicCartDto>(
      await g.add(cartId, { productId: w.mug.productId, quantity: 1 }),
      "add mug",
    );

    expect(cart.items[0]).toMatchObject({
      variantId: w.mug.variantId,
      sku: "MUG-STD",
      title: "Product MUG",
      variantTitle: null,
      unitPriceAmountMinor: 5000,
    });
  });

  it("quantity and remove address one line by its variant and leave the other size alone", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();
    unwrap(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.s, quantity: 1 }),
      "add S",
    );
    unwrap(
      await g.add(cartId, { productId: w.shirt.productId, variantId: w.l, quantity: 1 }),
      "add L",
    );

    const changed = unwrap<PublicCartDto>(
      await g.quantity(cartId, { productId: w.shirt.productId, variantId: w.l, quantity: 3 }),
      "change L",
    );
    expect(changed.items.map((i) => [i.variantId, i.quantity])).toEqual([
      [w.s, 1],
      [w.l, 3],
    ]);

    const removed = unwrap<PublicCartDto>(
      await g.remove(cartId, { productId: w.shirt.productId, variantId: w.s }),
      "remove S",
    );
    expect(removed.items.map((i) => [i.variantId, i.quantity])).toEqual([[w.l, 3]]);
  });

  it("an older client that names only the product still reaches its single line", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();
    unwrap(await g.add(cartId, { productId: w.mug.productId, quantity: 1 }), "add mug");

    const changed = unwrap<PublicCartDto>(
      await g.quantity(cartId, { productId: w.mug.productId, quantity: 4 }),
      "change by product only",
    );
    expect(changed.items[0]?.quantity).toBe(4);

    const removed = unwrap<PublicCartDto>(
      await g.remove(cartId, { productId: w.mug.productId }),
      "remove by product only",
    );
    expect(removed.items).toEqual([]);
  });

  it("a client-supplied price is rejected by the strict body schema and ignored by the handler", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    const schema = g.addSchema();
    expect(
      schema?.safeParse({
        sessionRef: g.sessionRef,
        productId: w.shirt.productId,
        variantId: w.s,
        quantity: 1,
        unitPriceAmountMinor: 1,
      }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({
        sessionRef: g.sessionRef,
        productId: w.shirt.productId,
        variantId: w.s,
        quantity: 1,
      }).success,
    ).toBe(true);

    // Even if a forged body reached the handler directly, the variant's price is used.
    const cart = unwrap<PublicCartDto>(
      await g.add(cartId, {
        productId: w.shirt.productId,
        variantId: w.s,
        quantity: 1,
        unitPriceAmountMinor: 1,
        currency: "USD",
      }),
      "add with forged price",
    );
    expect(cart.items[0]?.unitPriceAmountMinor).toBe(10000);
  });

  it("a variantId from another product is unavailable (422), never priced", async () => {
    const w = await world();
    const g = guest(w.admin);
    const cartId = await g.open();

    const reply = await g.add(cartId, { productId: w.mug.productId, variantId: w.l, quantity: 1 });

    expect(reply.status).toBe(422);
  });
});

describe("staff cart — variants are what is sold (Plan 2A)", () => {
  it("add prices and snapshots the chosen variant; replace swaps size by line key", async () => {
    const w = await world();
    const routes = cartRoutes(w.admin);
    const created = unwrap<{ cartId: string }>(
      await call(
        route(routes, "POST", "/carts"),
        {},
        { sessionRef: "staff-session", currency: "USD" },
      ),
      "create cart",
    );
    const params = { cartId: created.cartId };

    const added = unwrap<{ totalAmountMinor: number }>(
      await call(route(routes, "POST", "/carts/:cartId/items"), params, {
        productId: w.shirt.productId,
        variantId: w.s,
        quantity: 2,
      }),
      "staff add S",
    );
    expect(added.totalAmountMinor).toBe(20000);

    const replaced = unwrap<{ totalAmountMinor: number }>(
      await call(route(routes, "POST", "/carts/:cartId/items/replace"), params, {
        oldProductId: w.shirt.productId,
        oldVariantId: w.s,
        newProductId: w.shirt.productId,
        newVariantId: w.l,
        quantity: 2,
      }),
      "staff replace S -> L",
    );
    expect(replaced.totalAmountMinor).toBe(24000);

    const noVariant = await call(route(routes, "POST", "/carts/:cartId/items"), params, {
      productId: w.shirt.productId,
      quantity: 1,
    });
    expect(noVariant.status).toBe(422);
    expect((noVariant.body as { code: string }).code).toBe("VARIANT_REQUIRED");
  });
});
