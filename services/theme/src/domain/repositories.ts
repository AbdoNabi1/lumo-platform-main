import type { CursorPage, Paginated } from "@platform/types";
import type { Theme } from "./theme";

/** Persistence port for {@link Theme}. ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter, matching `services/catalog`'s shape. `Theme` carries no `tenantId` of its own, so `save` takes it as an explicit parameter (Option B) rather than reading it off the aggregate. */
export interface ThemeRepository {
  save(theme: Theme, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Theme | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Theme | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Theme>>;
}
