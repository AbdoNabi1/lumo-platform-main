import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { DiscountDto } from "@/lib/discounts/model";
import { combinationsShort, listSummary } from "@/lib/discounts/summary";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { DiscountStatusBadge } from "./discount-status-badge";

/**
 * Shopify's discount list: Title (the code, or an automatic discount's title, with its summary line
 * under it), Status, Method, Type, Combinations, Used. The title links to the discount.
 */
export function DiscountsTable({
  items,
  t,
  locale,
  currency,
  timeZone,
}: {
  readonly items: readonly DiscountDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly currency: string;
  readonly timeZone: string;
}) {
  const ctx = { t: t.discounts.summary, locale, currency, timeZone };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.discounts.columns.title}</TableHead>
          <TableHead>{t.discounts.columns.status}</TableHead>
          <TableHead>{t.discounts.columns.method}</TableHead>
          <TableHead>{t.discounts.columns.type}</TableHead>
          <TableHead>{t.discounts.columns.combinations}</TableHead>
          <TableHead className="text-end">{t.discounts.columns.used}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((discount) => {
          const summary = listSummary(discount, ctx);
          return (
            <TableRow key={discount.id}>
              <TableCell>
                <div className="flex flex-col">
                  <Link
                    href={`/discounts/${encodeURIComponent(discount.id)}`}
                    className="font-medium hover:underline"
                  >
                    {discount.code ?? discount.title}
                  </Link>
                  {summary !== "" && (
                    <span className="text-muted-foreground text-xs">{summary}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <DiscountStatusBadge status={discount.status} t={t} />
              </TableCell>
              <TableCell>{t.discounts.methods[discount.method]}</TableCell>
              <TableCell>{t.discounts.types[discount.type]}</TableCell>
              <TableCell>{combinationsShort(discount.combinesWith, t.discounts, locale)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {formatNumber(locale, discount.usageCount)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
