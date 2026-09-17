import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { AutomationWorkflow } from "../domain/automation-workflow";
import type { AutomationWorkflowRepository } from "../domain/automation-workflow-repository";

export interface InMemoryAutomationWorkflowRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/**
 * In-memory `AutomationWorkflowRepository`. Persists the aggregate and writes events to the
 * outbox on save. ADR-0014 (WP-10, T10.5): keyed by `(tenantId, workflowId)` — `AutomationWorkflow`
 * carries no `tenantId` of its own, so the store must key on it explicitly or a cross-tenant leak
 * here would be invisible to every isolation test.
 */
export class InMemoryAutomationWorkflowRepository implements AutomationWorkflowRepository {
  private readonly store = new Map<
    string,
    { readonly tenantId: string; readonly workflow: AutomationWorkflow }
  >();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAutomationWorkflowRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(workflow: AutomationWorkflow, tenantId: string, tx?: unknown): Promise<void> {
    this.store.set(workflow.id.toString(), { tenantId, workflow });
    await this.outbox.write(workflow.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, tenantId: string): Promise<AutomationWorkflow | null> {
    const entry = this.store.get(id);
    return entry !== undefined && entry.tenantId === tenantId ? entry.workflow : null;
  }

  async findByName(name: string, tenantId: string): Promise<AutomationWorkflow | null> {
    for (const entry of this.store.values()) {
      if (entry.tenantId === tenantId && entry.workflow.name === name) return entry.workflow;
    }
    return null;
  }

  async list(page: CursorPage, tenantId: string): Promise<Paginated<AutomationWorkflow>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()]
      .filter((entry) => entry.tenantId === tenantId)
      .map((entry) => entry.workflow)
      .sort((a, b) => (a.id.toString() < b.id.toString() ? 1 : -1));
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((workflow) => workflow.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (workflow) => workflow.id.toString());
  }
}
