import type { CursorPage, Paginated } from "@platform/types";
import type { Theme } from "./theme";

/** Persistence port for {@link Theme}. ADR-0014 (WP-10, T10.3): read methods take `tenantId` as an explicit per-call parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet converted. */
export interface ThemeRepository {
  save(theme: Theme, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Theme | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Theme | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Theme>>;
}
