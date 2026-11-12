"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { OrderListItemDto } from "@/lib/api/orders";
import { formatCurrency, formatNumber, orderDateParts } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { NO_ORDER_ACTIONS, type OrderActionPermissions } from "@/lib/orders/order-views";
import type { Dictionary } from "@/messages/en";
import { BulkResultNote, OrdersBulkBar, type BulkOutcome } from "./orders-bulk-bar";
import { OrderFulfillmentStatusBadge, OrderPaymentStatusBadge } from "./order-status-badge";
import { OrdersExportDialog, type OrdersExportContext } from "./orders-export-dialog";

/** Columns that only fit from the medium breakpoint up. On a phone: Order, Customer, Total, Payment status. */
const FROM_MD = "hidden md:table-cell";

/** "Today at 8:27 pm" / "Yesterday at …" / "Oct 7 at …", in the page locale. */
function dateLabel(parts: ReturnType<typeof orderDateParts>, t: Dictionary): string {
  const template =
    parts.when === "today"
      ? t.ordersPage.dateToday
      : parts.when === "yesterday"
        ? t.ordersPage.dateYesterday
        : t.ordersPage.dateOther;
  return template.replace("{date}", parts.date).replace("{time}", parts.time);
}

/** "1 item" / "3 items" / "منتجين" — the plural form comes from the locale's own rules. */
function itemCountLabel(count: number, locale: Locale, t: Dictionary): string {
  const category = new Intl.PluralRules(locale).select(count);
  return t.ordersPage.itemCount[category].replace("{count}", formatNumber(locale, count));
}

/** The list's Tags column (spec §2.4): the first three tags as chips, then "+N more". */
function OrderTagsCell({
  tags,
  t,
  locale,
}: {
  readonly tags: readonly string[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (tags.length === 0) return null;
  const rest = tags.length - 3;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tags.slice(0, 3).map((tag) => (
        <Badge key={tag} variant="neutral">
          <span dir="auto">{tag}</span>
        </Badge>
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground text-xs">
          {t.ordersPage.moreTags.replace("{count}", () => formatNumber(locale, rest))}
        </span>
      )}
    </span>
  );
}

/** The shop's own label for a shipping method; a method it has no label for shows as it was recorded. */
function deliveryLabel(method: string | null, t: Dictionary): string {
  if (method === null) return "—";
  return (t.shippingMethodLabel as Record<string, string>)[method] ?? method;
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly onChange: () => void;
  readonly label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="accent-primary relative z-10 size-4"
      checked={checked}
      onChange={onChange}
      aria-label={label}
    />
  );
}

/**
 * The orders list, like Shopify's: a checkbox column (select all on this page), the short number with an
 * Archived badge, a relative date, the customer, the total and both statuses. While rows are selected the
 * header becomes the bulk-action bar. Selection is per page: it clears whenever the page's orders change.
 * The Order link is stretched over the row; the checkboxes sit above it (`z-10`). `now` is injectable so
 * the relative date is testable.
 */
