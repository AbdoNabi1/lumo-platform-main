import { ValueObject } from "@platform/domain";

interface OrderTotalsSnapshotProps {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
}

/** An immutable copy of Checkout's assembled totals, captured at order creation — Orders recalculates nothing. */
export class OrderTotalsSnapshot extends ValueObject<OrderTotalsSnapshotProps> {
  static create(props: OrderTotalsSnapshotProps): OrderTotalsSnapshot {
    return new OrderTotalsSnapshot(props);
  }

  get subtotalMinor(): number {
    return this.props.subtotalMinor;
  }

  get taxMinor(): number {
    return this.props.taxMinor;
  }

  get shippingMinor(): number {
    return this.props.shippingMinor;
  }

  get discountMinor(): number {
    return this.props.discountMinor;
  }

  get totalMinor(): number {
    return this.props.totalMinor;
  }

  get currency(): string {
    return this.props.currency;
  }
}
