import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import type { AutomationWorkflow } from "../domain/automation-workflow";
import type { AutomationWorkflowRepository } from "../domain/automation-workflow-repository";

export interface InMemoryAutomationWorkflowRepositoryDeps {
  readonly outbox: OutboxWriter;
  readonly context: EventContext;
}

/** In-memory `AutomationWorkflowRepository`. Persists the aggregate and writes events to the outbox on save. */
export class InMemoryAutomationWorkflowRepository implements AutomationWorkflowRepository {
  private readonly store = new Map<string, AutomationWorkflow>();
  private readonly outbox: OutboxWriter;
  private readonly context: EventContext;

  constructor(deps: InMemoryAutomationWorkflowRepositoryDeps) {
    this.outbox = deps.outbox;
    this.context = deps.context;
  }

  async save(workflow: AutomationWorkflow, tx?: unknown): Promise<void> {
    this.store.set(workflow.id.toString(), workflow);
    await this.outbox.write(workflow.pullDomainEvents(), this.context, tx);
  }

  async findById(id: string, _tenantId: string): Promise<AutomationWorkflow | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string, _tenantId: string): Promise<AutomationWorkflow | null> {
    for (const workflow of this.store.values()) {
      if (workflow.name === name) return workflow;
    }
    return null;
  }

  async list(page: CursorPage, _tenantId: string): Promise<Paginated<AutomationWorkflow>> {
    const limit = normalizePageSize(page.first);
    const all = [...this.store.values()].sort((a, b) =>
      a.id.toString() < b.id.toString() ? 1 : -1,
    );
    const after = page.after;
    const startIndex =
      after === undefined ? 0 : all.findIndex((workflow) => workflow.id.toString() === after) + 1;
    const rows = all.slice(startIndex, startIndex + limit + 1);
    return buildPaginatedPage(rows, limit, (workflow) => workflow.id.toString());
  }
}
