import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface TaxClassCreatedData {
  readonly code: string;
  readonly name: string;
}

/** Raised when a new tax classification is created. */
export class TaxClassCreated extends DomainEvent {
  readonly eventName = "tax_class.created";
  readonly data: TaxClassCreatedData;

  constructor(props: DomainEventProps, data: TaxClassCreatedData) {
    super(props);
    this.data = data;
  }
}
