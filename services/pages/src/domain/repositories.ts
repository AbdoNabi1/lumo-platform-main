import type { CursorPage, Paginated } from "@platform/types";
import type { Page } from "./page";
import type { Template } from "./template";

/** Persistence port for {@link Page}. */
export interface PageRepository {
  save(page: Page, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Page | null>;
  findByRoutePath(routePath: string, tx?: unknown): Promise<Page | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Page>>;
}

/** Persistence port for {@link Template}. */
export interface TemplateRepository {
  save(template: Template, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Template | null>;
  findByName(name: string, tx?: unknown): Promise<Template | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Template>>;
}
