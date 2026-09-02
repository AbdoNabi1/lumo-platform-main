import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface BudgetUpdatedData {
  readonly costCenterRef: string;
  readonly period: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Raised when a {@link Budget} is created or revised. */
export class BudgetUpdated extends DomainEvent {
  readonly eventName = "finance.budget_updated";
  readonly data: BudgetUpdatedData;

  constructor(props: DomainEventProps, data: BudgetUpdatedData) {
    super(props);
    this.data = data;
  }
}
