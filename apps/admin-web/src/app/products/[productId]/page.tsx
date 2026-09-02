import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangleIcon, ArrowLeftIcon, LockIcon, SearchXIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import {
  ProductInventoryCard,
  ProductInventoryCardSkeleton,
} from "@/components/products/product-inventory-card";
import { ProductEditForm } from "@/components/products/product-edit-form";
import { ProductLifecycleActions } from "@/components/products/product-lifecycle-actions";
import { ProductMediaSeoCard } from "@/components/products/product-media-seo-card";
import { ProductOrganizationCard } from "@/components/products/product-organization-card";
import { ProductStatusBadge } from "@/components/products/product-status-badge";
import { ProductVariantsCard } from "@/components/products/product-variants-card";
import { fetchBrandsPage } from "@/lib/api/brands";
import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchMediaDownloadUrl } from "@/lib/api/media";
import { fetchProduct } from "@/lib/api/products";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";

interface ProductDetailPageProps {
  readonly params: Promise<{ readonly productId: string }>;
}

/**
 * The Product Detail screen (Phase A.30). Resolves the real `GET /products/:productId` endpoint.
 * Inventory gets its own `<Suspense>` boundary (separate bounded context) so a slow/failed
 * Inventory read never blocks the rest of the product from rendering — same streaming discipline
 * as the Order Detail screen.
 */
export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();
  const { productId } = await params;

  const result = await fetchProduct(productId);

  if (result.outcome === "unauthorized") {
    return (
      <AppShell t={t} locale={locale} activeNavId="products" user={user}>
        <StatePanel
          icon={<LockIcon aria-hidden="true" className="size-5" />}
          message={t.productDetail.unauthorized}
          backLabel={t.productDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "not_found") {
    return (
      <AppShell t={t} locale={locale} activeNavId="products" user={user}>
        <StatePanel
          icon={<SearchXIcon aria-hidden="true" className="size-5" />}
          message={t.productDetail.notFound}
          backLabel={t.productDetail.back}
        />
      </AppShell>
    );
  }
  if (result.outcome === "error") {
    return (
      <AppShell t={t} locale={locale} activeNavId="products" user={user}>
        <StatePanel
          icon={<AlertTriangleIcon aria-hidden="true" className="size-5" />}
          message={t.productDetail.error}
          backLabel={t.productDetail.back}
        />
      </AppShell>
    );
  }

  const product = result.product;

  // T3.6: resolve a download URL per attached media asset — there is no list/batch endpoint
  // (see `docs/plans/BLOCKERS.md`), so this fans out one `GET /media/assets/:id/download-url`
  // call per id, same fan-out shape as `lib/api/licensing.ts`'s `fetchUsageCounters`. A failed
  // lookup renders an explicit "unavailable" state for that one asset (README rule #4) rather
  // than hiding it or fabricating a link.
  const mediaAssets = await Promise.all(
    product.mediaAssetIds.map(async (id) => {
      const downloadResult = await fetchMediaDownloadUrl(id);
      return { id, url: downloadResult.outcome === "ok" ? downloadResult.url : null };
    }),
  );

  // T5.7: brand/category pickers on `ProductOrganizationCard` need the lists to render `<select>`/
  // checklist options — fetched server-side here (never from the Client Component, per the
  // repo-wide "never call the runtime API from browser JS" rule) and passed down as plain DTO
  // arrays. Capped to the first page (100): a search-as-you-type picker is out of scope for this
  // task. A failed fetch degrades to an empty list rather than fabricating options — the card still
  // renders the product's actual assigned id(s) as an "unlisted" option either way.
  const [brandsResult, categoriesResult] = await Promise.all([
    fetchBrandsPage({ first: 100 }),
    fetchCategoriesPage({ first: 100 }),
  ]);
  const brands = brandsResult.outcome === "ok" ? brandsResult.items : [];
  const categories = categoriesResult.outcome === "ok" ? categoriesResult.items : [];

  return (
    <AppShell t={t} locale={locale} activeNavId="products" user={user}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
            <Link href="/products">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {t.productDetail.back}
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">{product.name}</h1>
            <ProductStatusBadge status={product.status} t={t} />
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.productDetail.sku}: <span className="font-mono">{product.sku}</span> ·{" "}
            {t.productDetail.slug}: <span className="font-mono">{product.slug}</span>
          </p>
          {product.scheduledAt !== null && (
            <p className="text-muted-foreground mt-1 text-sm">
              {t.productDetail.scheduledFor.replace(
                "{date}",
                formatDateTime(locale, product.scheduledAt),
              )}
            </p>
          )}

          <div className="mt-4">
            <ProductLifecycleActions productId={product.id} status={product.status} t={t} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="flex flex-col gap-6 xl:col-span-2">
            <ProductVariantsCard
              productId={product.id}
              variants={product.variants}
              t={t}
              locale={locale}
            />
            <Suspense fallback={<ProductInventoryCardSkeleton t={t} />}>
              <ProductInventoryCard productId={product.id} t={t} />
            </Suspense>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t.productEdit.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ProductEditForm
                  productId={product.id}
                  name={product.name}
                  slug={product.slug}
                  t={t}
                />
              </CardContent>
            </Card>
            <ProductOrganizationCard
              productId={product.id}
              brandId={product.brandId}
              categoryIds={product.categoryIds}
              options={product.options}
              brands={brands}
              categories={categories}
              t={t}
            />
            <ProductMediaSeoCard
              productId={product.id}
              mediaAssets={mediaAssets}
              seoTitle={product.seoTitle}
              seoDescription={product.seoDescription}
              t={t}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatePanel({
  icon,
  message,
  backLabel,
}: {
  readonly icon: ReactNode;
  readonly message: string;
  readonly backLabel: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Card>
        <CardContent className="text-muted-foreground flex flex-col items-center gap-4 px-4 py-12 text-center sm:px-5">
          {icon}
          <p role="note">{message}</p>
          <Button variant="outline" asChild>
            <Link href="/products">
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {backLabel}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
