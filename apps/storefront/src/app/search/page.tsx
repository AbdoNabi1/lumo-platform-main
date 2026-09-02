import { cookies } from "next/headers";
import Link from "next/link";
import { AlertTriangleIcon, ArrowLeftIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Card, CardContent } from "@platform/ui";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { AvailabilityBook, PriceBook, searchPublishedProducts } from "@/lib/catalog";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Search results (T5.15). Calls the public `GET /public/products?query=...` route added this task
 * (`apps/admin/src/http/public-catalog-routes.ts`) via `searchPublishedProducts`
 * (`apps/storefront/src/lib/catalog.ts`) — a case-insensitive substring match over Catalog's own
 * product data (`ListProducts`' own doc comment), not the dedicated Search context's eventual
 * ranked relevance (that context has no query-execution capability at all today — see
 * `docs/plans/BLOCKERS.md`'s T5.15 entry). Three explicit states beyond the results grid: no query
 * given yet (prompt), a query with zero matches (empty), and a failed catalog call (error) — never
 * a blank page.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  if (query.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
        <SiteHeader t={t} locale={locale} />
        <StatePanel
          icon={<SearchIcon className="size-6" />}
          title={t.search.promptTitle}
          body={t.search.promptBody}
          action={{ href: "/", label: t.search.backToShop }}
        />
      </main>
    );
  }

  const result = await searchPublishedProducts(query);

  if (result.status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
        <SiteHeader t={t} locale={locale} />
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.search.errorTitle}
          body={t.search.errorBody}
          action={{ href: "/", label: t.search.backToShop }}
        />
      </main>
    );
  }

  const { products } = result;
  const [priceBook, availabilityBook] = await Promise.all([
    PriceBook.load(),
    AvailabilityBook.load(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.search.backToShop}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t.search.resultsTitle}</h1>
        <p className="text-muted-foreground text-sm">
          {t.search.resultsCount
            .replace("{count}", String(products.length))
            .replace("{query}", query)}
        </p>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <SearchXIcon aria-hidden="true" className="size-5" />
            <p className="text-foreground font-medium">{t.search.emptyTitle}</p>
            <p role="note">{t.search.emptyBody.replace("{query}", query)}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              price={priceBook?.resolve(product.id) ?? { status: "unavailable" }}
              availability={availabilityBook?.resolve(product.id) ?? { status: "unknown" }}
              t={t}
              locale={locale}
            />
          ))}
        </div>
      )}
    </main>
  );
}
