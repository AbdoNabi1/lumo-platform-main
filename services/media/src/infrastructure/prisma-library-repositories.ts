import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Folder } from "../domain/folder";
import type { FolderRepository, MediaAssetRepository } from "../domain/library-repositories";
import type { MediaAsset } from "../domain/media-asset";
import { FolderMapper, MediaAssetMapper } from "./library-mappers";

export interface PrismaLibraryRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

export class PrismaFolderRepository implements FolderRepository {
  private readonly deps: PrismaLibraryRepositoriesDeps;

  constructor(deps: PrismaLibraryRepositoriesDeps) {
    this.deps = deps;
  }

  async save(folder: Folder, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = folder.id.toString();
    const row = FolderMapper.toRow(folder, tenantId);

    if (folder.version === 0) {
      await client.folder.create({ data: row });
    } else {
      const updated = await client.folder.updateMany({
        where: { id, tenantId, version: folder.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new ConcurrencyError(`Folder ${id} was modified concurrently`);
    }

    await this.deps.outbox.write(
      folder.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Folder | null> {
    const run = (client: TransactionClient) => client.folder.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : FolderMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Folder>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.folder.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => FolderMapper.toDomain(row)),
      limit,
      (f) => f.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaFolderRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

export class PrismaMediaAssetRepository implements MediaAssetRepository {
  private readonly deps: PrismaLibraryRepositoriesDeps;

  constructor(deps: PrismaLibraryRepositoriesDeps) {
    this.deps = deps;
  }

  async save(asset: MediaAsset, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = asset.id.toString();
    const row = MediaAssetMapper.toRow(asset, tenantId);

    if (asset.version === 0) {
      await client.mediaAsset.create({ data: row });
    } else {
      const updated = await client.mediaAsset.updateMany({
        where: { id, tenantId, version: asset.version },
        data: { status: row.status, version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(`MediaAsset ${id} was modified concurrently`);
    }

    await this.deps.outbox.write(
      asset.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<MediaAsset | null> {
    const run = (client: TransactionClient) =>
      client.mediaAsset.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : MediaAssetMapper.toDomain(row);
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<MediaAsset>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.mediaAsset.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => MediaAssetMapper.toDomain(row)),
      limit,
      (a) => a.id.toString(),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaMediaAssetRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
