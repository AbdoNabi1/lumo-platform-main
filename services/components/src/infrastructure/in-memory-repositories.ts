import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { ComponentDefinition } from "../domain/component-definition";
import type { ComponentDefinitionRepository } from "../domain/repositories";

export interface InMemoryComponentsRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ComponentDefinitionRepository`. Persists the aggregate and writes events to the
 * outbox on save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, definitionId)` —
 * `ComponentDefinition` carries no `tenantId` of its own, so the store must key on it explicitly
 * or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryComponentDefinitionRepository implements ComponentDefinitionRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly definition: ComponentDefinition }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryComponentsRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(definition: ComponentDefinition, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(definition.id.toString(), { tenantId, definition });
    await this.outbox.write(definition.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<ComponentDefinition | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.definition : null;
  }

  async findByKey(key: string, tenantId: string): Promise<ComponentDefinition | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.definition.key === key) return entry.definition;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<ComponentDefinition>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.definition)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
