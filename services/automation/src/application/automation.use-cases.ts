import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type CursorPage, type Paginated, type Result } from "@platform/types";
import { type DomainError, ConcurrencyError, ConflictError, NotFoundError } from "@platform/utils";
import { AutomationWorkflow } from "../domain/automation-workflow";
import type { AutomationWorkflowRepository } from "../domain/automation-workflow-repository";
import { AutomationAction, AutomationTrigger } from "../domain/value-objects/trigger-action";
import type { WorkflowStatusValue } from "../domain/value-objects/workflow-status";
import type { ActionDispatcherPort } from "./ports";

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.18, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8 — duplicated locally per this codebase's
 * established convention, not shared across packages) — `PrismaAutomationWorkflowRepository.save`
 * throws `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected/recoverable (two racing triggers for the same workflow), so the whole read-check-write
 * attempt is retried from scratch against the now-current row. Any other error (including a
 * Result-channel domain rejection, which is returned not thrown) propagates immediately.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

export interface CreateWorkflowInput {
  readonly name: string;
  readonly triggerType: "event" | "scheduled";
  readonly eventType?: string;
  readonly cronExpression?: string;
  readonly actions: readonly { actionType: string; params?: Readonly<Record<string, unknown>> }[];
  readonly tenantId: string;
}

export interface WorkflowStatusOutput {
  readonly workflowId: string;
  readonly status: string;
}

export interface WorkflowDeps {
  readonly workflows: AutomationWorkflowRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Creates a workflow in `draft` status. */
export class CreateWorkflow implements UseCase<
  CreateWorkflowInput,
  WorkflowStatusOutput,
  DomainError
> {
  private readonly deps: WorkflowDeps;

  constructor(deps: WorkflowDeps) {
    this.deps = deps;
  }

  async execute(input: CreateWorkflowInput): Promise<Result<WorkflowStatusOutput, DomainError>> {
    const name = Guard.againstEmpty(input.name, "name");
    if (!name.ok) return err(name.error);

    return this.deps.unitOfWork.run<Result<WorkflowStatusOutput, DomainError>>(async (tx) => {
      const existing = await this.deps.workflows.findByName(input.name, input.tenantId, tx);
      if (existing !== null) {
        return err(new ConflictError(`Workflow "${input.name}" already exists`));
      }
      const trigger =
        input.triggerType === "event"
          ? AutomationTrigger.event(input.eventType ?? "")
          : AutomationTrigger.scheduled(input.cronExpression ?? "");
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      const workflow = AutomationWorkflow.create(
        id,
        input.name,
        trigger,
        input.actions.map((a) => AutomationAction.create(a.actionType, a.params)),
      );
      await this.deps.workflows.save(workflow, input.tenantId, tx);
      return ok({ workflowId: id.toString(), status: workflow.status.value });
    });
  }
}

export interface WorkflowIdInput {
  readonly workflowId: string;
  readonly tenantId: string;
}

export interface AdvanceWorkflowInput extends WorkflowIdInput {
  readonly toStatus: WorkflowStatusValue;
}

/** Generic validated transition — used for activate/pause/archive. */
export class AdvanceWorkflow implements UseCase<
  AdvanceWorkflowInput,
  WorkflowStatusOutput,
  DomainError
> {
  private readonly deps: WorkflowDeps;

  constructor(deps: WorkflowDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceWorkflowInput): Promise<Result<WorkflowStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WorkflowStatusOutput, DomainError>>(async (tx) => {
      const workflow = await this.deps.workflows.findById(input.workflowId, input.tenantId, tx);
      if (workflow === null) return err(new NotFoundError("Workflow not found"));

      try {
        workflow.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.workflows.save(workflow, input.tenantId, tx);
      return ok({ workflowId: workflow.id.toString(), status: workflow.status.value });
    });
  }
}

export interface TriggerWorkflowInput extends WorkflowIdInput {
  readonly triggerId: string;
}

export interface TriggerWorkflowOutput extends WorkflowStatusOutput {
  readonly executionId: string;
  readonly duplicate: boolean;
}

export interface TriggerWorkflowDeps extends WorkflowDeps {
  readonly dispatcher: ActionDispatcherPort;
}

interface StartOrResumeOutcome {
  readonly workflowId: string;
  readonly status: string;
  readonly executionId: string;
  readonly actions: readonly AutomationAction[];
  readonly proceedToPort: boolean;
  readonly isNew: boolean;
}

/**
 * Runs a workflow for one trigger — dispatches actions via `ActionDispatcherPort`.
 *
 * Phase A.18 (Task 7/8, dedup-store transaction-boundary hardening): the dedup check used to be a
 * separate `ProcessedTriggerStore` whose `markProcessed()` write had no `tx` parameter — it could
 * not commit atomically with `workflows.save()` (A.17 §14). Fixed by Option B (Task 7): the dedup
 * signal is now derived directly from `workflow.executions` — the SAME `findById(tx)` read and
 * SAME `save(workflow, tx)` write already used for the rest of the aggregate, exactly the pattern
 * this codebase's own `Coupons`/`Loyalty` aggregates already use for their own dedup. There is no
 * separate store left to desync: "processed" IS a committed row in the workflow's own execution
 * history, so a dedup marker can never survive a rolled-back aggregate write (Scenario C) and can
 * never be lost while the aggregate write survives (Scenario B) — both were literally the same
 * write. This also fixes a latent scoping defect: the old store's `hasProcessed(triggerId)` was
 * keyed GLOBALLY across every workflow in the system, so two unrelated workflows triggered by a
 * coincidentally-identical `triggerId` would have the second one silently swallowed as "duplicate."
 * `workflow.executions` is scoped to the one loaded aggregate, so dedup is now correctly per-workflow.
 *
 * Mirrors the reserve/external-call/settle split already established for Fulfillment's
 * `RequestReservation` (Phase A.15) and Payments' `CapturePaymentLifecycle` (Phase A.8/A.9): the
 * dispatch happens OUTSIDE any open transaction, and `withConcurrencyRetry` bounds retries on
 * optimistic-lock conflicts so a losing concurrent racer resumes into the winner's already-durable
 * execution instead of propagating an unhandled `ConcurrencyError`.
 *
 * RESIDUAL RISK (documented, not fixed — same disposition Fulfillment's own doc comment accepts):
 * a caller whose OWN first attempt finds an execution already `running` (not created by itself,
 * e.g. a genuinely new request arriving after another process's `startExecution` committed but
 * before that process's own dispatch/settle finished) cannot be distinguished from a crash/failure
 * retry and — by design, so a crash-orphaned `running` execution is not permanently stuck — DOES
 * proceed to dispatch again. Closing this fully would require a port-level idempotency key on
 * `ActionDispatcherPort.dispatch()` (it already carries `triggerId`, so a real adapter CAN dedupe
 * receiver-side — no real adapter exists to verify against, same "mechanism built but not wired"
 * disposition A.16 established for Licensing's `PaymentsPort`).
 */
export class TriggerWorkflow implements UseCase<
  TriggerWorkflowInput,
  TriggerWorkflowOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;
  private readonly deps: TriggerWorkflowDeps;

  constructor(deps: TriggerWorkflowDeps) {
    this.deps = deps;
  }

  async execute(input: TriggerWorkflowInput): Promise<Result<TriggerWorkflowOutput, DomainError>> {
    const started = await this.startOrResume(input.workflowId, input.triggerId, input.tenantId);
    if (!started.ok) return err(started.error);
    const { executionId, actions, proceedToPort, isNew } = started.value;

    if (!proceedToPort) {
      return ok({
        workflowId: started.value.workflowId,
        status: started.value.status,
        executionId,
        duplicate: !isNew,
      });
    }

    let dispatchError: string | undefined;
    try {
      await this.deps.dispatcher.dispatch(actions, input.triggerId);
    } catch (error) {
      dispatchError = error instanceof Error ? error.message : "dispatch failed";
    }

    return this.settle(input.workflowId, executionId, dispatchError, isNew, input.tenantId);
  }

  private async startOrResume(
    workflowId: string,
    triggerId: string,
    tenantId: string,
  ): Promise<Result<StartOrResumeOutcome, DomainError>> {
    let attempt = 0;
    return withConcurrencyRetry(TriggerWorkflow.MAX_CONCURRENCY_RETRIES, () => {
      attempt += 1;
      const isFirstAttempt = attempt === 1;
      return this.deps.unitOfWork.run<Result<StartOrResumeOutcome, DomainError>>(async (tx) => {
        const workflow = await this.deps.workflows.findById(workflowId, tenantId, tx);
        if (workflow === null) return err(new NotFoundError("Workflow not found"));

        const existing = workflow.executions.find((e) => e.triggerId === triggerId);
        if (existing !== undefined) {
          const terminal =
            existing.status === "succeeded" ||
            existing.status === "failed" ||
            existing.status === "dead_letter";
          return ok({
            workflowId: workflow.id.toString(),
            status: workflow.status.value,
            executionId: existing.id.toString(),
            actions: workflow.actions,
            // Resume: either this caller's OWN retry after losing the optimistic-lock race
            // (attempt > 1 — the winner owns dispatch) or a standalone call finding a durable
            // but unsettled execution left by a prior attempt (attempt 1 — see class doc's
            // "Residual risk"). A terminal execution never re-dispatches.
            proceedToPort: !terminal && isFirstAttempt,
            isNew: false,
          });
        }

        let executionId: string;
        try {
          const execution = workflow.startExecution(
            triggerId,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
          executionId = execution.id.toString();
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.workflows.save(workflow, tenantId, tx);
        return ok({
          workflowId: workflow.id.toString(),
          status: workflow.status.value,
          executionId,
          actions: workflow.actions,
          proceedToPort: true,
          isNew: true,
        });
      });
    });
  }

  private async settle(
    workflowId: string,
    executionId: string,
    dispatchError: string | undefined,
    isNew: boolean,
    tenantId: string,
  ): Promise<Result<TriggerWorkflowOutput, DomainError>> {
    return withConcurrencyRetry(TriggerWorkflow.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<TriggerWorkflowOutput, DomainError>>(async (tx) => {
        const workflow = await this.deps.workflows.findById(workflowId, tenantId, tx);
        if (workflow === null) return err(new NotFoundError("Workflow not found"));

        const execution = workflow.executions.find((e) => e.id.toString() === executionId);
        if (execution === undefined) return err(new NotFoundError("Execution not found"));

        // Already settled by a prior/racing attempt — idempotent no-op, mirrors Capture's
        // Phase A.9 `alreadyCaptured` write+side-effect guard.
        if (execution.status === "running") {
          try {
            if (dispatchError === undefined) {
              workflow.completeExecutionSuccess(
                executionId,
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            } else {
              workflow.completeExecutionFailure(
                executionId,
                dispatchError,
                this.deps.idGenerator.generate(),
                this.deps.clock.now(),
              );
            }
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.workflows.save(workflow, tenantId, tx);
        }

        return ok({
          workflowId: workflow.id.toString(),
          status: workflow.status.value,
          executionId,
          duplicate: !isNew,
        });
      }),
    );
  }
}

export interface RetryExecutionInput extends WorkflowIdInput {
  readonly executionId: string;
}

/** Retries a failed execution — dead-letters once attempts are exhausted. */
export class RetryExecution implements UseCase<
  RetryExecutionInput,
  WorkflowStatusOutput,
  DomainError
> {
  private readonly deps: WorkflowDeps;

  constructor(deps: WorkflowDeps) {
    this.deps = deps;
  }

  async execute(input: RetryExecutionInput): Promise<Result<WorkflowStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<WorkflowStatusOutput, DomainError>>(async (tx) => {
      const workflow = await this.deps.workflows.findById(input.workflowId, input.tenantId, tx);
      if (workflow === null) return err(new NotFoundError("Workflow not found"));

      try {
        workflow.retryExecution(
          input.executionId,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.workflows.save(workflow, input.tenantId, tx);
      return ok({ workflowId: workflow.id.toString(), status: workflow.status.value });
    });
  }
}

export interface ListWorkflowsInput extends CursorPage {
  readonly tenantId: string;
}

export interface ListWorkflowsDeps {
  readonly workflows: AutomationWorkflowRepository;
}

/** Cursor-paginated workflow listing, most recently created first (Phase A.30 admin Automations screen). */
export class ListWorkflows implements UseCase<
  ListWorkflowsInput,
  Paginated<AutomationWorkflow>,
  DomainError
> {
  private readonly deps: ListWorkflowsDeps;

  constructor(deps: ListWorkflowsDeps) {
    this.deps = deps;
  }

  async execute(
    input: ListWorkflowsInput,
  ): Promise<Result<Paginated<AutomationWorkflow>, DomainError>> {
    return ok(await this.deps.workflows.list(input, input.tenantId));
  }
}
