import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";

export interface InMemoryExperimentRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ExperimentRepository`. Persists the aggregate and writes events to the outbox on
 * save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, experimentId)` — `Experiment` carries no
 * `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak here would
 * be invisible to every isolation test.
 */
export class InMemoryExperimentRepository implements ExperimentRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly experiment: Experiment }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryExperimentRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(experiment: Experiment, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(experiment.id.toString(), { tenantId, experiment });
    await this.outbox.write(experiment.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Experiment | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.experiment : null;
  }

  async findByName(name: string, tenantId: string): Promise<Experiment | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.experiment.name === name) return entry.experiment;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<Experiment>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.experiment)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
