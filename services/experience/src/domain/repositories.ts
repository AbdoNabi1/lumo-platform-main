import type { CursorPage, Paginated } from "@platform/types";
import type { Experience } from "./experience";

/** Persistence port for {@link Experience}. ADR-0014 (WP-10, T10.3): read methods take `tenantId` as an explicit per-call parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet converted. */
export interface ExperienceRepository {
  save(experience: Experience, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<Experience | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<Experience | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Experience>>;
}
