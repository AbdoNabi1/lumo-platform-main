import { Entity, type UniqueEntityId } from "@platform/domain";

export type AutomationExecutionStatusValue =
  "pending" | "running" | "succeeded" | "failed" | "retrying" | "dead_letter";

const TRANSITIONS: Readonly<
  Record<AutomationExecutionStatusValue, readonly AutomationExecutionStatusValue[]>
> = {
  pending: ["running"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: ["retrying", "dead_letter"],
  retrying: ["running", "dead_letter"],
  dead_letter: [],
};

/** Whether a transition from `from` to `to` is allowed by the execution's own retry/dead-letter transition table. */
export function canTransitionExecution(
  from: AutomationExecutionStatusValue,
  to: AutomationExecutionStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

interface AutomationExecutionProps {
  readonly triggerId: string;
  status: AutomationExecutionStatusValue;
  attemptCount: number;
  readonly startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

/**
 * One append-only execution run of a workflow (Sprint 5.3) — idempotent/replay-safe at the
 * application layer via the workflow's own `executions` list (keyed by `triggerId`, Phase A.18);
 * this entity itself only enforces the retry/dead-letter transition table.
 */
export class AutomationExecution extends Entity<AutomationExecutionProps> {
  static start(id: UniqueEntityId, triggerId: string, occurredAt: Date): AutomationExecution {
    return new AutomationExecution(
      { triggerId, status: "running", attemptCount: 1, startedAt: occurredAt },
      id,
    );
  }

  /** Rebuilds a persisted execution exactly as stored. */
  static reconstitute(
    id: UniqueEntityId,
    triggerId: string,
    status: AutomationExecutionStatusValue,
    attemptCount: number,
    startedAt: Date,
    completedAt?: Date,
    errorMessage?: string,
  ): AutomationExecution {
    return new AutomationExecution(
      { triggerId, status, attemptCount, startedAt, completedAt, errorMessage },
      id,
    );
  }

  transition(toStatus: AutomationExecutionStatusValue): void {
    if (!canTransitionExecution(this.props.status, toStatus)) {
      throw new Error(`Cannot transition execution from "${this.props.status}" to "${toStatus}"`);
    }
    this.props.status = toStatus;
  }

  succeed(occurredAt: Date): void {
    this.transition("succeeded");
    this.props.completedAt = occurredAt;
  }

  fail(errorMessage: string, occurredAt: Date): void {
    this.transition("failed");
    this.props.completedAt = occurredAt;
    this.props.errorMessage = errorMessage;
  }

  retry(): void {
    this.transition("retrying");
  }

  resume(): void {
    this.transition("running");
    this.props.attemptCount += 1;
  }

  deadLetter(occurredAt: Date): void {
    this.transition("dead_letter");
    this.props.completedAt = occurredAt;
  }

  get triggerId(): string {
    return this.props.triggerId;
  }

  get status(): AutomationExecutionStatusValue {
    return this.props.status;
  }

  get attemptCount(): number {
    return this.props.attemptCount;
  }

  get startedAt(): Date {
    return this.props.startedAt;
  }

  get completedAt(): Date | undefined {
    return this.props.completedAt;
  }

  get errorMessage(): string | undefined {
    return this.props.errorMessage;
  }
}
