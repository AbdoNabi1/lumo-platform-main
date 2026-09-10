import type { FeatureBundle } from "./feature-bundle";
import type { FeatureDefinition } from "./feature-definition";

/** Persists feature definitions with their immutable version history. Tenant-scoped, optimistic-locked, same-tx outbox. */
export interface FeatureDefinitionRepository {
  save(feature: FeatureDefinition, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureDefinition | null>;
  /** Discovery — all definitions (optionally filtered by lifecycle/category); read model for the catalog. */
  list(
    tenantId: string,
    filter?: { readonly lifecycle?: string; readonly category?: string },
    tx?: unknown,
  ): Promise<readonly FeatureDefinition[]>;
}

/** Persists feature bundles (commercial collections). Tenant-scoped, optimistic-locked, same-tx outbox (P1.1.1 §2). */
export interface FeatureBundleRepository {
  save(bundle: FeatureBundle, tx?: unknown): Promise<void>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureBundle | null>;
  list(tenantId: string, tx?: unknown): Promise<readonly FeatureBundle[]>;
}
