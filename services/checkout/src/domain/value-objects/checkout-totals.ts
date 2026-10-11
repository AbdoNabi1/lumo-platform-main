import { ValueObject } from "@platform/domain";
import type { CheckoutItem } from "./checkout-item";

interface CheckoutTotalsProps {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  /** Plan 3C: true when `taxMinor` is already inside the prices (so it is not added to the total). */
  readonly taxIncluded: boolean;
  readonly shippingName?: string;
}

/**
 * The session's assembled totals — a **sum of stored snapshots** (subtotal from `CheckoutItem`
 * lines, tax/shipping/discount from their respective request-and-store snapshots). Never computes
 * tax, shipping rates, or discounts itself (those stay Finance/Shipping/Promotions' jobs).
 */
export class CheckoutTotals extends ValueObject<CheckoutTotalsProps> {
  static assemble(
    items: readonly CheckoutItem[],
    taxMinor: number,
    shippingMinor: number,
    discountMinor: number,
    currency: string,
    extra: { readonly taxIncluded?: boolean; readonly shippingName?: string | undefined } = {},
  ): CheckoutTotals {
    const subtotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const taxIncluded = extra.taxIncluded ?? false;
    // grandTotal = subtotal + shipping − discount + (taxIncluded ? 0 : tax)
    const totalMinor = Math.max(
      0,
      subtotalMinor + shippingMinor - discountMinor + (taxIncluded ? 0 : taxMinor),
    );
    return new CheckoutTotals({
      subtotalMinor,
      taxMinor,
      shippingMinor,
      discountMinor,
      totalMinor,
      currency,
      taxIncluded,
      ...(extra.shippingName === undefined ? {} : { shippingName: extra.shippingName }),
    });
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

  get taxIncluded(): boolean {
    return this.props.taxIncluded;
  }

  get shippingName(): string | undefined {
    return this.props.shippingName;
  }
}
