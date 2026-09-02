import type { CursorPage, Paginated } from "@platform/types";
import type { FeatureFlag } from "./feature-flag";

/** Persistence port for {@link FeatureFlag}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface FeatureFlagRepository {
  save(flag: FeatureFlag, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<FeatureFlag | null>;
  findByKey(key: string, tx?: unknown): Promise<FeatureFlag | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<FeatureFlag>>;
}
