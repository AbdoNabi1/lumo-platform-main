import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ExpenseCreatedData {
  readonly costCenterRef: string;
  readonly categoryRef: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Raised when a merchant-entered {@link Expense} is recorded. */
export class ExpenseCreated extends DomainEvent {
  readonly eventName = "finance.expense_created";
  readonly data: ExpenseCreatedData;

  constructor(props: DomainEventProps, data: ExpenseCreatedData) {
    super(props);
    this.data = data;
  }
}
