import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Product } from "../domain/product";
import type { ProductRepository } from "../domain/product-repository";

export interface InMemoryProductRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ProductRepository`. On save it persists the aggregate and writes its pulled domain
 * events to the outbox (the standard pattern; a Prisma adapter does this inside the DB transaction).
 *
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, productId)`, not just `productId` — `Product`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly product: Product }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryProductRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(product: Product, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(product.id.toString(), { tenantId, product });
    await this.outbox.write(product.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Product | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId && !entry.product.deleted
      ? entry.product
      : null;
  }

  async findBySlug(slug: string, tenantId: string): Promise<Product | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        !entry.product.deleted &&
        entry.product.slug.value === slug
      ) {
        return entry.product;
      }
    }
    return null;
  }

  async findBySku(sku: string, tenantId: string): Promise<Product | null> {
    for (const entry of this.store.values()) {
      if (
        entry.tenantId === tenantId &&
        !entry.product.deleted &&
        entry.product.sku.value === sku
      ) {
        return entry.product;
      }
    }
    return null;
  }

  async delete(product: Product, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(product, tenantId, tx);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Product>> {
    return this.paginate(
      [...this.store.values()]
        .filter((entry) => entry.tenantId === tenantId && !entry.product.deleted)
        .map((entry) => entry.product),
      page,
    );
  }

  async search(query: string, page: CursorPage, tenantId: string): Promise<Paginated<Product>> {
    const needle = query.toLowerCase();
    const rows = [...this.store.values()]
      .filter(
        (entry) =>
          entry.tenantId === tenantId &&
          !entry.product.deleted &&
          (entry.product.name.toLowerCase().includes(needle) ||
            entry.product.sku.value.toLowerCase().includes(needle) ||
            entry.product.slug.value.toLowerCase().includes(needle)),
      )
      .map((entry) => entry.product);
    return this.paginate(rows, page);
  }

  private paginate(rows: readonly Product[], page: CursorPage): Paginated<Product> {
    const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((p) => p.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (p) => p.id.toString());
  }
}
