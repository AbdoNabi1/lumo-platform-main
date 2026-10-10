import { Suspense } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import type { OrderDetailDto } from "@/lib/api/orders";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { OrderLifecycleActions } from "./order-lifecycle-actions";
import { OrderReturnsCard, OrderReturnsCardSkeleton } from "./order-returns-card";
import { OrderShippingCard, OrderShippingCardSkeleton } from "./order-shipping-card";

/**
 * The developer-ish controls the order page used to lead with, collapsed under "Advanced": the
 * lifecycle actions card exactly as it was (Advance to…, Payment reference / Mark paid, Request
 * payment capture, Request fulfillment) plus the returns and shipment cards with their links to the
 * screens that already exist. A native `<details>`, closed by default — everything inside is still in
 * the page, one click away.
 */
export function OrderAdvancedSection({
  order,
  t,
  locale,
}: {
  readonly order: OrderDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <details className="border-border bg-card group rounded-2xl border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-lg font-semibold">{t.orderPage.advanced}</span>
          <span className="text-muted-foreground block text-sm">{t.orderPage.advancedHint}</span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="text-muted-foreground size-5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-6 px-4 pb-4 sm:px-5 sm:pb-5">
        <Card>
          <CardContent>
            <OrderLifecycleActions orderId={order.id} status={order.status} t={t} />
          </CardContent>
        </Card>
        <Suspense fallback={<OrderShippingCardSkeleton t={t} />}>
          <OrderShippingCard orderId={order.id} t={t} locale={locale} />
        </Suspense>
        <Suspense fallback={<OrderReturnsCardSkeleton t={t} />}>
          <OrderReturnsCard orderId={order.id} t={t} locale={locale} />
        </Suspense>
      </div>
    </details>
  );
}
