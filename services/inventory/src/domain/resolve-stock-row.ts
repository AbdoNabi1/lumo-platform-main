import type { InventoryItem } from "./inventory-item";

/** The Plan 2B-1 lookup rule over one product's rows at one warehouse. */
export function resolveStockRow(
  rows: readonly InventoryItem[],
  variantId: string | undefined,
): InventoryItem | null {
  if (variantId !== undefined) {
    const exact = rows.find((row) => row.variantRef === variantId);
    if (exact !== undefined) return exact;
    const [only] = rows;
    return rows.length === 1 && only !== undefined && only.variantRef === null ? only : null;
  }
  const [only] = rows;
  return rows.length === 1 && only !== undefined ? only : null;
}
