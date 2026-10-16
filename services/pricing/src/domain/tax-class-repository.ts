import type { CursorPage, Paginated } from "@platform/types";
import type { TaxClass } from "./tax-class";

/** Persistence port for {@link TaxClass}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface TaxClassRepository {
  save(taxClass: TaxClass, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<TaxClass | null>;
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<TaxClass | null>;
  /** Persists a tax class already marked deleted (via `TaxClass.delete`) — same shape as `save` (Sprint 7.0). */
  delete(taxClass: TaxClass, tenantId: string, tx?: unknown): Promise<void>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<TaxClass>>;
}
