import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Price } from "../domain/price";
import type { PriceRepository } from "../domain/price-repository";

export interface InMemoryPriceRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `PriceRepository`. Persists the aggregate and writes its events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, priceId)` — `Price` carries no `tenantId`, so the
 * store keys on it explicitly or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryPriceRepository implements PriceRepository {
  private readonly store = new Map<string, Map<string, Price>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPriceRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  private forTenant(tenantId: string): Map<string, Price> {
    let bucket = this.store.get(tenantId);
    if (bucket === undefined) {
      bucket = new Map();
      this.store.set(tenantId, bucket);
    }
    return bucket;
  }

  async save(price: Price, tenantId: string, tx?: unknown): Promise<void> {
    this.forTenant(tenantId).set(price.id.toString(), price);
    await this.outbox.write(price.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Price | null> {
    const price = this.forTenant(tenantId).get(id) ?? null;
    return price !== null && price.deleted ? null : price;
  }

  async delete(price: Price, tenantId: string, tx?: unknown): Promise<void> {
    await this.save(price, tenantId, tx);
  }

  // Not `async` (unlike its siblings above) — a synchronous computation returned via
  // `Promise.resolve` satisfies the `Promise<...>` return type without tripping
  // `@typescript-eslint/require-await` (checked-in warning-count gate, `check-lint-warnings.mjs`).
  findPublishedByProduct(
    productRef: string,
    currency: string,
    tenantId: string,
  ): Promise<readonly Price[]> {
    return Promise.resolve(
      [...this.forTenant(tenantId).values()].filter(
        (price) =>
          !price.deleted &&
          price.status === "published" &&
          price.product.value === productRef &&
          price.amount.currency === currency,
      ),
    );
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Price>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.forTenant(tenantId).values()]
      .filter((p) => !p.deleted)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((p) => p.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (p) => p.id.toString());
  }
}
