import { ValueObject } from "@platform/domain";

interface OrderTotalsSnapshotProps {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  /** Plan 3B: the shipping method the shopper selected (e.g. "standard"); absent on older orders. */
  readonly shippingMethod?: string;
  /** Plan 3C: what the shopper saw for that rate ("Standard"); absent on older orders. */
  readonly shippingName?: string;
  /** Plan 3C: true when `taxMinor` is already inside the prices; absent on older orders (tax was added). */
  readonly taxIncluded?: boolean;
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

  get shippingMethod(): string | undefined {
    return this.props.shippingMethod;
  }

  get shippingName(): string | undefined {
    return this.props.shippingName;
  }

  /** True when the tax is inside the prices, so it is not an extra on top of the total. */
  get taxIncluded(): boolean {
    return this.props.taxIncluded ?? false;
  }
}
