import Link from "next/link";
import { Badge, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@platform/ui";
import { AddToCartButton } from "./add-to-cart-button";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { AvailabilityResolution, PriceResolution, PublishedProduct } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * One product, linking to its detail page, with a guest add-to-cart action (Task 9). Price and
 * availability are passed in already resolved (`PriceBook`/`AvailabilityBook`) rather than
 * re-fetched per card, so a grid of these costs one price call and one inventory call in total,
 * not one per product.
 *
 * The card is no longer fully clickable (Productization Phase 8's design) — only the title links
 * to the detail page. A `<button>` cannot legally nest inside an `<a>`, so once a real add-to-cart
 * action exists here, the previous whole-card `<Link>` had to shrink to just the navigable part.
 */
export function ProductCard({
  product,
  price,
  availability,
  t,
  locale,
}: {
  readonly product: PublishedProduct;
  readonly price: PriceResolution;
  readonly availability: AvailabilityResolution;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  const outOfStock = availability.status === "ok" && availability.available <= 0;

  return (
    <Card variant="interactive">
      <Link href={`/products/${product.slug}`} className="block">
        <CardHeader>
          <CardTitle as="h3" className="text-base">
            {product.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <PriceLabel price={price} t={t} locale={locale} />
          <AvailabilityBadge availability={availability} t={t} locale={locale} />
        </CardContent>
      </Link>
      {price.status === "ok" && (
        <CardFooter>
          <AddToCartButton productId={product.id} outOfStock={outOfStock} t={t} />
        </CardFooter>
      )}
    </Card>
  );
}

export function PriceLabel({
  price,
  t,
  locale,
}: {
  readonly price: PriceResolution;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (price.status === "ok") {
    return (
      <span className="text-sm font-medium">
        {formatCurrency(locale, price.amountMinor, price.currency)}
      </span>
    );
  }
  return <span className="text-muted-foreground text-sm">{t.product.priceUnavailable}</span>;
}

export function AvailabilityBadge({
  availability,
  t,
  locale,
}: {
  readonly availability: AvailabilityResolution;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  if (availability.status === "unknown") {
    return <Badge variant="neutral">{t.product.availabilityUnknown}</Badge>;
  }
  if (availability.available <= 0) {
    return <Badge variant="destructive">{t.product.outOfStock}</Badge>;
  }
  return (
    <Badge variant="success">
      {t.product.inStock.replace("{count}", formatNumber(locale, availability.available))}
    </Badge>
  );
}
