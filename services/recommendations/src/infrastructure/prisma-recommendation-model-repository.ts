import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { RecommendationModel } from "../domain/recommendation-model";
import type { RecommendationModelRepository } from "../domain/recommendation-model-repository";
import {
  RecommendationModelMapper,
  type RecommendationModelRow,
} from "./recommendation-model.mapper";

export interface PrismaRecommendationModelRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `RecommendationModelRepository` on the `recommendations` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaRecommendationModelRepository implements RecommendationModelRepository {
  private readonly deps: PrismaRecommendationModelRepositoryDeps;

  constructor(deps: PrismaRecommendationModelRepositoryDeps) {
    this.deps = deps;
  }

  async save(model: RecommendationModel, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const modelId = model.id.toString();
    const row = RecommendationModelMapper.toRow(model, tenantId);

    // `sets` is an array of closed object shapes without an index signature, so it has no
    // structural overlap with `InputJsonValue`'s `InputJsonObject` (comparability fails).
    if (model.version === 0) {
      await client.recommendationModel.create({
        data: { ...row, sets: row.sets as unknown as Prisma.InputJsonValue },
      });
    } else {
      const updated = await client.recommendationModel.updateMany({
        where: { id: modelId, tenantId, version: model.version },
        data: {
          status: row.status,
          sets: row.sets as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Recommendation model ${modelId} was modified concurrently (expected version ${model.version})`,
        );
      }
    }

    await this.deps.outbox.write(model.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<RecommendationModel | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.recommendationModel.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return RecommendationModelMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<RecommendationModel | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.recommendationModel.findFirst({
      where: { name, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return RecommendationModelMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<RecommendationModel>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.recommendationModel.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => RecommendationModelMapper.toDomain(this.toMapperRow(row))),
      limit,
      (m) => m.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly strategy: string;
    readonly status: string;
    readonly sets: unknown;
    readonly version: number;
  }): RecommendationModelRow {
    return { ...row, sets: row.sets as RecommendationModelRow["sets"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaRecommendationModelRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
