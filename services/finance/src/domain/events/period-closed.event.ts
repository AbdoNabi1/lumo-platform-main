import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface PeriodClosedData {
  readonly startDate: string;
  readonly endDate: string;
}

/** Raised when a {@link FiscalPeriod} is closed (via {@link FiscalClosingService}). */
export class PeriodClosed extends DomainEvent {
  readonly eventName = "finance.period_closed";
  readonly data: PeriodClosedData;

  constructor(props: DomainEventProps, data: PeriodClosedData) {
    super(props);
    this.data = data;
  }
}
