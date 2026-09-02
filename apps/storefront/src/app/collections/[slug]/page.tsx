import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon, PackageSearchIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { ProductCard } from "@/components/product-card";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { AvailabilityBook, PriceBook, resolveCollectionBySlug } from "@/lib/catalog";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/**
 * Collection Page. Membership comes from the collection's own `productIds` (curated order is
 * part of the public contract — `toCollectionDto` preserves array order, so member products
 * render in that order, not re-sorted). No filtering/search is added — the spec is explicit
 * that this phase doesn't add speculative discovery features.
 *
 * Membership is fetched one paginated page at a time (T5.20 — `GET /public/collections/:slug/
 * products`) rather than the whole catalog's first 100 products intersected client-side, which
 * silently dropped any member beyond that page. `?after=<cursor>` in the URL selects the page, so
 * "next page" is a plain link (shareable, works with JS disabled) rather than client-side state —
 * there is no "previous page" link because the cursor route is forward-only, same as every other
 * cursor-paginated route in this codebase; going back is a browser-back, not a fabricated link.
 */
export default async function CollectionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly after?: string }>;
}) {
  const { slug } = await params;
  const { after } = await searchParams;
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveCollectionBySlug(slug, after);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
        <SiteHeader t={t} locale={locale} />
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.collection.errorTitle}
          body={t.collection.errorBody}
          action={{ href: "/", label: t.collection.backToShop }}
        />
      </main>
    );
  }

  const { collection, products, pageInfo } = result;
  const isFirstPage = after === undefined;
  const [priceBook, availabilityBook] = await Promise.all([
    PriceBook.load(),
    AvailabilityBook.load(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.collection.backToShop}
      </Link>

      <Card>
        <CardHeader>
          <h1>
            <CardTitle as="div">{collection.name}</CardTitle>
          </h1>
        </CardHeader>
        <CardContent>
          <span className="text-muted-foreground text-sm">
            {t.collection.productCount.replace("{count}", String(products.length))}
          </span>
        </CardContent>
      </Card>

      {products.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <PackageSearchIcon aria-hidden="true" className="size-5" />
            {/* A later page can legitimately come back empty after filtering stale/unpublished
                ids while `hasNextPage` is still true (see the use case's own doc comment) — that
                is not "this collection has no products", so it gets its own copy. */}
            <p role="note">{isFirstPage ? t.collection.empty : t.collection.emptyPage}</p>
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

      {pageInfo.hasNextPage && pageInfo.endCursor !== null ? (
        <Link
          href={`/collections/${encodeURIComponent(slug)}?after=${encodeURIComponent(pageInfo.endCursor)}`}
          className="text-muted-foreground inline-flex items-center gap-1.5 self-center text-sm"
        >
          {t.collection.nextPage}
          <ArrowRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      ) : null}
    </main>
  );
}
