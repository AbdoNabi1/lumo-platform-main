import type { FeatureBundle } from "./feature-bundle";
import type { FeatureDefinition } from "./feature-definition";

/**
 * Persists feature definitions with their immutable version history. Tenant-scoped,
 * optimistic-locked, same-tx outbox.
 *
 * ADR-0014 (WP-10, T10.5): every method takes `tenantId` as an explicit per-call parameter.
 * `RegisterFeatureProps.tenantId` is used only at registration time to validate/build the
 * aggregate — `FeatureDefinition` itself carries no `tenantId` field, so `save` takes it as an
 * explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface FeatureDefinitionRepository {
  save(feature: FeatureDefinition, tenantId: string, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureDefinition | null>;
  /** Discovery — all definitions (optionally filtered by lifecycle/category); read model for the catalog. */
  list(
    tenantId: string,
    filter?: { readonly lifecycle?: string; readonly category?: string },
    tx?: unknown,
  ): Promise<readonly FeatureDefinition[]>;
}

/**
 * Persists feature bundles (commercial collections). Tenant-scoped, optimistic-locked, same-tx
 * outbox (P1.1.1 §2). Same ADR-0014 (WP-10, T10.5) shape as {@link FeatureDefinitionRepository} —
 * `FeatureBundle` carries no `tenantId` field either, so `save` takes it as an explicit parameter.
 */
export interface FeatureBundleRepository {
  save(bundle: FeatureBundle, tenantId: string, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureBundle | null>;
  list(tenantId: string, tx?: unknown): Promise<readonly FeatureBundle[]>;
}
