import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@platform/ui";
import { ProductInventoryTable } from "./product-inventory-table";
import { fetchProductInventory } from "@/lib/api/products";
import type { Dictionary } from "@/messages/en";

/**
 * A product's stock across every warehouse (Phase A.30: Inventory had no "stock by product" query
 * at all — `GET /products/:productId/inventory` closes that gap). An async Server Component in its
 * own `<Suspense>` boundary so a slow/failed Inventory read never blocks the rest of the product
 * from rendering — same streaming discipline as the Order Detail screen's payment/customer cards.
 *
 * T5.5: the read-only rows plus their per-row "Receive"/"Adjust" write forms now live in
 * `ProductInventoryTable` (a client component, since this component stays an async Server
 * Component that does its own fetch — a file can't be both). This component still owns the fetch
 * and the ok/unavailable split; `ProductInventoryTable` never re-fetches.
 */
export async function ProductInventoryCard({
  productId,
  t,
}: {
  readonly productId: string;
  readonly t: Dictionary;
}) {
  const result = await fetchProductInventory(productId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.productDetail.inventory}</CardTitle>
      </CardHeader>
      <CardContent className={result.outcome === "ok" ? "p-0 sm:p-0" : undefined}>
        {result.outcome === "ok" ? (
          <ProductInventoryTable productId={productId} rows={result.rows} t={t} />
        ) : (
          <p className="text-muted-foreground text-sm">{t.productDetail.inventoryUnavailable}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ProductInventoryCardSkeleton({ t }: { readonly t: Dictionary }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{t.productDetail.inventory}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton key={index} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
