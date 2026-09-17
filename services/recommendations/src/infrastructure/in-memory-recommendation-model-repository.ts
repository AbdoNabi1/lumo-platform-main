import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";

export interface InMemoryRecommendationModelRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `RecommendationModelRepository`. Persists the aggregate and writes events to the
 * outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, modelId)` — `RecommendationModel`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryRecommendationModelRepository implements RecommendationModelRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly model: RecommendationModel }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryRecommendationModelRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(model: RecommendationModel, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(model.id.toString(), { tenantId, model });
    await this.outbox.write(model.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<RecommendationModel | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.model : null;
  }

  async findByName(name: string, tenantId: string): Promise<RecommendationModel | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.model.name === name) return entry.model;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<RecommendationModel>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.model)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
