import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";

export interface InMemoryExperimentRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ExperimentRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryExperimentRepository implements ExperimentRepository {
  private readonly store = new Map<string, Experiment>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryExperimentRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(experiment: Experiment, tx?: unknown): Promise<void> {
    this.store.set(experiment.id.toString(), experiment);
    await this.outbox.write(experiment.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Experiment | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string, _tenantId: string): Promise<Experiment | null> {
    for (const experiment of this.store.values()) {
      if (experiment.name === name) return experiment;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Experiment>> {
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
