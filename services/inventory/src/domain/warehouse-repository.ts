import type { CursorPage, Paginated } from "@platform/types";
import type { Warehouse } from "./warehouse";

/** Persistence port for {@link Warehouse}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface WarehouseRepository {
  save(warehouse: Warehouse, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Warehouse | null>;
  /** Looks up by the tenant-unique `code` — the registration natural key. */
  findByCode(code: string, tx?: unknown): Promise<Warehouse | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Warehouse>>;
}
