import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { AddProductToCollection } from "./add-product-to-collection.use-case";
import { AddVariant } from "./add-variant.use-case";
import { AssignCategories } from "./assign-categories.use-case";
import { CreateBrand } from "./create-brand.use-case";
import { CreateCategory } from "./create-category.use-case";
import { CreateCollection } from "./create-collection.use-case";
import { CreateProduct } from "./create-product.use-case";
import { DeleteProduct } from "./delete-product.use-case";
import { ListProducts } from "./list-products.use-case";
import { MoveCategory } from "./move-category.use-case";
import { ReorderCollectionProducts } from "./reorder-collection-products.use-case";
import { SetProductBrand } from "./set-product-brand.use-case";
import { CatalogEventTranslator } from "../infrastructure/catalog-event-translator";
import { InMemoryBrandRepository } from "../infrastructure/in-memory-brand-repository";
import { InMemoryCategoryRepository } from "../infrastructure/in-memory-category-repository";
import { InMemoryCollectionRepository } from "../infrastructure/in-memory-collection-repository";
import { InMemoryProductRepository } from "../infrastructure/in-memory-product-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-10T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new CatalogEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "catalog",
  });
  const context = rootEventContext(sequentialIds());
  const products = new InMemoryProductRepository({ outbox, context });
  const categories = new InMemoryCategoryRepository({ outbox, context });
  const brands = new InMemoryBrandRepository({ outbox, context });
  const collections = new InMemoryCollectionRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { products, categories, brands, collections, unitOfWork, idGenerator, clock };
}

