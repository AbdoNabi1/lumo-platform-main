import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Prisma } from "@prisma/client";
import type { AutomationWorkflow } from "../domain/automation-workflow";
import type { AutomationWorkflowRepository } from "../domain/automation-workflow-repository";
import { AutomationWorkflowMapper, type AutomationWorkflowRow } from "./automation-workflow.mapper";

export interface PrismaAutomationWorkflowRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `AutomationWorkflowRepository` on the `automation` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaAutomationWorkflowRepository implements AutomationWorkflowRepository {
  private readonly deps: PrismaAutomationWorkflowRepositoryDeps;

  constructor(deps: PrismaAutomationWorkflowRepositoryDeps) {
    this.deps = deps;
  }

  async save(workflow: AutomationWorkflow, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const id = workflow.id.toString();
    const row = AutomationWorkflowMapper.toRow(workflow, tenantId);

    if (workflow.version === 0) {
      await client.automationWorkflow.create({
        data: {
          ...row,
          actions: row.actions as Prisma.InputJsonValue,
          executions: row.executions,
        },
      });
    } else {
      const updated = await client.automationWorkflow.updateMany({
        where: { id, tenantId, version: workflow.version },
        data: {
          status: row.status,
          executions: row.executions,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Automation workflow ${id} was modified concurrently (expected version ${workflow.version})`,
        );
      }
    }

    await this.deps.outbox.write(workflow.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<AutomationWorkflow | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.automationWorkflow.findFirst({
      where: { id, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return AutomationWorkflowMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(name: string, tx?: unknown): Promise<AutomationWorkflow | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.automationWorkflow.findFirst({
      where: { name, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return AutomationWorkflowMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<AutomationWorkflow>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const limit = normalizePageSize(page.first);
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const rows = await client.automationWorkflow.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after !== undefined ? { id: { lt: after } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const workflows = rows.map((row) => AutomationWorkflowMapper.toDomain(this.toMapperRow(row)));
    return buildPaginatedPage(workflows, limit, (workflow) => workflow.id.toString());
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly name: string;
    readonly triggerType: string;
    readonly eventType: string | null;
    readonly cronExpression: string | null;
    readonly actions: unknown;
    readonly status: string;
    readonly executions: unknown;
    readonly version: number;
  }): AutomationWorkflowRow {
    return {
      ...row,
      triggerType: row.triggerType as AutomationWorkflowRow["triggerType"],
      actions: row.actions as AutomationWorkflowRow["actions"],
      executions: row.executions as AutomationWorkflowRow["executions"],
    };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaAutomationWorkflowRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
