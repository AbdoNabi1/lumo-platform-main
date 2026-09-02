import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Promotion } from "../domain/promotion";
import type { PromotionRepository } from "../domain/promotion-repository";

export interface InMemoryPromotionRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `PromotionRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryPromotionRepository implements PromotionRepository {
  private readonly store = new Map<string, Promotion>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryPromotionRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(promotion: Promotion, tx?: unknown): Promise<void> {
    this.store.set(promotion.id.toString(), promotion);
    await this.outbox.write(promotion.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Promotion | null> {
    return this.store.get(id) ?? null;
  }

  async findActive(): Promise<readonly Promotion[]> {
    return [...this.store.values()].filter((promotion) => promotion.status.value === "active");
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<Promotion>> {
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    );
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
