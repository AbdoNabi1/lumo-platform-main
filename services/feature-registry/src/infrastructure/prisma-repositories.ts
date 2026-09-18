import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { FeatureBundle } from "../domain/feature-bundle";
import type { FeatureDefinition } from "../domain/feature-definition";
import type { FeatureBundleRepository, FeatureDefinitionRepository } from "../domain/repositories";
import { FeatureBundleMapper, FeatureDefinitionMapper } from "./mappers";

export interface PrismaFeatureRegistryRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

function requireTx(tx: unknown): TransactionClient {
  if (tx === undefined || tx === null)
    throw new Error(
      "Feature Registry repository.save requires the unit of work's transaction client (ADR-0003).",
    );
  return tx as TransactionClient;
}

/** Production `FeatureDefinitionRepository` on the `feature_registry` schema (optimistic locking + same-tx outbox). */
export class PrismaFeatureDefinitionRepository implements FeatureDefinitionRepository {
  constructor(private readonly deps: PrismaFeatureRegistryRepositoryDeps) {}

  async save(feature: FeatureDefinition, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = feature.id.toString();
    if (feature.version === 0)
      await client.featureDefinition.create({
        data: FeatureDefinitionMapper.toRow(feature, tenantId),
      });
    else {
      const updated = await client.featureDefinition.updateMany({
        where: { id, tenantId, version: feature.version },
        data: { ...FeatureDefinitionMapper.toUpdate(feature), version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(
          `FeatureDefinition ${id} was modified concurrently (expected version ${feature.version})`,
        );
    }
    await this.deps.outbox.write(
      feature.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureDefinition | null> {
    const run = (client: TransactionClient) =>
      client.featureDefinition.findFirst({ where: { tenantId, key } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : FeatureDefinitionMapper.toDomain(row);
  }

  async list(
    tenantId: string,
    filter?: { readonly lifecycle?: string; readonly category?: string },
    tx?: unknown,
  ): Promise<readonly FeatureDefinition[]> {
    const run = (client: TransactionClient) =>
      client.featureDefinition.findMany({
        where: {
          tenantId,
          ...(filter?.lifecycle !== undefined ? { lifecycle: filter.lifecycle } : {}),
          ...(filter?.category !== undefined ? { category: filter.category } : {}),
        },
        orderBy: { key: "asc" },
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return rows.map((row) => FeatureDefinitionMapper.toDomain(row));
  }
}

/** Production `FeatureBundleRepository` on the `feature_registry` schema (optimistic locking + same-tx outbox). */
export class PrismaFeatureBundleRepository implements FeatureBundleRepository {
  constructor(private readonly deps: PrismaFeatureRegistryRepositoryDeps) {}

  async save(bundle: FeatureBundle, tenantId: string, tx?: unknown): Promise<void> {
    const client = requireTx(tx);
    const id = bundle.id.toString();
    if (bundle.version === 0)
      await client.featureBundle.create({
        data: FeatureBundleMapper.toRow(bundle, tenantId),
      });
    else {
      const updated = await client.featureBundle.updateMany({
        where: { id, tenantId, version: bundle.version },
        data: { ...FeatureBundleMapper.toUpdate(bundle), version: { increment: 1 } },
      });
      if (updated.count === 0)
        throw new ConcurrencyError(
          `FeatureBundle ${id} was modified concurrently (expected version ${bundle.version})`,
        );
    }
    await this.deps.outbox.write(
      bundle.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  async findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureBundle | null> {
    const run = (client: TransactionClient) =>
      client.featureBundle.findFirst({ where: { tenantId, key } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : FeatureBundleMapper.toDomain(row);
  }

  async list(tenantId: string, tx?: unknown): Promise<readonly FeatureBundle[]> {
    const run = (client: TransactionClient) =>
      client.featureBundle.findMany({ where: { tenantId }, orderBy: { key: "asc" } });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return rows.map((row) => FeatureBundleMapper.toDomain(row));
  }
}
