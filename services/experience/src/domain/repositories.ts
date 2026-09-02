import type { CursorPage, Paginated } from "@platform/types";
import type { Experience } from "./experience";

/** Persistence port for {@link Experience}. */
export interface ExperienceRepository {
  save(experience: Experience, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Experience | null>;
  findByName(name: string, tx?: unknown): Promise<Experience | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Experience>>;
}
