import type { CursorPage, Paginated } from "@platform/types";
import type { Theme } from "./theme";

/** Persistence port for {@link Theme}. */
export interface ThemeRepository {
  save(theme: Theme, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Theme | null>;
  findByName(name: string, tx?: unknown): Promise<Theme | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Theme>>;
}
