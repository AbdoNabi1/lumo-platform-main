import type { Database, TransactionClient } from "@platform/db";
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
  readonly tenantId: string;
}

/** Production `ContentBlockRepository` on the `content` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaContentBlockRepository implements ContentBlockRepository {
  private readonly deps: PrismaContentRepositoriesDeps;

  constructor(deps: PrismaContentRepositoriesDeps) {
    this.deps = deps;
  }

  async save(block: ContentBlock, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

  async findById(id: string, tx?: unknown): Promise<ContentBlock | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.contentBlock.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ContentBlockMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<ContentBlock | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.contentBlock.findFirst({
      where: { name, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ContentBlockMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<ContentBlock>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const limit = normalizePageSize(page.first);
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const rows = await client.contentBlock.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after !== undefined ? { id: { lt: after } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
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
