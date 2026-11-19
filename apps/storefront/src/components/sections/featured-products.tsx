import { ProductCard } from "@/components/product-card";
import { priceOf, type AvailabilityBook, type PublishedProduct } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { SectionHeading } from "./section-heading";
import { columnsClass } from "./section-styles";
import type { Settings } from "./section-types";

/** A grid of product cards. Keyed by position: the same product may be listed twice. */
export function ProductGrid({
  products,
  columns,
  availability,
  t,
  locale,
}: {
  readonly products: readonly PublishedProduct[];
  readonly columns: number;
  readonly availability: AvailabilityBook | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <div className={`grid gap-3 ${columnsClass(columns)}`}>
      {products.map((product, index) => (
        <ProductCard
          key={index}
          product={product}
          price={priceOf(product)}
          availability={availability?.resolveProduct(product) ?? { status: "unknown" }}
          t={t}
          locale={locale}
        />
      ))}
    </div>
  );
}

export function FeaturedProducts({
  id,
  settings,
  products,
  availability,
  t,
  locale,
}: {
  readonly id: string;
  readonly settings: Settings<"featured_products">;
  readonly products: readonly PublishedProduct[];
  readonly availability: AvailabilityBook | null;
  readonly t: Dictionary;
  readonly locale: Locale;
}) {
  return (
    <>
      <SectionHeading text={settings.heading} locale={locale} id={id} />
      {products.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.home.productsEmpty}</p>
      ) : (
        <ProductGrid
          products={products}
          columns={settings.columns}
          availability={availability}
          t={t}
          locale={locale}
        />
      )}
    </>
  );
}
