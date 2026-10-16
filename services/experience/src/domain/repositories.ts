import type { CursorPage, Paginated } from "@platform/types";
import type { Experience } from "./experience";

/**
 * Persistence port for {@link Experience}. ADR-0014 (WP-10, T10.5): every method takes `tenantId`
 * as an explicit per-call parameter. `Experience` carries no `tenantId` of its own, so `save`
 * takes it as an explicit parameter (Option B) rather than reading it off the aggregate.
 */
export interface ExperienceRepository {
  save(experience: Experience, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Experience | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Experience | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Experience>>;
}
