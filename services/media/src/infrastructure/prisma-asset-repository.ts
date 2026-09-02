import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { ConcurrencyError } from "@platform/utils";
import type { Asset } from "../domain/asset";
import type { AssetRepository } from "../domain/asset-repository";
import { AssetMapper } from "./asset.mapper";

export interface PrismaAssetRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/**
 * Production `AssetRepository` on the `media` schema (metadata only — binaries live in object
 * storage). Optimistic locking + same-transaction outbox per ADR-0003.
 */
export class PrismaAssetRepository implements AssetRepository {
  private readonly deps: PrismaAssetRepositoryDeps;

  constructor(deps: PrismaAssetRepositoryDeps) {
    this.deps = deps;
  }

  async save(asset: Asset, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;

    if (asset.version === 0) {
      await client.asset.create({ data: AssetMapper.toRow(asset, tenantId) });
    } else {
      const updated = await client.asset.updateMany({
        where: { id: asset.id.toString(), tenantId, version: asset.version },
        data: { version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Asset ${asset.id.toString()} was modified concurrently (expected version ${asset.version})`,
        );
      }
    }

    await this.deps.outbox.write(asset.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Asset | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.asset.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : AssetMapper.toDomain(row);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaAssetRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