describe("Catalog application use-cases (Commerce Sprint 1, Sprint 4.2, Sprint 7.0)", () => {
  it("creates a product, a brand, and assigns the brand", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "SKU-1",
      name: "Wagon",
      slug: "wagon",
      variants: [{ sku: "SKU-1-V1", priceAmountMinor: 1999, currency: "USD" }],
      tenantId: "tenant-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const brand = await new CreateBrand(h).execute({
      name: "Acme",
      slug: "acme",
      tenantId: "tenant-1",
    });
    expect(brand.ok).toBe(true);
    if (!brand.ok) return;

    const assigned = await new SetProductBrand(h).execute({
      productId: created.value.id,
      brandId: brand.value.id,
      tenantId: "tenant-1",
    });
    expect(assigned.ok).toBe(true);
  });

  it("rejects setting an unknown brand (404)", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "SKU-2",
      name: "Blocks",
      slug: "blocks",
      variants: [{ sku: "SKU-2-V1", priceAmountMinor: 999, currency: "USD" }],
      tenantId: "tenant-1",
    });
    if (!created.ok) throw new Error("fixture failed");
    const result = await new SetProductBrand(h).execute({
      productId: created.value.id,
      brandId: "missing-brand",
      tenantId: "tenant-1",
    });
    expect(result.ok).toBe(false);
  });

  it("adds a variant to an existing product", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "SKU-3",
      name: "Puzzle",
      slug: "puzzle",
      variants: [{ sku: "SKU-3-V1", priceAmountMinor: 1500, currency: "USD" }],
      tenantId: "tenant-1",
    });
    if (!created.ok) throw new Error("fixture failed");
    const added = await new AddVariant(h).execute({
      productId: created.value.id,
      sku: "SKU-3-V2",
      priceAmountMinor: 1700,
      currency: "USD",
      tenantId: "tenant-1",
    });
    expect(added.ok).toBe(true);
  });

  it("assigns categories only when every category exists", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "SKU-4",
      name: "Ball",
      slug: "ball",
      variants: [{ sku: "SKU-4-V1", priceAmountMinor: 500, currency: "USD" }],
      tenantId: "tenant-1",
    });
    if (!created.ok) throw new Error("fixture failed");

    const missing = await new AssignCategories(h).execute({
      productId: created.value.id,
      categoryIds: ["missing-category"],
      tenantId: "tenant-1",
    });
    expect(missing.ok).toBe(false);

    const category = await new CreateCategory(h).execute({
      name: "Outdoor",
      slug: "outdoor",
      tenantId: "tenant-1",
    });
    if (!category.ok) throw new Error("fixture failed");
    const assigned = await new AssignCategories(h).execute({
      productId: created.value.id,
      categoryIds: [category.value.id],
      tenantId: "tenant-1",
    });
    expect(assigned.ok).toBe(true);
  });

  it("MoveCategory walks the real ancestor chain and rejects a transitive cycle", async () => {
    const h = harness();
    const root = await new CreateCategory(h).execute({
      name: "Root",
      slug: "root",
      tenantId: "tenant-1",
    });
    if (!root.ok) throw new Error("fixture failed");
    const child = await new CreateCategory(h).execute({
      name: "Child",
      slug: "child",
      parentId: root.value.id,
      tenantId: "tenant-1",
    });
    if (!child.ok) throw new Error("fixture failed");

    // Moving root under its own child must be rejected (root is its own transitive ancestor).
    const result = await new MoveCategory(h).execute({
      categoryId: root.value.id,
      newParentId: child.value.id,
      tenantId: "tenant-1",
    });
    expect(result.ok).toBe(false);
  });

  it("soft-deletes a product; it disappears from findById and list", async () => {
    const h = harness();
    const created = await new CreateProduct(h).execute({
      sku: "SKU-5",
      name: "Kite",
      slug: "kite",
      variants: [{ sku: "SKU-5-V1", priceAmountMinor: 800, currency: "USD" }],
      tenantId: "tenant-1",
    });
    if (!created.ok) throw new Error("fixture failed");

    const deleted = await new DeleteProduct(h).execute({
      productId: created.value.id,
      tenantId: "tenant-1",
    });
    expect(deleted.ok).toBe(true);

    const found = await h.products.findById(created.value.id, "tenant-1");
    expect(found).toBeNull();
    const listed = await new ListProducts(h).execute({ tenantId: "tenant-1" });
    expect(listed.ok).toBe(true);
    if (listed.ok)
      expect(listed.value.items.some((p) => p.id.toString() === created.value.id)).toBe(false);
  });

  it("searches products by case-insensitive substring", async () => {
    const h = harness();
    await new CreateProduct(h).execute({
      sku: "SKU-6",
      name: "Wooden Train Set",
      slug: "wooden-train-set",
      variants: [{ sku: "SKU-6-V1", priceAmountMinor: 2500, currency: "USD" }],
      tenantId: "tenant-1",
    });
    const result = await new ListProducts(h).execute({ query: "train", tenantId: "tenant-1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(1);
  });

  it("creates a collection, adds a product, and reorders (exact permutation only)", async () => {
    const h = harness();
    const p1 = await new CreateProduct(h).execute({
      sku: "SKU-7",
      name: "Doll",
      slug: "doll",
      variants: [{ sku: "SKU-7-V1", priceAmountMinor: 1200, currency: "USD" }],
      tenantId: "tenant-1",
    });
    const p2 = await new CreateProduct(h).execute({
      sku: "SKU-8",
      name: "Car",
      slug: "car",
      variants: [{ sku: "SKU-8-V1", priceAmountMinor: 1300, currency: "USD" }],
      tenantId: "tenant-1",
    });
    if (!p1.ok || !p2.ok) throw new Error("fixture failed");

    const collection = await new CreateCollection(h).execute({
      name: "New Arrivals",
      slug: "new-arrivals",
      tenantId: "tenant-1",
    });
    if (!collection.ok) throw new Error("fixture failed");

    await new AddProductToCollection(h).execute({
      collectionId: collection.value.id,
      productId: p1.value.id,
      tenantId: "tenant-1",
    });
    await new AddProductToCollection(h).execute({
      collectionId: collection.value.id,
      productId: p2.value.id,
      tenantId: "tenant-1",
    });

    const reordered = await new ReorderCollectionProducts(h).execute({
      collectionId: collection.value.id,
      productIds: [p2.value.id, p1.value.id],
      tenantId: "tenant-1",
    });
    expect(reordered.ok).toBe(true);

    const stored = await h.collections.findById(collection.value.id, "tenant-1");
    expect(stored?.productIds).toEqual([p2.value.id, p1.value.id]);
  });
});
