import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import type { OrderDetailDto } from "@/lib/api/orders";
import { fetchPaymentIntent } from "@/lib/api/payments";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { paymentMethodLabel } from "@/lib/payment-method-label";
import type { Dictionary } from "@/messages/en";
import { CodCollectionForm } from "./cod-collection-form";
import { MarkPaidDialog } from "./mark-paid-dialog";
import { OrderPaymentStatusBadge } from "./order-status-badge";

/** A payment in one of these states can never be collected, whatever its amounts say. */
const CLOSED_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "captured",
  "refunded",
  "partially_refunded",
  "closed",
  "cancelled",
  "expired",
  "failed",
]);

/** "3 items" / "منتجين" — the plural form comes from the locale's own rules. */
function itemsNote(count: number, locale: Locale, t: Dictionary): string {
  const category = new Intl.PluralRules(locale).select(count);
  return t.ordersPage.itemCount[category].replace("{count}", formatNumber(locale, count));
}

/**
 * The payment card, like Shopify's: titled with the payment status, then Subtotal ("3 items"),
 * Shipping (the method), Taxes and a bold Total, a divider, "Paid by customer" and — while payment is
 * pending — the Balance still owed. Phase 2: one Discount line per discount, with its code (or an
 * automatic discount's title) beside it — Shopify's "Discount SALE10"; a shipping discount is its own
 * line, since Shipping shows the rate before it. Under it, how the customer pays, and the one action
 * that fits:
 *
 * - a cash-on-delivery payment not yet collected → "Mark as paid" (the confirmed collection, with its
 *   confirm, `confirmCodCollectionAction`);
 * - an order with NO payment linked, still `placed` → "Mark as paid" asking for a payment reference
 *   (`markOrderPaidAction`, which only works for a `placed` order and a payment Payments can verify);
 * - nothing otherwise — never a button that can only fail.
 *
 * `paymentRef` IS the `PaymentIntent` id (see `apps/runtime`'s `hasCapturedPayment`), resolved here
 * against Payments for the captured amount. An async Server Component in its own `<Suspense>` boundary
 * so a slow or failed Payments lookup never blocks the rest of the order — the totals still render.
 */
export async function OrderPaymentCard({
  order,
  t,
  locale,
}: {
  readonly order: OrderDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const intent = order.paymentRef === null ? null : await fetchPaymentIntent(order.paymentRef);
  const payment = intent?.outcome === "ok" ? intent.paymentIntent : null;

  const currency = order.totals?.currency ?? order.currency;
  const total = order.totals?.totalMinor ?? order.totalMinor;
  const money = (amountMinor: number) => formatCurrency(locale, amountMinor, currency);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  // Plan 3C: the rate's recorded name when there is one; an older order's method key has its own label.
  const shippingMethodName =
    order.totals?.shippingName != null && order.totals.shippingName !== ""
      ? order.totals.shippingName
      : order.shippingMethod === null
        ? null
        : ((t.shippingMethodLabel as Record<string, string>)[order.shippingMethod] ??
          order.shippingMethod);
  // Plan 3C: prices that include tax carry it inside the total, so it is a note under the total, not an
  // extra line; with none collected there is nothing to note.
  const taxIncluded = order.totals?.taxIncluded === true;

  // What the customer has paid: the captured amount when Payments says so; a legacy paid order with no
  // intent to ask was paid in full; otherwise nothing.
  const paid = payment?.capturedAmountMinor ?? (order.paymentStatus === "paid" ? total : 0);
  const pending = order.paymentStatus === "pending";
  const balance = Math.max(total - paid, 0);

  const collectable =
    pending &&
    payment !== null &&
    payment.provider === "cod" &&
    payment.capturedAmountMinor < payment.amountMinor &&
    !CLOSED_PAYMENT_STATUSES.has(payment.status);
  const canMarkWithReference = pending && order.paymentRef === null && order.status === "placed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <OrderPaymentStatusBadge status={order.paymentStatus} t={t} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          {order.totals !== null && (
            <>
              <Line
                label={t.orderPage.paymentSubtotal}
                note={itemsNote(itemCount, locale, t)}
                value={money(order.totals.subtotalMinor)}
              />
              <Line
                label={t.orderPage.paymentShipping}
                note={shippingMethodName}
                value={money(order.totals.shippingMinor)}
              />
              {!taxIncluded && (
                <Line label={t.orderPage.paymentTaxes} value={money(order.totals.taxMinor)} />
              )}
              {(order.totals.discounts ?? []).length > 0
                ? (order.totals.discounts ?? []).map((discount, index) => (
                    <Line
                      key={`${discount.code ?? discount.title}-${index}`}
                      label={t.orderPage.paymentDiscount}
                      note={discount.code ?? discount.title}
                      value={money(-discount.amountMinor)}
                    />
                  ))
                : order.totals.discountMinor > 0 && (
                    <Line
                      label={t.orderPage.paymentDiscount}
                      value={money(-order.totals.discountMinor)}
                    />
                  )}
            </>
          )}
          <Line label={t.orderPage.paymentTotal} value={money(total)} strong />
        </dl>
        {order.totals !== null && taxIncluded && order.totals.taxMinor > 0 && (
          <p className="text-muted-foreground text-sm">
            {t.orderPage.paymentTaxesIncluded.replace("{tax}", money(order.totals.taxMinor))}
          </p>
        )}

        <dl className="border-border flex flex-col gap-2 border-t pt-4 text-sm">
          <Line label={t.orderPage.paidByCustomer} value={money(paid)} />
          {pending && <Line label={t.orderPage.balance} value={money(balance)} strong />}
        </dl>

        <dl className="border-border flex flex-col gap-2 border-t pt-4 text-sm">
          <Line
            label={t.orderPage.paymentMethodLine}
            value={paymentMethodLabel(order.paymentProvider, t)}
          />
          {payment !== null && payment.refundedAmountMinor > 0 && (
            <Line
              label={t.orderDetail.paymentRefunded}
              value={money(payment.refundedAmountMinor)}
            />
          )}
          {payment?.pspReference != null && (
            <Line
              label={t.orderDetail.paymentReference}
              value={<span className="font-mono text-xs">{payment.pspReference}</span>}
            />
          )}
        </dl>
        {intent !== null && intent.outcome !== "ok" && (
          <p className="text-muted-foreground text-sm">{t.orderDetail.paymentUnavailable}</p>
        )}

        {collectable && payment !== null && (
          <CodCollectionForm
            orderId={order.id}
            paymentIntentId={payment.id}
            confirmMessage={t.orderDetail.confirmCashReceived.replace(
              "{amount}",
              formatCurrency(locale, payment.amountMinor, payment.currency),
            )}
            t={t}
          />
        )}
        {canMarkWithReference && <MarkPaidDialog orderId={order.id} t={t} />}
      </CardContent>
    </Card>
  );
}

function Line({
  label,
  note,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly note?: string | null;
  readonly value: ReactNode;
  readonly strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-baseline justify-between gap-3 text-base font-semibold"
          : "flex items-baseline justify-between gap-3"
      }
    >
      <dt className={strong ? "" : "text-muted-foreground"}>
        {label}
        {note != null && note !== "" && (
          <span className="text-muted-foreground ms-2 text-xs font-normal">{note}</span>
        )}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function OrderPaymentCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.orderDetail.payment}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
