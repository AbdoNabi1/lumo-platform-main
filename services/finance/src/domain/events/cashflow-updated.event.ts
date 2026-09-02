import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CashflowUpdatedData {
  readonly period: string;
  readonly netMinor: number;
  readonly currency: string;
}

/** Raised when `CashFlowProjector` recomputes a period's net cash flow. */
export class CashflowUpdated extends DomainEvent {
  readonly eventName = "finance.cashflow_updated";
  readonly data: CashflowUpdatedData;

  constructor(props: DomainEventProps, data: CashflowUpdatedData) {
    super(props);
    this.data = data;
  }
}
