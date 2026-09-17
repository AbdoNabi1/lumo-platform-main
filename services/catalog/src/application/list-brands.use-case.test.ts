import { describe, expect, it } from "vitest";
import type { Brand } from "../domain/brand";
import { ListBrands } from "./list-brands.use-case";

describe("ListBrands", () => {
  it("returns the paginated page the repository lists", async () => {
    const brand = { id: "brand-1" } as unknown as Brand;
    const page = { items: [brand], pageInfo: { hasNextPage: false, endCursor: null } };
    const brands = {
      save: async () => {},
      findById: async () => null,
      findBySlug: async () => null,
      delete: async () => {},
      list: async () => page,
    };
    const useCase = new ListBrands({ brands });
    const result = await useCase.execute({ tenantId: "tenant-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(page);
    }
  });
});
