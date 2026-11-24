import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { SegmentMemberRow } from "@/lib/api/customer-segments";
import { formatCurrency, formatMediumDate, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * The customers in a segment: name (linked), email, orders, amount spent in the SHOP currency the
 * page came with (never a guessed one), last order and the email subscription. Names and emails
 * sit in `<bdi dir="auto">` so a Latin email next to an Arabic name never reorders.
 */
export function SegmentMembersTable({
  members,
  currency,
  t,
  locale,
}: {
  readonly members: readonly SegmentMemberRow[];
  readonly currency: string;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.segments.members;

  return (
    <Table aria-label={k.tableLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{k.columns.name}</TableHead>
          <TableHead>{k.columns.email}</TableHead>
          <TableHead className="text-end">{k.columns.orders}</TableHead>
          <TableHead className="text-end">{k.columns.amountSpent}</TableHead>
          <TableHead>{k.columns.lastOrder}</TableHead>
          <TableHead>{k.columns.emailSubscription}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="font-medium">
              <Link
                href={`/customers/${encodeURIComponent(member.id)}`}
                className="hover:text-primary"
                aria-label={t.customersPage.viewCustomer.replace("{name}", member.name)}
              >
                <bdi dir="auto">{member.name}</bdi>
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <bdi dir="auto">{member.email}</bdi>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatNumber(locale, member.ordersCount)}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatCurrency(locale, member.amountSpentMinor, currency)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {member.lastOrderAt === null ? "—" : formatMediumDate(locale, member.lastOrderAt)}
            </TableCell>
            <TableCell>
              <Badge variant={member.emailSubscribed ? "success" : "neutral"}>
                {member.emailSubscribed ? k.subscribed : k.notSubscribed}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
