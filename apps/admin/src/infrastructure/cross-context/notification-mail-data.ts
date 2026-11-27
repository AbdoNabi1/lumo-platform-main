import type { Order } from "@platform/orders";

/**
 * Wave 2b: what the order mails keep on a notification row. Order facts only: the order number, the
 * currency, the totals and the lines (product names and prices), plus the bare customer reference.
 * No address, no name, no email, no body (ADR-0006). The recipient's address and name are read when
 * the mail is sent.
 */
export interface MailLine {
  readonly name: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly unitAmountMinor: number;
}

export interface MailTotals {
  readonly subtotalMinor?: number;
  readonly discountMinor?: number;
  readonly shippingMinor?: number;
  readonly taxMinor?: number;
  readonly totalMinor: number;
}

export function orderJson(lines: readonly MailLine[], totals: MailTotals): string {
  return JSON.stringify({ lines, ...totals });
}

export function orderMailVariables(order: Order): Record<string, string> {
  const totals = order.totals;
  const lines: MailLine[] = order.items.map((item) => ({
    name: item.snapshot.name,
    variantTitle: item.snapshot.variantTitle ?? null,
    quantity: item.quantity,
    unitAmountMinor: item.snapshot.unitPrice.amountMinor,
  }));
  const totalMinor = totals?.totalMinor ?? order.totalAmount().amountMinor;
  return {
    order_number: order.orderNumber.value,
    currency: order.currency,
    total_minor: String(totalMinor),
    customer_ref: order.customerRef,
    order_json: orderJson(lines, {
      totalMinor,
      ...(totals === undefined
        ? {}
        : {
            subtotalMinor: totals.subtotalMinor,
            discountMinor: totals.discountMinor,
            shippingMinor: totals.shippingMinor,
            taxMinor: totals.taxMinor,
          }),
    }),
  };
}
