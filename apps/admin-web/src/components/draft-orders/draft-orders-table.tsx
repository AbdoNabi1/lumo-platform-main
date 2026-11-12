import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { DraftOrderListItemDto, DraftOrderStatus } from "@/lib/api/draft-orders";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** `@platform/ui` Badge variants (neutral, accent, success, warning, destructive, info, outline). */
export const DRAFT_BADGE: Record<DraftOrderStatus, "neutral" | "info" | "success"> = {
  open: "neutral",
  invoice_sent: "info",
  completed: "success",
};

/** Shopify's Drafts table. Server-renderable: receives DTOs, imports no API code. */
export function DraftOrdersTable({
  drafts,
  t,
  locale,
}: {
  readonly drafts: readonly DraftOrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const d = t.draftOrders;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{d.columns.draft}</TableHead>
          <TableHead>{d.columns.date}</TableHead>
          <TableHead>{d.columns.customer}</TableHead>
          <TableHead>{d.columns.status}</TableHead>
          <TableHead className="text-end">{d.columns.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => (
          <TableRow key={draft.id}>
            <TableCell>
              <Link
                href={`/draft-orders/${encodeURIComponent(draft.id)}`}
                dir="ltr"
                className="font-medium hover:underline"
              >
                {`#${draft.draftNumber}`}
              </Link>
              {draft.orderRef !== null && draft.orderNumber !== null && (
                <Link
                  href={`/orders/${encodeURIComponent(draft.orderRef)}`}
                  className="text-muted-foreground ms-2 text-sm hover:underline"
                >
                  {d.orderLink.replace("{number}", () => draft.orderNumber ?? "")}
                </Link>
              )}
            </TableCell>
            <TableCell>{formatShortDate(locale, draft.createdAt)}</TableCell>
            <TableCell>
              <span dir="auto">{draft.customerName ?? d.noCustomer}</span>
            </TableCell>
            <TableCell>
              <Badge variant={DRAFT_BADGE[draft.status]}>{d.status[draft.status]}</Badge>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatCurrency(locale, draft.totalMinor, draft.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
