import type { CursorPage, Paginated } from "@platform/types";
import type { Warehouse } from "./warehouse";

/** Persistence port for {@link Warehouse}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). ADR-0014 (WP-10, T10.3): `tenantId` is an explicit per-call parameter. */
export interface WarehouseRepository {
  save(warehouse: Warehouse, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Warehouse | null>;
  /** Looks up by the tenant-unique `code` — the registration natural key. */
  findByCode(code: string, tenantId: string, tx?: unknown): Promise<Warehouse | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Warehouse>>;
}
