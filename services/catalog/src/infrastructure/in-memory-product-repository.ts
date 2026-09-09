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
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly store = new Map<string, Product>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryProductRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(product: Product, tx?: unknown): Promise<void> {
    this.store.set(product.id.toString(), product);
    await this.outbox.write(product.pullDomainEvents(), this.context, tx);
  }

  /**
   * ADR-0014: the port now takes `tenantId` per call, matching the real Prisma adapter. This
   * fake stores everything in one shared `Map` with no tenant partitioning — adequate for today's
   * single-tenant unit tests, but it cannot catch a cross-tenant leak. `tenantId` is accepted (for
   * signature parity, and to be ready for whoever writes T10.5's adversarial suite) but not yet
   * used to filter; note this rather than silently pretending isolation is tested here.
   */
  async findById(id: string, _tenantId: string): Promise<Product | null> {
    const product = this.store.get(id);
    return product !== undefined && !product.deleted ? product : null;
  }

  async findBySlug(slug: string): Promise<Product | null> {
    for (const product of this.store.values()) {
      if (!product.deleted && product.slug.value === slug) return product;
    }
    return null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    for (const product of this.store.values()) {
      if (!product.deleted && product.sku.value === sku) return product;
    }
    return null;
  }

  async delete(product: Product, tx?: unknown): Promise<void> {
    await this.save(product, tx);
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Product>> {
    return this.paginate(
      [...this.store.values()].filter((p) => !p.deleted),
      page,
    );
  }

  async search(query: string, page: CursorPage, _tenantId: string): Promise<Paginated<Product>> {
    const needle = query.toLowerCase();
    const rows = [...this.store.values()].filter(
      (p) =>
        !p.deleted &&
        (p.name.toLowerCase().includes(needle) ||
          p.sku.value.toLowerCase().includes(needle) ||
          p.slug.value.toLowerCase().includes(needle)),
    );
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
