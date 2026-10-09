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

/** What the product page shows and lets the merchant edit about stock (Plan 2B-2, per location since 2B-3). */
export interface StockView {
  /** The active locations quantities can go to, in the order the API lists them. Empty until the first save registers one. */
  readonly locations: readonly { readonly id: string; readonly name: string }[];
  /** The location the variants table starts on: the one holding the most of this product, else the first. */
  readonly defaultLocationId: string | null;
  /** The stock read failed: show the quantities read-only, never as zeros that Save would write. */
  readonly readOnlyReason: "unavailable" | null;
  /** Location id → variant id → that variant's quantities there. */
  readonly byLocation: Readonly<Record<string, Readonly<Record<string, StockLevelDto>>>>;
}

interface LocationLike {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/** The stock locations quantities can go to: a deactivated warehouse is not one. */
export function activeLocations<T extends LocationLike>(warehouses: readonly T[]): T[] {
  return warehouses.filter((warehouse) => warehouse.status === "active");
}

/**
 * The product page's stock view from the tenant's warehouses and this product's stock rows: every
 * active location with its own quantities (the legacy-row rule applies per location). The default
 * location is the one holding the most of this product, else the first.
 */
export function buildStockView(
  warehouses: readonly LocationLike[],
  rows: readonly ({
    readonly warehouseId: string;
    readonly variantId: string | null;
  } & StockLevelDto)[],
  variants: readonly { readonly id: string }[],
): StockView {
  const locations = activeLocations(warehouses);
  const byLocation: Record<string, Readonly<Record<string, StockLevelDto>>> = {};
  let defaultLocationId: string | null = null;
  let best = -1;
  for (const location of locations) {
    const own = rows.filter((row) => row.warehouseId === location.id);
    byLocation[location.id] = stockByVariant(own, variants);
    const total = own.reduce((sum, row) => sum + row.available, 0);
    if (total > best) {
      best = total;
      defaultLocationId = location.id;
    }
  }
  return {
    locations: locations.map((location) => ({ id: location.id, name: location.name })),
    defaultLocationId,
    readOnlyReason: null,
    byLocation,
  };
}

/** The view when the stock could not be read: read-only, never zeros that Save would write. */
export const UNAVAILABLE_STOCK: StockView = {
  locations: [],
  defaultLocationId: null,
  readOnlyReason: "unavailable",
  byLocation: {},
};
