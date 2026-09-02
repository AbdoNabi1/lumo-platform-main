import { ValueObject } from "@platform/domain";

export type IndexStatusValue = "active" | "rebuilding" | "disabled";

/** The validated lifecycle transition table (Sprint 5.2). */
const TRANSITIONS: Readonly<Record<IndexStatusValue, readonly IndexStatusValue[]>> = {
  active: ["rebuilding", "disabled"],
  rebuilding: ["active", "disabled"],
  disabled: ["active"],
};

/** Whether a transition from `from` to `to` is allowed by the index lifecycle's transition table. */
export function canTransitionIndex(from: IndexStatusValue, to: IndexStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface IndexStatusProps {
  readonly value: IndexStatusValue;
}

/** The lifecycle state of a search index (active→rebuilding→disabled). */
export class IndexStatus extends ValueObject<IndexStatusProps> {
  static active(): IndexStatus {
    return new IndexStatus({ value: "active" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: IndexStatusValue): IndexStatus {
    return new IndexStatus({ value });
  }

  get value(): IndexStatusValue {
    return this.props.value;
  }
}
