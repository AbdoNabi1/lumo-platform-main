export interface StockLevelDto {
  readonly onHand: number;
  readonly reserved: number;
  readonly available: number;
}

export type StockChange =
  | { readonly kind: "none" }
  | { readonly kind: "receive"; readonly quantity: number }
  | { readonly kind: "adjust"; readonly onHand: number }
  | { readonly kind: "invalid" };

/** The merchant types AVAILABLE (Shopify); on-hand keeps the reserved units on top of it. */
export function stockChange(desiredAvailable: number, current: StockLevelDto | null): StockChange {
  if (!Number.isInteger(desiredAvailable) || desiredAvailable < 0) return { kind: "invalid" };
  if (current === null) {
    return desiredAvailable === 0
      ? { kind: "none" }
      : { kind: "receive", quantity: desiredAvailable };
  }
  if (desiredAvailable === current.available) return { kind: "none" };
  return { kind: "adjust", onHand: desiredAvailable + current.reserved };
}

/** One location's stock rows → by variant id, with the Plan 2B-1 legacy-row rule. */
export function stockByVariant(
  rows: readonly ({ readonly variantId: string | null } & StockLevelDto)[],
  variants: readonly { readonly id: string }[],
): Record<string, StockLevelDto> {
  const result: Record<string, StockLevelDto> = {};
  for (const row of rows) {
    if (row.variantId !== null) {
      result[row.variantId] = {
        onHand: row.onHand,
        reserved: row.reserved,
        available: row.available,
      };
    }
  }
  const [only] = variants;
  const [lone] = rows;
  if (
    variants.length === 1 &&
    only !== undefined &&
    rows.length === 1 &&
    lone?.variantId === null
  ) {
    result[only.id] = { onHand: lone.onHand, reserved: lone.reserved, available: lone.available };
  }
  return result;
}
