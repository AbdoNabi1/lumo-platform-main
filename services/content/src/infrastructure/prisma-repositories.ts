import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { ContentBlock } from "../domain/content-block";
import type { ContentBlockRepository } from "../domain/repositories";
import { ContentBlockMapper, type ContentBlockRow } from "./mappers";

export interface PrismaContentRepositoriesDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `ContentBlockRepository` on the `content` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaContentBlockRepository implements ContentBlockRepository {
  private readonly deps: PrismaContentRepositoriesDeps;

  constructor(deps: PrismaContentRepositoriesDeps) {
    this.deps = deps;
  }

  async save(block: ContentBlock, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = block.id.toString();
    const row = ContentBlockMapper.toRow(block, tenantId);

    if (block.version === 0) {
      await client.contentBlock.create({
        data: { ...row, versions: row.versions },
      });
    } else {
      const updated = await client.contentBlock.updateMany({
        where: { id, tenantId, version: block.version },
        data: {
          content: row.content,
          status: row.status,
          scheduledAt: row.scheduledAt,
          versions: row.versions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Content block ${id} was modified concurrently (expected version ${block.version})`,
        );
      }
    }

    await this.deps.outbox.write(block.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<ContentBlock | null> {
    const run = (client: TransactionClient) =>
      client.contentBlock.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ContentBlockMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<ContentBlock | null> {
    const run = (client: TransactionClient) =>
      client.contentBlock.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : ContentBlockMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<ContentBlock>> {
    const limit = normalizePageSize(page.first);
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const run = (client: TransactionClient) =>
      client.contentBlock.findMany({
        where: { tenantId, ...(after !== undefined ? { id: { lt: after } } : {}) },
        orderBy: { id: "desc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    const blocks = rows.map((row) => ContentBlockMapper.toDomain(this.toMapperRow(row)));
    return buildPaginatedPage(blocks, limit, (block) => block.id.toString());
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly blockType: string;
    readonly format: string;
    readonly content: string;
    readonly locale: string | null;
    readonly status: string;
    readonly scheduledAt: Date | null;
    readonly versions: unknown;
    readonly version: number;
  }): ContentBlockRow {
    return {
      ...row,
      format: row.format as ContentBlockRow["format"],
      versions: row.versions as ContentBlockRow["versions"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaContentBlockRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
