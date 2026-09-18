import { describe, expect, it } from "vitest";
import type { Price } from "../domain/price";
import { ListPrices } from "./list-prices.use-case";

describe("ListPrices", () => {
  it("delegates to the repository's list and returns a Paginated page", async () => {
    const rows = [{ id: "price-1" }, { id: "price-2" }] as unknown as readonly Price[];
    const prices = {
      save: async () => {},
      findById: async () => null,
      delete: async () => {},
      list: async () => ({ items: rows, pageInfo: { hasNextPage: true, endCursor: "price-2" } }),
      findPublishedByProduct: async () => [],
    };
    const useCase = new ListPrices({ prices });
    const result = await useCase.execute({ first: 2, tenantId: "tenant-a" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        items: rows,
        pageInfo: { hasNextPage: true, endCursor: "price-2" },
      });
    }
  });

  it("returns an empty page when there are no prices", async () => {
    const prices = {
      save: async () => {},
      findById: async () => null,
      delete: async () => {},
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      findPublishedByProduct: async () => [],
    };
    const useCase = new ListPrices({ prices });
    const result = await useCase.execute({ first: 2, tenantId: "tenant-a" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      });
    }
  });
});
