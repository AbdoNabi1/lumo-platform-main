import { MenuLink } from "@/components/menu-link";
import type { AvailabilityBook, PublishedProduct } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/messages/en";
import { ProductGrid } from "./featured-products";
import { SectionHeading } from "./section-heading";
import { BUTTON_CLASS } from "./section-styles";
import type { Settings } from "./section-types";

export function FeaturedCollection({
  id,
  settings,
  products,
  availability,
  t,
  locale,
  previewToken,
}: {
  readonly id: string;
  readonly settings: Settings<"featured_collection">;
  readonly products: readonly PublishedProduct[];
  readonly availability: AvailabilityBook | null;
  readonly t: Dictionary;
  readonly locale: Locale;
  readonly previewToken: string | null;
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
      {settings.showViewAll && (
        <div className="flex justify-center">
          <MenuLink
            entry={{
              label: t.sections.viewAll,
              href: `/collections/${encodeURIComponent(settings.collection.slug)}`,
              external: false,
              children: [],
            }}
            previewToken={previewToken}
            className={BUTTON_CLASS.secondary}
          />
        </div>
      )}
    </>
  );
}
