import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import type { OrderDetailDto } from "@/lib/api/orders";
import { formatClockTime, formatLongDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { canCancelFrom } from "@/lib/order-lifecycle";
import type { Dictionary } from "@/messages/en";
import { OrderMoreActions, OrderRefundButton } from "./order-header-actions";
import { OrderFulfillmentStatusBadge, OrderPaymentStatusBadge } from "./order-status-badge";

/**
 * The order page header, like Shopify's: a back arrow, the short number, the payment and fulfillment
 * badges, and "October 9, 2026 at 8:27 pm from Online Store" under them; Refund and "More actions" on
 * the end side. The refund button is enabled only when the backend accepts a refund — today that is
 * the legacy `paid` status alone (`RefundPolicy`), so a checkout order that is paid but not yet
 * refundable shows the button disabled rather than offering a call that can only fail.
 */
export function OrderHeader({
  order,
  t,
  locale,
}: {
  readonly order: OrderDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const placedAt = new Date(order.createdAt);
  const placed = t.orderPage.placedFromStore
    .replace("{date}", formatLongDate(locale, order.createdAt))
    .replace("{time}", formatClockTime(locale, placedAt));

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
          <Link href="/orders">
            <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {t.orderDetail.back}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight">#{order.orderNumber}</h1>
          <OrderPaymentStatusBadge status={order.paymentStatus} t={t} />
          <OrderFulfillmentStatusBadge status={order.fulfillmentStatus} t={t} />
        </div>
        <p className="text-muted-foreground mt-1 text-sm">{placed}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <OrderRefundButton orderId={order.id} enabled={order.status === "paid"} t={t} />
        <OrderMoreActions orderId={order.id} canCancel={canCancelFrom(order.status)} t={t} />
      </div>
    </header>
  );
}
