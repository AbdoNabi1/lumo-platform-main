import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Brand } from "../domain/brand";
import type { BrandRepository } from "../domain/brand-repository";

export interface InMemoryBrandRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `BrandRepository` (Commerce Sprint 1). */
export class InMemoryBrandRepository implements BrandRepository {
  private readonly store = new Map<string, Brand>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryBrandRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(brand: Brand, tx?: unknown): Promise<void> {
    this.store.set(brand.id.toString(), brand);
    await this.outbox.write(brand.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Brand | null> {
    const brand = this.store.get(id);
    return brand !== undefined && !brand.deleted ? brand : null;
  }

  async findBySlug(slug: string): Promise<Brand | null> {
    for (const brand of this.store.values()) {
      if (!brand.deleted && brand.slug.value === slug) return brand;
    }
    return null;
  }

  async delete(brand: Brand, tx?: unknown): Promise<void> {
    await this.save(brand, tx);
  }

  async list(page: CursorPage): Promise<Paginated<Brand>> {
    const sorted = [...this.store.values()]
      .filter((b) => !b.deleted)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : null;
    const filtered = after === null ? sorted : sorted.filter((b) => b.id.toString() > after);
    const limit = normalizePageSize(page.first);
    return buildPaginatedPage(filtered.slice(0, limit + 1), limit, (b) => b.id.toString());
  }
}
