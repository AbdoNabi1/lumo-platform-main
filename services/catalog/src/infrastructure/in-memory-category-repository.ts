import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Category } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";

export interface InMemoryCategoryRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `CategoryRepository`. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, categoryId)` — see
 * `InMemoryProductRepository`'s doc comment for why.
 */
export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly category: Category }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryCategoryRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(category: Category, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(category.id.toString(), { tenantId, category });
    await this.outbox.write(category.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Category | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId && !entry.category.deleted
      ? entry.category
      : null;
  }

  async findBySlug(slug: string, tenantId: string): Promise<Category | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        !entry.category.deleted &&
        entry.category.slug.value === slug
      ) {
        return entry.category;
      }
    }
    return null;
  }

  async delete(category: Category, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(category, tenantId, tx);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Category>> {
    const sorted = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId && !entry.category.deleted)
      .map((entry) => entry.category)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((c) => c.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (c) => c.id.toString());
  }

  async hasChildren(id: string, tenantId: string): Promise<boolean> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        !entry.category.deleted &&
        entry.category.parentId === id
      ) {
        return true;
      }
    }
    return false;
  }
}
