import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";

export interface InMemoryFeatureFlagRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `FeatureFlagRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly store = new Map<string, FeatureFlag>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryFeatureFlagRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(flag: FeatureFlag, tx?: unknown): Promise<void> {
    this.store.set(flag.id.toString(), flag);
    await this.outbox.write(flag.pullDomainEvents(), this.context, tx);
  }

  /** ADR-0014: `tenantId` accepted for signature parity; this fake has no tenant partitioning. */
  async findById(id: string, _tenantId: string): Promise<FeatureFlag | null> {
    return this.store.get(id) ?? null;
  }

  async findByKey(key: string, _tenantId: string): Promise<FeatureFlag | null> {
    for (const flag of this.store.values()) {
      if (flag.key === key) return flag;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, _tenantId: string): Promise<Paginated<FeatureFlag>> {
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
