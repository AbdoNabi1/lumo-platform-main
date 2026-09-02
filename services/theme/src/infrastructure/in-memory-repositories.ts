import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Theme } from "../domain/theme";
import type { ThemeRepository } from "../domain/repositories";

export interface InMemoryThemeRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ThemeRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryThemeRepository implements ThemeRepository {
  private readonly store = new Map<string, Theme>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryThemeRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(theme: Theme, tx?: unknown): Promise<void> {
    this.store.set(theme.id.toString(), theme);
    await this.outbox.write(theme.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Theme | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<Theme | null> {
    for (const theme of this.store.values()) {
      if (theme.name === name) return theme;
    }
    return null;
  }

  /** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
  async list(page: CursorPage): Promise<Paginated<Theme>> {
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
