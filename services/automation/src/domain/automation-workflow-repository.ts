import type { CursorPage, Paginated } from "@platform/types";
import type { AutomationWorkflow } from "./automation-workflow";

/**
 * Persistence port for {@link AutomationWorkflow}. Implemented in infrastructure. The optional `tx`
 * scopes the call to the caller's transaction (ADR-0003).
 *
 * ADR-0014 (WP-10, T10.5): every method takes `tenantId` as an explicit per-call parameter.
 * `AutomationWorkflow` carries no `tenantId` of its own, so `save` takes it as an explicit
 * parameter (Option B) rather than reading it off the aggregate.
 */
export interface AutomationWorkflowRepository {
  save(workflow: AutomationWorkflow, tenantId: string, tx?: unknown): Promise<void>;
  findById(id: string, tenantId: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  findByName(name: string, tenantId: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  /** Cursor page, most recently created first (Phase A.30 admin Automations screen). */
  list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<AutomationWorkflow>>;
}
