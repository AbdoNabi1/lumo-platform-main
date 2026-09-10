import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { FeatureBundle } from "../domain/feature-bundle";
import type { FeatureDefinition } from "../domain/feature-definition";
import type { FeatureBundleRepository, FeatureDefinitionRepository } from "../domain/repositories";

export interface InMemoryFeatureRegistryRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `FeatureDefinitionRepository` (tests/dev). */
export class InMemoryFeatureDefinitionRepository implements FeatureDefinitionRepository {
  private readonly store = new Map<string, FeatureDefinition>();
  constructor(private readonly deps: InMemoryFeatureRegistryRepositoryDeps) {}

  async save(feature: FeatureDefinition, tx?: unknown): Promise<void> {
    this.store.set(feature.key, feature);
    await this.deps.outbox.write(feature.pullDomainEvents(), this.deps.context, tx);
  }

  async findByKey(key: string, _tenantId: string): Promise<FeatureDefinition | null> {
    return this.store.get(key) ?? null;
  }

  async list(
    _tenantId: string,
    filter?: { readonly lifecycle?: string; readonly category?: string },
  ): Promise<readonly FeatureDefinition[]> {
    let all = [...this.store.values()];
    if (filter?.lifecycle !== undefined) all = all.filter((f) => f.lifecycle === filter.lifecycle);
    if (filter?.category !== undefined)
      all = all.filter((f) => f.effectiveSpec().category === filter.category);
    return all;
  }
}

/** In-memory `FeatureBundleRepository` (tests/dev). */
export class InMemoryFeatureBundleRepository implements FeatureBundleRepository {
  private readonly store = new Map<string, FeatureBundle>();
  constructor(private readonly deps: InMemoryFeatureRegistryRepositoryDeps) {}

  async save(bundle: FeatureBundle, tx?: unknown): Promise<void> {
    this.store.set(bundle.key, bundle);
    await this.deps.outbox.write(bundle.pullDomainEvents(), this.deps.context, tx);
  }

  async findByKey(key: string, _tenantId: string): Promise<FeatureBundle | null> {
    return this.store.get(key) ?? null;
  }

  async list(_tenantId: string): Promise<readonly FeatureBundle[]> {
    return [...this.store.values()];
  }
}
