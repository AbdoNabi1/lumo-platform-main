import { ValueObject } from "@platform/domain";

export type ExperimentStatusValue = "draft" | "running" | "paused" | "completed" | "archived";

const TRANSITIONS: Readonly<Record<ExperimentStatusValue, readonly ExperimentStatusValue[]>> = {
  draft: ["running"],
  running: ["paused", "completed"],
  paused: ["running", "completed"],
  completed: ["archived"],
  archived: [],
};

/** Whether a transition from `from` to `to` is allowed by the experiment lifecycle's transition table. */
export function canTransitionExperiment(
  from: ExperimentStatusValue,
  to: ExperimentStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ExperimentStatusProps {
  readonly value: ExperimentStatusValue;
}

/** The lifecycle state of an experiment (draft→running→paused→completed→archived). */
export class ExperimentStatus extends ValueObject<ExperimentStatusProps> {
  static draft(): ExperimentStatus {
    return new ExperimentStatus({ value: "draft" });
  }

  static from(value: ExperimentStatusValue): ExperimentStatus {
    return new ExperimentStatus({ value });
  }

  get value(): ExperimentStatusValue {
    return this.props.value;
  }
}
