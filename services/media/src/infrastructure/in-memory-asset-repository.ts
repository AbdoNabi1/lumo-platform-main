import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { Asset } from "../domain/asset";
import type { AssetRepository } from "../domain/asset-repository";

export interface InMemoryAssetRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `AssetRepository`. Persists the aggregate and writes its events to the outbox on save. */
export class InMemoryAssetRepository implements AssetRepository {
  private readonly store = new Map<string, Asset>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAssetRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(asset: Asset, tx?: unknown): Promise<void> {
    this.store.set(asset.id.toString(), asset);
    await this.outbox.write(asset.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string): Promise<Asset | null> {
    return this.store.get(id) ?? null;
  }
}
