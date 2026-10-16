import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Brand } from "../domain/brand";
import type { BrandRepository } from "../domain/brand-repository";

export interface InMemoryBrandRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `BrandRepository` (Commerce Sprint 1). ADR-0014 (WP-10, T10.3): keyed by
 * `(tenantId, brandId)` — see `InMemoryProductRepository`'s doc comment for why.
 */
export class InMemoryBrandRepository implements BrandRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly brand: Brand }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryBrandRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(brand: Brand, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(brand.id.toString(), { tenantId, brand });
    await this.outbox.write(brand.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Brand | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId && !entry.brand.deleted
      ? entry.brand
      : null;
  }

  async findBySlug(slug: string, tenantId: string): Promise<Brand | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && !entry.brand.deleted && entry.brand.slug.value === slug) {
        return entry.brand;
      }
    }
    return null;
  }

  async delete(brand: Brand, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(brand, tenantId, tx);
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Brand>> {
    const sorted = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId && !entry.brand.deleted)
      .map((entry) => entry.brand)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((b) => b.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (b) => b.id.toString());
  }
}
