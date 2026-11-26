import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface ConsentChangedData {
  readonly scope: string;
  readonly granted: boolean;
  /** Present when the shopper made the choice themselves (`shopper/checkout`); absent for staff. */
  readonly source?: string;
}

/** Raised when a customer grants or revokes consent for a scope. */
export class ConsentChanged extends DomainEvent {
  readonly eventName = "consent.changed";
  readonly data: ConsentChangedData;

  constructor(props: DomainEventProps, data: ConsentChangedData) {
    super(props);
    this.data = data;
  }
}
