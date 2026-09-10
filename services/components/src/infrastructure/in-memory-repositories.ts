import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { ComponentDefinition } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";

export interface InMemoryComponentsRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ComponentDefinitionRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryComponentDefinitionRepository implements ComponentDefinitionRepository {
  private readonly store = new Map<string, ComponentDefinition>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryComponentsRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(definition: ComponentDefinition, tx?: unknown): Promise<void> {
    this.store.set(definition.id.toString(), definition);
    await this.outbox.write(definition.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<ComponentDefinition | null> {
    return this.store.get(id) ?? null;
  }

  async findByKey(key: string, _tenantId: string): Promise<ComponentDefinition | null> {
    for (const definition of this.store.values()) {
      if (definition.key === key) return definition;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, _tenantId: string): Promise<Paginated<ComponentDefinition>> {
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
