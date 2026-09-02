import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { formatNumber } from "@/lib/format";
import type { PublishedCollection } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

export function CollectionCard({
  collection,
  t,
  locale,
}: {
  readonly collection: PublishedCollection;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <Link href={`/collections/${collection.slug}`} className="block">
      <Card variant="interactive">
        <CardHeader>
          <CardTitle as="h3" className="text-base">
            {collection.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="text-muted-foreground text-sm">
            {t.collection.productCount.replace(
              "{count}",
              formatNumber(locale, collection.productIds.length),
            )}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
