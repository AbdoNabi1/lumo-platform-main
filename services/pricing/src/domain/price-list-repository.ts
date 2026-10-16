import type { PriceList } from "./price-list";

/** Persistence port for {@link PriceList}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface PriceListRepository {
  save(priceList: PriceList, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<PriceList | null>;
}
