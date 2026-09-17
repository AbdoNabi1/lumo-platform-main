import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Theme } from "../domain/theme";
import type { ThemeRepository } from "../domain/repositories";

export interface InMemoryThemeRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ThemeRepository`. Persists the aggregate and writes events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, themeId)` — `Theme` carries no `tenantId` of its
 * own, so the store must key on it explicitly or a cross-tenant leak here would be invisible to
 * every isolation test.
 */
export class InMemoryThemeRepository implements ThemeRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly theme: Theme }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryThemeRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(theme: Theme, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(theme.id.toString(), { tenantId, theme });
    await this.outbox.write(theme.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Theme | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.theme : null;
  }

  async findByName(name: string, tenantId: string): Promise<Theme | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.theme.name === name) return entry.theme;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage, tenantId: string): Promise<Paginated<Theme>> {
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.theme)
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const start = after === undefined ? 0 : all.findIndex((x) => x.id.toString() > after);
    const limit = normalizePageSize(page.first);
    const window = start < 0 ? [] : all.slice(start, start + limit + 1);
    return buildPaginatedPage(window, limit, (x) => x.id.toString());
  }
}
