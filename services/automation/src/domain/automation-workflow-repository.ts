import type { CursorPage, Paginated } from "@platform/types";
import type { AutomationWorkflow } from "./automation-workflow";

/** Persistence port for {@link AutomationWorkflow}. Implemented in infrastructure. The optional `tx` scopes the call to the caller's transaction (ADR-0003). */
export interface AutomationWorkflowRepository {
  save(workflow: AutomationWorkflow, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  findByName(name: string, tx?: unknown): Promise<AutomationWorkflow | null>;
  /** Cursor page, most recently created first (Phase A.30 admin Automations screen). */
  list(page: CursorPage, tx?: unknown): Promise<Paginated<AutomationWorkflow>>;
}
