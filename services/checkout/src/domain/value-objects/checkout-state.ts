import { ValueObject } from "@platform/domain";

export type CheckoutStateValue = "started" | "locked" | "completed" | "failed" | "expired";

interface CheckoutStateProps {
  readonly value: CheckoutStateValue;
}

/** The state of a checkout session (a closed set of internal states; not external input). */
export class CheckoutState extends ValueObject<CheckoutStateProps> {
  static started(): CheckoutState {
    return new CheckoutState({ value: "started" });
  }

  static locked(): CheckoutState {
    return new CheckoutState({ value: "locked" });
  }

  static completed(): CheckoutState {
    return new CheckoutState({ value: "completed" });
  }

  static failed(): CheckoutState {
    return new CheckoutState({ value: "failed" });
  }

  static expired(): CheckoutState {
    return new CheckoutState({ value: "expired" });
  }

  /** Rehydrates a persisted state value (infrastructure trusts stored data; G-12). */
  static from(value: CheckoutStateValue): CheckoutState {
    return new CheckoutState({ value });
  }

  get value(): CheckoutStateValue {
    return this.props.value;
  }

  get isStarted(): boolean {
    return this.props.value === "started";
  }

  /** Modifiable states — details can still be set/recalculated (not a terminal or in-flight-lock state). */
  get isOpen(): boolean {
    return this.props.value === "started" || this.props.value === "locked";
  }
}
