import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CheckoutLockedData {
  readonly cartRef: string;
  readonly customerRef?: string;
}

/** Raised when a checkout session is locked (e.g. while the purchase saga is running). */
export class CheckoutLocked extends DomainEvent {
  readonly eventName = "checkout_session.locked";
  readonly data: CheckoutLockedData;

  constructor(props: DomainEventProps, data: CheckoutLockedData) {
    super(props);
    this.data = data;
  }
}
