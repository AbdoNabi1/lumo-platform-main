import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { FeatureFlag } from "../domain/feature-flag";
import type { FeatureFlagRepository } from "../domain/feature-flag-repository";
import { FeatureFlagMapper, type FeatureFlagRow } from "./feature-flag.mapper";

export interface PrismaFeatureFlagRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Production `FeatureFlagRepository` on the `feature_flags` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  private readonly deps: PrismaFeatureFlagRepositoryDeps;

  constructor(deps: PrismaFeatureFlagRepositoryDeps) {
    this.deps = deps;
  }

  async save(flag: FeatureFlag, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const id = flag.id.toString();
    const row = FeatureFlagMapper.toRow(flag, tenantId);

    if (flag.version === 0) {
      await client.featureFlag.create({
        data: {
          ...row,
          environments: row.environments,
          rules: row.rules,
          changes: row.changes,
        },
      });
    } else {
      const updated = await client.featureFlag.updateMany({
        where: { id, tenantId, version: flag.version },
        data: {
          status: row.status,
          environments: row.environments,
          rules: row.rules,
          rolloutPercentage: row.rolloutPercentage,
          changes: row.changes,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Feature flag ${id} was modified concurrently (expected version ${flag.version})`,
        );
      }
    }

    await this.deps.outbox.write(
      flag.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<FeatureFlag | null> {
    const run = (client: TransactionClient) =>
      client.featureFlag.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : FeatureFlagMapper.toDomain(this.toMapperRow(row));
  }

  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureFlag | null> {
    const run = (client: TransactionClient) =>
      client.featureFlag.findFirst({ where: { key, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : FeatureFlagMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<FeatureFlag>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.featureFlag.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => FeatureFlagMapper.toDomain(this.toMapperRow(row))),
      limit,
      (f) => f.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: string;
    readonly environments: unknown;
    readonly rules: unknown;
    readonly rolloutPercentage: number;
    readonly changes: unknown;
    readonly version: number;
  }): FeatureFlagRow {
    return {
      ...row,
      environments: row.environments as FeatureFlagRow["environments"],
      rules: row.rules as FeatureFlagRow["rules"],
      changes: row.changes as FeatureFlagRow["changes"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaFeatureFlagRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
