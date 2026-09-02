import type { CursorPage, Paginated } from "@platform/types";
import type { Experiment } from "./experiment";

/** Persistence port for {@link Experiment}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface ExperimentRepository {
  save(experiment: Experiment, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<Experiment | null>;
  findByName(name: string, tx?: unknown): Promise<Experiment | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<Experiment>>;
}
