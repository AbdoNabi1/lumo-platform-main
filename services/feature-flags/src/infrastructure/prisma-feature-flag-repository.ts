import type { Database, TransactionClient } from "@platform/db";
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
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `FeatureFlagRepository` on the `feature_flags` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  private readonly deps: PrismaFeatureFlagRepositoryDeps;

  constructor(deps: PrismaFeatureFlagRepositoryDeps) {
    this.deps = deps;
  }

  async save(flag: FeatureFlag, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
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

    await this.deps.outbox.write(flag.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<FeatureFlag | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.featureFlag.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return FeatureFlagMapper.toDomain(this.toMapperRow(row));
  }

  async findByKey(key: string, tx?: unknown): Promise<FeatureFlag | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.featureFlag.findFirst({
      where: { key, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return FeatureFlagMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<FeatureFlag>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.featureFlag.findMany({
      where: { tenantId: this.deps.tenantId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
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
