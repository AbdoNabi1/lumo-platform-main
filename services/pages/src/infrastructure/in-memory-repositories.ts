import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Page } from "../domain/page";
import type { PageRepository, TemplateRepository } from "../domain/repositories";
import type { Template } from "../domain/template";

/** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
function paginate<T extends { readonly id: { toString(): string } }>(
  rows: readonly T[],
  page: CursorPage,
): Paginated<T> {
  const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}

export interface InMemoryPagesRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `PageRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, pageId)` — `Page`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryPageRepository implements PageRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly page: Page }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(page: Page, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(page.id.toString(), { tenantId, page });
    await this.outbox.write(page.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Page | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.page : null;
  }

  async findByRoutePath(routePath: string, tenantId: string): Promise<Page | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.page.routePath.value === routePath) {
        return entry.page;
      }
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Page>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.page);
    return paginate(rows, page);
  }
}

/**
 * In-memory `TemplateRepository`. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, templateId)` for
 * the same reason as {@link InMemoryPageRepository}.
 */
export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly template: Template }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(template: Template, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(template.id.toString(), { tenantId, template });
    await this.outbox.write(template.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Template | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.template : null;
  }

  async findByName(name: string, tenantId: string): Promise<Template | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.template.name === name) return entry.template;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Template>> {
    const rows = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.template);
    return paginate(rows, page);
  }
}
