import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface TaxCalculatedData {
  readonly jurisdiction: string;
  readonly baseAmountMinor: number;
  readonly taxAmountMinor: number;
  readonly currency: string;
}

/** Raised when `TaxCalculator` computes tax due for a taxable amount. */
export class TaxCalculated extends DomainEvent {
  readonly eventName = "finance.tax_calculated";
  readonly data: TaxCalculatedData;

  constructor(props: DomainEventProps, data: TaxCalculatedData) {
    super(props);
    this.data = data;
  }
}
