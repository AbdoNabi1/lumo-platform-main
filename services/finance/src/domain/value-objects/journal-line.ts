import { type Money, ValueObject } from "@platform/domain";
import type { LedgerDirection } from "./ledger-direction";

interface JournalLineProps {
  readonly accountRef: string;
  readonly direction: LedgerDirection;
  readonly amount: Money;
  readonly memo?: string;
}

/** One debit or credit leg of a {@link Journal}. Amount is always non-negative (kernel `Money`); sign is carried by `direction`. */
export class JournalLine extends ValueObject<JournalLineProps> {
  static create(
    accountRef: string,
    direction: LedgerDirection,
    amount: Money,
    memo?: string,
  ): JournalLine {
    return new JournalLine({ accountRef, direction, amount, memo });
  }

  get accountRef(): string {
    return this.props.accountRef;
  }

  get direction(): LedgerDirection {
    return this.props.direction;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get memo(): string | undefined {
    return this.props.memo;
  }
}
