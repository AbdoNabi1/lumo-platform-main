import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Experience } from "../domain/experience";
import type { ExperienceRepository } from "../domain/repositories";

export interface InMemoryExperienceRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ExperienceRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryExperienceRepository implements ExperienceRepository {
  private readonly store = new Map<string, Experience>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryExperienceRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(experience: Experience, tx?: unknown): Promise<void> {
    this.store.set(experience.id.toString(), experience);
    await this.outbox.write(experience.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<Experience | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string, _tenantId: string): Promise<Experience | null> {
    for (const experience of this.store.values()) {
      if (experience.name === name) return experience;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, _tenantId: string): Promise<Paginated<Experience>> {
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
