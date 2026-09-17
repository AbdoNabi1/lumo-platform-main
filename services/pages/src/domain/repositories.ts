import type { CursorPage, Paginated } from "@platform/types";
import type { Page } from "./page";
import type { Template } from "./template";

/**
 * Persistence port for {@link Page}.
 *
 * ADR-0014 (WP-10, T10.5): every method takes `tenantId` as an explicit per-call parameter.
 * `Page` carries no `tenantId` of its own, so `save` takes it as an explicit parameter (Option B)
 * rather than reading it off the aggregate.
 */
export interface PageRepository {
  save(page: Page, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Page | null>;
  findByRoutePath(routePath: string, tenantId: string, tx?: unknown): Promise<Page | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Page>>;
}

/** Persistence port for {@link Template}. Same ADR-0014 shape as {@link PageRepository}. */
export interface TemplateRepository {
  save(template: Template, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Template | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Template | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Template>>;
}
