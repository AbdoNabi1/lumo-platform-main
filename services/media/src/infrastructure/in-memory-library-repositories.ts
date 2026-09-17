import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { Folder } from "../domain/folder";
import type { FolderRepository, MediaAssetRepository } from "../domain/library-repositories";
import type { MediaAsset } from "../domain/media-asset";

/** Sorting by id is required: the cursor is the id, so unsorted iteration would skip rows. */
function paginate<T extends { readonly id: { toString(): string } }>(
  rows: readonly T[],
  page: CursorPage,
): Paginated<T> {
  const sorted = [...rows].sort((a, b) => a.id.toString().localeCompare(b.id.toString()));
  const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
  const start = after === undefined ? 0 : sorted.findIndex((x) => x.id.toString() > after);
  const limit = normalizePageSize(page.first);
  const window = start < 0 ? [] : sorted.slice(start, start + limit + 1);
  return buildPaginatedPage(window, limit, (x) => x.id.toString());
}

export interface InMemoryLibraryRepositoriesDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * ADR-0014 (WP-10, T10.3): both repositories below key their store by `(tenantId, id)` — neither
 * `Folder` nor `MediaAsset` carries `tenantId` of its own, so the store must key on it explicitly
 * or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryFolderRepository implements FolderRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly folder: Folder }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLibraryRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(folder: Folder, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(folder.id.toString(), { tenantId, folder });
    await this.outbox.write(folder.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<Folder | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.folder : null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<Folder>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.folder),
      page,
    );
  }
}

export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly asset: MediaAsset }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLibraryRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(asset: MediaAsset, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(asset.id.toString(), { tenantId, asset });
    await this.outbox.write(asset.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<MediaAsset | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.asset : null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<MediaAsset>> {
    return paginate(
      [...this.store.values()].filter((e) => e.tenantId === tenantId).map((e) => e.asset),
      page,
    );
  }
}
