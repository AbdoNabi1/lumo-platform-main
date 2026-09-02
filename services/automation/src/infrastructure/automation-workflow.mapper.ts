import { UniqueEntityId } from "@platform/domain";
import {
  AutomationExecution,
  type AutomationExecutionStatusValue,
} from "../domain/automation-execution";
import { AutomationWorkflow } from "../domain/automation-workflow";
import {
  AutomationAction,
  AutomationTrigger,
  type AutomationTriggerType,
} from "../domain/value-objects/trigger-action";
import { WorkflowStatus, type WorkflowStatusValue } from "../domain/value-objects/workflow-status";

export interface AutomationExecutionJson {
  readonly id: string;
  readonly triggerId: string;
  readonly status: AutomationExecutionStatusValue;
  readonly attemptCount: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly errorMessage?: string;
}

export interface AutomationWorkflowRow {
  readonly id: string;
  readonly name: string;
  readonly triggerType: AutomationTriggerType;
  readonly eventType: string | null;
  readonly cronExpression: string | null;
  readonly actions: readonly { actionType: string; params: Readonly<Record<string, unknown>> }[];
  readonly status: string;
  readonly executions: readonly AutomationExecutionJson[];
  readonly version: number;
}

/** Persistence ↔ aggregate mapping for {@link AutomationWorkflow}. Mapping only — no I/O. */
export class AutomationWorkflowMapper {
  static toDomain(row: AutomationWorkflowRow): AutomationWorkflow {
    const trigger =
      row.triggerType === "event"
        ? AutomationTrigger.event(row.eventType ?? "")
        : AutomationTrigger.scheduled(row.cronExpression ?? "");

    return AutomationWorkflow.reconstitute(
      UniqueEntityId.from(row.id),
      row.name,
      trigger,
      row.actions.map((a) => AutomationAction.create(a.actionType, a.params)),
      WorkflowStatus.from(row.status as WorkflowStatusValue),
      row.version,
      row.executions.map((e) =>
        AutomationExecution.reconstitute(
          UniqueEntityId.from(e.id),
          e.triggerId,
          e.status,
          e.attemptCount,
          new Date(e.startedAt),
          e.completedAt === undefined ? undefined : new Date(e.completedAt),
          e.errorMessage,
        ),
      ),
    );
  }

  static toRow(workflow: AutomationWorkflow, tenantId: string) {
    return {
      id: workflow.id.toString(),
      tenantId,
      name: workflow.name,
      triggerType: workflow.trigger.type,
      eventType: workflow.trigger.eventType ?? null,
      cronExpression: workflow.trigger.cronExpression ?? null,
      actions: workflow.actions.map((a) => ({ actionType: a.actionType, params: a.params })),
      status: workflow.status.value,
      executions: workflow.executions.map((e) => ({
        id: e.id.toString(),
        triggerId: e.triggerId,
        status: e.status,
        attemptCount: e.attemptCount,
        startedAt: e.startedAt.toISOString(),
        completedAt: e.completedAt?.toISOString(),
        errorMessage: e.errorMessage,
      })),
      version: 1,
    };
  }
}
