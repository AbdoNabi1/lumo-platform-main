import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Asset } from "../domain/asset";
import type { AssetRepository } from "../domain/asset-repository";

export interface InMemoryAssetRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `AssetRepository`. Persists the aggregate and writes its events to the outbox on save.
 * ADR-0014 (WP-10, T10.3): keyed by `(tenantId, assetId)` — `Asset` carries no `tenantId` of its
 * own, so the store must key on it explicitly or a cross-tenant leak here would be invisible to
 * every isolation test.
 */
export class InMemoryAssetRepository implements AssetRepository {
  private readonly store = new Map<string, { readonly tenantId: string; readonly asset: Asset }>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAssetRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(asset: Asset, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(asset.id.toString(), { tenantId, asset });
    await this.outbox.write(asset.pullDomainEvents(), { ...this.context, tenantId }, tx);
  }

  async findById(id: string, tenantId: string): Promise<Asset | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.asset : null;
  }
}
