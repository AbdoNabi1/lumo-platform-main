import Link from "next/link";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@platform/ui";
import type { CollectionDto } from "@/lib/api/collections";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/** Shopify's collection list: Title (a link to the collection), Products (count), Status. */
export function CollectionsTable({
  collections,
  t,
  locale,
}: {
  readonly collections: readonly CollectionDto[];
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const k = t.collections;
  return (
    <Table aria-label={k.title}>
      <TableHeader>
        <TableRow>
          <TableHead>{k.columns.title}</TableHead>
          <TableHead className="text-end">{k.columns.products}</TableHead>
          <TableHead>{k.columns.status}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {collections.map((collection) => (
          <TableRow key={collection.id}>
            <TableCell>
              <Link
                href={`/collections/${encodeURIComponent(collection.id)}`}
                className="font-medium hover:underline"
              >
                <bdi dir="auto">{collection.name}</bdi>
              </Link>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatNumber(locale, collection.productCount)}
            </TableCell>
            <TableCell>
              <Badge variant={collection.status === "published" ? "success" : "neutral"}>
                {collection.status === "published" ? k.statusPublished : k.statusDraft}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
