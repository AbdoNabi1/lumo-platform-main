import { ValueObject } from "@platform/domain";

export type ModelStatusValue = "draft" | "training" | "active" | "retired";

/** The validated lifecycle transition table (Sprint 5.2). */
const TRANSITIONS: Readonly<Record<ModelStatusValue, readonly ModelStatusValue[]>> = {
  draft: ["training"],
  training: ["active", "draft"],
  active: ["retired", "training"],
  retired: [],
};

/** Whether a transition from `from` to `to` is allowed by the recommendation-model lifecycle's transition table. */
export function canTransitionModel(from: ModelStatusValue, to: ModelStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface ModelStatusProps {
  readonly value: ModelStatusValue;
}

/** The lifecycle state of a recommendation model (draft→training→active→retired). */
export class ModelStatus extends ValueObject<ModelStatusProps> {
  static draft(): ModelStatus {
    return new ModelStatus({ value: "draft" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: ModelStatusValue): ModelStatus {
    return new ModelStatus({ value });
  }

  get value(): ModelStatusValue {
    return this.props.value;
  }
}
