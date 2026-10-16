import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../domain/inventory-item";
import { ListInventoryByProduct } from "./list-inventory-by-product.use-case";

describe("ListInventoryByProduct", () => {
  it("delegates to the repository's findByProduct", async () => {
    const rows = [{ id: "item-1" }, { id: "item-2" }] as unknown as readonly InventoryItem[];
    let receivedProductId: string | undefined;
    const items = {
      save: async () => {},
      findById: async () => null,
      findByProductAndWarehouse: async () => null,
      findByReservationReference: async () => null,
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      findByProduct: async (productId: string) => {
        receivedProductId = productId;
        return rows;
      },
    };
    const useCase = new ListInventoryByProduct({ items });
    const result = await useCase.execute({ tenantId: "tenant-a", productId: "product-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(rows);
    }
    expect(receivedProductId).toBe("product-1");
  });

  it("returns an empty array when the product has no stock rows", async () => {
    const items = {
      save: async () => {},
      findById: async () => null,
      findByProductAndWarehouse: async () => null,
      findByReservationReference: async () => null,
      list: async () => ({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      findByProduct: async () => [],
    };
    const useCase = new ListInventoryByProduct({ items });
    const result = await useCase.execute({ tenantId: "tenant-a", productId: "no-such-product" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});
