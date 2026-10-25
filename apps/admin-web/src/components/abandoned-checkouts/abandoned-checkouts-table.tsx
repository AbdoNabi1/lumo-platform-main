import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { AbandonedCheckoutListItemDto } from "@/lib/api/abandoned-checkouts";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { placedByLabel } from "@/lib/orders/abandoned-checkouts";
import type { Dictionary } from "@/messages/en";

/** Shopify's abandoned-checkouts table. Server-renderable: receives DTOs, imports no API code. */
export function AbandonedCheckoutsTable({
  checkouts,
  t,
  locale,
}: {
  readonly checkouts: readonly AbandonedCheckoutListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const a = t.abandonedCheckouts;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{a.columns.checkout}</TableHead>
          <TableHead>{a.columns.date}</TableHead>
          <TableHead>{a.columns.placedBy}</TableHead>
          <TableHead>{a.columns.region}</TableHead>
          <TableHead>{a.columns.recoveryLink}</TableHead>
          <TableHead>{a.columns.recoveryStatus}</TableHead>
          <TableHead className="text-end">{a.columns.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checkouts.map((checkout) => (
          <TableRow key={checkout.id}>
            <TableCell>
              <Link
                href={`/abandoned-checkouts/${encodeURIComponent(checkout.id)}`}
                className="font-medium hover:underline"
              >
                {checkout.reference}
              </Link>
            </TableCell>
            <TableCell>{formatShortDate(locale, checkout.createdAt)}</TableCell>
            <TableCell>
              <span dir="auto">{placedByLabel(checkout) ?? a.unknownCustomer}</span>
            </TableCell>
            <TableCell>{checkout.region ?? a.noRegion}</TableCell>
            <TableCell>
              {checkout.lastLinkIssuedAt === null
                ? a.notShared
                : a.shared.replace("{date}", () =>
                    formatShortDate(locale, checkout.lastLinkIssuedAt ?? ""),
                  )}
            </TableCell>
            <TableCell>
              {checkout.recoveredOrder !== null ? (
                <Link href={`/orders/${encodeURIComponent(checkout.recoveredOrder.id)}`}>
                  <Badge variant="success">{a.recovered}</Badge>
                </Link>
              ) : (
                <Badge variant="neutral">{a.notRecovered}</Badge>
              )}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatCurrency(locale, checkout.totalMinor, checkout.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
