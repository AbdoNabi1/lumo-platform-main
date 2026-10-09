import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@platform/ui";
import { AppShell } from "@/components/app-shell";
import { ProductEditor } from "@/components/products/editor/product-editor";
import { fetchBrandsPage } from "@/lib/api/brands";
import { fetchCategoriesPage } from "@/lib/api/categories";
import { fetchWarehouses } from "@/lib/api/inventory";
import { fetchProductsPage } from "@/lib/api/products";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_LOCALE, dictionaryFor, isLocale, LOCALE_COOKIE } from "@/lib/i18n";
import { buildStockView, UNAVAILABLE_STOCK } from "@/lib/products/stock";

/**
 * The create screen — the same one-page editor as the detail screen (Plan 2C-2). Gated to
 * `operator`+ by `middleware.ts`.
 */
export default async function NewProductPage() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const t = dictionaryFor(locale);
  const user = await getCurrentUser();

  const [brandsResult, categoriesResult, productsResult, warehousesResult] = await Promise.all([
    fetchBrandsPage({ first: 100 }),
    fetchCategoriesPage({ first: 100 }),
    fetchProductsPage({ first: 1 }),
    fetchWarehouses(),
  ]);
  const brands = brandsResult.outcome === "ok" ? brandsResult.items : [];
  const categories = categoriesResult.outcome === "ok" ? categoriesResult.items : [];
  // Until a store currency setting exists (G-99), the newest product's currency is the best guess
  // of the store's currency; a store with no products yet starts on EGP.
  const defaultCurrency =
    (productsResult.outcome === "ok" ? productsResult.items[0]?.currency : null) ?? "EGP";

  // A new product has no stock yet; the view still names the location the opening quantity goes
  // to, and turns the quantity read-only when the shop has several (or could not be read).
  const stock =
    warehousesResult.outcome === "ok"
      ? buildStockView(warehousesResult.items, [], [])
      : UNAVAILABLE_STOCK;

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
          <h1 className="text-4xl font-semibold tracking-tight">{t.productCreate.title}</h1>
          <p className="text-md text-muted-foreground mt-1">{t.productCreate.subtitle}</p>
        </div>

        <ProductEditor
          mode="create"
          product={null}
          brands={brands}
          categories={categories}
          defaultCurrency={defaultCurrency}
          t={t}
          locale={locale}
          stock={stock}
          storefrontUrl={null}
          slots={{}}
        />
      </div>
    </AppShell>
  );
}
