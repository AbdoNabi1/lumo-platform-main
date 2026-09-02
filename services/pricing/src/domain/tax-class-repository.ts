import type { CursorPage, Paginated } from "@platform/types";
import type { TaxClass } from "./tax-class";

/** Persistence port for {@link TaxClass}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface TaxClassRepository {
  save(taxClass: TaxClass, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<TaxClass | null>;
  findByCode(code: string, tx?: unknown): Promise<TaxClass | null>;
  /** Persists a tax class already marked deleted (via `TaxClass.delete`) — same shape as `save` (Sprint 7.0). */
  delete(taxClass: TaxClass, tx?: unknown): Promise<void>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<TaxClass>>;
}
