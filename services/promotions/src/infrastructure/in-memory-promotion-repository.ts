import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";

/** ADR-0014 (WP-10, T10.3): per-tenant bucket, so every store is keyed by `(tenantId, id)`. */
function bucketFor<T>(store: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
  let bucket = store.get(tenantId);
  if (bucket === undefined) {
    bucket = new Map();
    store.set(tenantId, bucket);
  }
  return bucket;
}

export interface InMemoryPromotionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `PromotionRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryPromotionRepository implements PromotionRepository {
  private readonly store = new Map<string, Map<string, Promotion>>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPromotionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(promotion: Promotion, tenantId: string, tx?: unknown): Promise<void> {
    bucketFor(this.store, tenantId).set(promotion.id.toString(), promotion);
    await this.outbox.write(promotion.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Promotion | null> {
    return bucketFor(this.store, tenantId).get(id) ?? null;
  }

  async findActive(tenantId: string): Promise<readonly Promotion[]> {
    return [...bucketFor(this.store, tenantId).values()].filter(
      (promotion) => promotion.status.value === "active",
    );
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<Promotion>> {
    const all = [...bucketFor(this.store, tenantId).values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
