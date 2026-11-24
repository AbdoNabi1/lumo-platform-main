import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { SegmentView } from "@/lib/api/customer-segments";
import { formatMediumDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { segmentDisplayName, segmentHref } from "@/lib/customers/segment-labels";
import type { Dictionary } from "@/messages/en";

/** The Segments list: name (defaults in their localized label), type, last edited. */
export function SegmentsTable({
  segments,
  t,
  locale,
}: {
  readonly segments: readonly SegmentView[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.segments;

  return (
    <Table aria-label={k.listLabel}>
      <TableHeader>
        <TableRow>
          <TableHead>{k.columns.name}</TableHead>
          <TableHead>{k.columns.type}</TableHead>
          <TableHead>{k.columns.lastEdited}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {segments.map((segment) => {
          const name = segmentDisplayName(segment, t);
          return (
            <TableRow key={segment.id}>
              <TableCell className="font-medium">
                <Link
                  href={segmentHref(segment.id)}
                  className="hover:text-primary"
                  aria-label={k.openSegment.replace("{name}", name)}
                >
                  <bdi dir="auto">{name}</bdi>
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={segment.kind === "default" ? "neutral" : "accent"}>
                  {k.types[segment.kind]}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {segment.updatedAt === null ? "—" : formatMediumDate(locale, segment.updatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
