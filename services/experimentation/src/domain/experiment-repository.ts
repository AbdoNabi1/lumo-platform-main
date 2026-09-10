import type { CursorPage, Paginated } from "@platform/types";
import type { Experiment } from "./experiment";

/**
 * Persistence port for {@link Experiment}. Implemented in infrastructure. The optional `tx` scopes
 * the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByName`/`list` take `tenantId` as an explicit per-call
 * parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet
 * converted.
 */
export interface ExperimentRepository {
  save(experiment: Experiment, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Experiment | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Experiment | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Experiment>>;
}
