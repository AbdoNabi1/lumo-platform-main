import type { CursorPage, Paginated } from "@platform/types";
import type { ComponentDefinition } from "./component-definition";

/** Persistence port for {@link ComponentDefinition}. ADR-0014 (WP-10, T10.3): read methods take `tenantId` as an explicit per-call parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet converted. */
export interface ComponentDefinitionRepository {
  save(definition: ComponentDefinition, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<ComponentDefinition | null>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<ComponentDefinition | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<ComponentDefinition>>;
}
