import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

export interface InMemoryCategoryRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `CategoryRepository`. */
export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new Map<string, Category>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCategoryRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(category: Category, tx?: unknown): Promise<void> {
    this.store.set(category.id.toString(), category);
    await this.outbox.write(category.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Category | null> {
    const category = this.store.get(id);
    return category !== undefined && !category.deleted ? category : null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    for (const category of this.store.values()) {
      if (!category.deleted && category.slug.value === slug) return category;
    }
    return null;
  }

  async delete(category: Category, tx?: unknown): Promise<void> {
    await this.save(category, tx);
  }

  async list(page: CursorPage): Promise<Paginated<Category>> {
    const sorted = [...this.store.values()]
      .filter((c) => !c.deleted)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((c) => c.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (c) => c.id.toString());
  }

  async hasChildren(id: string): Promise<boolean> {
    for (const category of this.store.values()) {
      if (!category.deleted && category.parentId === id) return true;
    }
    return false;
  }
}
