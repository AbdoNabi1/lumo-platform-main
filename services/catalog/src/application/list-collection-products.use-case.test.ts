import { describe, expect, it } from "vitest";
import type { Collection } from "../domain/collection";
import type { CollectionRepository } from "../domain/collection-repository";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";
import { ListCollectionProducts } from "./list-collection-products.use-case";

function fakeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "collection-1",
    status: "published",
    productIds: [],
    ...overrides,
  } as unknown as Collection;
}

function fakeProduct(id: string, status = "published"): Product {
  return { id, status: { value: status } } as unknown as Product;
}

function stubCollections(overrides: Partial<CollectionRepository> = {}): CollectionRepository {
  return {
    save: async () => {},
    findById: async () => null,
    findBySlug: async () => null,
    delete: async () => {},
    list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    ...overrides,
  };
}

function stubProducts(byId: ReadonlyMap<string, Product>): ProductRepository {
  return {
    save: async () => {},
    findById: async (id: string) => byId.get(id) ?? null,
    findBySlug: async () => null,
    findBySku: async () => null,
    delete: async () => {},
    list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
  };
}

describe("ListCollectionProducts", () => {
  it("returns a NotFoundError when no collection has that slug", async () => {
    const useCase = new ListCollectionProducts({
      collections: stubCollections(),
      products: stubProducts(new Map()),
    });

    const result = await useCase.execute({ slug: "no-such-slug", tenantId: "tenant-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns a NotFoundError for an unpublished (draft) collection", async () => {
    const collection = fakeCollection({ status: "draft", productIds: ["p1"] });
    const useCase = new ListCollectionProducts({
      collections: stubCollections({
        findBySlug: async (slug) => (slug === "featured" ? collection : null),
      }),
      products: stubProducts(new Map([["p1", fakeProduct("p1")]])),
    });

    const result = await useCase.execute({ slug: "featured", tenantId: "tenant-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("resolves the collection's member products, preserving curated order", async () => {
    const collection = fakeCollection({ productIds: ["p3", "p1", "p2"] });
    const products = new Map([
      ["p1", fakeProduct("p1")],
      ["p2", fakeProduct("p2")],
      ["p3", fakeProduct("p3")],
    ]);
    const useCase = new ListCollectionProducts({
      collections: stubCollections({ findBySlug: async () => collection }),
      products: stubProducts(products),
    });

    const result = await useCase.execute({ slug: "featured", tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
    expect(result.value.pageInfo).toEqual({ hasNextPage: false, endCursor: "2" });
  });

  it("silently skips a stale id whose product no longer resolves", async () => {
    const collection = fakeCollection({ productIds: ["p1", "deleted-id", "p2"] });
    const products = new Map([
      ["p1", fakeProduct("p1")],
      ["p2", fakeProduct("p2")],
    ]);
    const useCase = new ListCollectionProducts({
      collections: stubCollections({ findBySlug: async () => collection }),
      products: stubProducts(products),
    });

    const result = await useCase.execute({ slug: "featured", tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((p) => p.id)).toEqual(["p1", "p2"]);
    // pageInfo describes the raw index slice, not the filtered result.
    expect(result.value.pageInfo.endCursor).toBe("2");
  });

  it("silently skips a member product that isn't published (never leaks a draft)", async () => {
    const collection = fakeCollection({ productIds: ["p1", "p2"] });
    const products = new Map([
      ["p1", fakeProduct("p1", "published")],
      ["p2", fakeProduct("p2", "draft")],
    ]);
    const useCase = new ListCollectionProducts({
      collections: stubCollections({ findBySlug: async () => collection }),
      products: stubProducts(products),
    });

    const result = await useCase.execute({ slug: "featured", tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((p) => p.id)).toEqual(["p1"]);
  });

  it("paginates by index — first page honors `first`, sets hasNextPage, and the cursor resumes the second page", async () => {
    const collection = fakeCollection({ productIds: ["p1", "p2", "p3"] });
    const products = new Map([
      ["p1", fakeProduct("p1")],
      ["p2", fakeProduct("p2")],
      ["p3", fakeProduct("p3")],
    ]);
    const useCase = new ListCollectionProducts({
      collections: stubCollections({ findBySlug: async () => collection }),
      products: stubProducts(products),
    });

    const firstPage = await useCase.execute({ slug: "featured", first: 2, tenantId: "tenant-1" });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.items.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(firstPage.value.pageInfo).toEqual({ hasNextPage: true, endCursor: "1" });

    const secondPage = await useCase.execute({
      slug: "featured",
      first: 2,
      after: firstPage.value.pageInfo.endCursor as string,
      tenantId: "tenant-1",
    });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;
    expect(secondPage.value.items.map((p) => p.id)).toEqual(["p3"]);
    expect(secondPage.value.pageInfo).toEqual({ hasNextPage: false, endCursor: "2" });
  });

  it("returns an empty page with hasNextPage false for a collection with no members", async () => {
    const collection = fakeCollection({ productIds: [] });
    const useCase = new ListCollectionProducts({
      collections: stubCollections({ findBySlug: async () => collection }),
      products: stubProducts(new Map()),
    });

    const result = await useCase.execute({ slug: "featured", tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
  });
});
