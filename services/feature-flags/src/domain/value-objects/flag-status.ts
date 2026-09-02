import { ValueObject } from "@platform/domain";

export type FlagStatusValue = "active" | "killed" | "archived";

const TRANSITIONS: Readonly<Record<FlagStatusValue, readonly FlagStatusValue[]>> = {
  active: ["killed", "archived"],
  killed: ["active", "archived"],
  archived: [],
};

/** Whether a transition from `from` to `to` is allowed by the flag lifecycle's transition table. */
export function canTransitionFlag(from: FlagStatusValue, to: FlagStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface FlagStatusProps {
  readonly value: FlagStatusValue;
}

/** The lifecycle state of a feature flag (active→killed→archived; killed can revive to active). */
export class FlagStatus extends ValueObject<FlagStatusProps> {
  static active(): FlagStatus {
    return new FlagStatus({ value: "active" });
  }

  static from(value: FlagStatusValue): FlagStatus {
    return new FlagStatus({ value });
  }

  get value(): FlagStatusValue {
    return this.props.value;
  }
}
