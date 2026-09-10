import type { CursorPage, Paginated } from "@platform/types";
import type { Page } from "./page";
import type { Template } from "./template";

/**
 * Persistence port for {@link Page}.
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByRoutePath`/`list` take `tenantId` as an explicit
 * per-call parameter, matching `services/catalog`'s first-converted-context shape. `save` is not
 * yet converted.
 */
export interface PageRepository {
  save(page: Page, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Page | null>;
  findByRoutePath(routePath: string, tenantId: string, tx?: unknown): Promise<Page | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Page>>;
}

/** Persistence port for {@link Template}. Same ADR-0014 shape as {@link PageRepository}. */
export interface TemplateRepository {
  save(template: Template, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Template | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Template | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Template>>;
}
