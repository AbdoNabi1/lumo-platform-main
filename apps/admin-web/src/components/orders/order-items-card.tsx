import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@platform/ui";
import type { OrderDetailItemDto, OrderTotalsDto } from "@/lib/api/orders";
import { formatCurrency } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export function OrderItemsCard({
  items,
  totals,
  fallbackTotalMinor,
  currency,
  t,
  locale,
}: {
  readonly items: readonly OrderDetailItemDto[];
  readonly totals: OrderTotalsDto | null;
  readonly fallbackTotalMinor: number;
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.orderDetail.items}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
        <Table aria-label={t.orderDetail.items}>
          <TableHeader>
            <TableRow>
              <TableHead>{t.orderDetail.product}</TableHead>
              <TableHead className="text-end">{t.orderDetail.quantity}</TableHead>
              <TableHead className="text-end">{t.orderDetail.unitPrice}</TableHead>
              <TableHead className="text-end">{t.orderDetail.lineTotal}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-end tabular-nums">{item.quantity}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatCurrency(locale, item.unitPriceMinor, currency)}
                </TableCell>
                <TableCell className="text-end font-medium tabular-nums">
                  {formatCurrency(locale, item.lineTotalMinor, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="border-border flex flex-col gap-2 border-t px-4 py-4 sm:px-5">
          {totals === null ? (
            <>
              <p className="text-muted-foreground text-sm">{t.orderDetail.totalsUnavailable}</p>
              <TotalsRow
                label={t.orderDetail.total}
                amountMinor={fallbackTotalMinor}
                currency={currency}
                locale={locale}
                emphasize
              />
            </>
          ) : (
            <>
              <TotalsRow
                label={t.orderDetail.subtotal}
                amountMinor={totals.subtotalMinor}
                currency={totals.currency}
                locale={locale}
              />
              <TotalsRow
                label={t.orderDetail.shipping}
                amountMinor={totals.shippingMinor}
                currency={totals.currency}
                locale={locale}
              />
              <TotalsRow
                label={t.orderDetail.tax}
                amountMinor={totals.taxMinor}
                currency={totals.currency}
                locale={locale}
              />
              {totals.discountMinor > 0 && (
                <TotalsRow
                  label={t.orderDetail.discount}
                  amountMinor={-totals.discountMinor}
                  currency={totals.currency}
                  locale={locale}
                />
              )}
              <TotalsRow
                label={t.orderDetail.total}
                amountMinor={totals.totalMinor}
                currency={totals.currency}
                locale={locale}
                emphasize
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TotalsRow({
  label,
  amountMinor,
  currency,
  locale,
  emphasize = false,
}: {
  readonly label: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly locale: Locale;
  readonly emphasize?: boolean;
}) {
  return (
    <div
      className={
        emphasize
          ? "flex items-center justify-between text-base font-semibold"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={emphasize ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{formatCurrency(locale, amountMinor, currency)}</span>
    </div>
  );
}
