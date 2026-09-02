import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ArrowLeftIcon, PackageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Separator } from "@platform/ui";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { AddToWishlistButton } from "@/components/add-to-wishlist-button";
import { AvailabilityBadge, PriceLabel } from "@/components/product-card";
import { ProductReviews } from "@/components/product-reviews";
import { SiteHeader } from "@/components/site-header";
import { StatePanel } from "@/components/state-panel";
import { WriteReviewForm } from "@/components/write-review-form";
import { AvailabilityBook, PriceBook, resolveProductBySlug } from "@/lib/catalog";
import { CUSTOMER_SESSION_COOKIE, resolveCurrentCustomer } from "@/lib/customer-session";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { getProductReviews } from "@/lib/runtime-api";

/** The reviews section's own page size (T5.18) — mirrors `COLLECTION_PRODUCTS_PAGE_SIZE`'s reasoning in `lib/catalog.ts`: a real page, not an attempt to fit everything on one request. */
const PRODUCT_REVIEWS_PAGE_SIZE = 10;

/**
 * Product Detail. Only fields the public `/public/products` DTO actually carries are shown —
 * `name`, `sku`, `slug`, `variants[].{id,sku}`, plus price (Pricing's product-level, real
 * `getPrices()`) and availability (Inventory, summed across warehouses). The DTO has no
 * description, image/media, brand, or category fields, so none are rendered — see the Phase 2
 * report for the full list of fields evaluated and why each was included or omitted.
 *
 * T5.18 added a reviews section below the core product card (display only at the time). T5.18-write
 * adds the submission form: rendered only when {@link resolveCurrentCustomer} confirms a REAL
 * server-side session, exactly the same discipline the wishlist affordance below already uses — a
 * signed-out shopper sees a sign-in link instead of a form that would fail on submit.
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly reviewsAfter?: string }>;
}) {
  const { slug } = await params;
  const { reviewsAfter } = await searchParams;
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);

  const result = await resolveProductBySlug(slug);

  if (result.status === "not-found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
        <SiteHeader t={t} locale={locale} />
        <StatePanel
          icon={<AlertTriangleIcon className="size-6" />}
          title={t.product.errorTitle}
          body={t.product.errorBody}
          action={{ href: "/", label: t.product.backToShop }}
        />
      </main>
    );
  }

  const { product } = result;
  const [priceBook, availabilityBook, reviewsPage, customer] = await Promise.all([
    PriceBook.load(),
    AvailabilityBook.load(),
    getProductReviews(product.id, PRODUCT_REVIEWS_PAGE_SIZE, reviewsAfter),
    /**
     * T5.17 Part B — gates the "save for later" affordance below, and (T5.18-write) the review
     * submission form. A REAL server-side session validation, not a cookie-presence guess: an
     * expired or revoked cookie correctly renders no wishlist control and no review form at all.
     *
     * Deliberately resolved here, on the detail page, and NOT inside `ProductCard`: a card renders
     * in grids (home, collections, search), and putting the affordance there would either cost one
     * session lookup per page render for a control most visitors cannot use, or force every grid
     * page to thread a `signedIn` prop down. The detail page is where a shopper decides to save or
     * review something, and it already performs several per-product reads, so one more is
     * proportionate.
     */
    resolveCurrentCustomer((await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value),
  ]);
  const price = priceBook?.resolve(product.id) ?? { status: "unavailable" as const };
  const availability = availabilityBook?.resolve(product.id) ?? { status: "unknown" as const };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-8">
      <SiteHeader t={t} locale={locale} />

      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <ArrowLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t.product.backToShop}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span
              className="bg-secondary text-secondary-foreground flex size-9 shrink-0 items-center justify-center rounded-md"
              aria-hidden="true"
            >
              <PackageIcon className="size-4" />
            </span>
            <h1>
              <CardTitle as="div">{product.name}</CardTitle>
            </h1>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            {t.product.sku}: {product.sku}
          </p>

          <div className="flex items-center gap-3">
            <PriceLabel price={price} t={t} locale={locale} />
            <AvailabilityBadge availability={availability} t={t} locale={locale} />
          </div>

          {price.status === "ok" && (
            <AddToCartButton
              productId={product.id}
              outOfStock={availability.status === "ok" && availability.available <= 0}
              t={t}
            />
          )}

          {/*
           * Shown only to a signed-in customer — a wishlist has no `customerRef` to be scoped to
           * for an anonymous shopper, so there is nothing to offer rather than a control that would
           * fail on click. An `"error"` resolution renders nothing either: when the session cannot
           * be verified, the safe default is to withhold the control, not to guess.
           */}
          {customer.status === "signed-in" && (
            <AddToWishlistButton productRef={product.id} t={t} />
          )}

          {product.variants.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t.product.variants}</h2>
                <ul className="flex flex-col gap-2">
                  {product.variants.map((variant) => (
                    <li
                      key={variant.id}
                      className="border-border rounded-md border px-3 py-2 text-sm"
                    >
                      {t.product.variantSku.replace("{sku}", variant.sku)}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/*
       * Same `"error"`-withholds-the-control discipline as `AddToWishlistButton` above: when the
       * session cannot be verified, the safe default is to show neither the form nor a sign-in
       * prompt, not to guess which one applies.
       */}
      {customer.status !== "error" && (
        <Card>
          <CardContent className="py-6">
            {customer.status === "signed-in" ? (
              <WriteReviewForm slug={slug} productRef={product.id} t={t} />
            ) : (
              <p className="text-muted-foreground text-sm">
                <Link href="/account/login" className="text-foreground underline">
                  {t.product.reviewForm.signInPrompt}
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <ProductReviews slug={slug} page={reviewsPage} t={t} />
    </main>
  );
}
