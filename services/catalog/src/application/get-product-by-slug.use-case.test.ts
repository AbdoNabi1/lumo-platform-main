import { describe, expect, it } from "vitest";
import type { Product } from "../domain/product";
import { GetProductBySlug } from "./get-product-by-slug.use-case";

describe("GetProductBySlug", () => {
  it("returns the product the repository finds by slug", async () => {
    const product = { id: "product-1" } as unknown as Product;
    const products = {
      save: async () => {},
      findById: async () => null,
      findBySlug: async (slug: string) => (slug === "wooden-blocks" ? product : null),
      findBySku: async () => null,
      delete: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new GetProductBySlug({ products });
    const result = await useCase.execute({ slug: "wooden-blocks", tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(product);
    }
  });

  it("returns a NotFoundError when no product has that slug", async () => {
    const products = {
      save: async () => {},
      findById: async () => null,
      findBySlug: async () => null,
      findBySku: async () => null,
      delete: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      search: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new GetProductBySlug({ products });
    const result = await useCase.execute({ slug: "no-such-slug", tenantId: "tenant-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
