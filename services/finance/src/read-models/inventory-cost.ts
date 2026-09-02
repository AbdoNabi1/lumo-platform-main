import type { CogsSnapshot } from "../domain/cogs-snapshot";

export interface InventoryCostReadModel {
  readonly productRef: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly effectiveAt: string;
}

export function projectInventoryCost(
  snapshot: CogsSnapshot,
  currency: string,
): InventoryCostReadModel {
  return {
    productRef: snapshot.productRef,
    currency,
    totalMinor: snapshot.totalMinor,
    effectiveAt: snapshot.effectiveAt.toISOString(),
  };
}
