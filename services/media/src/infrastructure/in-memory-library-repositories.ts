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

export class InMemoryFolderRepository implements FolderRepository {
  private readonly store = new Map<string, Folder>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLibraryRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(folder: Folder, tx?: unknown): Promise<void> {
    this.store.set(folder.id.toString(), folder);
    await this.outbox.write(folder.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Folder | null> {
    return this.store.get(id) ?? null;
  }

  async list(page: CursorPage): Promise<Paginated<Folder>> {
    return paginate([...this.store.values()], page);
  }
}

export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  private readonly store = new Map<string, MediaAsset>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryLibraryRepositoriesDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(asset: MediaAsset, tx?: unknown): Promise<void> {
    this.store.set(asset.id.toString(), asset);
    await this.outbox.write(asset.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<MediaAsset | null> {
    return this.store.get(id) ?? null;
  }

  async list(page: CursorPage): Promise<Paginated<MediaAsset>> {
    return paginate([...this.store.values()], page);
  }
}
