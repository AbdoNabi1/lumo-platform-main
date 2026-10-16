import type { CursorPage, Paginated } from "@platform/types";
import type { ComponentDefinition } from "./component-definition";

/** Persistence port for {@link ComponentDefinition}. ADR-0014 (WP-10, T10.3): every method takes `tenantId` as an explicit per-call parameter, matching `services/catalog`'s shape. `ComponentDefinition` carries no `tenantId` of its own, so `save` takes it as an explicit parameter (Option B) rather than reading it off the aggregate. */
export interface ComponentDefinitionRepository {
  save(definition: ComponentDefinition, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<ComponentDefinition | null>;
  findByKey(key: string, tenantId: string, tx?: unknown): Promise<ComponentDefinition | null>;
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<ComponentDefinition>>;
}
