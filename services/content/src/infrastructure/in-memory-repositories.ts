import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { ContentBlock } from "../domain/content-block";
import type { ContentBlockRepository } from "../domain/repositories";

export interface InMemoryContentRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `ContentBlockRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryContentBlockRepository implements ContentBlockRepository {
  private readonly store = new Map<string, ContentBlock>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryContentRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(block: ContentBlock, tx?: unknown): Promise<void> {
    this.store.set(block.id.toString(), block);
    await this.outbox.write(block.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<ContentBlock | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<ContentBlock | null> {
    for (const block of this.store.values()) {
      if (block.name === name) return block;
    }
    return null;
  }

  async list(page: CursorPage): Promise<Paginated<ContentBlock>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString() < b.id.toString() ? 1 : -1,
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((block) => block.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (block) => block.id.toString());
  }
}
