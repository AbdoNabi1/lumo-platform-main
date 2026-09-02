import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";

export interface InMemoryRecommendationModelRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `RecommendationModelRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryRecommendationModelRepository implements RecommendationModelRepository {
  private readonly store = new Map<string, RecommendationModel>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryRecommendationModelRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(model: RecommendationModel, tx?: unknown): Promise<void> {
    this.store.set(model.id.toString(), model);
    await this.outbox.write(model.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<RecommendationModel | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<RecommendationModel | null> {
    for (const model of this.store.values()) {
      if (model.name === name) return model;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<RecommendationModel>> {
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
