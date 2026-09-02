import { DomainEvent, type DomainEventProps } from "@platform/domain";

export interface CheckoutRecalculatedData {
  readonly cartRef: string;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
}

/** Raised whenever the session's assembled totals are recalculated (a snapshot changed). */
export class CheckoutRecalculated extends DomainEvent {
  readonly eventName = "checkout_session.recalculated";
  readonly data: CheckoutRecalculatedData;

  constructor(props: DomainEventProps, data: CheckoutRecalculatedData) {
    super(props);
    this.data = data;
  }
}
