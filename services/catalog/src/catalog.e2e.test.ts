import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCatalog } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-06-30T00:00:00.000Z") };

function wire() {
  return wireCatalog({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("catalog (end to end)", () => {
  it("creates and publishes a product, emitting product.created + product.published via the outbox", async () => {
    const app = wire();

    const created = await app.products.create({
      sku: "P-1",
      name: "Toy Wagon",
      slug: "toy-wagon",
      variants: [{ sku: "P-1-RED", priceAmountMinor: 1999, currency: "USD" }],
      tenantId: "tenant-1",
    });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };

    const published = await app.products.publish({ productId: id, tenantId: "tenant-1" });
    expect(published.status).toBe(200);

    const count = await app.drainOutbox();
    expect(count).toBe(2);
    expect(app.deliveredEventTypes).toEqual([
      "catalog.product.created",
      "catalog.product.published",
    ]);
  });

  it("rejects an invalid slug at the boundary (422)", async () => {
    const app = wire();
    const response = await app.products.create({
      sku: "P-2",
      name: "Bad",
      slug: "Bad Slug",
      variants: [{ sku: "P-2-A", priceAmountMinor: 100, currency: "USD" }],
      tenantId: "tenant-1",
    });
    expect(response.status).toBe(422);
  });

  it("returns 404 when publishing a missing product", async () => {
    const app = wire();
    const response = await app.products.publish({ productId: "missing", tenantId: "tenant-1" });
    expect(response.status).toBe(404);
  });

  it("creates a category", async () => {
    const app = wire();
    const response = await app.categories.create({
      name: "Outdoor",
      slug: "outdoor",
      tenantId: "tenant-1",
    });
    expect(response.status).toBe(201);
  });

  // -- Sprint 7.0: "2 new flows" (§8) -------------------------------------------------------------

  it("full collection flow: create -> add -> move (between collections) -> publish -> delete", async () => {
    const app = wire();

    const productA = await app.products.create({
      sku: "P-10",
      name: "Kite",
      slug: "kite",
      variants: [{ sku: "P-10-A", priceAmountMinor: 800, currency: "USD" }],
      tenantId: "tenant-1",
    });
    expect(productA.status).toBe(201);
    const { id: productId } = productA.body as { id: string };

    const from = await app.collections.create({
      name: "Summer",
      slug: "summer",
      tenantId: "tenant-1",
    });
    const to = await app.collections.create({ name: "Sale", slug: "sale", tenantId: "tenant-1" });
    expect(from.status).toBe(201);
    expect(to.status).toBe(201);
    const { id: fromId } = from.body as { id: string };
    const { id: toId } = to.body as { id: string };

    const added = await app.collections.addProduct({
      collectionId: fromId,
      productId,
      tenantId: "tenant-1",
    });
    expect(added.status).toBe(200);

    const moved = await app.collections.moveProductBetweenCollections({
      fromCollectionId: fromId,
      toCollectionId: toId,
      productId,
      tenantId: "tenant-1",
    });
    expect(moved.status).toBe(200);

    const published = await app.collections.publish({ collectionId: toId, tenantId: "tenant-1" });
    expect(published.status).toBe(200);

    const deleted = await app.collections.delete({ collectionId: fromId, tenantId: "tenant-1" });
    expect(deleted.status).toBe(200);
  });

  it("product soft-delete and category-with-children delete rejection", async () => {
    const app = wire();

    const product = await app.products.create({
      sku: "P-11",
      name: "Ball",
      slug: "ball",
      variants: [{ sku: "P-11-A", priceAmountMinor: 500, currency: "USD" }],
      tenantId: "tenant-1",
    });
    const { id: productId } = product.body as { id: string };
    const deletedProduct = await app.products.delete({ productId, tenantId: "tenant-1" });
    expect(deletedProduct.status).toBe(200);
    const missing = await app.products.get({ productId, tenantId: "tenant-1" });
    expect(missing.status).toBe(404);

    const parent = await app.categories.create({
      name: "Outdoor",
      slug: "outdoor-2",
      tenantId: "tenant-1",
    });
    const { id: parentId } = parent.body as { id: string };
    const child = await app.categories.create({
      name: "Sports",
      slug: "sports",
      parentId,
      tenantId: "tenant-1",
    });
    expect(child.status).toBe(201);

    const rejectedDelete = await app.categories.delete({
      categoryId: parentId,
      tenantId: "tenant-1",
    });
    expect(rejectedDelete.status).toBe(409);
  });
});
