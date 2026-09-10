import type { CursorPage, Paginated } from "@platform/types";
import type { FeatureFlag } from "./feature-flag";

/**
 * Persistence port for {@link FeatureFlag}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByKey`/`list` take `tenantId` as an explicit per-call
 * parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet
 * converted — it still relies on the concrete Prisma adapter's constructor-injected `tenantId`.
 */
export interface FeatureFlagRepository {
  save(flag: FeatureFlag, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<FeatureFlag | null>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<FeatureFlag | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<FeatureFlag>>;
}
