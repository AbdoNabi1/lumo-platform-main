import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import type { OrderDetailDto } from "@/lib/api/orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { FulfillItemsButton } from "./fulfill-items-button";
import { OrderFulfillmentStatusBadge } from "./order-status-badge";

/** An order in one of these states is over: nothing is left to fulfill, so no "Fulfill items". */
const NOTHING_TO_FULFILL: ReadonlySet<string> = new Set(["cancelled", "closed", "refunded"]);

/** The shop's own label for a shipping method; one it has no label for shows as it was recorded. */
function deliveryMethodLine(method: string | null, t: Dictionary): string {
  if (method === null) return t.orderPage.noDeliveryMethod;
  const name = (t.shippingMethodLabel as Record<string, string>)[method] ?? method;
  return t.orderPage.deliveryMethodLine.replace("{method}", name);
}

/**
 * The fulfillment card, like Shopify's: titled with the fulfillment status and the number of items
 * ("Unfulfilled (3)"), the delivery method, then one row per item — a placeholder tile (product images
 * arrive with Plan 2C-3), the title linking to the product, the variant and SKU, and
 * "price × quantity" with the line total. The footer is a "Fulfill items" button while nothing has been
 * opened (and the order is still live), or a "View fulfillment" link once a fulfillment exists.
 *
 * Fulfillment never waits for payment: a cash-on-delivery order can be fulfilled while its payment is
 * still pending — opening a fulfillment asks nothing of the order's payment status.
 */
export function OrderItemsCard({
  order,
  t,
  locale,
}: {
  readonly order: OrderDetailDto;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const canFulfill =
    order.fulfillmentStatus === "unfulfilled" && !NOTHING_TO_FULFILL.has(order.status);
  const hasFulfillment = order.fulfillmentStatus !== "unfulfilled";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <OrderFulfillmentStatusBadge status={order.fulfillmentStatus} count={itemCount} t={t} />
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          {deliveryMethodLine(order.shippingMethod, t)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-border flex flex-col divide-y">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0">
              <div
                aria-hidden="true"
                className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg"
              >
                <ImageIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${item.productId}`}
                  className="hover:text-primary font-medium"
                >
                  {item.name}
                </Link>
                {item.variantTitle !== null && (
                  <p className="text-muted-foreground text-sm">{item.variantTitle}</p>
                )}
                {item.sku !== null && item.sku !== "" && (
                  <p className="text-muted-foreground text-sm">
                    {t.orderPage.sku.replace("{sku}", item.sku)}
                  </p>
                )}
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                {t.orderPage.unitTimesQuantity
                  .replace("{price}", formatCurrency(locale, item.unitPriceMinor, order.currency))
                  .replace("{quantity}", String(item.quantity))}
              </p>
              <p className="w-24 text-end font-medium tabular-nums">
                {formatCurrency(locale, item.lineTotalMinor, order.currency)}
              </p>
            </li>
          ))}
        </ul>

        {canFulfill && <FulfillItemsButton orderId={order.id} items={order.items} t={t} />}
        {hasFulfillment && (
          <Button variant="outline" asChild className="self-start">
            <Link href={`/orders/${order.id}/fulfillment`}>{t.orderPage.viewFulfillment}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
