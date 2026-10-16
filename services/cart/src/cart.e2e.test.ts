import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCart } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };
const TENANT = "tenant-a";

function wire() {
  return wireCart({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

async function newCartId(app: ReturnType<typeof wire>): Promise<string> {
  const created = await app.cart.create({
    tenantId: TENANT,
    customerRef: "customer-1",
    sessionRef: "session-1",
    currency: "USD",
  });
  expect(created.status).toBe(201);
  return (created.body as { cartId: string }).cartId;
}

describe("cart (end to end)", () => {
  it("creates a cart, adds lines, checks out, and publishes cart.checked_out via the outbox", async () => {
    const app = wire();
    const cartId = await newCartId(app);

    const added = await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-1",
      quantity: 2,
      unitPriceAmountMinor: 1500,
      currency: "USD",
    });
    expect(added.status).toBe(200);
    expect((added.body as { totalAmountMinor: number }).totalAmountMinor).toBe(3000);

    await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-2",
      quantity: 1,
      unitPriceAmountMinor: 500,
      currency: "USD",
    });

    const checkedOut = await app.cart.checkOut({ tenantId: TENANT, cartId });
    expect(checkedOut.status).toBe(200);
    expect((checkedOut.body as { totalAmountMinor: number }).totalAmountMinor).toBe(3500);

    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("cart.cart.checked_out");
  });

  it("rejects checking out an empty cart (409)", async () => {
    const app = wire();
    const cartId = await newCartId(app);
    const response = await app.cart.checkOut({ tenantId: TENANT, cartId });
    expect(response.status).toBe(409);
  });

  it("rejects adding an item in a currency different from the cart (409)", async () => {
    const app = wire();
    const cartId = await newCartId(app);
    const response = await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-1",
      quantity: 1,
      unitPriceAmountMinor: 1000,
      currency: "EUR",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 when operating on an unknown cart", async () => {
    const app = wire();
    const response = await app.cart.add({
      tenantId: TENANT,
      cartId: "missing",
      productId: "product-1",
      quantity: 1,
      unitPriceAmountMinor: 1000,
      currency: "USD",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid currency at creation (422)", async () => {
    const app = wire();
    const response = await app.cart.create({
      tenantId: TENANT,
      customerRef: "customer-1",
      sessionRef: "session-1",
      currency: "dollars",
    });
    expect(response.status).toBe(422);
  });

  it("abandons an active cart and publishes cart.abandoned", async () => {
    const app = wire();
    const cartId = await newCartId(app);
    await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-1",
      quantity: 1,
      unitPriceAmountMinor: 1000,
      currency: "USD",
    });

    expect((await app.cart.abandon({ tenantId: TENANT, cartId })).status).toBe(200);
    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("cart.cart.abandoned");
  });

  it("creates a guest cart and merges it into a customer cart on login", async () => {
    const app = wire();
    const guest = await app.cart.create({
      tenantId: TENANT,
      sessionRef: "session-guest",
      currency: "USD",
    });
    expect(guest.status).toBe(201);
    const guestCartId = (guest.body as { cartId: string }).cartId;
    await app.cart.add({
      tenantId: TENANT,
      cartId: guestCartId,
      productId: "product-1",
      quantity: 2,
      unitPriceAmountMinor: 1000,
      currency: "USD",
    });

    const customerCartId = await newCartId(app);
    await app.cart.add({
      tenantId: TENANT,
      cartId: customerCartId,
      productId: "product-2",
      quantity: 1,
      unitPriceAmountMinor: 500,
      currency: "USD",
    });

    const merged = await app.cart.merge({
      tenantId: TENANT,
      targetCartId: customerCartId,
      sourceCartId: guestCartId,
    });
    expect(merged.status).toBe(200);
    expect((merged.body as { totalAmountMinor: number }).totalAmountMinor).toBe(2500);
    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("cart.cart.merged");
  });

  it("replaces a variant on an existing line", async () => {
    const app = wire();
    const cartId = await newCartId(app);
    await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-1",
      quantity: 1,
      unitPriceAmountMinor: 1000,
      currency: "USD",
    });

    const replaced = await app.cart.replaceVariant({
      tenantId: TENANT,
      cartId,
      oldProductId: "product-1",
      newProductId: "product-1-large",
      quantity: 1,
      unitPriceAmountMinor: 1200,
      currency: "USD",
    });
    expect(replaced.status).toBe(200);
    expect((replaced.body as { totalAmountMinor: number }).totalAmountMinor).toBe(1200);
  });

  it("runs the full lifecycle: lock -> unlock -> save -> restore -> clear -> expire", async () => {
    const app = wire();
    const cartId = await newCartId(app);
    await app.cart.add({
      tenantId: TENANT,
      cartId,
      productId: "product-1",
      quantity: 1,
      unitPriceAmountMinor: 1000,
      currency: "USD",
    });

    expect((await app.cart.lock({ tenantId: TENANT, cartId })).status).toBe(200);
    expect((await app.cart.unlock({ tenantId: TENANT, cartId })).status).toBe(200);
    expect((await app.cart.saveForLater({ tenantId: TENANT, cartId })).status).toBe(200);
    expect((await app.cart.restore({ tenantId: TENANT, cartId })).status).toBe(200);
    expect((await app.cart.clear({ tenantId: TENANT, cartId })).status).toBe(200);

    const expired = await app.cart.expire({ tenantId: TENANT, cartId });
    expect(expired.status).toBe(200);
    expect((expired.body as { status: string }).status).toBe("expired");

    await app.drainOutbox();
    expect(app.deliveredEventTypes).toContain("cart.cart.locked");
    expect(app.deliveredEventTypes).toContain("cart.cart.saved");
    expect(app.deliveredEventTypes).toContain("cart.cart.expired");
  });
});
