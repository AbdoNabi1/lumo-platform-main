import { CollectionCard } from "@/components/collection-card";
import { ProductCard } from "@/components/product-card";
import {
  AvailabilityBook,
  listPublishedCollections,
  listPublishedProducts,
  priceOf,
} from "@/lib/catalog";
import { dictionaryFor } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/request-locale";
import { getCategories } from "@/lib/runtime-api";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";

/**
 * Storefront home. Products/Collections are real catalog data (Phase 2) — each card links to
 * its own detail page. Categories has no detail page in this phase, so it stays a plain list,
 * same as Sprint 0.1's original smoke test.
 */
export default async function Home() {
  const locale = await getRequestLocale();
  const t = dictionaryFor(locale);

  const [productsResult, collectionsResult, categories, availabilityBook] = await Promise.all([
    listPublishedProducts(),
    listPublishedCollections(),
    getCategories(),
    AvailabilityBook.load(),
  ]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{t.home.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t.home.subtitle}</p>
        </CardContent>
      </Card>

      <section aria-labelledby="products-heading" className="flex flex-col gap-3">
        <h2 id="products-heading" className="text-lg font-semibold">
          {t.home.productsTitle}
        </h2>
        {productsResult.status === "error" ? (
          <p className="text-muted-foreground text-sm">{t.home.productsError}</p>
        ) : productsResult.products.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.home.productsEmpty}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {productsResult.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                price={priceOf(product)}
                availability={availabilityBook?.resolveProduct(product) ?? { status: "unknown" }}
                t={t}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
        <h2 id="categories-heading" className="text-lg font-semibold">
          {t.home.categoriesTitle}
        </h2>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            {categories === null || categories.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t.home.categoriesEmpty}</p>
            ) : (
              categories.map((category) => (
                <div key={category.id} className="border-b pb-2 text-sm last:border-b-0">
                  {category.name}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="collections-heading" className="flex flex-col gap-3">
        <h2 id="collections-heading" className="text-lg font-semibold">
          {t.home.collectionsTitle}
        </h2>
        {collectionsResult.status === "error" ? (
          <p className="text-muted-foreground text-sm">{t.home.collectionsError}</p>
        ) : collectionsResult.collections.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.home.collectionsEmpty}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {collectionsResult.collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} t={t} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