export function OrdersTable({
  orders,
  t,
  locale,
  now,
  permissions = NO_ORDER_ACTIONS,
  exportContext,
}: {
  readonly orders: readonly OrderListItemDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly now?: Date;
  /** The bulk actions this staff member may take (server-decided); none when omitted. */
  readonly permissions?: OrderActionPermissions;
  /** What the list is showing; when given, "Export selected" opens the export dialog on the selection. */
  readonly exportContext?: OrdersExportContext | undefined;
}) {
  const reference = now ?? new Date();
  const pageKey = orders.map((order) => order.id).join(",");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setSelected(new Set());
  }, [pageKey]);

  const selectedOrders = orders.filter((order) => selected.has(order.id));
  const allSelected = orders.length > 0 && selectedOrders.length === orders.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(orders.map((order) => order.id)));
  const toggleOne = (orderId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });

  const selectAll = (
    <SelectAllCheckbox
      checked={allSelected}
      indeterminate={selectedOrders.length > 0 && !allSelected}
      onChange={toggleAll}
      label={t.ordersPage.selectAll}
    />
  );

  return (
    <div className="flex flex-col">
      {outcome !== null && (
        <BulkResultNote
          outcome={outcome}
          t={t}
          locale={locale}
          onDismiss={() => setOutcome(null)}
        />
      )}
      <Table aria-label={t.ordersPage.title}>
        <TableHeader>
          {selectedOrders.length > 0 ? (
            <TableRow>
              <TableHead className="w-10">{selectAll}</TableHead>
              <TableHead colSpan={9}>
                <OrdersBulkBar
                  selected={selectedOrders}
                  t={t}
                  locale={locale}
                  permissions={permissions}
                  onExportSelected={
                    exportContext === undefined ? undefined : () => setExportOpen(true)
                  }
                  onFinished={(next) => {
                    setOutcome(next);
                    setSelected(new Set());
                  }}
                />
              </TableHead>
            </TableRow>
          ) : (
            <TableRow>
              <TableHead className="w-10">{selectAll}</TableHead>
              <TableHead>{t.ordersPage.columns.order}</TableHead>
              <TableHead className={FROM_MD}>{t.ordersPage.columns.date}</TableHead>
              <TableHead>{t.ordersPage.columns.customer}</TableHead>
              <TableHead className="text-end">{t.ordersPage.columns.total}</TableHead>
              <TableHead>{t.ordersPage.columns.paymentStatus}</TableHead>
              <TableHead className={FROM_MD}>{t.ordersPage.columns.fulfillmentStatus}</TableHead>
              <TableHead className={FROM_MD}>{t.ordersPage.columns.items}</TableHead>
              <TableHead className={FROM_MD}>{t.ordersPage.columns.deliveryMethod}</TableHead>
              <TableHead className={FROM_MD}>{t.ordersPage.columns.tags}</TableHead>
            </TableRow>
          )}
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const date = orderDateParts(locale, order.createdAt, reference);
            return (
              <TableRow
                key={order.id}
                className="hover:bg-muted/50 relative"
                data-state={selected.has(order.id) ? "selected" : undefined}
              >
                <TableCell className="relative z-10 w-10">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={selected.has(order.id)}
                    onChange={() => toggleOne(order.id)}
                    aria-label={t.ordersPage.selectOrder.replace(
                      "{orderNumber}",
                      order.orderNumber,
                    )}
                  />
                </TableCell>
                <TableCell className="font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <Link
                      href={`/orders/${order.id}`}
                      className="hover:text-primary focus-visible:after:ring-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
                      aria-label={t.ordersPage.viewOrder.replace(
                        "{orderNumber}",
                        order.orderNumber,
                      )}
                    >
                      #{order.orderNumber}
                    </Link>
                    {order.archivedAt ? (
                      <Badge variant="neutral">{t.ordersPage.archivedBadge}</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell
                  className={`text-muted-foreground whitespace-nowrap ${FROM_MD}`}
                  title={date.full}
                >
                  {dateLabel(date, t)}
                </TableCell>
                <TableCell>
                  {order.customerName === null ? (
                    <span className="text-muted-foreground">{t.ordersPage.noCustomer}</span>
                  ) : (
                    <span className="truncate">{order.customerName}</span>
                  )}
                </TableCell>
                <TableCell className="text-end font-medium tabular-nums">
                  {formatCurrency(locale, order.totalMinor, order.currency)}
                </TableCell>
                <TableCell>
                  <OrderPaymentStatusBadge status={order.paymentStatus} t={t} />
                </TableCell>
                <TableCell className={FROM_MD}>
                  <OrderFulfillmentStatusBadge status={order.fulfillmentStatus} t={t} />
                </TableCell>
                <TableCell className={`text-muted-foreground whitespace-nowrap ${FROM_MD}`}>
                  {itemCountLabel(order.itemCount, locale, t)}
                </TableCell>
                <TableCell className={`text-muted-foreground ${FROM_MD}`}>
                  {deliveryLabel(order.shippingMethod, t)}
                </TableCell>
                <TableCell className={FROM_MD}>
                  <OrderTagsCell tags={order.tags ?? []} t={t} locale={locale} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {exportOpen && exportContext !== undefined && (
        <OrdersExportDialog
          open
          onOpenChange={setExportOpen}
          context={exportContext}
          selectedIds={selectedOrders.map((order) => order.id)}
          defaultScope="selected"
          t={t}
        />
      )}
    </div>
  );
}
