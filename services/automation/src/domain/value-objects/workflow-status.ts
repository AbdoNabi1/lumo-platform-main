import { ValueObject } from "@platform/domain";

export type WorkflowStatusValue = "draft" | "active" | "paused" | "archived";

const TRANSITIONS: Readonly<Record<WorkflowStatusValue, readonly WorkflowStatusValue[]>> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

/** Whether a transition from `from` to `to` is allowed by the workflow lifecycle's transition table. */
export function canTransitionWorkflow(from: WorkflowStatusValue, to: WorkflowStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface WorkflowStatusProps {
  readonly value: WorkflowStatusValue;
}

/** The lifecycle state of an automation workflow (draft→active→paused→archived). */
export class WorkflowStatus extends ValueObject<WorkflowStatusProps> {
  static draft(): WorkflowStatus {
    return new WorkflowStatus({ value: "draft" });
  }

  static from(value: WorkflowStatusValue): WorkflowStatus {
    return new WorkflowStatus({ value });
  }

  get value(): WorkflowStatusValue {
    return this.props.value;
  }
}
