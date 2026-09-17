import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { ContentBlock } from "../domain/content-block";
import type { ContentBlockRepository } from "../domain/repositories";

export interface InMemoryContentRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `ContentBlockRepository`. Persists the aggregate and writes events to the outbox on
 * save. ADR-0014 (WP-10, T10.3): keyed by `(tenantId, blockId)` — `ContentBlock` carries no
 * `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak here would
 * be invisible to every isolation test.
 */
export class InMemoryContentBlockRepository implements ContentBlockRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly block: ContentBlock }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryContentRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(block: ContentBlock, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(block.id.toString(), { tenantId, block });
    await this.outbox.write(block.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<ContentBlock | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.block : null;
  }

  async findByName(name: string, tenantId: string): Promise<ContentBlock | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.block.name === name) return entry.block;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<ContentBlock>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.block)
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((block) => block.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (block) => block.id.toString());
  }
}
