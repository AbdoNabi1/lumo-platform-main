import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../domain/inventory-item";
import { ListInventoryItems } from "./list-inventory-items.use-case";

describe("ListInventoryItems", () => {
  it("delegates to the repository's list and returns a Paginated page", async () => {
    const rows = [{ id: "item-1" }, { id: "item-2" }] as unknown as readonly InventoryItem[];
    const items = {
      save: async () => {},
      findById: async () => null,
      findByProductAndWarehouse: async () => null,
      findByProduct: async () => [],
      findByReservationReference: async () => null,
      list: async () => ({ items: rows, pageInfo: { hasNextPage: true, endCursor: "item-2" } }),
    };
    const useCase = new ListInventoryItems({ items });
    const result = await useCase.execute({ first: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        items: rows,
        pageInfo: { hasNextPage: true, endCursor: "item-2" },
      });
    }
  });

  it("returns an empty page when there are no inventory items", async () => {
    const items = {
      save: async () => {},
      findById: async () => null,
      findByProductAndWarehouse: async () => null,
      findByProduct: async () => [],
      findByReservationReference: async () => null,
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    };
    const useCase = new ListInventoryItems({ items });
    const result = await useCase.execute({ first: 2 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
    }
  });
});
