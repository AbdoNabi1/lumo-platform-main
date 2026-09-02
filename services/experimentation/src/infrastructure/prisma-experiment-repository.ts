import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { Experiment } from "../domain/experiment";
import type { ExperimentRepository } from "../domain/experiment-repository";
import { ExperimentMapper, type ExperimentRow } from "./experiment.mapper";

export interface PrismaExperimentRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `ExperimentRepository` on the `experiment` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaExperimentRepository implements ExperimentRepository {
  private readonly deps: PrismaExperimentRepositoryDeps;

  constructor(deps: PrismaExperimentRepositoryDeps) {
    this.deps = deps;
  }

  async save(experiment: Experiment, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = experiment.id.toString();
    const row = ExperimentMapper.toRow(experiment, tenantId);

    if (experiment.version === 0) {
      await client.experiment.create({
        data: {
          ...row,
          variants: row.variants,
          audienceSegmentRefs: row.audienceSegmentRefs as Prisma.InputJsonValue,
          results: row.results,
        },
      });
    } else {
      const updated = await client.experiment.updateMany({
        where: { id, tenantId, version: experiment.version },
        data: {
          status: row.status,
          results: row.results,
          winnerVariantKey: row.winnerVariantKey,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Experiment ${id} was modified concurrently (expected version ${experiment.version})`,
        );
      }
    }

    await this.deps.outbox.write(experiment.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Experiment | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.experiment.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return ExperimentMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<Experiment | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.experiment.findFirst({
      where: { name, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return ExperimentMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Experiment>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.experiment.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => ExperimentMapper.toDomain(this.toMapperRow(row))),
      limit,
      (e) => e.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly hypothesis: string | null;
    readonly variants: unknown;
    readonly audiencePercentage: number;
    readonly audienceSegmentRefs: unknown;
    readonly goalMetricRef: string;
    readonly featureFlagRef: string | null;
    readonly status: string;
    readonly results: unknown;
    readonly winnerVariantKey: string | null;
    readonly version: number;
  }): ExperimentRow {
    return {
      ...row,
      variants: row.variants as ExperimentRow["variants"],
      audienceSegmentRefs: row.audienceSegmentRefs as ExperimentRow["audienceSegmentRefs"],
      results: row.results as ExperimentRow["results"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaExperimentRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
