import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";

export interface InMemoryFeatureFlagRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `FeatureFlagRepository`. Persists the aggregate and writes events to the outbox on
 * save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, flagId)` — `FeatureFlag` carries no
 * `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak here would
 * be invisible to every isolation test.
 */
export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly flag: FeatureFlag }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryFeatureFlagRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(flag: FeatureFlag, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(flag.id.toString(), { tenantId, flag });
    await this.outbox.write(flag.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<FeatureFlag | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.flag : null;
  }

  async findByKey(key: string, tenantId: string): Promise<FeatureFlag | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.flag.key === key) return entry.flag;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<FeatureFlag>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.flag)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
