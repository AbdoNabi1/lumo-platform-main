import type { EventContext, OutboxWriter } from "@platform/messaging";
import type { FeatureBundle } from "../domain/feature-bundle";
import type { FeatureDefinition } from "../domain/feature-definition";
import type { FeatureBundleRepository, FeatureDefinitionRepository } from "../domain/repositories";

export interface InMemoryFeatureRegistryRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `FeatureDefinitionRepository` (tests/dev). ADR-0014 (WP-10, T10.5): keyed by
 * `(tenantId, key)` — `FeatureDefinition` carries no `tenantId` of its own, so the store must key
 * on it explicitly or a cross-tenant leak here would be invisible to every isolation test.
 */
export class InMemoryFeatureDefinitionRepository implements FeatureDefinitionRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly feature: FeatureDefinition }
  >();
  constructor(private readonly deps: InMemoryFeatureRegistryRepositoryDeps) {}

  async save(feature: FeatureDefinition, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(feature.key, { tenantId, feature });
    await this.deps.outbox.write(feature.pullDomainEvents(), this.deps.context, tx);
  }

  async findByKey(key: string, tenantId: string): Promise<FeatureDefinition | null> {
    const entry = this.store.get(key);
    return entry !== undefined && entry.tenantId === tenantId ? entry.feature : null;
  }

  async list(
    tenantId: string,
    filter?: { readonly lifecycle?: string; readonly category?: string },
  ): Promise<readonly FeatureDefinition[]> {
    let all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.feature);
    if (filter?.lifecycle !== undefined) all = all.filter((f) => f.lifecycle === filter.lifecycle);
    if (filter?.category !== undefined)
      all = all.filter((f) => f.effectiveSpec().category === filter.category);
    return all;
  }
}

/**
 * In-memory `FeatureBundleRepository` (tests/dev). ADR-0014 (WP-10, T10.5): keyed by
 * `(tenantId, key)` for the same reason as {@link InMemoryFeatureDefinitionRepository}.
 */
export class InMemoryFeatureBundleRepository implements FeatureBundleRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly bundle: FeatureBundle }
  >();
  constructor(private readonly deps: InMemoryFeatureRegistryRepositoryDeps) {}

  async save(bundle: FeatureBundle, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(bundle.key, { tenantId, bundle });
    await this.deps.outbox.write(bundle.pullDomainEvents(), this.deps.context, tx);
  }

  async findByKey(key: string, tenantId: string): Promise<FeatureBundle | null> {
    const entry = this.store.get(key);
    return entry !== undefined && entry.tenantId === tenantId ? entry.bundle : null;
  }

  async list(tenantId: string): Promise<readonly FeatureBundle[]> {
    return [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.bundle);
  }
}
