import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
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
}

/** Production `AutomationWorkflowRepository` on the `automation` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaAutomationWorkflowRepository implements AutomationWorkflowRepository {
  private readonly deps: PrismaAutomationWorkflowRepositoryDeps;

  constructor(deps: PrismaAutomationWorkflowRepositoryDeps) {
    this.deps = deps;
  }

  async save(workflow: AutomationWorkflow, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
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

    await this.deps.outbox.write(
      workflow.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<AutomationWorkflow | null> {
    const run = (client: TransactionClient) =>
      client.automationWorkflow.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : AutomationWorkflowMapper.toDomain(this.toMapperRow(row));
  }

  async findByName(
    name: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<AutomationWorkflow | null> {
    const run = (client: TransactionClient) =>
      client.automationWorkflow.findFirst({ where: { name, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : AutomationWorkflowMapper.toDomain(this.toMapperRow(row));
  }

  async list(
    page: CursorPage,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<AutomationWorkflow>> {
    const limit = normalizePageSize(page.first);
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const run = (client: TransactionClient) =>
      client.automationWorkflow.findMany({
        where: { tenantId, ...(after !== undefined ? { id: { lt: after } } : {}) },
        orderBy: { id: "desc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
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
