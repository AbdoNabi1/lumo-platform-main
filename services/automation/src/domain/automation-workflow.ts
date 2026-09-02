import { AggregateRoot, BusinessRuleError, UniqueEntityId } from "@platform/domain";
import { AutomationExecution } from "./automation-execution";
import { WorkflowTransitioned } from "./events/workflow-transitioned.event";
import type { AutomationAction, AutomationTrigger } from "./value-objects/trigger-action";
import {
  canTransitionWorkflow,
  WorkflowStatus,
  type WorkflowStatusValue,
} from "./value-objects/workflow-status";

const MAX_ATTEMPTS = 3;

interface AutomationWorkflowProps {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly actions: readonly AutomationAction[];
  status: WorkflowStatus;
  readonly executions: AutomationExecution[];
}

/**
 * Source of truth for one workflow's lifecycle and execution history (Sprint 5.3). Orchestrates
 * only — owns no business entities; actions are dispatched through `ActionDispatcherPort`, never
 * called directly.
 */
export class AutomationWorkflow extends AggregateRoot<AutomationWorkflowProps> {
  static create(
    id: UniqueEntityId,
    name: string,
    trigger: AutomationTrigger,
    actions: readonly AutomationAction[],
  ): AutomationWorkflow {
    return new AutomationWorkflow(
      { name, trigger, actions, status: WorkflowStatus.draft(), executions: [] },
      id,
    );
  }

  /** Rebuilds a persisted workflow exactly as stored — no domain events raised (ADR-0003, G-12). */
  static reconstitute(
    id: UniqueEntityId,
    name: string,
    trigger: AutomationTrigger,
    actions: readonly AutomationAction[],
    status: WorkflowStatus,
    version: number,
    executions: readonly AutomationExecution[] = [],
  ): AutomationWorkflow {
    return new AutomationWorkflow(
      { name, trigger, actions, status, executions: [...executions] },
      id,
      version,
    );
  }

  /** The generic, validated status transition — every named method below delegates to this. */
  transition(toStatus: WorkflowStatusValue, eventId: string, occurredAt: Date): void {
    const fromStatus = this.props.status.value;
    if (!canTransitionWorkflow(fromStatus, toStatus)) {
      throw new BusinessRuleError(
        `Cannot transition workflow from "${fromStatus}" to "${toStatus}"`,
      );
    }
    this.props.status = WorkflowStatus.from(toStatus);
    this.raise("workflow", toStatus, eventId, occurredAt);
  }

  activate(eventId: string, occurredAt: Date): void {
    this.transition("active", eventId, occurredAt);
  }

  pause(eventId: string, occurredAt: Date): void {
    this.transition("paused", eventId, occurredAt);
  }

  archive(eventId: string, occurredAt: Date): void {
    this.transition("archived", eventId, occurredAt);
  }

  /** Starts a new execution — the caller (application layer) has already deduped by `triggerId` against this workflow's own `executions` (Phase A.18). */
  startExecution(triggerId: string, eventId: string, occurredAt: Date): AutomationExecution {
    if (this.props.status.value !== "active") {
      throw new BusinessRuleError(`Workflow is not active (status: ${this.props.status.value})`);
    }
    const execution = AutomationExecution.start(
      UniqueEntityId.from(this.id.toString() + this.props.executions.length),
      triggerId,
      occurredAt,
    );
    this.props.executions.push(execution);
    this.raise("execution", "running", eventId, occurredAt, execution.id.toString());
    return execution;
  }

  completeExecutionSuccess(executionId: string, eventId: string, occurredAt: Date): void {
    const execution = this.requireExecution(executionId);
    execution.succeed(occurredAt);
    this.raise("execution", "succeeded", eventId, occurredAt, executionId);
  }

  completeExecutionFailure(
    executionId: string,
    errorMessage: string,
    eventId: string,
    occurredAt: Date,
  ): void {
    const execution = this.requireExecution(executionId);
    execution.fail(errorMessage, occurredAt);
    this.raise("execution", "failed", eventId, occurredAt, executionId);
  }

  /** Retries a failed execution — dead-letters once attempts are exhausted. */
  retryExecution(executionId: string, eventId: string, occurredAt: Date): void {
    const execution = this.requireExecution(executionId);
    if (execution.attemptCount >= MAX_ATTEMPTS) {
      execution.deadLetter(occurredAt);
      this.raise("execution", "dead_letter", eventId, occurredAt, executionId);
      return;
    }
    execution.retry();
    execution.resume();
    this.raise("execution", "retrying", eventId, occurredAt, executionId);
  }

  private requireExecution(executionId: string): AutomationExecution {
    const execution = this.props.executions.find((e) => e.id.toString() === executionId);
    if (execution === undefined) {
      throw new BusinessRuleError(`Workflow has no execution "${executionId}"`);
    }
    return execution;
  }

  private raise(
    family: "workflow" | "execution",
    action: string,
    eventId: string,
    occurredAt: Date,
    executionRef?: string,
  ): void {
    this.addDomainEvent(
      new WorkflowTransitioned(
        { eventId, aggregateId: this.id, occurredAt },
        {
          name: this.props.name,
          family,
          action,
          executionRef,
        },
      ),
    );
  }

  get name(): string {
    return this.props.name;
  }

  get trigger(): AutomationTrigger {
    return this.props.trigger;
  }

  get actions(): readonly AutomationAction[] {
    return this.props.actions;
  }

  get status(): WorkflowStatus {
    return this.props.status;
  }

  /** The append-only execution history (persisted verbatim). */
  get executions(): readonly AutomationExecution[] {
    return this.props.executions;
  }
}
