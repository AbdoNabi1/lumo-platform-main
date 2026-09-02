import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePricing } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wirePricing({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("pricing (end to end)", () => {
  it("creates + activates a price list, then creates + changes a price emitting price.changed", async () => {
    const app = wire();

    const list = await app.priceLists.create({ name: "Retail", currency: "USD" });
    expect(list.status).toBe(201);
    const listId = (list.body as { id: string }).id;
    expect((await app.priceLists.activate({ priceListId: listId })).status).toBe(200);

    const price = await app.prices.create({
      priceListId: listId,
      productId: "product-1",
      amountMinor: 1999,
      currency: "USD",
    });
    expect(price.status).toBe(201);
    const priceId = (price.body as { id: string }).id;

    const changed = await app.prices.change({ priceId, amountMinor: 1799, currency: "USD" });
    expect(changed.status).toBe(200);

    expect(await app.drainOutbox()).toBe(1);
    expect(app.deliveredEventTypes).toContain("pricing.price.changed");
  });

  it("rejects an invalid currency (422)", async () => {
    const app = wire();
    const response = await app.priceLists.create({ name: "Bad", currency: "dollars" });
    expect(response.status).toBe(422);
  });

  it("returns 404 when changing a missing price", async () => {
    const app = wire();
    const response = await app.prices.change({
      priceId: "missing",
      amountMinor: 100,
      currency: "USD",
    });
    expect(response.status).toBe(404);
  });

  it("creates a rich price (compare-at/cost/effective window/tax class) and publishes it", async () => {
    const app = wire();
    const list = await app.priceLists.create({ name: "Retail 2", currency: "USD" });
    const listId = (list.body as { id: string }).id;

    const taxClass = await app.registry.createTaxClass({ code: "STANDARD", name: "Standard rate" });
    expect(taxClass.status).toBe(201);
    const taxClassId = (taxClass.body as { id: string }).id;

    const price = await app.prices.create({
      priceListId: listId,
      productId: "product-rich",
      amountMinor: 2999,
      currency: "USD",
      compareAtMinor: 3999,
      costMinor: 1200,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      taxClassRef: taxClassId,
    });
    expect(price.status).toBe(201);
    const priceId = (price.body as { id: string }).id;

    const published = await app.prices.publish({ priceId });
    expect(published.status).toBe(200);
    expect((published.body as { status: string }).status).toBe("published");

    const doublePublish = await app.prices.publish({ priceId });
    expect(doublePublish.status).toBe(409);
  });

  it("rejects a duplicate tax class code (dedupe, 409)", async () => {
    const app = wire();
    await app.registry.createTaxClass({ code: "REDUCED", name: "Reduced rate" });
    const duplicate = await app.registry.createTaxClass({ code: "REDUCED", name: "Reduced (dup)" });
    expect(duplicate.status).toBe(409);
  });

  it("rejects an invalid tax class (empty code, 422)", async () => {
    const app = wire();
    const response = await app.registry.createTaxClass({ code: "", name: "Nameless" });
    expect(response.status).toBe(422);
  });

  it("creates a pricing rule and caps a percentage rule at 100 (422 above the cap)", async () => {
    const app = wire();
    const rule = await app.registry.createPricingRule({
      type: "percentage",
      value: 20,
      priority: 1,
    });
    expect(rule.status).toBe(201);

    const overCap = await app.registry.createPricingRule({
      type: "percentage",
      value: 150,
      priority: 1,
    });
    expect(overCap.status).toBe(422);
  });

  it("lists prices with cursor pagination", async () => {
    const app = wire();
    const list = await app.priceLists.create({ name: "Retail 3", currency: "USD" });
    const listId = (list.body as { id: string }).id;
    for (let i = 0; i < 3; i += 1) {
      await app.prices.create({
        priceListId: listId,
        productId: `product-list-${i}`,
        amountMinor: 1000,
        currency: "USD",
      });
    }

    const page = await app.prices.list({ first: 2 });
    expect(page.status).toBe(200);
    expect((page.body as { items: readonly unknown[] }).items).toHaveLength(2);
  });
});
