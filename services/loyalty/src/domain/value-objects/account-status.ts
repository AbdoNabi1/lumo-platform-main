import { ValueObject } from "@platform/domain";

export type AccountStatusValue = "active" | "suspended" | "closed";

/** The validated lifecycle transition table (Sprint 5.1). */
const TRANSITIONS: Readonly<Record<AccountStatusValue, readonly AccountStatusValue[]>> = {
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

/** Whether a transition from `from` to `to` is allowed by the loyalty-account lifecycle's transition table. */
export function canTransitionAccount(from: AccountStatusValue, to: AccountStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

interface AccountStatusProps {
  readonly value: AccountStatusValue;
}

/** The lifecycle state of a loyalty account (active/suspended/closed). */
export class AccountStatus extends ValueObject<AccountStatusProps> {
  static active(): AccountStatus {
    return new AccountStatus({ value: "active" });
  }

  /** Rehydrates a persisted status value (infrastructure trusts stored data; G-12). */
  static from(value: AccountStatusValue): AccountStatus {
    return new AccountStatus({ value });
  }

  get value(): AccountStatusValue {
    return this.props.value;
  }
}
