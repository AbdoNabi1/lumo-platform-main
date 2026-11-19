import Image from "next/image";
import Link from "next/link";
import { PackageIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@platform/ui";
import { AddToCartButton } from "./add-to-cart-button";
import { formatCurrency, formatNumber } from "@/lib/format";
import { safeImageSrc } from "@/lib/safe-image";
import type { AvailabilityResolution, PriceResolution, PublishedProduct } from "@/lib/catalog";
import type { ProductImageSummary } from "@/lib/runtime-api";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";

/**
 * One product, linking to its detail page, with a guest add-to-cart action (Task 9). Price and
 * availability are passed in already resolved (`priceOf` from the product's own variants, and `AvailabilityBook`) rather than
 * re-fetched per card, so a grid of these costs one inventory call in total, not one per product.
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
  // Plan 2C-3: an older API sends only `media`; a newer one names the card's two pictures itself.
  // A picture whose url is empty or not an http(s)/same-site address is no picture (it would crash
  // next/image, or load something that is not ours): the card shows its placeholder instead.
  const usable = (image: ProductImageSummary | null | undefined) =>
    image !== null && image !== undefined && safeImageSrc(image.url) !== null ? image : null;
  const featured = usable(product.featuredImage ?? product.media?.[0]);
  const hover = usable(product.hoverImage ?? product.media?.[1]);
  const alt = featured?.alt ?? product.name;
  // The slug is encoded so it can only ever be one path segment (F5).
  const href = `/products/${encodeURIComponent(product.slug)}`;

  return (
    <Card variant="interactive">
      <Link href={href} className="group block">
        {/* A square, so the grid does not jump as pictures load. The hover picture is CSS only. */}
        <div className="bg-muted relative aspect-square w-full overflow-hidden">
          {featured !== null ? (
            <>
              <Image
                src={featured.url}
                alt={alt}
                fill
                sizes="(min-width: 1024px) 20rem, 50vw"
                unoptimized
                loading="lazy"
                className="object-cover"
              />
              {hover !== null && (
                <Image
                  src={hover.url}
                  alt={hover.alt ?? product.name}
                  aria-hidden="true"
                  fill
                  sizes="(min-width: 1024px) 20rem, 50vw"
                  unoptimized
                  loading="lazy"
                  className="object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <div
              role="img"
              aria-label={t.product.gallery.noImage}
              className="text-muted-foreground flex size-full items-center justify-center"
            >
              <PackageIcon aria-hidden="true" className="size-8" />
            </div>
          )}
        </div>
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
      {/*
       * Plan 2A: a quick add can only name a variant when there is exactly one. A product with
       * several (sizes, colours) is bought from its detail page, where the shopper picks one —
       * Shopify's "Choose options" button takes them there.
       */}
      {price.status === "ok" && product.variants.length <= 1 && (
        <CardFooter>
          <AddToCartButton
            productId={product.id}
            variantId={product.variants[0]?.id}
            outOfStock={outOfStock}
            sellableWhenOutOfStock={product.variants[0]?.sellableWhenOutOfStock}
            t={t}
          />
        </CardFooter>
      )}
      {price.status === "ok" && product.variants.length > 1 && (
        <CardFooter>
          <Button asChild>
            <Link href={href}>{t.product.chooseOptions}</Link>
          </Button>
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
    // Plan 2C-1: "From …" when the variants are not all priced alike; the compare-at (the lowest
    // variant's own) is struck through beside it.
    const amount = formatCurrency(locale, price.amountMinor, price.currency);
    return (
      <span className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">
          {price.varies ? t.product.priceFrom.replace("{price}", amount) : amount}
        </span>
        {price.compareAtMinor !== null && (
          <s className="text-muted-foreground">
            {formatCurrency(locale, price.compareAtMinor, price.currency)}
          </s>
        )}
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
  // Plan 2B-1: a product that sells past zero has no meaningful count to show.
  if (availability.available === Number.POSITIVE_INFINITY) {
    return <Badge variant="success">{t.product.inStockNoCount}</Badge>;
  }
  return (
    <Badge variant="success">
      {t.product.inStock.replace("{count}", formatNumber(locale, availability.available))}
    </Badge>
  );
}
