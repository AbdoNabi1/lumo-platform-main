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

export class InMemoryPageRepository implements PageRepository {
  private readonly store = new Map<string, Page>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(page: Page, tx?: unknown): Promise<void> {
    this.store.set(page.id.toString(), page);
    await this.outbox.write(page.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Page | null> {
    return this.store.get(id) ?? null;
  }

  async findByRoutePath(routePath: string): Promise<Page | null> {
    for (const page of this.store.values()) {
      if (page.routePath.value === routePath) return page;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<Page>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly store = new Map<string, Template>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPagesRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(template: Template, tx?: unknown): Promise<void> {
    this.store.set(template.id.toString(), template);
    await this.outbox.write(template.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Template | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<Template | null> {
    for (const template of this.store.values()) {
      if (template.name === name) return template;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<Template>> {
    return paginate([...this.store.values()], page);
  }
}
