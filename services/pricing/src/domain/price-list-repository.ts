import type { PriceList } from "./price-list";

/** Persistence port for {@link PriceList}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface PriceListRepository {
  save(priceList: PriceList, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<PriceList | null>;
}
