import type { CursorPage, Paginated } from "@platform/types";
import type { ContentBlock } from "./content-block";

/** Persistence port for {@link ContentBlock}. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ContentBlockRepository {
  save(block: ContentBlock, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ContentBlock | null>;
  findByName(name: string, tx?: unknown): Promise<ContentBlock | null>;
  /** Cursor page, most recently created first (Phase A.30 admin Content screen). */
  list(page: CursorPage, tx?: unknown): Promise<Paginated<ContentBlock>>;
}
