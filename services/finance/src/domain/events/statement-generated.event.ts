import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface StatementGeneratedData {
  readonly period: string;
  readonly statementType: "trial_balance" | "income_statement" | "balance_sheet";
  readonly currency: string;
}

/** Raised when `StatementBuilder` produces a statement for a period. */
export class StatementGenerated extends DomainEvent {
  readonly eventName = "finance.statement_generated";
  readonly data: StatementGeneratedData;

  constructor(props: DomainEventProps, data: StatementGeneratedData) {
    super(props);
    this.data = data;
  }
}
