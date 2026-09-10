import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { SearchIndex } from "../domain/search-index";
import type { SearchIndexRepository } from "../domain/search-index-repository";
import { SearchIndexMapper, type SearchIndexRow } from "./search-index.mapper";

export interface PrismaSearchIndexRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `SearchIndexRepository` on the `search` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaSearchIndexRepository implements SearchIndexRepository {
  private readonly deps: PrismaSearchIndexRepositoryDeps;

  constructor(deps: PrismaSearchIndexRepositoryDeps) {
    this.deps = deps;
  }

  async save(index: SearchIndex, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const indexId = index.id.toString();
    const row = SearchIndexMapper.toRow(index, tenantId);

    if (index.version === 0) {
      await client.searchIndex.create({
        data: {
          ...row,
          // `SynonymEntry[]` has no index signature, so it doesn't structurally overlap with
          // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
          synonyms: row.synonyms as unknown as Prisma.InputJsonValue,
          facetFields: row.facetFields,
          sortableFields: row.sortableFields,
          suggestions: row.suggestions,
        },
      });
    } else {
      const updated = await client.searchIndex.updateMany({
        where: { id: indexId, tenantId, version: index.version },
        data: {
          status: row.status,
          // `SynonymEntry[]` has no index signature, so it doesn't structurally overlap with
          // `InputJsonValue`'s `InputJsonObject` (comparability fails, not just assignability).
          synonyms: row.synonyms as unknown as Prisma.InputJsonValue,
          suggestions: row.suggestions,
          documentCount: row.documentCount,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Search index ${indexId} was modified concurrently (expected version ${index.version})`,
        );
      }
    }

    await this.deps.outbox.write(index.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<SearchIndex | null> {
    const run = (client: TransactionClient) =>
      client.searchIndex.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SearchIndexMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tenantId: string, tx?: unknown): Promise<SearchIndex | null> {
    const run = (client: TransactionClient) =>
      client.searchIndex.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : SearchIndexMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<SearchIndex>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.searchIndex.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => SearchIndexMapper.toDomain(this.toMapperRow(row))),
      limit,
      (i) => i.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly synonyms: unknown;
    readonly facetFields: unknown;
    readonly sortableFields: unknown;
    readonly suggestions: unknown;
    readonly documentCount: number;
    readonly version: number;
  }): SearchIndexRow {
    return {
      ...row,
      synonyms: row.synonyms as SearchIndexRow["synonyms"],
      facetFields: row.facetFields as SearchIndexRow["facetFields"],
      sortableFields: row.sortableFields as SearchIndexRow["sortableFields"],
      suggestions: row.suggestions as SearchIndexRow["suggestions"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaSearchIndexRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
