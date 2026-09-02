import type { CursorPage, Paginated } from "@platform/types";
import type { ComponentDefinition } from "./component-definition";

/** Persistence port for {@link ComponentDefinition}. */
export interface ComponentDefinitionRepository {
  save(definition: ComponentDefinition, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ComponentDefinition | null>;
  findByKey(key: string, tx?: unknown): Promise<ComponentDefinition | null>;
  list(page: CursorPage, tx?: unknown): Promise<Paginated<ComponentDefinition>>;
}
