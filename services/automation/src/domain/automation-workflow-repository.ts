import type { CursorPage, Paginated } from "@platform/types";
import type { AutomationWorkflow } from "./automation-workflow";

/**
 * Persistence port for {@link AutomationWorkflow}. Implemented in infrastructure. The optional `tx`
 * scopes the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.3): `findById`/`findByName`/`list` take `tenantId` as an explicit per-call
 * parameter, matching `services/catalog`'s first-converted-context shape. `save` is not yet
 * converted.
 */
export interface AutomationWorkflowRepository {
  save(workflow: AutomationWorkflow, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  /** Cursor page, most recently created first (Phase A.30 admin Automations screen). */
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<AutomationWorkflow>>;
}
