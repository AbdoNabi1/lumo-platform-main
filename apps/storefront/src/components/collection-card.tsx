import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { safeImageSrc } from "@/lib/safe-image";
import type { HomeCollection } from "@/lib/section-data";
import type { Dictionary } from "@/messages/en";

/**
 * One collection, linking to its page. The picture is optional (a merchant choice, dropped when
 * its url is unusable) and the count is nullable (omitted when the list did not name it). The slug
 * is encoded so the link can only be one path segment under `/collections` (F5).
 */
export function CollectionCard({
  collection,
  t,
  locale,
}: {
  readonly collection: HomeCollection;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const src = safeImageSrc(collection.image?.url);
  return (
    <Link href={`/collections/${encodeURIComponent(collection.slug)}`} className="block">
      <Card variant="interactive">
        {src !== null && (
          <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden">
            <Image
              src={src}
              alt={collection.image?.alt ?? ""}
              fill
              sizes="(min-width: 1024px) 20rem, 50vw"
              unoptimized
              loading="lazy"
              className="object-cover"
            />
          </div>
        )}
        <CardHeader>
          <CardTitle as="h3" className="text-base">
            {collection.name}
          </CardTitle>
        </CardHeader>
        {collection.productCount !== null && (
          <CardContent>
            <span className="text-muted-foreground text-sm">
              {t.collection.productCount.replace(
                "{count}",
                formatNumber(locale, collection.productCount),
              )}
            </span>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}
