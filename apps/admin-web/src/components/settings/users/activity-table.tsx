import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { StaffActivityItem } from "@/lib/staff/two-step";
import type { Dictionary } from "@/messages/en";
import { ActivitySentence } from "./activity-sentence";

/** When / Who / What. Server-rendered: nothing here is interactive. */
export function ActivityTable({
  items,
  t,
  locale,
}: {
  readonly items: readonly StaffActivityItem[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.usersActivity;
  return (
    <Table aria-label={k.listLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{k.columns.when}</TableHead>
          <TableHead>{k.columns.who}</TableHead>
          <TableHead>{k.columns.what}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const who = item.actorEmail ?? item.subjectEmail;
          return (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatDateTime(locale, item.at)}
              </TableCell>
              <TableCell className="font-medium">
                {who === null ? "—" : <bdi dir="auto">{who}</bdi>}
              </TableCell>
              <TableCell>
                <ActivitySentence item={item} t={t} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
